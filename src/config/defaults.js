/**
 * Cấu hình mặc định và các hằng số hệ thống cho Discord Anti-Spam Bot.
 * Mọi giá trị ở đây có thể tùy chỉnh theo từng máy chủ thông qua `/antispam config`.
 */

export const ESCALATION_LADDER = Object.freeze([
  Object.freeze({
    level: 1,
    timeoutSeconds: 0,
    label: 'Mức 1 — Cảnh cáo & Xóa tin nhắn',
  }),
  Object.freeze({
    level: 2,
    timeoutSeconds: 5 * 60, // 5 phút
    label: 'Mức 2 — Timeout 5 phút',
  }),
  Object.freeze({
    level: 3,
    timeoutSeconds: 30 * 60, // 30 phút
    label: 'Mức 3 — Timeout 30 phút',
  }),
  Object.freeze({
    level: 4,
    timeoutSeconds: 2 * 60 * 60, // 2 giờ
    label: 'Mức 4 — Timeout 2 giờ',
  }),
  Object.freeze({
    level: 5,
    timeoutSeconds: 24 * 60 * 60, // 24 giờ
    label: 'Mức 5 — Timeout 24 giờ (Nghiêm trọng)',
  }),
]);

export const VIOLATION_TYPES = Object.freeze({
  EVERYONE_HERE: 'EVERYONE_HERE_SPAM',
  MASS_MENTION_SINGLE: 'MASS_MENTION_SINGLE_MESSAGE',
  MENTION_BURST_WINDOW: 'MENTION_BURST_SHORT_TIME',
  REPEATED_MENTION_MESSAGES: 'REPEATED_MENTION_MULTI_MESSAGES',
  REPEATED_TARGET_HARASSMENT: 'REPEATED_SAME_TARGET_MENTION',
});

export const DEFAULT_GUILD_CONFIG = Object.freeze({
  enabled: true,
  blockEveryoneHere: true,
  maxMentionsPerMessage: 5,
  maxMentionsWindow: 8,
  timeWindowSeconds: 10,
  maxRepeatMessages: 3,
  maxSameTargetMessages: 2,
  repeatWindowSeconds: 15,
  protectAgainstBots: true,
  ignoreImplicitReplies: true,
  strikeResetMinutes: 60,
  autoDeleteWarnSeconds: 10,
  warnCooldownSeconds: 8,
  logChannelId: null,
  whitelistRoles: [],
  whitelistUsers: [],
  whitelistChannels: [],
});

export const SYSTEM_LIMITS = Object.freeze({
  MAX_LOGS_PER_GUILD: 100,
  MAX_TRACKED_USERS_PER_GUILD: 5000,
  TRACKER_SWEEP_INTERVAL_MS: 60_000,
  CONTENT_PREVIEW_MAX_LENGTH: 300,
  DISCORD_MAX_TIMEOUT_SECONDS: 28 * 24 * 60 * 60,
});

/**
 * Tạo bản sao sâu an toàn cho cấu hình mặc định của một máy chủ mới.
 * @returns {object}
 */
export function createDefaultGuildConfig() {
  return {
    ...DEFAULT_GUILD_CONFIG,
    whitelistRoles: [],
    whitelistUsers: [],
    whitelistChannels: [],
    stats: {
      totalViolations: 0,
      deletedMessages: 0,
      warningsIssued: 0,
      timeoutsIssued: 0,
    },
    updatedAt: new Date().toISOString(),
  };
}
