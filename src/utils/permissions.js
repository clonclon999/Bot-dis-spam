import { PermissionFlagsBits } from 'discord.js';

/**
 * Kiểm tra thành viên có quyền Quản trị / Điều hành để dùng lệnh cấu hình bot hay không.
 * @param {import('discord.js').GuildMember | null | undefined} member
 * @param {boolean} [allowModerators=false] - Cho phép Moderator xem status/logs
 * @returns {boolean}
 */
export function canManageAntiSpam(member, allowModerators = false) {
  if (!member?.permissions) return false;
  if (member.guild?.ownerId === member.id) return true;

  const adminPerms = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
  ];

  if (adminPerms.some((perm) => member.permissions.has(perm))) {
    return true;
  }

  if (allowModerators) {
    const modPerms = [
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ManageMessages,
    ];
    return modPerms.some((perm) => member.permissions.has(perm));
  }

  return false;
}

/**
 * Kiểm tra Bot có quyền xóa tin nhắn trong kênh cụ thể hay không.
 * @param {import('discord.js').GuildBasedChannel | null | undefined} channel
 * @param {import('discord.js').GuildMember | null | undefined} me
 * @returns {boolean}
 */
export function canBotDeleteMessage(channel, me) {
  if (!channel || !me) return false;
  if (typeof channel.permissionsFor !== 'function') return false;
  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  return (
    perms.has(PermissionFlagsBits.ViewChannel) &&
    perms.has(PermissionFlagsBits.ManageMessages)
  );
}

/**
 * Kiểm tra Bot có quyền gửi tin nhắn & Embed vào kênh cụ thể hay không.
 * @param {import('discord.js').GuildBasedChannel | null | undefined} channel
 * @param {import('discord.js').GuildMember | null | undefined} me
 * @returns {boolean}
 */
export function canBotSendEmbed(channel, me) {
  if (!channel || !me) return false;
  if (!channel.isTextBased?.()) return false;
  if (typeof channel.permissionsFor !== 'function') return true;
  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  return (
    perms.has(PermissionFlagsBits.ViewChannel) &&
    perms.has(PermissionFlagsBits.SendMessages) &&
    perms.has(PermissionFlagsBits.EmbedLinks)
  );
}

/**
 * Kiểm tra đầy đủ điều kiện phân cấp vai trò (Role Hierarchy) và quyền trước khi Timeout thành viên.
 * @param {import('discord.js').GuildMember | null | undefined} targetMember
 * @param {import('discord.js').GuildMember | null | undefined} me
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkBotCanTimeout(targetMember, me) {
  if (!targetMember) {
    return { ok: false, reason: 'Không tìm thấy thành viên trong máy chủ (có thể đã rời server).' };
  }
  if (!me) {
    return { ok: false, reason: 'Không xác định được thông tin thành viên của Bot.' };
  }
  if (targetMember.guild && targetMember.id === targetMember.guild.ownerId) {
    return { ok: false, reason: 'Không thể timeout Chủ sở hữu máy chủ (Server Owner).' };
  }
  if (!me.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return { ok: false, reason: 'Bot thiếu quyền Moderate Members (Timeout thành viên).' };
  }
  if (targetMember.permissions?.has(PermissionFlagsBits.Administrator)) {
    return { ok: false, reason: 'Thành viên có quyền Administrator (Discord không cho phép timeout).' };
  }
  if (
    me.roles?.highest &&
    targetMember.roles?.highest &&
    me.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0
  ) {
    return {
      ok: false,
      reason: 'Vai trò cao nhất của Bot thấp hơn hoặc bằng vai trò của người vi phạm.',
    };
  }
  if (targetMember.moderatable === false) {
    return { ok: false, reason: 'Discord từ chối quyền kiểm duyệt đối với thành viên này (moderatable = false).' };
  }

  return { ok: true };
}

/**
 * Tổng hợp báo cáo quyền hạn của Bot trong máy chủ để hiển thị trong `/antispam status`.
 * @param {import('discord.js').Guild} guild
 * @returns {{ ViewChannel: boolean, SendMessages: boolean, EmbedLinks: boolean, ManageMessages: boolean, ModerateMembers: boolean }}
 */
export function auditBotGuildPermissions(guild) {
  const me = guild?.members?.me;
  const perms = me?.permissions;
  return {
    ViewChannel: Boolean(perms?.has(PermissionFlagsBits.ViewChannel)),
    SendMessages: Boolean(perms?.has(PermissionFlagsBits.SendMessages)),
    EmbedLinks: Boolean(perms?.has(PermissionFlagsBits.EmbedLinks)),
    ManageMessages: Boolean(perms?.has(PermissionFlagsBits.ManageMessages)),
    ModerateMembers: Boolean(perms?.has(PermissionFlagsBits.ModerateMembers)),
  };
}
