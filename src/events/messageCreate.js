import { evaluateExemption } from '../services/whitelistService.js';
import { logger } from '../utils/logger.js';

/** Bộ đệm thời gian nhận EXP trò chuyện để tránh ghi SQLite liên tục khi chat nhanh */
const chatExpCooldowns = new Map();
const CHAT_EXP_INTERVAL_MS = 60_000;

/**
 * Xử lý sự kiện tin nhắn mới (`messageCreate`):
 * 1. Thực thi lớp bảo vệ Anti-Spam `@Mention` trước tiên.
 * 2. Nếu tin nhắn hợp lệ và không vi phạm, cộng nhẹ EXP tương tác định kỳ (mỗi 60s/người).
 */
export async function handleMessageCreate(message, context) {
  const {
    guildStore,
    mentionDetector,
    punishmentService,
    db,
    economySystem,
    levelSystem,
    questSystem,
  } = context;

  try {
    if (!message || !message.guild || message.system) return;

    if (message.partial && typeof message.fetch === 'function') {
      message = await message.fetch().catch(() => null);
      if (!message || !message.guild) return;
    }

    // Bước 1: Kiểm tra Anti-Spam @Mention nếu máy chủ đang bật
    if (guildStore && mentionDetector && punishmentService) {
      const config = guildStore.getConfig(message.guild.id);
      if (config.enabled) {
        const botUserId = message.client?.user?.id ?? null;
        const exemption = evaluateExemption(message, config, botUserId);
        if (!exemption.exempt) {
          const violation = mentionDetector.inspectMessage(message, config);
          if (violation) {
            await punishmentService.enforce({ message, violation, config });
            return; // Tin nhắn vi phạm không được nhận EXP chat
          }
        }
      }
    }

    // Bước 2: Thưởng EXP trò chuyện thụ động nhẹ nhàng (chống spam bằng cooldown 60 giây)
    if (
      !message.author?.bot &&
      db &&
      economySystem &&
      levelSystem &&
      !db.getSetting('maintenanceMode')
    ) {
      const uid = message.author.id;
      const now = Date.now();
      const prev = chatExpCooldowns.get(uid) ?? 0;
      if (now - prev >= CHAT_EXP_INTERVAL_MS) {
        chatExpCooldowns.set(uid, now);
        if (chatExpCooldowns.size > 3000) {
          for (const [k, ts] of chatExpCooldowns.entries()) {
            if (now - ts > CHAT_EXP_INTERVAL_MS) chatExpCooldowns.delete(k);
          }
        }
        const u = economySystem.ensureUser(uid, message.author.username, now);
        if (!u.is_banned) {
          levelSystem.grantExp(uid, 12, now);
          questSystem?.incrementMetric(uid, 'messages_sent', 1, now);
        }
      }
    }
  } catch (err) {
    logger.error('MessageCreateEvent', 'Lỗi không mong muốn khi xử lý tin nhắn', err);
  }
}

/**
 * Xử lý sự kiện chỉnh sửa tin nhắn (`messageUpdate`) chặn lách luật sửa tin nhắn thành spam @mention.
 */
export async function handleMessageUpdate(
  oldMessage,
  newMessage,
  { guildStore, mentionDetector, punishmentService }
) {
  try {
    if (!newMessage || !guildStore || !mentionDetector || !punishmentService) return;

    if (newMessage.partial && typeof newMessage.fetch === 'function') {
      newMessage = await newMessage.fetch().catch(() => null);
    }
    if (!newMessage || !newMessage.guild || newMessage.system) return;

    const config = guildStore.getConfig(newMessage.guild.id);
    if (!config.enabled) return;

    const botUserId = newMessage.client?.user?.id ?? null;
    const exemption = evaluateExemption(newMessage, config, botUserId);
    if (exemption.exempt) return;

    const violation = mentionDetector.inspectEditedMessage(
      oldMessage,
      newMessage,
      config
    );
    if (!violation) return;

    await punishmentService.enforce({
      message: newMessage,
      violation,
      config,
    });
  } catch (err) {
    logger.error('MessageUpdateEvent', 'Lỗi không mong muốn khi kiểm tra tin nhắn sửa đổi', err);
  }
}
