/**
 * Cấu hình mặc định toàn cục cho Kinh tế, Ngân hàng, Trò chơi, Bảo trì
 * và hệ thống Chống Spam @Mention.
 */

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
  maintenanceMode: false,
  maintenanceReason: 'Hệ thống đang bảo trì nâng cấp định kỳ.',
  freezeAllTransactions: false,
  protectStaffFromRob: true,

  // Kinh tế VNĐ
  startingBalance: 20_000,
  dailyReward: 15_000,
  weeklyReward: 80_000,
  monthlyReward: 300_000,
  workMin: 3_000,
  workMax: 12_000,
  workCooldownSec: 300, // 5 phút
  begMin: 500,
  begMax: 3_500,
  begCooldownSec: 180, // 3 phút
  questRewardMultiplier: 1.0,
  gamePayoutMultiplier: 1.0,

  // Giới hạn cược (hỗ trợ đầy đủ nút chọn nhanh 100 VNĐ -> Tất cả)
  minBet: 100,
  maxBet: 5_000_000,

  // Ngân hàng
  bankInterestRate: 0.02, // 2% mỗi chu kỳ cho tài khoản thường
  savingsInterestBonus: 1.5, // Tài khoản tiết kiệm hưởng x1.5 lãi suất (3%)
  interestIntervalHours: 24, // Chu kỳ trả lãi 24 giờ
  maxBankDeposit: 500_000_000,
  minLevelForBank: 1,
  minDepositForSavings: 50_000,

  // Cướp & Truy nã (kèm chống farm cướp lặp lại cùng 1 nạn nhân)
  robCooldownSec: 600, // 10 phút giữa các lượt cướp
  robSameTargetCooldownSec: 3600, // 60 phút không được cướp lặp lại cùng 1 nạn nhân
  robSuccessRatePct: 40, // 40%
  robMaxStealPct: 15, // Cướp tối đa 15% tiền mặt nạn nhân
  robMaxCap: 250_000, // Trần cướp tối đa 1 lần
  robFailFinePct: 12, // Phạt 12% ví của kẻ đi cướp khi thất bại
  robFailBounty: 15_000, // Tự động treo thưởng truy nã khi cướp hụt

  // Bật / tắt từng trò chơi
  gamesEnabled: {
    baucua: true,
    taixiu: true,
    coinflip: true,
    guess: true,
    race: true,
    rps: true,
    noitu: true,
  },

  // Thông số thưởng & thời gian trò Nối Từ Tiếng Việt PRO
  noituReward: 1_000,
  noituStreak3Bonus: 1_000,
  noituStreak5Bonus: 3_000,
  noituStreak10Bonus: 10_000,
  noituTimeoutSec: 30,
  noituCooldownSec: 5,

  // Phiên Đặt Cược Nhiều Người Chơi (Multiplayer Round System — PUBLIC START)
  mpRoundDurations: {
    baucua: 60, // Bầu Cua: 60 giây
    taixiu: 60, // Tài Xỉu: 60 giây
    race: 90, // Đua Thú: 90 giây
  },
  mpAllowEditCancelBet: true, // Thành viên được sửa/hủy cược cá nhân khi phiên đang BETTING
  mpMultiTableEnabled: false, // Chỉ OWNER mới được bật nhiều bàn cùng lúc
  mpMaxTablesPerGame: 3,
  mpTaixiuTripleRule: 'house_wins', // Công bố trước phiên: Tổng 3 hoặc 18 = Nhà cái thắng

  // Kênh log chuyên biệt
  logChannels: {
    economy: null,
    game: null,
    admin: null,
    anticheat: null,
    quest: null,
    event: null,
    error: null,
  },
});

// Hằng số hệ thống Anti-Spam @Mention (giữ tương thích hoàn toàn)
export const ESCALATION_LADDER = Object.freeze([
  Object.freeze({ level: 1, timeoutSeconds: 0, label: 'Mức 1 — Cảnh cáo & Xóa tin nhắn' }),
  Object.freeze({ level: 2, timeoutSeconds: 5 * 60, label: 'Mức 2 — Timeout 5 phút' }),
  Object.freeze({ level: 3, timeoutSeconds: 30 * 60, label: 'Mức 3 — Timeout 30 phút' }),
  Object.freeze({ level: 4, timeoutSeconds: 2 * 60 * 60, label: 'Mức 4 — Timeout 2 giờ' }),
  Object.freeze({ level: 5, timeoutSeconds: 24 * 60 * 60, label: 'Mức 5 — Timeout 24 giờ (Nghiêm trọng)' }),
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
  MAX_TRACKED_USERS_PER_GUILD: 2500,
  TRACKER_SWEEP_INTERVAL_MS: 120_000,
  CONTENT_PREVIEW_MAX_LENGTH: 300,
  DISCORD_MAX_TIMEOUT_SECONDS: 28 * 24 * 60 * 60,
});

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
