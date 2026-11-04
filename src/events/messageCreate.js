import { evaluateExemption } from '../services/whitelistService.js';
import { logger } from '../utils/logger.js';

/**
 * Xử lý sự kiện tin nhắn mới (`messageCreate`).
 * Mọi lỗi phát sinh đều được bọc an toàn để không bao giờ làm sập tiến trình Bot.
 *
 * @param {import('discord.js').Message} message
 * @param {object} context
 * @param {import('../storage/guildStore.js').GuildStore} context.guildStore
 * @param {import('../services/mentionDetector.js').MentionDetector} context.mentionDetector
 * @param {import('../services/punishmentService.js').PunishmentService} context.punishmentService
 */
export async function handleMessageCreate(
  message,
  { guildStore, mentionDetector, punishmentService }
) {
  try {
    if (!message || !message.guild || message.system) return;

    // Nếu tin nhắn ở trạng thái partial (chưa tải đủ nội dung), thử fetch nhẹ
    if (message.partial && typeof message.fetch === 'function') {
      message = await message.fetch().catch(() => null);
      if (!message || !message.guild) return;
    }

    const config = guildStore.getConfig(message.guild.id);
    if (!config.enabled) return;

    const botUserId = message.client?.user?.id ?? null;
    const exemption = evaluateExemption(message, config, botUserId);
    if (exemption.exempt) return;

    const violation = mentionDetector.inspectMessage(message, config);
    if (!violation) return;

    await punishmentService.enforce({
      message,
      violation,
      config,
    });
  } catch (err) {
    logger.error('MessageCreateEvent', 'Lỗi không mong muốn khi kiểm tra tin nhắn', err);
  }
}

/**
 * Xử lý sự kiện chỉnh sửa tin nhắn (`messageUpdate`) nhằm chặn hành vi lách luật
 * gửi tin nhắn thường rồi sửa thành hàng loạt @mention / @everyone.
 *
 * @param {import('discord.js').Message | import('discord.js').PartialMessage} oldMessage
 * @param {import('discord.js').Message | import('discord.js').PartialMessage} newMessage
 * @param {object} context
 */
export async function handleMessageUpdate(
  oldMessage,
  newMessage,
  { guildStore, mentionDetector, punishmentService }
) {
  try {
    if (!newMessage) return;

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
