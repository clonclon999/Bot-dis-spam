import { BOT_ROLES, SHOP_ITEMS } from '../config/constants.js';
import { formatRemainingMs, formatVnd } from '../utils/format.js';
import { resolveBotRole } from '../utils/permissions.js';
import { rollChancePct, secureInt } from '../utils/rng.js';

/**
 * Hệ thống Cướp Tiền (/rob), Bảo Hiểm (/protect) & Truy Nã (/bounty, /wanted):
 * - Cướp thất bại bị phạt tiền mặt và tự động ghi tên lên bảng Truy nã.
 * - Tuyệt đối không thể cướp OWNER hoặc ADMIN khi chế độ bảo vệ quản trị đang bật.
 */
export class CrimeSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   */
  constructor({ db, economySystem }) {
    this.db = db;
    this.economySystem = economySystem;
  }

  rob({ robberId, robberName, victimId, victimName, isVictimBot = false, now = Date.now() }) {
    if (String(robberId) === String(victimId)) {
      throw new Error('Bạn không thể tự cướp chính mình!');
    }
    if (isVictimBot) {
      throw new Error('Không thể cướp tài khoản Bot!');
    }

    return this.db.transaction(() => {
      const robber = this.economySystem.ensureUser(robberId, robberName, now);
      const victim = this.economySystem.ensureUser(victimId, victimName, now);

      this.economySystem.assertCanTransact(robber);

      // Bảo vệ OWNER và ADMIN khi chế độ protectStaffFromRob bật
      if (this.db.getSetting('protectStaffFromRob')) {
        const victimRole = resolveBotRole(this.db, victimId);
        if (victimRole === BOT_ROLES.OWNER || victimRole === BOT_ROLES.ADMIN) {
          throw new Error(
            '🛡️ Tài khoản **OWNER / ADMIN** đang được hệ thống tối cao bảo vệ — không thể thực hiện hành vi cướp!'
          );
        }
      }

      const cooldownMs = Number(this.db.getSetting('robCooldownSec') ?? 600) * 1000;
      const elapsed = now - (robber.last_rob_at || 0);
      if (elapsed < cooldownMs) {
        throw new Error(
          `Cảnh sát đang tuần tra! Hãy đợi **${formatRemainingMs(cooldownMs - elapsed)}** trước khi hành động tiếp.`
        );
      }

      if (robber.wallet < 3_000) {
        throw new Error('Bạn cần có ít nhất **3.000 VNĐ** tiền mặt trong ví mới có thể đi cướp.');
      }

      if (victim.protected_until > now) {
        throw new Error(
          `🛡️ <@${victimId}> đang có **Bảo Hiểm Chống Cướp** hiệu lực còn **${formatRemainingMs(victim.protected_until - now)}**!`
        );
      }

      if (victim.wallet < 5_000) {
        throw new Error('Ví tiền mặt của mục tiêu quá ít (< 5.000 VNĐ), không bõ công ra tay!');
      }

      const successRate = Number(this.db.getSetting('robSuccessRatePct') ?? 40);
      const maxStealPct = Number(this.db.getSetting('robMaxStealPct') ?? 15);
      const maxCap = Number(this.db.getSetting('robMaxCap') ?? 250_000);
      const failFinePct = Number(this.db.getSetting('robFailFinePct') ?? 12);
      const failBounty = Number(this.db.getSetting('robFailBounty') ?? 15_000);

      const succeeded = rollChancePct(successRate);

      if (succeeded) {
        const maxPossible = Math.min(
          maxCap,
          Math.max(1_000, Math.floor((victim.wallet * maxStealPct) / 100))
        );
        const minPossible = Math.max(500, Math.floor(maxPossible * 0.4));
        const stolen = Math.min(victim.wallet, secureInt(minPossible, maxPossible));

        // Kiểm tra tiền thưởng truy nã trên đầu nạn nhân (nếu có)
        const activeBounty = this.db.get(
          'SELECT amount FROM bounties WHERE target_id = ?',
          [String(victimId)]
        );
        const bountyBonus = activeBounty?.amount ?? 0;
        if (bountyBonus > 0) {
          this.db.run('DELETE FROM bounties WHERE target_id = ?', [String(victimId)]);
        }

        const robberAfter = robber.wallet + stolen + bountyBonus;
        const victimAfter = victim.wallet - stolen;

        this.db.run(
          'UPDATE users SET wallet = ?, last_rob_at = ?, updated_at = ? WHERE user_id = ?',
          [robberAfter, now, now, String(robberId)]
        );
        this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
          victimAfter,
          now,
          String(victimId),
        ]);

        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, ?, 'rob_gain', ?, ?, ?, ?)`,
          [
            String(robberId),
            String(victimId),
            stolen + bountyBonus,
            robberAfter,
            bountyBonus > 0 ? `Cướp thành công + Thưởng truy nã` : `Cướp thành công từ ${victimId}`,
            now,
          ]
        );
        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, ?, 'rob_loss', ?, ?, ?, ?)`,
          [String(victimId), String(robberId), -stolen, victimAfter, `Bị ${robberId} cướp`, now]
        );

        return {
          succeeded: true,
          stolen,
          bountyBonus,
          robberAfter,
          victimAfter,
        };
      }

      // Thất bại -> Bị phạt tiền & lên bảng Truy nã
      const fine = Math.min(
        robber.wallet,
        Math.max(1_000, Math.floor((robber.wallet * failFinePct) / 100))
      );
      const compensation = Math.floor(fine * 0.5);
      const robberAfter = robber.wallet - fine;
      const victimAfter = victim.wallet + compensation;

      this.db.run(
        'UPDATE users SET wallet = ?, last_rob_at = ?, updated_at = ? WHERE user_id = ?',
        [robberAfter, now, now, String(robberId)]
      );
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        victimAfter,
        now,
        String(victimId),
      ]);

      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'rob_fine', ?, ?, 'Bị bắt khi đi cướp', ?)`,
        [String(robberId), String(victimId), -fine, robberAfter, now]
      );

      this.db.run(
        `INSERT INTO bounties (target_id, amount, placed_by, reason, updated_at)
         VALUES (?, ?, 'SYSTEM', 'Cướp tài sản thất bại', ?)
         ON CONFLICT(target_id) DO UPDATE SET
           amount = bounties.amount + excluded.amount,
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
        [String(robberId), failBounty, now]
      );

      return {
        succeeded: false,
        fine,
        compensation,
        addedBounty: failBounty,
        robberAfter,
      };
    });
  }

  /**
   * Mua và kích hoạt ngay Bảo hiểm chống cướp 24h (/protect).
   */
  buyProtection(userId, username, hours = 24, now = Date.now()) {
    const unitPrice = SHOP_ITEMS.rob_shield.price;
    const days = Math.max(1, Math.min(7, Math.ceil(hours / 24)));
    const totalCost = unitPrice * days;
    const durationMs = days * 24 * 3600 * 1000;

    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      if (user.wallet < totalCost) {
        throw new Error(
          `Không đủ tiền! Cần **${formatVnd(totalCost)}** để mua **${days * 24} giờ** Bảo hiểm chống cướp.`
        );
      }

      const nextWallet = user.wallet - totalCost;
      const baseTime = Math.max(now, user.protected_until || 0);
      const protectedUntil = baseTime + durationMs;

      this.db.run(
        'UPDATE users SET wallet = ?, protected_until = ?, updated_at = ? WHERE user_id = ?',
        [nextWallet, protectedUntil, now, String(userId)]
      );
      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'protect_buy', ?, ?, ?, ?)`,
        [String(userId), -totalCost, nextWallet, `Mua bảo hiểm chống cướp (${days * 24}h)`, now]
      );

      return { cost: totalCost, protectedUntil, balanceAfter: nextWallet };
    });
  }

  /**
   * Đặt tiền thưởng truy nã lên một người chơi khác (/bounty).
   */
  placeBounty({ placerId, placerName, targetId, targetName, amount, reason = '', isTargetBot = false, now = Date.now() }) {
    const cleanAmt = Math.trunc(Number(amount));
    if (!Number.isSafeInteger(cleanAmt) || cleanAmt < 5_000) {
      throw new Error('Tiền thưởng truy nã tối thiểu là **5.000 VNĐ**.');
    }
    if (String(placerId) === String(targetId) || isTargetBot) {
      throw new Error('Mục tiêu đặt truy nã không hợp lệ.');
    }

    return this.db.transaction(() => {
      const placer = this.economySystem.ensureUser(placerId, placerName, now);
      this.economySystem.ensureUser(targetId, targetName, now);
      this.economySystem.assertCanTransact(placer);

      if (this.db.getSetting('protectStaffFromRob')) {
        const role = resolveBotRole(this.db, targetId);
        if (role === BOT_ROLES.OWNER || role === BOT_ROLES.ADMIN) {
          throw new Error('Không thể đặt lệnh truy nã đối với OWNER hoặc ADMIN.');
        }
      }

      if (placer.wallet < cleanAmt) {
        throw new Error(`Số dư ví không đủ! Cần **${formatVnd(cleanAmt)}**.`);
      }

      const nextWallet = placer.wallet - cleanAmt;
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        nextWallet,
        now,
        String(placerId),
      ]);

      this.db.run(
        `INSERT INTO bounties (target_id, amount, placed_by, reason, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(target_id) DO UPDATE SET
           amount = bounties.amount + excluded.amount,
           placed_by = excluded.placed_by,
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
        [String(targetId), cleanAmt, String(placerId), String(reason || 'Truy nã giang hồ').slice(0, 120), now]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'bounty_place', ?, ?, ?, ?)`,
        [String(placerId), String(targetId), -cleanAmt, nextWallet, `Đặt truy nã ${targetId}`, now]
      );

      const updatedBounty = this.db.get('SELECT * FROM bounties WHERE target_id = ?', [
        String(targetId),
      ]);
      return { totalBounty: updatedBounty.amount, balanceAfter: nextWallet };
    });
  }

  getWantedList(limit = 10) {
    const safeLimit = Math.max(1, Math.min(20, limit));
    return this.db.all(
      'SELECT * FROM bounties WHERE amount > 0 ORDER BY amount DESC, updated_at DESC LIMIT ?',
      [safeLimit]
    );
  }
}
