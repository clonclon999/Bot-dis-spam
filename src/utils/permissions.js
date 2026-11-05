import { PermissionFlagsBits } from 'discord.js';
import {
  BOT_ROLES,
  HARDCODED_OWNER_ID,
  ROLE_WEIGHT,
} from '../config/constants.js';

/**
 * Kiểm tra trực tiếp trong mã nguồn xem `userId` có phải là OWNER tối cao hay không.
 * Không phụ thuộc database hay bất kỳ cấu hình bên ngoài nào.
 *
 * @param {string | null | undefined} userId
 * @returns {boolean}
 */
export function isHardcodedOwner(userId) {
  return String(userId) === HARDCODED_OWNER_ID;
}

export const isOwner = isHardcodedOwner;

/**
 * Xác định cấp quyền hệ thống (OWNER / ADMIN / MODERATOR / MEMBER) của một người dùng.
 * OWNER ID (`1243061570247069696`) luôn được ưu tiên tuyệt đối ở mức cao nhất.
 *
 * @param {import('../database/db.js').GameDatabase | null} db
 * @param {string} userId
 * @returns {'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER'}
 */
export function resolveBotRole(db, userId) {
  if (isHardcodedOwner(userId)) {
    return BOT_ROLES.OWNER;
  }
  if (!db) return BOT_ROLES.MEMBER;
  const dbRole = db.getStaffRole(String(userId));
  if (dbRole === BOT_ROLES.ADMIN) return BOT_ROLES.ADMIN;
  if (dbRole === BOT_ROLES.MODERATOR) return BOT_ROLES.MODERATOR;
  return BOT_ROLES.MEMBER;
}

export const getUserBotRole = resolveBotRole;

/**
 * Kiểm tra người dùng có đạt tối thiểu cấp quyền yêu cầu hay không.
 * @param {import('../database/db.js').GameDatabase | null} db
 * @param {string} userId
 * @param {'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER'} minRole
 * @returns {boolean}
 */
export function hasBotRole(db, userId, minRole) {
  const actual = resolveBotRole(db, userId);
  return (ROLE_WEIGHT[actual] ?? 0) >= (ROLE_WEIGHT[minRole] ?? 999);
}

// ============================================================================
// Quyền hạn cấp máy chủ Discord (phục vụ module Anti-Spam @Mention)
// ============================================================================

export function canManageAntiSpam(member, allowModerators = false) {
  if (member?.id && isHardcodedOwner(member.id)) return true;
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

export function checkBotCanTimeout(targetMember, me) {
  if (!targetMember) {
    return { ok: false, reason: 'Không tìm thấy thành viên trong máy chủ.' };
  }
  if (!me) {
    return { ok: false, reason: 'Không xác định được thông tin của Bot.' };
  }
  if (targetMember.guild && targetMember.id === targetMember.guild.ownerId) {
    return { ok: false, reason: 'Không thể timeout Chủ sở hữu máy chủ.' };
  }
  if (!me.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return { ok: false, reason: 'Bot thiếu quyền Moderate Members.' };
  }
  if (targetMember.permissions?.has(PermissionFlagsBits.Administrator)) {
    return { ok: false, reason: 'Thành viên có quyền Administrator.' };
  }
  if (
    me.roles?.highest &&
    targetMember.roles?.highest &&
    me.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0
  ) {
    return {
      ok: false,
      reason: 'Vai trò của Bot thấp hơn hoặc bằng vai trò của người vi phạm.',
    };
  }
  if (targetMember.moderatable === false) {
    return { ok: false, reason: 'Discord từ chối quyền kiểm duyệt (moderatable = false).' };
  }
  return { ok: true };
}

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
