import { TITLES } from '../config/constants.js';

/**
 * Tính lượng EXP cần thiết để lên cấp tiếp theo từ cấp `level`.
 * @param {number} level
 * @returns {number}
 */
export function expRequiredForLevel(level) {
  const safeLv = Math.max(1, Math.trunc(level));
  return Math.floor(100 * Math.pow(safeLv, 1.45));
}

/**
 * Hệ thống Cấp độ (Level), Kinh nghiệm (EXP), Khung hồ sơ & Danh hiệu (Titles).
 */
export class LevelSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   */
  constructor({ db }) {
    this.db = db;
    this.petSystem = null;
    this.questSystem = null;
    this.eventSystem = null;
  }

  bindSystems({ petSystem, questSystem, eventSystem }) {
    this.petSystem = petSystem;
    this.questSystem = questSystem;
    this.eventSystem = eventSystem;
  }

  /**
   * Cộng EXP cho người chơi (tự động nhân thẻ x2 EXP + bonus Thú cưng, xử lý lên cấp & thưởng VNĐ).
   * @param {string} userId
   * @param {number} baseExp
   * @param {number} [now=Date.now()]
   * @returns {{ addedExp: number, leveledUp: boolean, oldLevel: number, newLevel: number, levelRewardVnd: number, newlyUnlockedTitles: string[] }}
   */
  grantExp(userId, baseExp, now = Date.now()) {
    if (!baseExp || baseExp <= 0) {
      return {
        addedExp: 0,
        leveledUp: false,
        oldLevel: 1,
        newLevel: 1,
        levelRewardVnd: 0,
        newlyUnlockedTitles: [],
      };
    }

    return this.db.transaction(() => {
      const user = this.db.get('SELECT * FROM users WHERE user_id = ?', [String(userId)]);
      if (!user) {
        return {
          addedExp: 0,
          leveledUp: false,
          oldLevel: 1,
          newLevel: 1,
          levelRewardVnd: 0,
          newlyUnlockedTitles: [],
        };
      }

      let multiplier = 1.0;
      if (user.exp_boost_until > now) {
        multiplier *= 2.0;
      }
      if (this.petSystem) {
        const petBonus = this.petSystem.getActivePetBonuses(userId);
        multiplier += petBonus.expBonusPct / 100;
      }

      const addedExp = Math.max(1, Math.round(baseExp * multiplier));
      let curExp = user.exp + addedExp;
      let curLevel = user.level;
      const oldLevel = curLevel;
      let levelRewardVnd = 0;

      while (curExp >= expRequiredForLevel(curLevel)) {
        curExp -= expRequiredForLevel(curLevel);
        curLevel += 1;
        levelRewardVnd += curLevel * 5_000;
      }

      const newWallet = user.wallet + levelRewardVnd;
      this.db.run(
        `UPDATE users
         SET exp = ?, level = ?, wallet = ?, total_earned = total_earned + ?, updated_at = ?
         WHERE user_id = ?`,
        [curExp, curLevel, newWallet, levelRewardVnd, now, String(userId)]
      );

      if (levelRewardVnd > 0) {
        this.db.run(
          `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
           VALUES (?, 'level_reward', ?, ?, ?, ?)`,
          [
            String(userId),
            levelRewardVnd,
            newWallet,
            `Thưởng thăng cấp ${oldLevel} -> ${curLevel}`,
            now,
          ]
        );
      }

      const levelsGained = curLevel - oldLevel;
      if (levelsGained > 0) {
        this.questSystem?.incrementMetric(userId, 'levels_gained', levelsGained, now);
        this.eventSystem?.recordProgress(userId, 'level_race', levelsGained, now);
      }

      const newlyUnlockedTitles = this.evaluateMilestoneTitles(userId);

      return {
        addedExp,
        leveledUp: levelsGained > 0,
        oldLevel,
        newLevel: curLevel,
        levelRewardVnd,
        newlyUnlockedTitles,
      };
    });
  }

  /**
   * Kiểm tra và tự động mở khóa các danh hiệu thành tựu cho người chơi.
   * @param {string} userId
   * @returns {string[]} Danh sách mã danh hiệu vừa mở khóa mới
   */
  evaluateMilestoneTitles(userId) {
    const user = this.db.get('SELECT * FROM users WHERE user_id = ?', [String(userId)]);
    if (!user) return [];

    let unlocked = [];
    try {
      unlocked = JSON.parse(user.unlocked_titles || '["tan_thu"]');
    } catch {
      unlocked = ['tan_thu'];
    }
    const set = new Set(unlocked);
    const newlyAdded = [];

    const tryAdd = (id) => {
      if (TITLES[id] && !set.has(id)) {
        set.add(id);
        newlyAdded.push(id);
      }
    };

    tryAdd('tan_thu');
    const netWorth = (user.wallet || 0) + (user.bank || 0) + (user.savings || 0);
    if (netWorth >= 1_000_000) tryAdd('dai_gia');
    if (netWorth >= 10_000_000) tryAdd('trieu_phu');
    if (netWorth >= 100_000_000) tryAdd('ty_phu');
    if ((user.games_won || 0) >= 25) tryAdd('than_may_man');

    const baucuaWins =
      this.db.get(
        "SELECT count(*) AS c FROM game_logs WHERE user_id = ? AND game = 'baucua' AND won = 1",
        [String(userId)]
      )?.c ?? 0;
    if (baucuaWins >= 15) tryAdd('vua_bau_cua');

    const taixiuWins =
      this.db.get(
        "SELECT count(*) AS c FROM game_logs WHERE user_id = ? AND game = 'taixiu' AND won = 1",
        [String(userId)]
      )?.c ?? 0;
    if (taixiuWins >= 15) tryAdd('cao_thu_tai_xiu');

    const petSpeciesCount =
      this.db.get(
        'SELECT count(DISTINCT species_id) AS c FROM pets WHERE user_id = ?',
        [String(userId)]
      )?.c ?? 0;
    if (petSpeciesCount >= 4) tryAdd('nha_suu_tap');

    if (newlyAdded.length > 0) {
      this.db.run(
        'UPDATE users SET unlocked_titles = ?, updated_at = ? WHERE user_id = ?',
        [JSON.stringify([...set]), Date.now(), String(userId)]
      );
    }

    return newlyAdded;
  }

  unlockSpecificTitle(userId, titleId) {
    if (!TITLES[titleId]) return false;
    const user = this.db.get('SELECT unlocked_titles FROM users WHERE user_id = ?', [
      String(userId),
    ]);
    if (!user) return false;

    const list = new Set(JSON.parse(user.unlocked_titles || '["tan_thu"]'));
    const added = !list.has(titleId);
    list.add(titleId);
    this.db.run('UPDATE users SET unlocked_titles = ? WHERE user_id = ?', [
      JSON.stringify([...list]),
      String(userId),
    ]);
    return added;
  }

  equipTitle(userId, titleId) {
    if (!TITLES[titleId]) {
      throw new Error('Danh hiệu không tồn tại.');
    }
    const user = this.db.get('SELECT unlocked_titles FROM users WHERE user_id = ?', [
      String(userId),
    ]);
    const unlocked = new Set(JSON.parse(user?.unlocked_titles || '["tan_thu"]'));
    if (!unlocked.has(titleId)) {
      throw new Error('Bạn chưa mở khóa danh hiệu này.');
    }
    this.db.run('UPDATE users SET active_title = ?, updated_at = ? WHERE user_id = ?', [
      titleId,
      Date.now(),
      String(userId),
    ]);
    return TITLES[titleId];
  }

  getLevelLeaderboard(limit = 10) {
    const safeLimit = Math.max(1, Math.min(25, limit));
    return this.db.all(
      `SELECT user_id, username, level, exp, active_title
       FROM users
       WHERE is_banned = 0
       ORDER BY level DESC, exp DESC
       LIMIT ?`,
      [safeLimit]
    );
  }
}
