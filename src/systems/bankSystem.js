import { formatRemainingMs, formatVnd } from '../utils/format.js';

/**
 * Hệ thống Ngân hàng & Tài khoản Tiết kiệm (Bank & Savings):
 * - Tính lãi suất theo chu kỳ xác định (Lazy Deterministic Accrual) dựa trên `last_interest_at`.
 * - Khởi động lại Bot 100 lần hay gọi lệnh `/interest` liên tục đều KHÔNG BAO GIỜ cộng lãi trùng lặp.
 */
export class BankSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   */
  constructor({ db, economySystem }) {
    this.db = db;
    this.economySystem = economySystem;
    this.questSystem = null;
    this.levelSystem = null;
  }

  bindSystems({ questSystem, levelSystem }) {
    this.questSystem = questSystem;
    this.levelSystem = levelSystem;
  }

  _checkBankEligibility(user) {
    const minLv = Number(this.db.getSetting('minLevelForBank') ?? 1);
    if (user.level < minLv) {
      throw new Error(
        `Bạn cần đạt tối thiểu **Cấp ${minLv}** để sử dụng dịch vụ Ngân hàng (Hiện tại: Cấp ${user.level}).`
      );
    }
  }

  /**
   * Tất toán tự động phần lãi suất đã đủ chu kỳ mà chưa nhận (tối đa tích lũy 30 chu kỳ).
   * Thực thi nguyên tử trong Transaction để chống nhận lãi trùng.
   */
  settleInterest(userId, username = '', now = Date.now()) {
    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      const intervalHours = Math.max(
        1,
        Number(this.db.getSetting('interestIntervalHours') ?? 24)
      );
      const intervalMs = intervalHours * 3600 * 1000;
      const baseRate = Math.max(0, Number(this.db.getSetting('bankInterestRate') ?? 0.02));
      const savingsBonus = Math.max(
        1,
        Number(this.db.getSetting('savingsInterestBonus') ?? 1.5)
      );
      const maxDeposit = Number(this.db.getSetting('maxBankDeposit') ?? 500_000_000);

      const lastAt = user.last_interest_at || now;
      if (!user.last_interest_at) {
        this.db.run('UPDATE users SET last_interest_at = ? WHERE user_id = ?', [
          now,
          String(userId),
        ]);
      }

      const rawPeriods = Math.floor((now - lastAt) / intervalMs);
      if (rawPeriods <= 0) {
        const nextInMs = intervalMs - ((now - lastAt) % intervalMs);
        return {
          credited: 0,
          periodsApplied: 0,
          bank: user.bank,
          savings: user.savings,
          baseRate,
          savingsRate: baseRate * savingsBonus,
          intervalHours,
          nextInterestInMs: nextInMs,
        };
      }

      const periodsApplied = Math.min(30, rawPeriods);
      const newLastInterestAt = lastAt + rawPeriods * intervalMs;

      let bankInterest = 0;
      let savingsInterest = 0;

      if (user.bank > 0 && !user.is_frozen && !user.is_banned) {
        bankInterest = Math.floor(user.bank * baseRate * periodsApplied);
      }
      if (user.savings > 0 && !user.is_frozen && !user.is_banned) {
        savingsInterest = Math.floor(
          user.savings * (baseRate * savingsBonus) * periodsApplied
        );
      }

      const nextBank = Math.min(maxDeposit, user.bank + bankInterest);
      const nextSavings = Math.min(maxDeposit, user.savings + savingsInterest);
      const totalCredited = nextBank - user.bank + (nextSavings - user.savings);

      this.db.run(
        `UPDATE users
         SET bank = ?, savings = ?, last_interest_at = ?, total_earned = total_earned + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextBank, nextSavings, newLastInterestAt, totalCredited, now, String(userId)]
      );

      if (totalCredited > 0) {
        this.db.run(
          `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
           VALUES (?, 'interest', ?, ?, ?, ?)`,
          [
            String(userId),
            totalCredited,
            user.wallet,
            `Lãi ngân hàng (${periodsApplied} chu kỳ)`,
            now,
          ]
        );
      }

      const nextInMs = intervalMs - ((now - newLastInterestAt) % intervalMs);
      return {
        credited: totalCredited,
        periodsApplied,
        bank: nextBank,
        savings: nextSavings,
        baseRate,
        savingsRate: baseRate * savingsBonus,
        intervalHours,
        nextInterestInMs: nextInMs,
      };
    });
  }

  /**
   * Gửi VNĐ vào Ngân hàng thường hoặc Sổ tiết kiệm (/deposit).
   */
  deposit(userId, username, amountOrAll, accountType = 'checking', now = Date.now()) {
    return this.db.transaction(() => {
      this.settleInterest(userId, username, now);
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);
      this._checkBankEligibility(user);

      const maxDeposit = Number(this.db.getSetting('maxBankDeposit') ?? 500_000_000);
      const isSavings = accountType === 'savings';
      const currentStored = isSavings ? user.savings : user.bank;
      const roomLeft = Math.max(0, maxDeposit - currentStored);

      if (roomLeft <= 0) {
        throw new Error(
          `Hạn mức gửi tối đa (${formatVnd(maxDeposit)}) của tài khoản này đã đầy!`
        );
      }

      let amount =
        amountOrAll === 'all' ? Math.min(user.wallet, roomLeft) : Math.trunc(Number(amountOrAll));

      if (!Number.isSafeInteger(amount) || amount < 1_000) {
        throw new Error('Số tiền gửi tối thiểu là **1.000 VNĐ**.');
      }
      if (amount > user.wallet) {
        throw new Error(
          `Số dư ví không đủ! Bạn đang có **${formatVnd(user.wallet)}** tiền mặt.`
        );
      }
      if (amount > roomLeft) {
        amount = roomLeft;
      }

      if (isSavings) {
        const minSavings = Number(this.db.getSetting('minDepositForSavings') ?? 50_000);
        if (user.savings + amount < minSavings) {
          throw new Error(
            `Mở Sổ Tiết Kiệm yêu cầu số dư tối thiểu **${formatVnd(minSavings)}**.`
          );
        }
      }

      const nextWallet = user.wallet - amount;
      const nextBank = isSavings ? user.bank : user.bank + amount;
      const nextSavings = isSavings ? user.savings + amount : user.savings;
      const openedAt =
        isSavings && !user.savings_opened_at ? now : user.savings_opened_at;

      this.db.run(
        `UPDATE users
         SET wallet = ?, bank = ?, savings = ?, savings_opened_at = ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, nextBank, nextSavings, openedAt, now, String(userId)]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(userId),
          isSavings ? 'savings_deposit' : 'deposit',
          -amount,
          nextWallet,
          isSavings ? 'Gửi Sổ Tiết Kiệm lãi cao' : 'Gửi Ngân Hàng',
          now,
        ]
      );

      this.questSystem?.incrementMetric(userId, 'bank_deposit', 1, now);
      this.levelSystem?.grantExp(userId, 15, now);

      return {
        amount,
        accountType,
        walletAfter: nextWallet,
        bankAfter: nextBank,
        savingsAfter: nextSavings,
      };
    });
  }

  /**
   * Rút VNĐ từ Ngân hàng hoặc Sổ Tiết Kiệm về ví (/withdraw).
   */
  withdraw(userId, username, amountOrAll, accountType = 'checking', now = Date.now()) {
    return this.db.transaction(() => {
      this.settleInterest(userId, username, now);
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      const isSavings = accountType === 'savings';
      const sourceBal = isSavings ? user.savings : user.bank;

      const amount =
        amountOrAll === 'all' ? sourceBal : Math.trunc(Number(amountOrAll));

      if (!Number.isSafeInteger(amount) || amount < 1_000) {
        throw new Error('Số tiền rút tối thiểu là **1.000 VNĐ**.');
      }
      if (amount > sourceBal) {
        throw new Error(
          `Số dư ${isSavings ? 'Sổ Tiết Kiệm' : 'Ngân Hàng'} không đủ! Hiện có **${formatVnd(sourceBal)}**.`
        );
      }

      const nextWallet = user.wallet + amount;
      const nextBank = isSavings ? user.bank : user.bank - amount;
      const nextSavings = isSavings ? user.savings - amount : user.savings;

      this.db.run(
        `UPDATE users SET wallet = ?, bank = ?, savings = ?, updated_at = ? WHERE user_id = ?`,
        [nextWallet, nextBank, nextSavings, now, String(userId)]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(userId),
          isSavings ? 'savings_withdraw' : 'withdraw',
          amount,
          nextWallet,
          isSavings ? 'Rút từ Sổ Tiết Kiệm' : 'Rút tiền Ngân Hàng',
          now,
        ]
      );

      return {
        amount,
        accountType,
        walletAfter: nextWallet,
        bankAfter: nextBank,
        savingsAfter: nextSavings,
      };
    });
  }

  getBankHistory(userId, limit = 10) {
    const safeLimit = Math.max(1, Math.min(15, limit));
    return this.db.all(
      `SELECT type, amount, balance_after, note, created_at
       FROM transactions
       WHERE user_id = ? AND type IN ('deposit', 'withdraw', 'savings_deposit', 'savings_withdraw', 'interest')
       ORDER BY id DESC
       LIMIT ?`,
      [String(userId), safeLimit]
    );
  }

  formatNextInterestCountdown(nextInterestInMs) {
    return formatRemainingMs(nextInterestInMs);
  }
}
