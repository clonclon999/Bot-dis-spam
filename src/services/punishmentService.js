import { ESCALATION_LADDER, SYSTEM_LIMITS } from '../config/defaults.js';
import {
  buildModLogEmbed,
  buildUserWarningEmbed,
  sanitizeContentPreview,
} from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import {
  canBotDeleteMessage,
  canBotSendEmbed,
  checkBotCanTimeout,
} from '../utils/permissions.js';

/**
 * Dịch vụ thực thi xử phạt vi phạm theo mức độ lũy tiến (Progressive Moderation):
 * 1. Tự động xóa tin nhắn vi phạm an toàn.
 * 2. Tính toán mức độ vi phạm (Cảnh cáo -> Timeout 5m -> 30m -> 2h -> 24h).
 * 3. Gửi thông báo cảnh cáo rõ lý do (kèm cơ chế chống tràn thông báo & tự thu hồi).
 * 4. Ghi log vào bộ nhớ bền vững và gửi Embed chi tiết tới kênh Log quản trị.
 */
export class PunishmentService {
  /**
   * @param {object} deps
   * @param {import('../storage/guildStore.js').GuildStore} deps.guildStore
   * @param {import('./mentionDetector.js').MentionDetector} deps.mentionDetector
   */
  constructor({ guildStore, mentionDetector }) {
    this.guildStore = guildStore;
    this.mentionDetector = mentionDetector;

    /**
     * Khóa: `${guildId}:${userId}`
     * Giá trị: `{ level: number, lastOffenseAt: number, lastWarnSentAt: number }`
     * @type {Map<string, { level: number, lastOffenseAt: number, lastWarnSentAt: number }>}
     */
    this.userStrikes = new Map();
  }

  /**
   * Lấy bước xử phạt tương ứng với cấp độ vi phạm hiện tại.
   * @param {number} level
   * @returns {{ level: number, timeoutSeconds: number, label: string }}
   */
  getEscalationStep(level) {
    const idx = Math.max(0, Math.min(ESCALATION_LADDER.length - 1, level - 1));
    return ESCALATION_LADDER[idx];
  }

  /**
   * Xem số mức vi phạm đang còn hiệu lực của thành viên.
   * @param {string} guildId
   * @param {string} userId
   * @param {number} [strikeResetMinutes=60]
   * @param {number} [now=Date.now()]
   * @returns {number}
   */
  getUserStrikeLevel(guildId, userId, strikeResetMinutes = 60, now = Date.now()) {
    const entry = this.userStrikes.get(`${guildId}:${userId}`);
    if (!entry) return 0;
    const expireMs = strikeResetMinutes * 60_000;
    if (now - entry.lastOffenseAt > expireMs) {
      this.userStrikes.delete(`${guildId}:${userId}`);
      return 0;
    }
    return entry.level;
  }

  /**
   * Đặt lại mức cảnh cáo của một thành viên (hoặc toàn bộ một máy chủ).
   * @param {string} guildId
   * @param {string | null} [userId=null]
   */
  resetStrikes(guildId, userId = null) {
    if (userId) {
      this.userStrikes.delete(`${guildId}:${userId}`);
      this.mentionDetector?.clearUserWindow(guildId, userId);
      return;
    }
    const prefix = `${guildId}:`;
    for (const key of this.userStrikes.keys()) {
      if (key.startsWith(prefix)) {
        this.userStrikes.delete(key);
      }
    }
  }

  /**
   * Thực thi toàn bộ quy trình xử lý khi phát hiện một tin nhắn vi phạm.
   *
   * @param {object} params
   * @param {import('discord.js').Message} params.message
   * @param {object} params.violation
   * @param {object} params.config
   * @param {number} [params.now=Date.now()]
   * @returns {Promise<object>} Kết quả xử lý
   */
  async enforce({ message, violation, config, now = Date.now() }) {
    const guild = message.guild;
    const author = message.author;
    const guildId = guild.id;
    const userId = author.id;
    const key = `${guildId}:${userId}`;

    // Dọn cửa sổ trượt hiện tại của người dùng để lần tính tiếp theo bắt đầu chu kỳ mới rõ ràng
    this.mentionDetector?.clearUserWindow(guildId, userId);

    // 1. Tính toán cấp độ vi phạm lũy tiến
    const strikeExpireMs = (config.strikeResetMinutes ?? 60) * 60_000;
    let record = this.userStrikes.get(key);

    if (!record || now - record.lastOffenseAt > strikeExpireMs) {
      record = { level: 0, lastOffenseAt: 0, lastWarnSentAt: 0 };
    }

    // Gộp xung đột nếu người dùng bắn nhiều tin cùng lúc trong < 1.2 giây:
    // Vẫn xóa sạch mọi tin vi phạm nhưng không nhảy vọt từ Mức 1 lên Mức 5 chỉ trong 1 giây.
    const isSimultaneousFlood = now - record.lastOffenseAt < 1_200 && record.level > 0;
    if (!isSimultaneousFlood) {
      record.level = Math.min(ESCALATION_LADDER.length, record.level + 1);
    }

    // Nếu hành vi đặc biệt nghiêm trọng (@everyone/@here hoặc gấp đôi ngưỡng cho phép),
    // áp dụng tối thiểu Mức 2 (Timeout ngay lập tức) để bảo vệ máy chủ khỏi Raid.
    if (violation.severity === 'critical' && record.level < 2) {
      record.level = 2;
    }

    record.lastOffenseAt = now;
    this.userStrikes.set(key, record);

    const step = this.getEscalationStep(record.level);
    const me = guild.members?.me ?? null;

    const actions = {
      messageDeleted: false,
      warningSent: false,
      timeoutApplied: false,
      timeoutSeconds: step.timeoutSeconds,
      timeoutSkippedReason: null,
    };

    // 2. Xóa tin nhắn vi phạm
    try {
      if (message.deletable || canBotDeleteMessage(message.channel, me)) {
        await message.delete();
        actions.messageDeleted = true;
      }
    } catch (err) {
      // Mã lỗi 10008 = Unknown Message (tin nhắn đã bị xóa trước đó bởi AutoMod/Moderator khác)
      if (err?.code === 10008) {
        actions.messageDeleted = true;
      } else {
        logger.warn(
          'PunishmentService',
          `Không thể xóa tin nhắn ${message.id} tại guild ${guildId}: ${err.message}`
        );
      }
    }

    // 3. Áp dụng Timeout theo mức độ (nếu bước hiện tại có timeoutSeconds > 0)
    if (step.timeoutSeconds > 0) {
      if (message.webhookId) {
        actions.timeoutSkippedReason = 'Tin nhắn gửi từ Webhook (không phải thành viên).';
      } else {
        let targetMember = message.member ?? guild.members?.cache?.get(userId) ?? null;
        if (!targetMember && typeof guild.members?.fetch === 'function') {
          targetMember = await guild.members.fetch(userId).catch(() => null);
        }

        const timeoutCheck = checkBotCanTimeout(targetMember, me);
        if (!timeoutCheck.ok) {
          actions.timeoutSkippedReason = timeoutCheck.reason;
        } else {
          const safeDurationSec = Math.min(
            step.timeoutSeconds,
            SYSTEM_LIMITS.DISCORD_MAX_TIMEOUT_SECONDS
          );
          try {
            await targetMember.timeout(
              safeDurationSec * 1000,
              `[Anti-Spam Mức ${step.level}] ${violation.reason}`
            );
            actions.timeoutApplied = true;
            actions.timeoutSeconds = safeDurationSec;
          } catch (err) {
            actions.timeoutSkippedReason = `Lỗi Discord API: ${err.message}`;
            logger.warn(
              'PunishmentService',
              `Không thể timeout thành viên ${userId} tại guild ${guildId}: ${err.message}`
            );
          }
        }
      }
    }

    // 4. Cảnh cáo người vi phạm (chống gửi hàng loạt bằng warnCooldownSeconds)
    const warnCooldownMs = (config.warnCooldownSeconds ?? 8) * 1000;
    const canWarnNow = now - record.lastWarnSentAt >= warnCooldownMs;

    if (canWarnNow && canBotSendEmbed(message.channel, me)) {
      record.lastWarnSentAt = now;
      try {
        const warnEmbed = buildUserWarningEmbed({
          user: `<@${userId}>`,
          violation,
          strikeLevel: step.level,
          timeoutSeconds: actions.timeoutApplied ? actions.timeoutSeconds : 0,
          autoDeleteSeconds: config.autoDeleteWarnSeconds ?? 10,
        });

        const sentWarn = await message.channel.send({
          embeds: [warnEmbed],
          allowedMentions: { users: [userId], roles: [], parse: [] },
        });
        actions.warningSent = true;

        const autoDeleteSec = config.autoDeleteWarnSeconds ?? 10;
        if (autoDeleteSec > 0 && sentWarn && typeof sentWarn.delete === 'function') {
          const timer = setTimeout(() => {
            sentWarn.delete().catch(() => {});
          }, autoDeleteSec * 1000);
          if (typeof timer.unref === 'function') {
            timer.unref();
          }
        }
      } catch (err) {
        logger.warn(
          'PunishmentService',
          `Không thể gửi tin cảnh cáo tại kênh ${message.channelId}: ${err.message}`
        );
      }
    }

    // 5. Lưu nhật ký bền vững & gửi vào kênh Log được cấu hình (tránh gửi trùng log liên thanh trong cùng 1s)
    const timestampIso = new Date(now).toISOString();
    const contentPreview = sanitizeContentPreview(message.content ?? '');

    const logEntry = {
      id: `${now}-${userId.slice(-4)}`,
      timestamp: timestampIso,
      userId,
      userTag: author.tag || author.username || userId,
      channelId: message.channelId,
      violationType: violation.type,
      reason: violation.reason,
      mentionCount: violation.mentionCount ?? 0,
      contentPreview,
      strikeLevel: step.level,
      actions,
    };

    this.guildStore.appendViolationLog(guildId, logEntry);

    if (config.logChannelId && !isSimultaneousFlood) {
      await this._dispatchToLogChannel({
        guild,
        me,
        logChannelId: config.logChannelId,
        user: author,
        channelId: message.channelId,
        violation,
        contentPreview: message.content ?? '',
        strikeLevel: step.level,
        actions,
        timestampIso,
      });
    }

    return {
      strikeLevel: step.level,
      actions,
      logEntry,
    };
  }

  /**
   * Gửi Embed báo cáo chi tiết vào kênh Log của máy chủ (an toàn, không làm sập bot nếu kênh bị xóa).
   */
  async _dispatchToLogChannel({
    guild,
    me,
    logChannelId,
    user,
    channelId,
    violation,
    contentPreview,
    strikeLevel,
    actions,
    timestampIso,
  }) {
    try {
      let logChannel = guild.channels?.cache?.get(logChannelId) ?? null;
      if (!logChannel && typeof guild.channels?.fetch === 'function') {
        logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
      }

      if (!logChannel || !canBotSendEmbed(logChannel, me)) {
        return;
      }

      const logEmbed = buildModLogEmbed({
        user,
        channelId,
        violation,
        contentPreview,
        strikeLevel,
        actions,
        timestampIso,
      });

      await logChannel.send({
        embeds: [logEmbed],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      logger.warn(
        'PunishmentService',
        `Lỗi gửi Embed vào kênh log ${logChannelId} tại guild ${guild.id}: ${err.message}`
      );
    }
  }

  /**
   * Dọn dẹp bộ nhớ cho các bản ghi cảnh cáo đã hết hạn từ lâu.
   * @param {number} [now=Date.now()]
   * @param {number} [maxExpireMs=86400000] - Mặc định dọn các mục cũ hơn 24 giờ
   * @returns {number}
   */
  sweepExpiredStrikes(now = Date.now(), maxExpireMs = 24 * 60 * 60 * 1000) {
    let removed = 0;
    for (const [key, entry] of this.userStrikes.entries()) {
      if (now - entry.lastOffenseAt > maxExpireMs) {
        this.userStrikes.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
