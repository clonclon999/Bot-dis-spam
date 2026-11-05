import { BOT_ROLES } from '../config/constants.js';
import {
  auditBotGuildPermissions,
  canBotDeleteMessage,
  canBotSendEmbed,
  canManageAntiSpam,
  checkBotCanTimeout,
  hasBotRole,
  isHardcodedOwner,
  resolveBotRole,
} from '../utils/permissions.js';

/**
 * Permission Manager Layer — kiểm tra phân quyền phía máy chủ:
 * - OWNER (`1243061570247069696`) cố định trong mã nguồn.
 * - Chỉ OWNER được phép cấp hoặc thu hồi quyền ADMIN.
 * - Kiểm tra vai trò MEMBER / MODERATOR / ADMIN / OWNER và quyền Discord Guild.
 */
export class PermissionManager {
  constructor(db) {
    this.db = db;
  }

  isOwner(userId) {
    return isHardcodedOwner(userId);
  }

  canManageAdmins(userId) {
    return isHardcodedOwner(userId);
  }

  resolveRole(userId) {
    return resolveBotRole(this.db, userId);
  }

  hasRole(userId, minRole = BOT_ROLES.MEMBER) {
    return hasBotRole(this.db, userId, minRole);
  }

  requireRole(userId, minRole) {
    if (!this.hasRole(userId, minRole)) {
      throw new Error(`⛔ Yêu cầu quyền hạn tối thiểu **${minRole}** để thực hiện thao tác này.`);
    }
    return this.resolveRole(userId);
  }
}

export {
  auditBotGuildPermissions,
  canBotDeleteMessage,
  canBotSendEmbed,
  canManageAntiSpam,
  checkBotCanTimeout,
  hasBotRole,
  isHardcodedOwner,
  resolveBotRole,
};
