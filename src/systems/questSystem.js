import { BUILTIN_QUESTS, LOG_CATEGORIES } from '../config/constants.js';
import { formatVnd, getVnDateKey, getVnWeekKey } from '../utils/format.js';

/**
 * Hệ thống Nhiệm vụ Hằng ngày, Hằng tuần, Đặc biệt & Tùy chỉnh (Quests):
 * - Tự động làm mới theo ngày / tuần (UTC+7).
 * - Hiển thị thanh tiến trình trực quan và chống nhận thưởng trùng lặp bằng Transaction ACID.
 */
export class QuestSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./logSystem.js').LogSystem} deps.logSystem
   */
  constructor({ db, logSystem }) {
    this.db = db;
    this.logSystem = logSystem;
    this.economySystem = null;
    this.levelSystem = null;
    this.eventSystem = null;
  }

  bindSystems({ economySystem, levelSystem, eventSystem }) {
    this.economySystem = economySystem;
    this.levelSystem = levelSystem;
    this.eventSystem = eventSystem;
  }

  getPeriodKey(scope, now = Date.now()) {
    if (scope === 'daily') return getVnDateKey(now);
    if (scope === 'weekly') return getVnWeekKey(now);
    return 'ONCE';
  }

  /**
   * Lấy danh sách toàn bộ nhiệm vụ đang hoạt động (gồm cả nhiệm vụ mặc định & nhiệm vụ do Admin tạo).
   */
  getAllActiveQuests(userLevel = 1, now = Date.now()) {
    const customRows = this.db.all(
      'SELECT * FROM custom_quests WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)',
      [now]
    );

    const customMapped = customRows.map((r) => ({
      id: r.id,
      scope: r.scope,
      name: r.name,
      description: r.description,
      metric: r.metric,
      target: r.target,
      rewardVnd: r.reward_vnd,
      rewardExp: r.reward_exp,
      expiresAt: r.expires_at,
      isCustom: true,
    }));

    const builtins = BUILTIN_QUESTS.filter((q) => {
      if (q.minLevel && userLevel < q.minLevel) return false;
      if (q.maxLevel && userLevel > q.maxLevel) return false;
      return true;
    });

    return [...builtins, ...customMapped];
  }

  /**
   * Ghi nhận tiến độ nhiệm vụ theo `metric` cho người chơi.
   */
  incrementMetric(userId, metric, delta = 1, now = Date.now()) {
    if (!delta || delta <= 0) return;
    const uid = String(userId);
    const user = this.db.get('SELECT level FROM users WHERE user_id = ?', [uid]);
    const lv = user?.level ?? 1;

    const matchingQuests = this.getAllActiveQuests(lv, now).filter(
      (q) => q.metric === metric
    );
    if (matchingQuests.length === 0) return;

    this.db.transaction(() => {
      for (const q of matchingQuests) {
        const periodKey = this.getPeriodKey(q.scope, now);
        const existing = this.db.get(
          'SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND quest_id = ? AND period_key = ?',
          [uid, q.id, periodKey]
        );

        if (existing?.claimed) continue;

        const nextProg = Math.min(q.target, (existing?.progress ?? 0) + delta);
        this.db.run(
          `INSERT INTO quest_progress (user_id, quest_id, period_key, progress, claimed, updated_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(user_id, quest_id, period_key)
           DO UPDATE SET progress = excluded.progress, updated_at = excluded.updated_at`,
          [uid, q.id, periodKey, nextProg, now]
        );
      }
    });
  }

  /**
   * Xem danh sách nhiệm vụ và tiến độ của một người chơi theo phân loại (`daily`, `weekly`, `special`, hoặc `all`).
   */
  getUserQuests(userId, username = '', filterScope = 'all', now = Date.now()) {
    const user = this.economySystem.ensureUser(userId, username, now);
    const activeQuests = this.getAllActiveQuests(user.level, now).filter((q) =>
      filterScope === 'all' ? true : q.scope === filterScope
    );

    const rewardGlobalMult = Number(this.db.getSetting('questRewardMultiplier') ?? 1.0);

    return activeQuests.map((q) => {
      const periodKey = this.getPeriodKey(q.scope, now);
      const row = this.db.get(
        'SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND quest_id = ? AND period_key = ?',
        [String(userId), q.id, periodKey]
      );
      const progress = Math.min(q.target, row?.progress ?? 0);
      const claimed = Boolean(row?.claimed);
      const completed = progress >= q.target;

      return {
        ...q,
        rewardVnd: Math.round(q.rewardVnd * rewardGlobalMult),
        progress,
        claimed,
        completed,
        claimable: completed && !claimed,
      };
    });
  }

  /**
   * Nhận thưởng tất cả các nhiệm vụ đã hoàn thành của người chơi (hoặc 1 nhiệm vụ cụ thể) — chống nhận đúp 100%.
   */
  claimRewards(userId, username = '', specificQuestId = null, now = Date.now()) {
    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      const list = this.getUserQuests(userId, username, 'all', now).filter((q) =>
        specificQuestId ? q.id === specificQuestId : q.claimable
      );

      if (specificQuestId && list.length === 0) {
        throw new Error('Không tìm thấy mã nhiệm vụ này.');
      }

      const readyList = list.filter((q) => q.claimable);
      if (readyList.length === 0) {
        throw new Error(
          specificQuestId
            ? 'Nhiệm vụ này chưa hoàn thành hoặc bạn đã nhận thưởng rồi!'
            : 'Hiện chưa có nhiệm vụ nào hoàn thành sẵn sàng để nhận thưởng.'
        );
      }

      const earnMult = this.economySystem.getEarnMultiplier(user, now);
      let totalVnd = 0;
      let totalBaseExp = 0;
      const claimedQuests = [];

      for (const q of readyList) {
        const periodKey = this.getPeriodKey(q.scope, now);
        // Kiểm tra lại trực tiếp trong DB để chặn tuyệt đối double-claim
        const freshRow = this.db.get(
          'SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND quest_id = ? AND period_key = ?',
          [String(userId), q.id, periodKey]
        );
        if (!freshRow || freshRow.claimed || freshRow.progress < q.target) {
          continue;
        }

        this.db.run(
          'UPDATE quest_progress SET claimed = 1, updated_at = ? WHERE user_id = ? AND quest_id = ? AND period_key = ?',
          [now, String(userId), q.id, periodKey]
        );

        const finalVnd = Math.round(q.rewardVnd * earnMult);
        totalVnd += finalVnd;
        totalBaseExp += q.rewardExp;
        claimedQuests.push({ ...q, finalVnd });
      }

      if (claimedQuests.length === 0) {
        throw new Error('Nhiệm vụ đã được nhận thưởng trước đó.');
      }

      const freshUser = this.db.get('SELECT wallet FROM users WHERE user_id = ?', [
        String(userId),
      ]);
      const nextWallet = freshUser.wallet + totalVnd;

      this.db.run(
        `UPDATE users
         SET wallet = ?, total_earned = total_earned + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, totalVnd, now, String(userId)]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'quest_reward', ?, ?, ?, ?)`,
        [
          String(userId),
          totalVnd,
          nextWallet,
          `Nhận thưởng ${claimedQuests.length} nhiệm vụ`,
          now,
        ]
      );

      // Tăng tiến độ nhiệm vụ tuần "Hoàn thành 30 nhiệm vụ" và sự kiện Nhiệm vụ
      const nonSelfCount = claimedQuests.filter(
        (q) => q.metric !== 'quests_claimed'
      ).length;
      if (nonSelfCount > 0) {
        this.incrementMetric(userId, 'quests_claimed', nonSelfCount, now);
        this.eventSystem?.recordProgress(userId, 'quest_event', nonSelfCount, now);
      }

      const expResult = this.levelSystem?.grantExp(userId, totalBaseExp, now);

      this.logSystem?.send(
        LOG_CATEGORIES.QUEST,
        `📜 <@${userId}> đã nhận thưởng **${claimedQuests.length}** nhiệm vụ (+**${formatVnd(totalVnd)}**).`
      );

      return {
        claimedQuests,
        totalVnd,
        balanceAfter: nextWallet,
        expResult,
      };
    });
  }

  // ==========================================================================
  // Công cụ Quản trị Nhiệm vụ (ADMIN / OWNER)
  // ==========================================================================

  createCustomQuest({ id, scope, name, description, metric, target, rewardVnd, rewardExp, durationHours = null }) {
    const cleanId = String(id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!cleanId) throw new Error('Mã nhiệm vụ không hợp lệ.');

    const now = Date.now();
    const expiresAt = durationHours && durationHours > 0 ? now + durationHours * 3600 * 1000 : null;

    this.db.run(
      `INSERT INTO custom_quests (id, scope, name, description, metric, target, reward_vnd, reward_exp, expires_at, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [cleanId, scope, name, description, metric, target, rewardVnd, rewardExp, expiresAt, now]
    );
    return cleanId;
  }

  editCustomQuest(id, patch) {
    const existing = this.db.get('SELECT * FROM custom_quests WHERE id = ?', [String(id)]);
    if (!existing) throw new Error(`Không tìm thấy nhiệm vụ tùy chỉnh mã "${id}".`);

    const nextName = patch.name ?? existing.name;
    const nextTarget = patch.target ?? existing.target;
    const nextVnd = patch.rewardVnd ?? existing.reward_vnd;
    const nextExp = patch.rewardExp ?? existing.reward_exp;

    this.db.run(
      `UPDATE custom_quests SET name = ?, target = ?, reward_vnd = ?, reward_exp = ? WHERE id = ?`,
      [nextName, nextTarget, nextVnd, nextExp, String(id)]
    );
  }

  deleteCustomQuest(id) {
    const existing = this.db.get('SELECT id FROM custom_quests WHERE id = ?', [String(id)]);
    if (!existing) throw new Error(`Không tìm thấy nhiệm vụ tùy chỉnh mã "${id}".`);
    this.db.run('DELETE FROM custom_quests WHERE id = ?', [String(id)]);
  }
}
