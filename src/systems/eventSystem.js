import { EVENT_TYPES, EVENT_TYPE_LABELS, LOG_CATEGORIES } from '../config/constants.js';
import { formatVnd } from '../utils/format.js';

/**
 * Hệ thống Sự kiện Máy chủ (Server Events):
 * Hỗ trợ đủ 7 loại sự kiện (Đua top người giàu, Đua top cấp độ, Bầu Cua, Tài Xỉu,
 * Nhiệm vụ, Đăng nhập liên tục, Phát thưởng toàn server) kèm tự động phát thưởng.
 */
export class EventSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./logSystem.js').LogSystem} deps.logSystem
   */
  constructor({ db, logSystem }) {
    this.db = db;
    this.logSystem = logSystem;
  }

  getActiveEvents(now = Date.now()) {
    return this.db.all(
      "SELECT * FROM server_events WHERE status = 'active' AND ends_at > ? ORDER BY id DESC",
      [now]
    );
  }

  getEventById(eventId) {
    return this.db.get('SELECT * FROM server_events WHERE id = ?', [Number(eventId)]);
  }

  getEventLeaderboard(eventId, limit = 10) {
    const safeLimit = Math.max(1, Math.min(20, limit));
    return this.db.all(
      `SELECT es.user_id, es.score, u.username
       FROM event_scores es
       LEFT JOIN users u ON u.user_id = es.user_id
       WHERE es.event_id = ?
       ORDER BY es.score DESC, es.updated_at ASC
       LIMIT ?`,
      [Number(eventId), safeLimit]
    );
  }

  /**
   * Tự động cộng điểm cho người chơi khi phát sinh hoạt động khớp với các sự kiện đang mở.
   */
  recordProgress(userId, eventType, points = 1, now = Date.now()) {
    if (!points || points <= 0) return;
    const active = this.db.all(
      "SELECT id FROM server_events WHERE status = 'active' AND type = ? AND ends_at > ?",
      [eventType, now]
    );
    if (active.length === 0) return;

    this.db.transaction(() => {
      for (const ev of active) {
        this.db.run(
          `INSERT INTO event_scores (event_id, user_id, score, claimed, updated_at)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(event_id, user_id) DO UPDATE SET
             score = event_scores.score + excluded.score,
             updated_at = excluded.updated_at`,
          [ev.id, String(userId), Math.trunc(points), now]
        );
      }
    });
  }

  /**
   * Tạo sự kiện mới (dành cho OWNER / ADMIN).
   */
  createEvent({ actorId, actorRole, type, name, description = '', rewardVnd, durationHours = 24, now = Date.now() }) {
    if (!EVENT_TYPE_LABELS[type]) {
      throw new Error('Loại sự kiện không hợp lệ.');
    }
    const cleanReward = Math.max(1_000, Math.trunc(Number(rewardVnd) || 50_000));
    const endsAt = now + Math.max(1, Number(durationHours)) * 3600 * 1000;
    const eventName = String(name || EVENT_TYPE_LABELS[type]).trim().slice(0, 80);
    const desc =
      String(description || '').trim() ||
      `Tham gia ${EVENT_TYPE_LABELS[type]} để nhận tổng quỹ thưởng hấp dẫn!`;

    const created = this.db.transaction(() => {
      this.db.run(
        `INSERT INTO server_events (type, name, description, reward_vnd, starts_at, ends_at, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        [type, eventName, desc, cleanReward, now, endsAt, String(actorId)]
      );
      const row = this.db.get('SELECT * FROM server_events ORDER BY id DESC LIMIT 1');
      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'event_create',
        targetId: String(row.id),
        details: `${eventName} (${type}) reward=${cleanReward}`,
      });
      return row;
    });

    this.logSystem?.send(
      LOG_CATEGORIES.EVENT,
      `🎉 Sự kiện mới **#${created.id} — ${created.name}** đã mở! Quỹ thưởng Top 1: **${formatVnd(cleanReward)}**.`
    );

    return created;
  }

  editEvent({ actorId, actorRole, eventId, rewardVnd = null, extendHours = null }) {
    const ev = this.getEventById(eventId);
    if (!ev) throw new Error(`Không tìm thấy sự kiện #${eventId}.`);

    const nextReward = rewardVnd !== null ? Math.max(1_000, Math.trunc(rewardVnd)) : ev.reward_vnd;
    const nextEnds =
      extendHours !== null ? ev.ends_at + Math.trunc(extendHours * 3600 * 1000) : ev.ends_at;

    this.db.transaction(() => {
      this.db.run(
        'UPDATE server_events SET reward_vnd = ?, ends_at = ? WHERE id = ?',
        [nextReward, nextEnds, ev.id]
      );
      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'event_edit',
        targetId: String(ev.id),
        details: `reward=${nextReward}, endsAt=${nextEnds}`,
      });
    });

    return this.getEventById(eventId);
  }

  /**
   * Kết thúc sự kiện và tự động trao thưởng cho Top 3 người dẫn đầu (100% / 60% / 30% mức thưởng gốc).
   */
  stopAndDistributeRewards({ actorId, actorRole, eventId, autoPay = true, now = Date.now() }) {
    const ev = this.getEventById(eventId);
    if (!ev) throw new Error(`Không tìm thấy sự kiện #${eventId}.`);
    if (ev.status === 'ended') throw new Error(`Sự kiện #${eventId} đã kết thúc trước đó.`);

    const winners = this.db.transaction(() => {
      this.db.run("UPDATE server_events SET status = 'ended', ends_at = ? WHERE id = ?", [
        now,
        ev.id,
      ]);

      const paid = [];
      if (autoPay) {
        const top3 = this.getEventLeaderboard(ev.id, 3);
        const ratios = [1.0, 0.6, 0.3];

        top3.forEach((entry, idx) => {
          const prize = Math.round(ev.reward_vnd * ratios[idx]);
          if (prize <= 0) return;

          const u = this.db.get('SELECT wallet FROM users WHERE user_id = ?', [
            entry.user_id,
          ]);
          if (!u) return;

          const after = u.wallet + prize;
          this.db.run(
            'UPDATE users SET wallet = ?, total_earned = total_earned + ?, updated_at = ? WHERE user_id = ?',
            [after, prize, now, entry.user_id]
          );
          this.db.run(
            `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
             VALUES (?, 'event_reward', ?, ?, ?, ?)`,
            [entry.user_id, prize, after, `Top ${idx + 1} sự kiện #${ev.id}: ${ev.name}`, now]
          );
          paid.push({ userId: entry.user_id, rank: idx + 1, score: entry.score, prize });
        });
      }

      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'event_stop',
        targetId: String(ev.id),
        details: `winnersPaid=${paid.length}`,
      });
      return paid;
    });

    this.logSystem?.send(
      LOG_CATEGORIES.EVENT,
      `🏁 Sự kiện **#${ev.id} — ${ev.name}** đã kết thúc! Đã tự động phát thưởng cho **${winners.length}** người dẫn đầu.`
    );

    return { event: ev, winners };
  }

  /**
   * Phát thưởng toàn hệ thống (Global Server Airdrop) cho tất cả tài khoản đang hoạt động hợp lệ.
   */
  distributeGlobalAirdrop({ actorId, actorRole, amountPerUser, reason = 'Phát thưởng toàn server', now = Date.now() }) {
    const cleanAmt = Math.max(1_000, Math.trunc(Number(amountPerUser)));

    const summary = this.db.transaction(() => {
      const recipients = this.db.all(
        'SELECT user_id, wallet FROM users WHERE is_banned = 0 AND is_frozen = 0'
      );

      for (const r of recipients) {
        const after = r.wallet + cleanAmt;
        this.db.run(
          'UPDATE users SET wallet = ?, total_earned = total_earned + ?, updated_at = ? WHERE user_id = ?',
          [after, cleanAmt, now, r.user_id]
        );
        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, ?, 'airdrop', ?, ?, ?, ?)`,
          [r.user_id, String(actorId), cleanAmt, after, reason, now]
        );
      }

      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'global_airdrop',
        details: `recipients=${recipients.length}, amountPerUser=${cleanAmt}, total=${recipients.length * cleanAmt}`,
      });

      return {
        recipientCount: recipients.length,
        amountPerUser: cleanAmt,
        totalDistributed: recipients.length * cleanAmt,
      };
    });

    this.logSystem?.send(
      LOG_CATEGORIES.EVENT,
      `🎁 **PHÁT THƯỞNG TOÀN SERVER:** <@${actorId}> đã trao **${formatVnd(cleanAmt)}**/người cho **${summary.recipientCount}** người chơi!`
    );

    return summary;
  }
}
