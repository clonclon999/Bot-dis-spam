import { LOG_CATEGORIES } from '../config/constants.js';
import { formatRemainingMs, formatVnd, getVnDateKey } from '../utils/format.js';
import { secureInt } from '../utils/rng.js';

const WORK_JOBS = Object.freeze([
  'Lập trình viên Backend ca đêm',
  'Kỹ sư vận hành máy chủ Cloud',
  'Đầu bếp nhà hàng 5 sao',
  'Tài xế giao hàng siêu tốc',
  'Chuyên viên phân tích dữ liệu',
  'Nhân viên pha chế cà phê thủ công',
  'Kiến trúc sư thiết kế hệ thống',
]);

/**
 * Hệ thống Kinh tế Tiền tệ VNĐ:
 * - Mọi biến động số dư đều chạy trong Transaction ACID của SQLite.
 * - Lưu vết đầy đủ vào bảng `transactions` và kiểm tra khóa giao dịch / đóng băng / gian lận.
 */
export class EconomySystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./logSystem.js').LogSystem} deps.logSystem
   */
  constructor({ db, logSystem }) {
    this.db = db;
    this.logSystem = logSystem;
    this.levelSystem = null;
    this.petSystem = null;
    this.questSystem = null;
    this.eventSystem = null;
  }

  bindSystems({ levelSystem, petSystem, questSystem, eventSystem }) {
    this.levelSystem = levelSystem;
    this.petSystem = petSystem;
    this.questSystem = questSystem;
    this.eventSystem = eventSystem;
  }

  /**
   * Khởi tạo hồ sơ người chơi nếu chưa tồn tại (an toàn trong transaction).
   */
  ensureUser(userId, username = '', now = Date.now()) {
    const uid = String(userId);
    const cleanName = String(username || '').slice(0, 64);

    return this.db.transaction(() => {
      let user = this.db.get('SELECT * FROM users WHERE user_id = ?', [uid]);
      if (!user) {
        const startBal = Number(this.db.getSetting('startingBalance') ?? 20_000);
        this.db.run(
          `INSERT INTO users (user_id, username, wallet, last_interest_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uid, cleanName, startBal, now, now, now]
        );
        if (startBal > 0) {
          this.db.run(
            `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
             VALUES (?, 'starter_bonus', ?, ?, 'Vốn khởi nghiệp Tân Thủ', ?)`,
            [uid, startBal, startBal, now]
          );
        }
        user = this.db.get('SELECT * FROM users WHERE user_id = ?', [uid]);
      } else if (cleanName && user.username !== cleanName) {
        this.db.run('UPDATE users SET username = ? WHERE user_id = ?', [cleanName, uid]);
        user.username = cleanName;
      }
      return user;
    });
  }

  /**
   * Kiểm tra tài khoản và hệ thống có được phép thực hiện giao dịch VNĐ hay không.
   */
  assertCanTransact(user, { bypassGlobalFreeze = false } = {}) {
    if (!user) throw new Error('Không tìm thấy dữ liệu người chơi.');
    if (user.is_banned) {
      throw new Error(
        `Tài khoản của bạn đã bị khóa khỏi hệ thống Game Bot. Lý do: ${user.ban_reason || 'Vi phạm quy định'}.`
      );
    }
    if (user.is_frozen) {
      throw new Error(
        'Tài khoản của bạn hiện đang bị ĐÓNG BĂNG giao dịch để kiểm tra an ninh.'
      );
    }
    if (!bypassGlobalFreeze && this.db.getSetting('freezeAllTransactions')) {
      throw new Error(
        'Hệ thống hiện đang tạm ĐÓNG BĂNG toàn bộ giao dịch VNĐ theo lệnh của OWNER.'
      );
    }
  }

  getBalance(userId, username = '', now = Date.now()) {
    const user = this.ensureUser(userId, username, now);
    return {
      wallet: user.wallet,
      bank: user.bank,
      savings: user.savings,
      netWorth: user.wallet + user.bank + user.savings,
      isFrozen: Boolean(user.is_frozen),
      isBanned: Boolean(user.is_banned),
    };
  }

  /**
   * Tính hệ số thưởng phụ trợ hợp lệ (Thú cưng + Vé May Mắn) dành riêng cho Làm việc & Nhiệm vụ.
   */
  getEarnMultiplier(user, now = Date.now()) {
    let mult = 1.0;
    if (user.lucky_boost_until > now) {
      mult += 0.35;
    }
    if (this.petSystem) {
      const petBonus = this.petSystem.getActivePetBonuses(user.user_id, now);
      mult += petBonus.questBonusPct / 100;
    }
    return mult;
  }

  /**
   * Nhận thưởng định kỳ (/daily, /weekly, /monthly) chống nhận đúp tuyệt đối.
   * @param {'daily' | 'weekly' | 'monthly'} period
   */
  claimPeriodicReward(userId, username, period, now = Date.now()) {
    const configMap = {
      daily: {
        col: 'last_daily_at',
        cooldownMs: 24 * 3600 * 1000,
        settingKey: 'dailyReward',
        label: 'Điểm danh Hằng Ngày',
        exp: 40,
      },
      weekly: {
        col: 'last_weekly_at',
        cooldownMs: 7 * 24 * 3600 * 1000,
        settingKey: 'weeklyReward',
        label: 'Phần thưởng Hằng Tuần',
        exp: 140,
      },
      monthly: {
        col: 'last_monthly_at',
        cooldownMs: 30 * 24 * 3600 * 1000,
        settingKey: 'monthlyReward',
        label: 'Phần thưởng Hằng Tháng',
        exp: 450,
      },
    };
    const meta = configMap[period];
    if (!meta) throw new Error('Chu kỳ nhận thưởng không hợp lệ.');

    return this.db.transaction(() => {
      const user = this.ensureUser(userId, username, now);
      this.assertCanTransact(user);

      const lastAt = user[meta.col] || 0;
      const elapsed = now - lastAt;
      if (elapsed < meta.cooldownMs) {
        const remain = meta.cooldownMs - elapsed;
        throw new Error(
          `Bạn đã nhận **${meta.label}** rồi! Vui lòng quay lại sau **${formatRemainingMs(remain)}**.`
        );
      }

      const baseAmount = Number(this.db.getSetting(meta.settingKey) ?? 15_000);
      let streak = user.login_streak || 0;
      let streakBonus = 0;

      if (period === 'daily') {
        const todayKey = getVnDateKey(now);
        const yesterdayKey = getVnDateKey(now - 24 * 3600 * 1000);
        if (user.last_streak_date === yesterdayKey) {
          streak += 1;
        } else if (user.last_streak_date !== todayKey) {
          streak = 1;
        }
        streakBonus = Math.min(25_000, (streak - 1) * 1_500);
        this.db.run(
          'UPDATE users SET login_streak = ?, last_streak_date = ? WHERE user_id = ?',
          [streak, todayKey, String(userId)]
        );
        this.eventSystem?.recordProgress(userId, 'login_streak', 1, now);
        this.questSystem?.incrementMetric(userId, 'daily_claimed', 1, now);
      }

      const totalReward = Math.round(baseAmount + streakBonus);
      const nextWallet = user.wallet + totalReward;

      this.db.run(
        `UPDATE users
         SET wallet = ?, ${meta.col} = ?, total_earned = total_earned + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, now, totalReward, now, String(userId)]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [String(userId), period, totalReward, nextWallet, meta.label, now]
      );

      this.questSystem?.incrementMetric(userId, 'vnd_earned', totalReward, now);
      this.eventSystem?.recordProgress(userId, 'rich_race', totalReward, now);
      const expRes = this.levelSystem?.grantExp(userId, meta.exp, now);

      return {
        reward: totalReward,
        streakBonus,
        streak,
        balanceAfter: nextWallet,
        expResult: expRes,
      };
    });
  }

  /**
   * Đi làm kiếm tiền (/work).
   */
  work(userId, username, now = Date.now()) {
    return this.db.transaction(() => {
      const user = this.ensureUser(userId, username, now);
      this.assertCanTransact(user);

      const cooldownMs = Number(this.db.getSetting('workCooldownSec') ?? 300) * 1000;
      const elapsed = now - (user.last_work_at || 0);
      if (elapsed < cooldownMs) {
        throw new Error(
          `Bạn đang nghỉ giải lao! Có thể đi làm tiếp sau **${formatRemainingMs(cooldownMs - elapsed)}** (hoặc dùng ⚡ Nước Tăng Lực).`
        );
      }

      const min = Number(this.db.getSetting('workMin') ?? 3_000);
      const max = Number(this.db.getSetting('workMax') ?? 12_000);
      const rawAmount = secureInt(min, max);
      const mult = this.getEarnMultiplier(user, now);
      const earned = Math.round(rawAmount * mult);
      const jobName = WORK_JOBS[secureInt(0, WORK_JOBS.length - 1)];

      const nextWallet = user.wallet + earned;
      this.db.run(
        `UPDATE users
         SET wallet = ?, last_work_at = ?, total_earned = total_earned + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, now, earned, now, String(userId)]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'work', ?, ?, ?, ?)`,
        [String(userId), earned, nextWallet, `Đi làm: ${jobName}`, now]
      );

      this.questSystem?.incrementMetric(userId, 'work_count', 1, now);
      this.questSystem?.incrementMetric(userId, 'vnd_earned', earned, now);
      this.eventSystem?.recordProgress(userId, 'rich_race', earned, now);
      const expRes = this.levelSystem?.grantExp(userId, 25, now);

      return {
        jobName,
        earned,
        multiplier: Number(mult.toFixed(2)),
        balanceAfter: nextWallet,
        expResult: expRes,
      };
    });
  }

  /**
   * Xin tiền ngẫu nhiên (/beg).
   */
  beg(userId, username, now = Date.now()) {
    return this.db.transaction(() => {
      const user = this.ensureUser(userId, username, now);
      this.assertCanTransact(user);

      const cooldownMs = Number(this.db.getSetting('begCooldownSec') ?? 180) * 1000;
      const elapsed = now - (user.last_beg_at || 0);
      if (elapsed < cooldownMs) {
        throw new Error(
          `Hãy đợi **${formatRemainingMs(cooldownMs - elapsed)}** trước khi xin tiếp nhé!`
        );
      }

      // 75% nhận được tiền, 25% bị từ chối vui vẻ
      const lucky = secureInt(1, 100) <= 75;
      const min = Number(this.db.getSetting('begMin') ?? 500);
      const max = Number(this.db.getSetting('begMax') ?? 3_500);
      const earned = lucky ? secureInt(min, max) : 0;

      const nextWallet = user.wallet + earned;
      this.db.run(
        `UPDATE users
         SET wallet = ?, last_beg_at = ?, total_earned = total_earned + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, now, earned, now, String(userId)]
      );

      if (earned > 0) {
        this.db.run(
          `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
           VALUES (?, 'beg', ?, ?, 'Nhận tiền hảo tâm (/beg)', ?)`,
          [String(userId), earned, nextWallet, now]
        );
        this.questSystem?.incrementMetric(userId, 'vnd_earned', earned, now);
      }

      const expRes = this.levelSystem?.grantExp(userId, 10, now);
      return { lucky, earned, balanceAfter: nextWallet, expResult: expRes };
    });
  }

  /**
   * Chuyển tiền giữa 2 người chơi (/pay) trong 1 Transaction ACID duy nhất.
   */
  transfer({ fromId, fromName, toId, toName, amount, isBotTarget = false, now = Date.now() }) {
    const cleanAmount = Math.trunc(Number(amount));
    if (!Number.isSafeInteger(cleanAmount) || cleanAmount < 1_000) {
      throw new Error('Số tiền chuyển tối thiểu là **1.000 VNĐ** và phải là số nguyên hợp lệ.');
    }
    if (String(fromId) === String(toId)) {
      throw new Error('Bạn không thể tự chuyển tiền cho chính mình.');
    }
    if (isBotTarget) {
      throw new Error('Không thể chuyển VNĐ cho tài khoản Bot.');
    }

    const res = this.db.transaction(() => {
      const sender = this.ensureUser(fromId, fromName, now);
      const receiver = this.ensureUser(toId, toName, now);

      this.assertCanTransact(sender);
      this.assertCanTransact(receiver);

      if (sender.wallet < cleanAmount) {
        throw new Error(
          `Số dư ví không đủ! Hiện có **${formatVnd(sender.wallet)}**, cần **${formatVnd(cleanAmount)}**.`
        );
      }

      const senderAfter = sender.wallet - cleanAmount;
      const receiverAfter = receiver.wallet + cleanAmount;

      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        senderAfter,
        now,
        String(fromId),
      ]);
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        receiverAfter,
        now,
        String(toId),
      ]);

      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'pay_out', ?, ?, ?, ?)`,
        [String(fromId), String(toId), -cleanAmount, senderAfter, `Chuyển tiền tới ${toId}`, now]
      );
      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'pay_in', ?, ?, ?, ?)`,
        [String(toId), String(fromId), cleanAmount, receiverAfter, `Nhận tiền từ ${fromId}`, now]
      );

      this.levelSystem?.evaluateMilestoneTitles(toId);
      return { amount: cleanAmount, senderAfter, receiverAfter };
    });

    this.logSystem?.send(
      LOG_CATEGORIES.ECONOMY,
      `💸 <@${fromId}> đã chuyển **${formatVnd(cleanAmount)}** cho <@${toId}>.`
    );

    return res;
  }

  getRichLeaderboard(limit = 10) {
    const safeLimit = Math.max(1, Math.min(25, limit));
    return this.db.all(
      `SELECT user_id, username, wallet, bank, savings, (wallet + bank + savings) AS net_worth, level, active_title
       FROM users
       WHERE is_banned = 0
       ORDER BY net_worth DESC
       LIMIT ?`,
      [safeLimit]
    );
  }

  getHistory(userId, limit = 10) {
    const safeLimit = Math.max(1, Math.min(20, limit));
    return this.db.all(
      `SELECT id, counterparty_id, type, amount, balance_after, note, created_at
       FROM transactions
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [String(userId), safeLimit]
    );
  }

  /**
   * Thống kê tổng cung tiền VNĐ toàn hệ thống & chỉ số lạm phát dành cho ADMIN / OWNER.
   */
  getMacroEconomyStats() {
    const row = this.db.get(
      `SELECT
         COUNT(*) AS total_users,
         COALESCE(SUM(wallet), 0) AS total_wallet,
         COALESCE(SUM(bank), 0) AS total_bank,
         COALESCE(SUM(savings), 0) AS total_savings,
         COALESCE(SUM(total_wagered), 0) AS total_wagered
       FROM users`
    );

    const totalSupply =
      (row?.total_wallet || 0) + (row?.total_bank || 0) + (row?.total_savings || 0);
    const totalUsers = Math.max(1, row?.total_users || 0);
    const avgWealth = Math.round(totalSupply / totalUsers);
    const baseStarter = Math.max(1, Number(this.db.getSetting('startingBalance') ?? 20_000));
    const inflationRatio = Number((avgWealth / baseStarter).toFixed(2));

    return {
      totalUsers: row?.total_users || 0,
      totalWallet: row?.total_wallet || 0,
      totalBank: row?.total_bank || 0,
      totalSavings: row?.total_savings || 0,
      totalSupply,
      avgWealth,
      totalWagered: row?.total_wagered || 0,
      inflationRatio,
    };
  }

  // ==========================================================================
  // Các thao tác Quản trị Tiền tệ (ADMIN / OWNER)
  // ==========================================================================

  adminAdjustWallet({ actorId, actorRole, targetId, targetName = '', mode, amount, reason = '' }) {
    const cleanAmt = Math.max(0, Math.trunc(Number(amount)));
    const now = Date.now();

    const result = this.db.transaction(() => {
      const user = this.ensureUser(targetId, targetName, now);
      let nextWallet = user.wallet;

      if (mode === 'add') {
        nextWallet = user.wallet + cleanAmt;
      } else if (mode === 'remove') {
        nextWallet = Math.max(0, user.wallet - cleanAmt);
      } else if (mode === 'set') {
        nextWallet = cleanAmt;
      } else {
        throw new Error('Chế độ điều chỉnh số dư không hợp lệ.');
      }

      const delta = nextWallet - user.wallet;
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        nextWallet,
        now,
        String(targetId),
      ]);

      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'admin_adjust', ?, ?, ?, ?)`,
        [
          String(targetId),
          String(actorId),
          delta,
          nextWallet,
          reason || `Quản trị viên (${mode})`,
          now,
        ]
      );

      this.db.recordAudit({
        actorId,
        actorRole,
        action: `economy_${mode}_money`,
        targetId,
        details: `amount=${cleanAmt}, delta=${delta}, after=${nextWallet}, reason=${reason}`,
      });

      this.levelSystem?.evaluateMilestoneTitles(targetId);
      return { before: user.wallet, after: nextWallet, delta };
    });

    this.logSystem?.send(
      LOG_CATEGORIES.ADMIN,
      `🛠️ **${actorRole}** <@${actorId}> thực hiện **${mode.toUpperCase()}** tiền đối với <@${targetId}>: \`${formatVnd(result.before)}\` → \`${formatVnd(result.after)}\`.`
    );

    return result;
  }

  adminResetUser({ actorId, actorRole, targetId }) {
    const now = Date.now();
    const startBal = Number(this.db.getSetting('startingBalance') ?? 20_000);

    this.db.transaction(() => {
      this.db.run('DELETE FROM inventory WHERE user_id = ?', [String(targetId)]);
      this.db.run('DELETE FROM pets WHERE user_id = ?', [String(targetId)]);
      this.db.run('DELETE FROM quest_progress WHERE user_id = ?', [String(targetId)]);
      this.db.run('DELETE FROM bounties WHERE target_id = ?', [String(targetId)]);
      this.db.run('DELETE FROM users WHERE user_id = ?', [String(targetId)]);
      this.ensureUser(targetId, '', now);
      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'reset_user',
        targetId,
        details: `Khôi phục toàn bộ tài khoản về mặc định (${startBal} VNĐ)`,
      });
    });

    this.logSystem?.send(
      LOG_CATEGORIES.ADMIN,
      `♻️ **${actorRole}** <@${actorId}> đã đặt lại (Reset) toàn bộ dữ liệu của <@${targetId}>.`
    );
  }
}
