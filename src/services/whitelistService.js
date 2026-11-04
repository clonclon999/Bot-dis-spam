import { PermissionFlagsBits } from 'discord.js';

/**
 * Dịch vụ kiểm tra miễn trừ (Whitelist & Quyền Quản trị).
 * Đảm bảo Owner, Admin, Moderator, các vai trò/người dùng/kênh trong danh sách miễn trừ
 * và tin nhắn hệ thống không bao giờ bị xử phạt nhầm.
 */

const EXEMPT_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
];

/**
 * Kiểm tra xem một tin nhắn có thuộc diện miễn trừ kiểm duyệt chống spam hay không.
 *
 * @param {import('discord.js').Message} message
 * @param {object} config - Cấu hình của máy chủ
 * @param {string | null} [botUserId] - ID của chính Bot hiện tại
 * @returns {{ exempt: boolean, reason?: string }}
 */
export function evaluateExemption(message, config, botUserId = null) {
  if (!message || !message.guild) {
    return { exempt: true, reason: 'not_in_guild' };
  }

  if (message.system) {
    return { exempt: true, reason: 'system_message' };
  }

  const author = message.author;
  if (!author) {
    return { exempt: true, reason: 'missing_author' };
  }

  if (botUserId && author.id === botUserId) {
    return { exempt: true, reason: 'self_bot' };
  }

  // Kiểm tra kênh miễn trừ (bao gồm cả kênh cha nếu tin nhắn nằm trong Thread)
  const channelId = message.channelId;
  const parentChannelId = message.channel?.parentId;
  if (Array.isArray(config.whitelistChannels) && config.whitelistChannels.length > 0) {
    if (
      config.whitelistChannels.includes(channelId) ||
      (parentChannelId && config.whitelistChannels.includes(parentChannelId))
    ) {
      return { exempt: true, reason: 'whitelisted_channel' };
    }
  }

  // Kiểm tra người dùng trong danh sách miễn trừ tùy chỉnh
  if (
    Array.isArray(config.whitelistUsers) &&
    config.whitelistUsers.includes(author.id)
  ) {
    return { exempt: true, reason: 'whitelisted_user' };
  }

  // Chủ sở hữu máy chủ luôn được miễn trừ
  if (message.guild.ownerId === author.id) {
    return { exempt: true, reason: 'guild_owner' };
  }

  const member =
    message.member ?? message.guild.members?.cache?.get(author.id) ?? null;

  // Kiểm tra quyền Admin / Moderator
  if (member?.permissions) {
    for (const perm of EXEMPT_PERMISSIONS) {
      if (member.permissions.has(perm)) {
        return { exempt: true, reason: 'admin_or_moderator' };
      }
    }
  }

  // Kiểm tra vai trò trong danh sách miễn trừ tùy chỉnh
  if (
    member?.roles?.cache &&
    Array.isArray(config.whitelistRoles) &&
    config.whitelistRoles.length > 0
  ) {
    const hasExemptRole = config.whitelistRoles.some((roleId) =>
      member.roles.cache.has(roleId)
    );
    if (hasExemptRole) {
      return { exempt: true, reason: 'whitelisted_role' };
    }
  }

  // Xử lý tin nhắn từ các Bot khác:
  // - Nếu tắt protectAgainstBots -> bỏ qua mọi bot để tránh xung đột.
  // - Nếu bật protectAgainstBots -> các bot quản trị đã được miễn trừ ở bước trên,
  //   còn bot lạ / raid bot spam mention trái phép vẫn sẽ bị chặn an toàn.
  if (author.bot && !message.webhookId && !config.protectAgainstBots) {
    return { exempt: true, reason: 'bot_ignored_by_config' };
  }

  return { exempt: false };
}
