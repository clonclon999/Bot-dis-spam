import { EmbedBuilder } from 'discord.js';
import { GAME_IDS } from '../config/constants.js';
import { evaluateExemption } from '../services/whitelistService.js';
import { COLORS } from '../utils/embeds.js';
import { formatVnd } from '../utils/format.js';
import { logger } from '../utils/logger.js';
import { globalPanelCleaner } from '../utils/panelCleaner.js';

/** Bộ đệm thời gian nhận EXP trò chuyện để tránh ghi SQLite liên tục khi chat nhanh */
const chatExpCooldowns = new Map();
const CHAT_EXP_INTERVAL_MS = 60_000;

/**
 * Xử lý sự kiện tin nhắn mới (`messageCreate`):
 * 1. Thực thi lớp bảo vệ Anti-Spam `@Mention` trước tiên.
 * 2. Xử lý trò chơi Nối Từ Tiếng Việt nếu tin nhắn nằm đúng trong kênh `#nối-từ` đã chỉ định.
 * 3. Cộng nhẹ EXP tương tác định kỳ (mỗi 60s/người).
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
    wordChainSystem,
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
            return;
          }
        }
      }
    }

    if (message.author?.bot) return;

    // Bước 2: Xử lý trò Nối Từ Tiếng Việt (CHỈ hoạt động tại đúng kênh Nối Từ đã cài đặt)
    if (db && wordChainSystem && !db.getSetting('maintenanceMode')) {
      const assignedNoituChan = db.getGameChannel(
        message.guild.id,
        GAME_IDS.NOITU
      );
      if (assignedNoituChan && message.channel?.id === assignedNoituChan) {
        const userRow = db.get('SELECT is_banned FROM users WHERE user_id = ?', [
          message.author.id,
        ]);
        if (!userRow?.is_banned) {
          const turn = wordChainSystem.submitWord({
            guildId: message.guild.id,
            channelId: message.channel.id,
            userId: message.author.id,
            username: message.author.username,
            content: message.content,
          });

          if (turn) {
            await renderWordChainOutcome(message, turn);
            return;
          }
        }
      }
    }

    // Bước 3: Thưởng EXP trò chuyện thụ động nhẹ nhàng (cooldown 60 giây)
    if (db && economySystem && levelSystem && !db.getSetting('maintenanceMode')) {
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
 * Hiển thị phản hồi Nối Từ siêu gọn gàng:
 * - Nhắc lỗi tự xóa sau 4 giây.
 * - Phản hồi lượt của Bot tự động xóa thẻ lượt cũ trước đó để kênh luôn sạch đẹp.
 */
async function renderWordChainOutcome(message, turn) {
  const channel = message.channel;

  if (!turn.ok) {
    if (typeof message.react === 'function') {
      await message.react('❌').catch(() => {});
    }
    if (typeof channel?.send === 'function') {
      const warnMsg = await channel
        .send({
          content: `⚠️ <@${message.author.id}> ${turn.reason}`,
          allowedMentions: { users: [message.author.id] },
        })
        .catch(() => null);

      if (warnMsg && typeof warnMsg.delete === 'function') {
        const timer = setTimeout(() => {
          warnMsg.delete().catch(() => {});
        }, 4_500);
        timer.unref?.();
      }
    }
    return;
  }

  // Nối đúng -> Thả cảm xúc ✅
  if (typeof message.react === 'function') {
    await message.react('✅').catch(() => {});
  }

  if (typeof channel?.send !== 'function') return;

  // Chế độ Đấu với Bot
  if (turn.mode === 'bot') {
    if (turn.roundWon) {
      const winMsg = await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.SUCCESS)
              .setTitle('🏆 ĐỈNH CAO! BẠN ĐÃ HẠ GỤC BOT NỐI TỪ!')
              .setDescription(
                `<@${message.author.id}> tung từ **\`${turn.playerWord}\`** khiến Bot bí từ hoàn toàn và nhận thưởng **+${formatVnd(turn.prizeVnd)}**!\n\n` +
                  `🔄 **Ván mới bắt đầu ngay:** \` ${turn.newStarterWord.toUpperCase()} \`\n` +
                  `👉 Tiếp theo bắt đầu bằng chữ: **\`${turn.nextSyllable}\`**`
              ),
          ],
          allowedMentions: { users: [message.author.id] },
        })
        .catch(() => null);

      if (winMsg) {
        await globalPanelCleaner.registerChannelBoard(channel.id, 'noitu_bot_turn', winMsg);
      }
      return;
    }

    const desc = turn.autoResetStarter
      ? `🤖 Bot đáp: **\`${turn.botWord}\`** *(Hết nhánh nối tiếp — Thưởng hòa hữu nghị **+${formatVnd(turn.earnedVnd)}**!)*\n🔄 **Đổi từ mới:** \` ${turn.autoResetStarter.toUpperCase()} \` ➔ Bắt đầu bằng chữ: **\`${turn.nextSyllable}\`**`
      : `🤖 Bot nối tiếp: **\`${turn.botWord}\`** *(+${formatVnd(turn.earnedVnd)} cho <@${message.author.id}>)*\n👉 Mời nối tiếp bắt đầu bằng chữ: **\`${turn.nextSyllable}\`** *(Chuỗi: ${turn.chainLength})*`;

    const botTurnMsg = await channel
      .send({
        embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(desc)],
        allowedMentions: { parse: [] },
      })
      .catch(() => null);

    // Xóa ngay thẻ phản hồi lượt trước của Bot để kênh #nối-từ chỉ hiện đúng 1 bảng gợi ý mới nhất!
    if (botTurnMsg) {
      await globalPanelCleaner.registerChannelBoard(
        channel.id,
        'noitu_bot_turn',
        botTurnMsg
      );
    }
    return;
  }

  // Chế độ Cộng đồng PvP: chỉ gửi bảng thông báo khi có người nổ Hũ kết thúc ván (các lượt giữa chỉ thả ✅ siêu gọn!)
  if (turn.roundWon) {
    const potMsg = await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('🎉 NỔ HŨ NỐI TỪ CỘNG ĐỒNG!')
            .setDescription(
              `<@${message.author.id}> đã khóa sổ chuỗi **${turn.endedChain} từ** bằng từ khóa **\`${turn.playerWord}\`** và ẵm trọn **+${formatVnd(turn.prizeVnd)}**!\n\n` +
                `🔄 **Ván mới bắt đầu:** \` ${turn.newStarterWord.toUpperCase()} \`\n` +
                `👉 Hãy nối tiếp bằng chữ: **\`${turn.nextSyllable}\`**`
            ),
        ],
        allowedMentions: { users: [message.author.id] },
      })
      .catch(() => null);

    if (potMsg) {
      await globalPanelCleaner.registerChannelBoard(channel.id, 'noitu_bot_turn', potMsg);
    }
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
