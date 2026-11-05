import crypto from 'node:crypto';
import {
  BAUCUA_MASCOT_MAP,
  BAUCUA_MASCOTS,
  BOT_ROLES,
  GAME_IDS,
  MP_ACTIVE_STATUSES,
  MP_ROUND_STATUS,
  MULTIPLAYER_GAME_IDS,
  RACE_ANIMAL_MAP,
  RACE_ANIMALS,
} from '../config/constants.js';
import { getUserBotRole, hasBotRole, isOwner } from '../utils/permissions.js';
import { withUserLock } from '../utils/locks.js';
import { formatVnd } from '../utils/format.js';
import { logger } from '../utils/logger.js';

const GAME_PREFIX = Object.freeze({
  [GAME_IDS.BAUCUA]: 'BC',
  [GAME_IDS.TAIXIU]: 'TX',
  [GAME_IDS.RACE]: 'DT',
});

const VALID_CHOICES = Object.freeze({
  [GAME_IDS.BAUCUA]: new Set(BAUCUA_MASCOTS.map((m) => m.id)),
  [GAME_IDS.TAIXIU]: new Set(['tai', 'xiu']),
  [GAME_IDS.RACE]: new Set(RACE_ANIMALS.map((a) => a.id)),
});

/**
 * Hệ thống Phiên Đặt Cược Nhiều Người Chơi (Multiplayer Round System — PUBLIC START).
 *
 * Bảo đảm kỹ thuật cốt lõi:
 * 1. PUBLIC START: MỌI THÀNH VIÊN trong server đều mở được phiên mới (không yêu cầu quyền ADMIN/MOD).
 * 2. Người mở phiên chỉ được ghi nhận danh tính hiển thị, TUYỆT ĐỐI không có quyền quản trị phiên.
 * 3. Chống tạo trùng phiên nguyên tử (Per-guild-game Mutex + SQLite Transaction).
 * 4. Đồng hồ dựa trên Timestamp CSDL (`ends_at`), không phụ thuộc mù quáng vào bộ đếm RAM.
 * 5. Khóa sổ nguyên tử tại 0s (`LOCKED`), lưu kết quả `crypto.randomInt` vào CSDL TRƯỚC KHI hiển thị (`DRAWING`),
 *    thanh toán ACID một lần duy nhất (`settled` + `settled_tx_done`), và tự khôi phục an toàn khi Bot khởi động lại.
 */
export class MultiplayerRoundSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   * @param {import('./levelSystem.js').LevelSystem} [deps.levelSystem]
   * @param {import('./questSystem.js').QuestSystem} [deps.questSystem]
   * @param {import('./eventSystem.js').EventSystem} [deps.eventSystem]
   * @param {import('./logSystem.js').LogSystem} [deps.logSystem]
   * @param {() => number} [deps.nowFn]
   * @param {number} [deps.animationDelayMs]
   * @param {(snapshot: object, meta?: object) => Promise<void>} [deps.boardRenderer]
   */
  constructor({
    db,
    economySystem,
    levelSystem = null,
    questSystem = null,
    eventSystem = null,
    logSystem = null,
    nowFn = () => Date.now(),
    animationDelayMs = 1500,
    boardRenderer = null,
  }) {
    this.db = db;
    this.economySystem = economySystem;
    this.levelSystem = levelSystem;
    this.questSystem = questSystem;
    this.eventSystem = eventSystem;
    this.logSystem = logSystem;
    this._now = nowFn;
    this.animationDelayMs = animationDelayMs;
    this.boardRenderer = boardRenderer;

    /** @type {import('discord.js').Client | null} */
    this.client = null;

    /** @type {Map<string, Set<ReturnType<typeof setTimeout>>>} roundId -> active timers */
    this._roundTimers = new Map();

    /** @type {Map<string, Promise<any>>} `${guildId}:${gameId}` -> creation mutex */
    this._createLocks = new Map();

    /** @type {Set<string>} roundIds currently inside finalize/cancel pipeline */
    this._finalizingRounds = new Set();

    /** @type {Map<string, ReturnType<typeof setTimeout>>} roundId -> coalesced render timer */
    this._renderDebounce = new Map();

    /** @type {Map<string, object>} `${channelId}:${messageId}` -> cached Message reference */
    this._messageRefs = new Map();

    /** @type {Map<string, number | 'modal' | 'all'>} userId -> quick-chip preference */
    this._userChipPrefs = new Map();

    this._seqCounter = 0;
  }

  attachClient(client) {
    this.client = client;
  }

  setBoardRenderer(fn) {
    this.boardRenderer = fn;
  }

  setUserChipPreference(userId, pref) {
    this._userChipPrefs.set(String(userId), pref);
  }

  getUserChipPreference(userId) {
    return this._userChipPrefs.get(String(userId)) ?? 'modal';
  }

  registerMessageRef(roundId, message) {
    if (!roundId || !message) return;
    this._messageRefs.set(String(roundId), message);
    if (message.id) {
      this.db.run(
        'UPDATE multiplayer_rounds SET message_id = ?, updated_at = ? WHERE round_id = ?',
        [String(message.id), this._now(), String(roundId)]
      );
    }
  }

  getMessageRef(roundId) {
    return this._messageRefs.get(String(roundId)) || null;
  }

  // ==========================================================================
  // Tiện ích Cấu hình & Kiểm tra Quyền hạn Server-side
  // ==========================================================================

  isSupportedGame(gameId) {
    return MULTIPLAYER_GAME_IDS.includes(gameId);
  }

  getValidChoices(gameId) {
    return VALID_CHOICES[gameId] || new Set();
  }

  getRoundDurationSec(gameId) {
    const map = this.db.getSetting('mpRoundDurations') || {};
    const fallback = gameId === GAME_IDS.RACE ? 90 : 60;
    const raw = Number(map[gameId]);
    if (!Number.isFinite(raw) || raw < 5) return fallback;
    return Math.min(600, Math.floor(raw));
  }

  getBetLimits() {
    const minBet = Math.max(10, Number(this.db.getSetting('minBet')) || 100);
    const maxBet = Math.max(minBet, Number(this.db.getSetting('maxBet')) || 50_000_000);
    return { minBet, maxBet };
  }

  canUserModifyOwnBet(userId) {
    if (hasBotRole(this.db, userId, BOT_ROLES.ADMIN)) return true;
    return this.db.getSetting('mpAllowEditCancelBet') !== false;
  }

  isMultiTableEnabled() {
    return this.db.getSetting('mpMultiTableEnabled') === true;
  }

  getMaxTablesPerGame() {
    return Math.max(1, Math.min(10, Number(this.db.getSetting('mpMaxTablesPerGame')) || 3));
  }

  getSettingsSummary() {
    const { minBet, maxBet } = this.getBetLimits();
    return {
      durations: {
        baucua: this.getRoundDurationSec(GAME_IDS.BAUCUA),
        taixiu: this.getRoundDurationSec(GAME_IDS.TAIXIU),
        race: this.getRoundDurationSec(GAME_IDS.RACE),
      },
      minBet,
      maxBet,
      allowEditCancelBet: this.db.getSetting('mpAllowEditCancelBet') !== false,
      multiTableEnabled: this.isMultiTableEnabled(),
      maxTablesPerGame: this.getMaxTablesPerGame(),
      taixiuTripleRule: this.db.getSetting('mpTaixiuTripleRule') || 'house_wins',
    };
  }

  // ==========================================================================
  // Sinh ID Duy Nhất cho Phiên (Round ID) & Vé Cược (Bet ID)
  // ==========================================================================

  _generateUniqueRoundId(gameId, now) {
    const prefix = GAME_PREFIX[gameId] || 'MP';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      this._seqCounter = (this._seqCounter + 1) % 10000;
      const rand = crypto.randomInt(100, 999);
      const timeTag = String(Math.floor(now / 1000) % 100000).padStart(5, '0');
      const candidate = `${prefix}-${timeTag}-${rand}`;
      const exists = this.db.get(
        'SELECT round_id FROM multiplayer_rounds WHERE round_id = ?',
        [candidate]
      );
      if (!exists) return candidate;
    }
    return `${prefix}-${now}-${crypto.randomInt(1000, 9999)}`;
  }

  _generateUniqueBetId(now) {
    this._seqCounter = (this._seqCounter + 1) % 100000;
    const rand = crypto.randomInt(1000, 9999);
    return `BET-${now}-${String(this._seqCounter).padStart(4, '0')}-${rand}`;
  }

  async _withRoundCreateLock(guildId, gameId, fn) {
    const key = `${guildId}:${gameId}`;
    const prev = this._createLocks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const chain = prev.then(() => next, () => next);
    this._createLocks.set(key, chain);

    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this._createLocks.get(key) === chain) {
        this._createLocks.delete(key);
      }
    }
  }

  // ==========================================================================
  // 1. PUBLIC START — Mọi thành viên trong server đều mở được phiên mới
  // ==========================================================================

  /**
   * Bắt đầu hoặc lấy phiên đang hoạt động của một trò chơi trong server.
   * QUAN TRỌNG: KHÔNG yêu cầu quyền OWNER / ADMIN / MODERATOR. Mọi thành viên hợp lệ đều gọi được!
   *
   * @param {object} params
   * @param {string} params.guildId
   * @param {string} params.channelId
   * @param {string} params.gameId - 'baucua' | 'taixiu' | 'race'
   * @param {string} params.userId
   * @param {string} [params.username]
   */
  async startRound({ guildId, channelId, gameId, userId, username = '' }) {
    if (!guildId || !channelId) {
      return {
        ok: false,
        code: 'GUILD_ONLY',
        error: '❌ Phiên cược chung nhiều người chơi chỉ hoạt động bên trong kênh máy chủ Discord.',
      };
    }

    if (!this.isSupportedGame(gameId)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_GAME',
        error: '❌ Trò chơi này không thuộc chế độ phiên cược chung nhiều người chơi (`baucua`, `taixiu`, `race`).',
      };
    }

    const gamesEnabled = this.db.getSetting('gamesEnabled') || {};
    if (gamesEnabled[gameId] === false) {
      return {
        ok: false,
        code: 'GAME_DISABLED',
        error: '⛔ Trò chơi này hiện đang tạm đóng bởi Quản trị viên.',
      };
    }

    const starterProfile = this.economySystem.ensureUser(userId, username);
    if (starterProfile.is_banned) {
      return {
        ok: false,
        code: 'USER_BANNED',
        error: '🚫 Tài khoản của bạn đang bị khóa nên không thể thao tác.',
      };
    }

    return this._withRoundCreateLock(String(guildId), String(gameId), async () => {
      const now = this._now();
      const durationSec = this.getRoundDurationSec(gameId);
      const multiTable = this.isMultiTableEnabled();
      const maxTables = multiTable ? this.getMaxTablesPerGame() : 1;

      const txOutcome = this.db.transaction(() => {
        const placeholders = MP_ACTIVE_STATUSES.map(() => '?').join(', ');
        const activeRows = this.db.all(
          `SELECT * FROM multiplayer_rounds
           WHERE guild_id = ? AND game_id = ? AND status IN (${placeholders})
           ORDER BY table_index ASC, created_at ASC`,
          [String(guildId), String(gameId), ...MP_ACTIVE_STATUSES]
        );

        if (activeRows.length >= maxTables) {
          return {
            created: false,
            roundId: activeRows[0].round_id,
          };
        }

        const usedTables = new Set(activeRows.map((r) => Number(r.table_index) || 1));
        let tableIndex = 1;
        while (usedTables.has(tableIndex)) {
          tableIndex += 1;
        }

        const roundId = this._generateUniqueRoundId(gameId, now);
        const endsAt = now + durationSec * 1000;

        // Khởi tạo ở trạng thái WAITING rồi chuyển nguyên tử sang BETTING khi mở nhận cược
        this.db.run(
          `INSERT INTO multiplayer_rounds (
             round_id, guild_id, channel_id, message_id, table_index, game_id, status,
             started_by, started_by_name, duration_sec, starts_at, ends_at,
             settled, refunded, total_players, total_bet_vnd, total_payout_vnd,
             total_won_vnd, total_lost_vnd, notified_30s, notified_10s, notified_5s,
             created_at, updated_at
           ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
          [
            roundId,
            String(guildId),
            String(channelId),
            tableIndex,
            String(gameId),
            MP_ROUND_STATUS.WAITING,
            String(userId),
            String(username || userId),
            durationSec,
            now,
            endsAt,
            now,
            now,
          ]
        );

        this.db.run(
          `UPDATE multiplayer_rounds
           SET status = ?, updated_at = ?
           WHERE round_id = ? AND status = ?`,
          [MP_ROUND_STATUS.BETTING, now, roundId, MP_ROUND_STATUS.WAITING]
        );

        return {
          created: true,
          roundId,
        };
      });

      if (!txOutcome.created) {
        const existingSnapshot = this.getRoundSnapshot(txOutcome.roundId);
        // Nếu phiên cũ thực tế đã quá hạn `ends_at` mà timer chưa kịp nổ, tự động chốt luôn!
        if (
          existingSnapshot &&
          existingSnapshot.round.status === MP_ROUND_STATUS.BETTING &&
          this._now() >= existingSnapshot.round.ends_at
        ) {
          await this.finalizeRound(existingSnapshot.round.round_id, { skipAnimation: true });
          // Sau khi chốt xong phiên hết hạn, mở phiên mới ngay cho thành viên vừa bấm!
          return this.startRound({ guildId, channelId, gameId, userId, username });
        }

        return {
          ok: true,
          created: false,
          snapshot: existingSnapshot,
          round: existingSnapshot?.round || null,
        };
      }

      this._scheduleRoundTimers(txOutcome.roundId);
      const snapshot = this.getRoundSnapshot(txOutcome.roundId);

      this.logSystem?.send?.(
        'game',
        '🚀 Mở Phiên Cược Chung Mới (Public Start)',
        `Người mở phiên: <@${userId}> (\`${username || userId}\`)\nTrò chơi: **${gameId.toUpperCase()}** • Mã phiên: \`#${txOutcome.roundId}\` • Thời gian: **${durationSec}s**`
      );

      return {
        ok: true,
        created: true,
        snapshot,
        round: snapshot?.round || null,
      };
    });
  }

  // ==========================================================================
  // 2. Truy vấn Snapshot Phiên, Lịch sử & Vé cược Cá nhân
  // ==========================================================================

  _parseResult(resultJson) {
    if (!resultJson) return null;
    try {
      return JSON.parse(resultJson);
    } catch {
      return null;
    }
  }

  getActiveRounds(guildId, gameId = null) {
    const placeholders = MP_ACTIVE_STATUSES.map(() => '?').join(', ');
    if (gameId) {
      return this.db
        .all(
          `SELECT * FROM multiplayer_rounds
           WHERE guild_id = ? AND game_id = ? AND status IN (${placeholders})
           ORDER BY table_index ASC, created_at ASC`,
          [String(guildId), String(gameId), ...MP_ACTIVE_STATUSES]
        )
        .map((r) => ({ ...r, result: this._parseResult(r.result_json) }));
    }

    return this.db
      .all(
        `SELECT * FROM multiplayer_rounds
         WHERE guild_id = ? AND status IN (${placeholders})
         ORDER BY created_at ASC`,
        [String(guildId), ...MP_ACTIVE_STATUSES]
      )
      .map((r) => ({ ...r, result: this._parseResult(r.result_json) }));
  }

  getRoundSnapshot(roundId) {
    if (!roundId) return null;
    const round = this.db.get(
      'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
      [String(roundId)]
    );
    if (!round) return null;

    const bets = this.db.all(
      `SELECT * FROM multiplayer_bets
       WHERE round_id = ? AND status IN ('ACTIVE', 'SETTLED', 'REFUNDED')
       ORDER BY created_at ASC`,
      [String(roundId)]
    );

    const doorStats = {};
    for (const choice of this.getValidChoices(round.game_id)) {
      doorStats[choice] = {
        choice,
        count: 0,
        total: 0,
        users: new Set(),
      };
    }

    const playerMap = new Map();
    for (const bet of bets) {
      if (!doorStats[bet.choice]) {
        doorStats[bet.choice] = { choice: bet.choice, count: 0, total: 0, users: new Set() };
      }
      doorStats[bet.choice].total += Number(bet.amount) || 0;
      doorStats[bet.choice].users.add(bet.user_id);

      const prev = playerMap.get(bet.user_id) || {
        userId: bet.user_id,
        username: bet.username || bet.user_id,
        totalBet: 0,
        totalPayout: 0,
        totalNet: 0,
        bets: [],
      };
      prev.totalBet += Number(bet.amount) || 0;
      prev.totalPayout += Number(bet.payout) || 0;
      prev.totalNet += Number(bet.net) || 0;
      prev.bets.push(bet);
      playerMap.set(bet.user_id, prev);
    }

    const normalizedDoorStats = {};
    for (const [k, v] of Object.entries(doorStats)) {
      normalizedDoorStats[k] = {
        choice: k,
        count: v.users.size,
        total: v.total,
      };
    }

    const players = Array.from(playerMap.values());
    const winners = players
      .filter((p) => p.totalNet > 0 || (round.status === MP_ROUND_STATUS.COMPLETED && p.totalPayout > p.totalBet))
      .sort((a, b) => b.totalNet - a.totalNet);
    const breakEven = players.filter(
      (p) => round.status === MP_ROUND_STATUS.COMPLETED && p.totalNet === 0 && p.totalBet > 0
    );
    const losers = players
      .filter((p) => round.status === MP_ROUND_STATUS.COMPLETED && p.totalNet < 0)
      .sort((a, b) => a.totalNet - b.totalNet);

    const now = this._now();
    const remainingMs = Math.max(0, Number(round.ends_at) - now);

    return {
      round: {
        ...round,
        result: this._parseResult(round.result_json),
      },
      bets,
      doorStats: normalizedDoorStats,
      players,
      winners,
      breakEven,
      losers,
      remainingMs,
      remainingSec: Math.ceil(remainingMs / 1000),
    };
  }

  getUserRoundBets(roundId, userId) {
    return this.db.all(
      `SELECT * FROM multiplayer_bets
       WHERE round_id = ? AND user_id = ? AND status IN ('ACTIVE', 'SETTLED', 'REFUNDED')
       ORDER BY created_at ASC`,
      [String(roundId), String(userId)]
    );
  }

  getRecentRounds(guildId, gameId = null, limit = 10) {
    const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
    if (gameId) {
      return this.db
        .all(
          `SELECT * FROM multiplayer_rounds
           WHERE guild_id = ? AND game_id = ? AND status IN ('COMPLETED', 'CANCELLED')
           ORDER BY created_at DESC LIMIT ?`,
          [String(guildId), String(gameId), safeLimit]
        )
        .map((r) => ({ ...r, result: this._parseResult(r.result_json) }));
    }

    return this.db
      .all(
        `SELECT * FROM multiplayer_rounds
         WHERE guild_id = ? AND status IN ('COMPLETED', 'CANCELLED')
         ORDER BY created_at DESC LIMIT ?`,
        [String(guildId), safeLimit]
      )
      .map((r) => ({ ...r, result: this._parseResult(r.result_json) }));
  }

  getMultiplayerLeaderboard(guildId, gameId = null, limit = 10) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
    if (gameId) {
      return this.db.all(
        `SELECT user_id, MAX(username) AS username,
                COUNT(DISTINCT round_id) AS rounds_played,
                SUM(amount) AS total_wagered,
                SUM(payout) AS total_payout,
                SUM(net) AS net_profit
         FROM multiplayer_bets
         WHERE guild_id = ? AND game_id = ? AND status = 'SETTLED'
         GROUP BY user_id
         ORDER BY net_profit DESC, total_payout DESC
         LIMIT ?`,
        [String(guildId), String(gameId), safeLimit]
      );
    }

    return this.db.all(
      `SELECT user_id, MAX(username) AS username,
              COUNT(DISTINCT round_id) AS rounds_played,
              SUM(amount) AS total_wagered,
              SUM(payout) AS total_payout,
              SUM(net) AS net_profit
       FROM multiplayer_bets
       WHERE guild_id = ? AND status = 'SETTLED'
       GROUP BY user_id
       ORDER BY net_profit DESC, total_payout DESC
       LIMIT ?`,
      [String(guildId), safeLimit]
    );
  }

  // ==========================================================================
  // 3. Đặt Cược, Sửa Cược & Hủy Cược Cá Nhân (ACID + Khóa theo User)
  // ==========================================================================

  _recomputeRoundTotalsInTx(roundId, now) {
    const agg = this.db.get(
      `SELECT COUNT(DISTINCT user_id) AS players, COALESCE(SUM(amount), 0) AS total_bet
       FROM multiplayer_bets
       WHERE round_id = ? AND status = 'ACTIVE'`,
      [String(roundId)]
    );
    const totalPlayers = Number(agg?.players) || 0;
    const totalBetVnd = Number(agg?.total_bet) || 0;
    this.db.run(
      `UPDATE multiplayer_rounds
       SET total_players = ?, total_bet_vnd = ?, updated_at = ?
       WHERE round_id = ?`,
      [totalPlayers, totalBetVnd, now, String(roundId)]
    );
    return { totalPlayers, totalBetVnd };
  }

  /**
   * Đặt cược vào một cửa của phiên đang mở (`BETTING` và `now < ends_at`).
   */
  async placeBet({ roundId, userId, username = '', choice, amount }) {
    const cleanChoice = String(choice || '').trim().toLowerCase();
    const betAmount = Math.floor(Number(amount));

    if (!Number.isSafeInteger(betAmount) || betAmount <= 0) {
      return {
        ok: false,
        code: 'INVALID_AMOUNT',
        error: '❌ Số tiền đặt cược phải là số nguyên dương VNĐ hợp lệ.',
      };
    }

    return withUserLock(`mp_user:${userId}`, async () => {
      const userProfile = this.economySystem.ensureUser(userId, username);
      if (userProfile.is_banned) {
        return {
          ok: false,
          code: 'USER_BANNED',
          error: '🚫 Tài khoản của bạn đang bị khóa.',
        };
      }

      const { minBet, maxBet } = this.getBetLimits();
      if (betAmount < minBet) {
        return {
          ok: false,
          code: 'BELOW_MIN_BET',
          error: `❌ Mức cược tối thiểu là **${formatVnd(minBet)}**.`,
        };
      }
      if (betAmount > maxBet) {
        return {
          ok: false,
          code: 'ABOVE_MAX_BET',
          error: `❌ Mức cược tối đa cho phép là **${formatVnd(maxBet)}**.`,
        };
      }

      const txRes = this.db.transaction(() => {
        const now = this._now();
        const round = this.db.get(
          'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
          [String(roundId)]
        );

        if (!round) {
          return { ok: false, code: 'ROUND_NOT_FOUND', error: '❌ Không tìm thấy phiên cược này.' };
        }

        // BẮT BUỘC KIỂM TRA CẢ STATUS VÀ TIMESTAMP `ends_at` TRONG DATABASE
        if (round.status !== MP_ROUND_STATUS.BETTING || now >= Number(round.ends_at)) {
          return {
            ok: false,
            code: 'ROUND_LOCKED',
            error: '⛔ Đã hết thời gian nhận cược! Phiên đã khóa sổ, bạn không thể đặt thêm.',
          };
        }

        const validDoors = this.getValidChoices(round.game_id);
        if (!validDoors.has(cleanChoice)) {
          return {
            ok: false,
            code: 'INVALID_CHOICE',
            error: `❌ Cửa cược \`${cleanChoice}\` không hợp lệ cho trò **${round.game_id}**.`,
          };
        }

        const activeUserBets = this.db.all(
          `SELECT * FROM multiplayer_bets
           WHERE round_id = ? AND user_id = ? AND status = 'ACTIVE'`,
          [String(roundId), String(userId)]
        );

        // Với Tài Xỉu 2 cửa đối lập: chặn đặt cả TÀI lẫn XỈU cùng lúc (tránh cày tổng cược ảo), hướng dẫn Sửa cược
        if (round.game_id === GAME_IDS.TAIXIU) {
          const opposite = activeUserBets.find((b) => b.choice !== cleanChoice);
          if (opposite) {
            return {
              ok: false,
              code: 'OPPOSITE_SIDE_EXISTS',
              error: `⚠️ Bạn đã đặt cửa **${opposite.choice.toUpperCase()}** trong phiên này. Hãy dùng nút **✏️ Sửa / Hủy Cược** nếu muốn đổi cửa!`,
            };
          }
        }

        const currentRoundUserTotal = activeUserBets.reduce(
          (sum, b) => sum + (Number(b.amount) || 0),
          0
        );
        if (currentRoundUserTotal + betAmount > maxBet) {
          return {
            ok: false,
            code: 'ROUND_MAX_EXCEEDED',
            error: `❌ Tổng tiền cược của bạn trong phiên này không được vượt quá **${formatVnd(maxBet)}** (Đã đặt: **${formatVnd(currentRoundUserTotal)}**).`,
          };
        }

        const freshUser = this.db.get(
          'SELECT wallet FROM users WHERE user_id = ?',
          [String(userId)]
        );
        const walletBefore = Number(freshUser?.wallet) || 0;
        if (walletBefore < betAmount) {
          return {
            ok: false,
            code: 'INSUFFICIENT_FUNDS',
            error: `❌ Số dư ví không đủ! Cần **${formatVnd(betAmount)}**, hiện có **${formatVnd(walletBefore)}**.`,
          };
        }

        const deductInfo = this.db.run(
          'UPDATE users SET wallet = wallet - ?, username = CASE WHEN ? != "" THEN ? ELSE username END, updated_at = ? WHERE user_id = ? AND wallet >= ?',
          [betAmount, String(username), String(username), now, String(userId), betAmount]
        );
        if (!deductInfo.changes) {
          return {
            ok: false,
            code: 'INSUFFICIENT_FUNDS',
            error: '❌ Số dư ví không đủ để thực hiện giao dịch đặt cược.',
          };
        }

        const walletAfter = walletBefore - betAmount;
        const existingSameDoor = activeUserBets.find((b) => b.choice === cleanChoice);
        let finalBetId;
        let finalDoorAmount;

        if (existingSameDoor) {
          finalBetId = existingSameDoor.bet_id;
          finalDoorAmount = Number(existingSameDoor.amount) + betAmount;
          this.db.run(
            `UPDATE multiplayer_bets
             SET amount = ?, username = CASE WHEN ? != '' THEN ? ELSE username END, updated_at = ?
             WHERE bet_id = ? AND status = 'ACTIVE'`,
            [finalDoorAmount, String(username), String(username), now, finalBetId]
          );
        } else {
          finalBetId = this._generateUniqueBetId(now);
          finalDoorAmount = betAmount;
          this.db.run(
            `INSERT INTO multiplayer_bets (
               bet_id, round_id, guild_id, game_id, user_id, username, choice,
               amount, status, payout, net, hits, settled_tx_done, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 0, 0, 0, ?, ?)`,
            [
              finalBetId,
              String(roundId),
              String(round.guild_id),
              String(round.game_id),
              String(userId),
              String(username || userId),
              cleanChoice,
              betAmount,
              now,
              now,
            ]
          );
        }

        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, NULL, 'mp_bet_place', ?, ?, ?, ?)`,
          [
            String(userId),
            -betAmount,
            walletAfter,
            `Đặt cược ${formatVnd(betAmount)} cửa ${cleanChoice.toUpperCase()} phiên #${roundId}`,
            now,
          ]
        );

        const totals = this._recomputeRoundTotalsInTx(roundId, now);
        return {
          ok: true,
          betId: finalBetId,
          roundId: String(roundId),
          gameId: round.game_id,
          choice: cleanChoice,
          addedAmount: betAmount,
          doorTotalAmount: finalDoorAmount,
          walletAfter,
          totals,
        };
      });

      if (!txRes.ok) {
        // Nếu phát hiện phiên đã quá giờ `ends_at`, kích hoạt khóa sổ ngầm ngay
        if (txRes.code === 'ROUND_LOCKED') {
          this._triggerFinalizeIfExpired(roundId);
        }
        return txRes;
      }

      this._scheduleBoardRender(roundId);
      const userBets = this.getUserRoundBets(roundId, userId);
      return {
        ...txRes,
        userBets,
        snapshot: this.getRoundSnapshot(roundId),
      };
    });
  }

  /**
   * Sửa số tiền (và/hoặc đổi cửa) của vé cược cá nhân khi phiên còn `BETTING`.
   * TUYỆT ĐỐI chỉ chủ sở hữu vé cược mới sửa được vé của chính mình.
   */
  async editBet({ roundId, betId, userId, newAmount, newChoice = null }) {
    const targetAmount = Math.floor(Number(newAmount));
    if (!Number.isSafeInteger(targetAmount) || targetAmount <= 0) {
      return {
        ok: false,
        code: 'INVALID_AMOUNT',
        error: '❌ Số tiền cược mới phải là số nguyên dương VNĐ.',
      };
    }

    if (!this.canUserModifyOwnBet(userId)) {
      return {
        ok: false,
        code: 'MODIFY_DISABLED',
        error: '⛔ Cấu hình máy chủ hiện không cho phép sửa/hủy cược sau khi đã đặt.',
      };
    }

    return withUserLock(`mp_user:${userId}`, async () => {
      const { minBet, maxBet } = this.getBetLimits();
      if (targetAmount < minBet || targetAmount > maxBet) {
        return {
          ok: false,
          code: 'OUT_OF_LIMITS',
          error: `❌ Số tiền cược mới phải nằm trong khoảng **${formatVnd(minBet)}** – **${formatVnd(maxBet)}**.`,
        };
      }

      const txRes = this.db.transaction(() => {
        const now = this._now();
        const round = this.db.get(
          'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
          [String(roundId)]
        );
        if (!round) {
          return { ok: false, code: 'ROUND_NOT_FOUND', error: '❌ Không tìm thấy phiên cược.' };
        }
        if (round.status !== MP_ROUND_STATUS.BETTING || now >= Number(round.ends_at)) {
          return {
            ok: false,
            code: 'ROUND_LOCKED',
            error: '⛔ Phiên cược đã khóa sổ! Bạn không thể chỉnh sửa vé cược nữa.',
          };
        }

        const bet = this.db.get(
          'SELECT * FROM multiplayer_bets WHERE bet_id = ? AND round_id = ?',
          [String(betId), String(roundId)]
        );
        if (!bet || bet.status !== 'ACTIVE') {
          return {
            ok: false,
            code: 'BET_NOT_FOUND',
            error: '❌ Không tìm thấy vé cược đang hoạt động để chỉnh sửa.',
          };
        }

        // BẢO MẬT QUYỀN SỞ HỮU: Không ai được sửa cược của người khác!
        if (String(bet.user_id) !== String(userId)) {
          return {
            ok: false,
            code: 'FORBIDDEN_NOT_OWNER',
            error: '🚫 Bạn chỉ có quyền chỉnh sửa vé cược của chính mình!',
          };
        }

        const finalChoice = newChoice ? String(newChoice).trim().toLowerCase() : bet.choice;
        if (!this.getValidChoices(round.game_id).has(finalChoice)) {
          return {
            ok: false,
            code: 'INVALID_CHOICE',
            error: `❌ Cửa cược \`${finalChoice}\` không hợp lệ.`,
          };
        }

        const otherBets = this.db.all(
          `SELECT * FROM multiplayer_bets
           WHERE round_id = ? AND user_id = ? AND status = 'ACTIVE' AND bet_id != ?`,
          [String(roundId), String(userId), String(betId)]
        );

        if (otherBets.some((b) => b.choice === finalChoice)) {
          return {
            ok: false,
            code: 'DUPLICATE_DOOR',
            error: `⚠️ Bạn đã có vé cược riêng ở cửa **${finalChoice.toUpperCase()}**. Hãy chỉnh sửa trực tiếp vé đó.`,
          };
        }

        const otherTotal = otherBets.reduce((s, b) => s + (Number(b.amount) || 0), 0);
        if (otherTotal + targetAmount > maxBet) {
          return {
            ok: false,
            code: 'ROUND_MAX_EXCEEDED',
            error: `❌ Tổng cược trong phiên vượt quá mức tối đa **${formatVnd(maxBet)}**.`,
          };
        }

        const diff = targetAmount - Number(bet.amount);
        const userRow = this.db.get('SELECT wallet FROM users WHERE user_id = ?', [String(userId)]);
        const walletBefore = Number(userRow?.wallet) || 0;

        if (diff > 0) {
          if (walletBefore < diff) {
            return {
              ok: false,
              code: 'INSUFFICIENT_FUNDS',
              error: `❌ Cần thêm **${formatVnd(diff)}** để nâng mức cược, nhưng ví chỉ còn **${formatVnd(walletBefore)}**.`,
            };
          }
          this.db.run(
            'UPDATE users SET wallet = wallet - ?, updated_at = ? WHERE user_id = ? AND wallet >= ?',
            [diff, now, String(userId), diff]
          );
        } else if (diff < 0) {
          this.db.run(
            'UPDATE users SET wallet = wallet + ?, updated_at = ? WHERE user_id = ?',
            [Math.abs(diff), now, String(userId)]
          );
        }

        const walletAfter = walletBefore - diff;
        this.db.run(
          `UPDATE multiplayer_bets
           SET choice = ?, amount = ?, updated_at = ?
           WHERE bet_id = ? AND status = 'ACTIVE'`,
          [finalChoice, targetAmount, now, String(betId)]
        );

        if (diff !== 0) {
          this.db.run(
            `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
             VALUES (?, NULL, 'mp_bet_edit', ?, ?, ?, ?)`,
            [
              String(userId),
              -diff,
              walletAfter,
              `Chỉnh sửa vé cược #${betId} phiên #${roundId} thành ${formatVnd(targetAmount)} (${finalChoice.toUpperCase()})`,
              now,
            ]
          );
        }

        const totals = this._recomputeRoundTotalsInTx(roundId, now);
        return {
          ok: true,
          betId: String(betId),
          choice: finalChoice,
          oldAmount: Number(bet.amount),
          newAmount: targetAmount,
          walletAfter,
          totals,
        };
      });

      if (!txRes.ok) {
        if (txRes.code === 'ROUND_LOCKED') this._triggerFinalizeIfExpired(roundId);
        return txRes;
      }

      this._scheduleBoardRender(roundId);
      return {
        ...txRes,
        userBets: this.getUserRoundBets(roundId, userId),
        snapshot: this.getRoundSnapshot(roundId),
      };
    });
  }

  /**
   * Hủy một vé cược cá nhân và hoàn 100% tiền về ví khi phiên còn `BETTING`.
   */
  async cancelBet({ roundId, betId, userId }) {
    if (!this.canUserModifyOwnBet(userId)) {
      return {
        ok: false,
        code: 'MODIFY_DISABLED',
        error: '⛔ Cấu hình máy chủ hiện không cho phép hủy cược sau khi đã đặt.',
      };
    }

    return withUserLock(`mp_user:${userId}`, async () => {
      const txRes = this.db.transaction(() => {
        const now = this._now();
        const round = this.db.get(
          'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
          [String(roundId)]
        );
        if (!round) {
          return { ok: false, code: 'ROUND_NOT_FOUND', error: '❌ Không tìm thấy phiên cược.' };
        }
        if (round.status !== MP_ROUND_STATUS.BETTING || now >= Number(round.ends_at)) {
          return {
            ok: false,
            code: 'ROUND_LOCKED',
            error: '⛔ Phiên cược đã khóa sổ! Không thể hủy cược sau khi hết giờ.',
          };
        }

        const bet = this.db.get(
          'SELECT * FROM multiplayer_bets WHERE bet_id = ? AND round_id = ?',
          [String(betId), String(roundId)]
        );
        if (!bet) {
          return { ok: false, code: 'BET_NOT_FOUND', error: '❌ Không tìm thấy vé cược.' };
        }
        if (String(bet.user_id) !== String(userId)) {
          return {
            ok: false,
            code: 'FORBIDDEN_NOT_OWNER',
            error: '🚫 Bạn không thể hủy vé cược của người chơi khác!',
          };
        }
        if (bet.status !== 'ACTIVE' || bet.settled_tx_done === 1) {
          return {
            ok: false,
            code: 'BET_ALREADY_PROCESSED',
            error: '⚠️ Vé cược này đã được hủy hoặc đã xử lý trước đó.',
          };
        }

        const refundAmount = Number(bet.amount) || 0;
        const markInfo = this.db.run(
          `UPDATE multiplayer_bets
           SET status = 'CANCELLED', settled_tx_done = 1, updated_at = ?
           WHERE bet_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0`,
          [now, String(betId)]
        );
        if (!markInfo.changes) {
          return {
            ok: false,
            code: 'BET_ALREADY_PROCESSED',
            error: '⚠️ Vé cược đã được xử lý.',
          };
        }

        this.db.run(
          'UPDATE users SET wallet = wallet + ?, updated_at = ? WHERE user_id = ?',
          [refundAmount, now, String(userId)]
        );
        const userAfter = this.db.get('SELECT wallet FROM users WHERE user_id = ?', [String(userId)]);
        const walletAfter = Number(userAfter?.wallet) || 0;

        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, NULL, 'mp_bet_cancel', ?, ?, ?, ?)`,
          [
            String(userId),
            refundAmount,
            walletAfter,
            `Hủy vé cược #${betId} (${bet.choice.toUpperCase()}) phiên #${roundId} — Hoàn 100%`,
            now,
          ]
        );

        const totals = this._recomputeRoundTotalsInTx(roundId, now);
        return {
          ok: true,
          betId: String(betId),
          choice: bet.choice,
          refundedAmount: refundAmount,
          walletAfter,
          totals,
        };
      });

      if (!txRes.ok) {
        if (txRes.code === 'ROUND_LOCKED') this._triggerFinalizeIfExpired(roundId);
        return txRes;
      }

      this._scheduleBoardRender(roundId);
      return {
        ...txRes,
        userBets: this.getUserRoundBets(roundId, userId),
        snapshot: this.getRoundSnapshot(roundId),
      };
    });
  }

  /**
   * Hủy toàn bộ vé cược của chính người gọi trong phiên đang `BETTING`.
   */
  async cancelAllUserBets({ roundId, userId }) {
    if (!this.canUserModifyOwnBet(userId)) {
      return {
        ok: false,
        code: 'MODIFY_DISABLED',
        error: '⛔ Cấu hình máy chủ hiện không cho phép hủy cược sau khi đã đặt.',
      };
    }

    return withUserLock(`mp_user:${userId}`, async () => {
      const txRes = this.db.transaction(() => {
        const now = this._now();
        const round = this.db.get(
          'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
          [String(roundId)]
        );
        if (!round) {
          return { ok: false, code: 'ROUND_NOT_FOUND', error: '❌ Không tìm thấy phiên cược.' };
        }
        if (round.status !== MP_ROUND_STATUS.BETTING || now >= Number(round.ends_at)) {
          return {
            ok: false,
            code: 'ROUND_LOCKED',
            error: '⛔ Phiên cược đã khóa sổ! Không thể hủy cược.',
          };
        }

        const activeBets = this.db.all(
          `SELECT * FROM multiplayer_bets
           WHERE round_id = ? AND user_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0`,
          [String(roundId), String(userId)]
        );
        if (!activeBets.length) {
          return {
            ok: false,
            code: 'NO_ACTIVE_BETS',
            error: '⚠️ Bạn hiện không có vé cược nào đang hoạt động trong phiên này.',
          };
        }

        let totalRefund = 0;
        for (const bet of activeBets) {
          const info = this.db.run(
            `UPDATE multiplayer_bets
             SET status = 'CANCELLED', settled_tx_done = 1, updated_at = ?
             WHERE bet_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0`,
            [now, bet.bet_id]
          );
          if (info.changes) {
            totalRefund += Number(bet.amount) || 0;
          }
        }

        this.db.run(
          'UPDATE users SET wallet = wallet + ?, updated_at = ? WHERE user_id = ?',
          [totalRefund, now, String(userId)]
        );
        const userAfter = this.db.get('SELECT wallet FROM users WHERE user_id = ?', [String(userId)]);
        const walletAfter = Number(userAfter?.wallet) || 0;

        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, NULL, 'mp_bet_cancel_all', ?, ?, ?, ?)`,
          [
            String(userId),
            totalRefund,
            walletAfter,
            `Hủy toàn bộ ${activeBets.length} vé cược trong phiên #${roundId} — Hoàn 100%`,
            now,
          ]
        );

        const totals = this._recomputeRoundTotalsInTx(roundId, now);
        return {
          ok: true,
          cancelledCount: activeBets.length,
          refundedAmount: totalRefund,
          walletAfter,
          totals,
        };
      });

      if (!txRes.ok) {
        if (txRes.code === 'ROUND_LOCKED') this._triggerFinalizeIfExpired(roundId);
        return txRes;
      }

      this._scheduleBoardRender(roundId);
      return {
        ...txRes,
        userBets: [],
        snapshot: this.getRoundSnapshot(roundId),
      };
    });
  }

  // ==========================================================================
  // 4. Tạo Kết Quả Ngẫu Nhiên Công Bằng (`crypto.randomInt`) — Dùng Chung Toàn Phiên
  // ==========================================================================

  _generateSharedResult(gameId) {
    if (gameId === GAME_IDS.BAUCUA) {
      const rolledIds = [
        BAUCUA_MASCOTS[crypto.randomInt(0, BAUCUA_MASCOTS.length)].id,
        BAUCUA_MASCOTS[crypto.randomInt(0, BAUCUA_MASCOTS.length)].id,
        BAUCUA_MASCOTS[crypto.randomInt(0, BAUCUA_MASCOTS.length)].id,
      ];
      const counts = {};
      for (const m of BAUCUA_MASCOTS) counts[m.id] = 0;
      for (const id of rolledIds) counts[id] = (counts[id] || 0) + 1;
      const isTriple = rolledIds[0] === rolledIds[1] && rolledIds[1] === rolledIds[2];

      return {
        gameId: GAME_IDS.BAUCUA,
        rolledIds,
        rolledDetails: rolledIds.map((id) => BAUCUA_MASCOT_MAP[id]),
        counts,
        isTriple,
        generatedAt: this._now(),
      };
    }

    if (gameId === GAME_IDS.TAIXIU) {
      const dice = [
        crypto.randomInt(1, 7),
        crypto.randomInt(1, 7),
        crypto.randomInt(1, 7),
      ];
      const sum = dice[0] + dice[1] + dice[2];
      const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
      // Theo luật chuẩn công bố trước phiên: Tổng 3 hoặc 18 => Nhà cái thắng
      const houseWins = sum === 3 || sum === 18;
      const outcome = houseWins ? 'house' : sum >= 11 ? 'tai' : 'xiu';

      return {
        gameId: GAME_IDS.TAIXIU,
        dice,
        sum,
        isTriple,
        houseWins,
        outcome,
        generatedAt: this._now(),
      };
    }

    // Đua Thú (`race`) — Xếp hạng ngẫu nhiên công bằng 5 chiến thú bằng Fisher-Yates + crypto.randomInt
    const shuffled = [...RACE_ANIMALS];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const rankingIds = shuffled.map((a) => a.id);
    const winnerId = rankingIds[0];

    return {
      gameId: GAME_IDS.RACE,
      winnerId,
      winnerDetail: RACE_ANIMAL_MAP[winnerId],
      rankingIds,
      rankingDetails: rankingIds.map((id) => RACE_ANIMAL_MAP[id]),
      generatedAt: this._now(),
    };
  }

  _calculateBetSettlement(gameId, bet, result) {
    const stake = Number(bet.amount) || 0;

    if (gameId === GAME_IDS.BAUCUA) {
      const hits = Number(result.counts?.[bet.choice]) || 0;
      // Quy tắc Bầu Cua: 1 lần = 2x hoàn trả, 2 lần = 3x, 3 lần = 4x, 0 lần = mất cược
      const payout = hits > 0 ? stake * (hits + 1) : 0;
      return {
        hits,
        payout,
        net: payout - stake,
        won: payout > 0,
      };
    }

    if (gameId === GAME_IDS.TAIXIU) {
      // Quy tắc Tài Xỉu: Tổng 3 hoặc 18 => Nhà cái thắng; đúng TÀI/XỈU => nhận 2x hoàn trả
      const won = !result.houseWins && bet.choice === result.outcome;
      const payout = won ? stake * 2 : 0;
      return {
        hits: won ? 1 : 0,
        payout,
        net: payout - stake,
        won,
      };
    }

    // Quy tắc Đua Thú: Chiến thú về Hạng #1 nhận 4.5x tiền cược
    const won = bet.choice === result.winnerId;
    const payout = won ? Math.round(stake * 4.5) : 0;
    return {
      hits: won ? 1 : 0,
      payout,
      net: payout - stake,
      won,
    };
  }

  // ==========================================================================
  // 5. Quy Trình Khóa Sổ -> Quay Kết Quả -> Thanh Toán ACID -> Kết Thúc Phiên
  // ==========================================================================

  _triggerFinalizeIfExpired(roundId) {
    const row = this.db.get(
      'SELECT round_id, status, ends_at FROM multiplayer_rounds WHERE round_id = ?',
      [String(roundId)]
    );
    if (!row) return;
    if (
      (row.status === MP_ROUND_STATUS.BETTING || row.status === MP_ROUND_STATUS.WAITING) &&
      this._now() >= Number(row.ends_at)
    ) {
      this.finalizeRound(roundId).catch((err) => {
        logger.error('MultiplayerRoundSystem', `Lỗi chốt phiên tự động #${roundId}`, err);
      });
    }
  }

  /**
   * Thực thi luồng kết thúc phiên chuẩn 12 bước (Mục 7):
   * `BETTING` -> `LOCKED` -> Lưu `result_json` vào DB TRƯỚC KHI hiển thị -> `DRAWING` -> `SETTLING` -> `COMPLETED`.
   * Hoàn toàn Idempotent: Không bao giờ quay lại kết quả đã lưu và không bao giờ cộng thưởng 2 lần!
   */
  async finalizeRound(roundId, { skipAnimation = false } = {}) {
    const key = String(roundId);
    if (this._finalizingRounds.has(key)) {
      return this.getRoundSnapshot(key);
    }

    this._finalizingRounds.add(key);
    this._clearRoundTimers(key);

    try {
      const initial = this.db.get(
        'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
        [key]
      );
      if (!initial) return null;
      if (
        initial.status === MP_ROUND_STATUS.COMPLETED ||
        initial.status === MP_ROUND_STATUS.CANCELLED
      ) {
        return this.getRoundSnapshot(key);
      }

      // BƯỚC 1–2: Chuyển trạng thái sang LOCKED và vô hiệu hóa nút đặt cược
      if (
        initial.status === MP_ROUND_STATUS.WAITING ||
        initial.status === MP_ROUND_STATUS.BETTING
      ) {
        const lockTime = this._now();
        this.db.run(
          `UPDATE multiplayer_rounds
           SET status = ?, locked_at = COALESCE(locked_at, ?), updated_at = ?
           WHERE round_id = ? AND status IN (?, ?)`,
          [
            MP_ROUND_STATUS.LOCKED,
            lockTime,
            lockTime,
            key,
            MP_ROUND_STATUS.WAITING,
            MP_ROUND_STATUS.BETTING,
          ]
        );
        await this._renderBoardNow(key, { phase: 'LOCKED' });
      }

      // BƯỚC 4–5: Sinh MỘT kết quả chung duy nhất (hoặc đọc lại nếu đã lưu trước khi crash!) và LƯU VÀO DB TRƯỚC KHI HIỂN THỊ
      const lockedRow = this.db.get(
        'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
        [key]
      );
      if (!lockedRow || lockedRow.status === MP_ROUND_STATUS.CANCELLED) {
        return this.getRoundSnapshot(key);
      }

      let sharedResult = this._parseResult(lockedRow.result_json);
      if (!sharedResult) {
        sharedResult = this._generateSharedResult(lockedRow.game_id);
        this.db.run(
          `UPDATE multiplayer_rounds
           SET result_json = ?, status = ?, updated_at = ?
           WHERE round_id = ? AND result_json IS NULL AND status NOT IN (?, ?)`,
          [
            JSON.stringify(sharedResult),
            MP_ROUND_STATUS.DRAWING,
            this._now(),
            key,
            MP_ROUND_STATUS.COMPLETED,
            MP_ROUND_STATUS.CANCELLED,
          ]
        );
        // Đọc lại từ DB để bảo đảm tuyệt đối 100% nhất quán
        const recheck = this.db.get(
          'SELECT result_json FROM multiplayer_rounds WHERE round_id = ?',
          [key]
        );
        sharedResult = this._parseResult(recheck?.result_json) || sharedResult;
      } else if (lockedRow.status === MP_ROUND_STATUS.LOCKED) {
        this.db.run(
          `UPDATE multiplayer_rounds SET status = ?, updated_at = ? WHERE round_id = ? AND status = ?`,
          [MP_ROUND_STATUS.DRAWING, this._now(), key, MP_ROUND_STATUS.LOCKED]
        );
      }

      // BƯỚC 6–7: Hiển thị Animation quay kết quả (`DRAWING`) khi phiên có hoặc không có người xem
      if (!skipAnimation && this.animationDelayMs > 0) {
        await this._renderBoardNow(key, { phase: 'DRAWING' });
        await new Promise((resolve) => setTimeout(resolve, this.animationDelayMs));
      }

      // BƯỚC 8–11: Chuyển sang `SETTLING` -> Tính thắng/thua & Cập nhật số dư trong 1 ACID Transaction -> `COMPLETED`
      const participantRewards = [];

      this.db.transaction(() => {
        const fresh = this.db.get(
          'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
          [key]
        );
        if (
          !fresh ||
          fresh.settled === 1 ||
          fresh.status === MP_ROUND_STATUS.COMPLETED ||
          fresh.status === MP_ROUND_STATUS.CANCELLED
        ) {
          return;
        }

        const now = this._now();
        this.db.run(
          'UPDATE multiplayer_rounds SET status = ?, updated_at = ? WHERE round_id = ?',
          [MP_ROUND_STATUS.SETTLING, now, key]
        );

        const activeBets = this.db.all(
          `SELECT * FROM multiplayer_bets
           WHERE round_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0
           ORDER BY created_at ASC`,
          [key]
        );

        // Nếu không có người đặt cược, kết thúc phiên sạch sẽ mà KHÔNG phát sinh bất kỳ giao dịch nào!
        if (activeBets.length === 0) {
          this.db.run(
            `UPDATE multiplayer_rounds
             SET status = ?, settled = 1, completed_at = ?,
                 total_players = 0, total_bet_vnd = 0, total_payout_vnd = 0,
                 total_won_vnd = 0, total_lost_vnd = 0, updated_at = ?
             WHERE round_id = ?`,
            [MP_ROUND_STATUS.COMPLETED, now, now, key]
          );
          return;
        }

        const perUserAgg = new Map();
        let roundTotalBet = 0;
        let roundTotalPayout = 0;
        let roundTotalWon = 0;
        let roundTotalLost = 0;

        for (const bet of activeBets) {
          const outcome = this._calculateBetSettlement(fresh.game_id, bet, sharedResult);
          const upd = this.db.run(
            `UPDATE multiplayer_bets
             SET status = 'SETTLED', payout = ?, net = ?, hits = ?, settled_tx_done = 1, updated_at = ?
             WHERE bet_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0`,
            [outcome.payout, outcome.net, outcome.hits, now, bet.bet_id]
          );

          if (!upd.changes) continue;

          const stake = Number(bet.amount) || 0;
          roundTotalBet += stake;
          roundTotalPayout += outcome.payout;
          if (outcome.net > 0) {
            roundTotalWon += outcome.net;
          } else if (outcome.net < 0) {
            roundTotalLost += Math.abs(outcome.net);
          }

          const uAgg = perUserAgg.get(bet.user_id) || {
            userId: bet.user_id,
            username: bet.username || bet.user_id,
            wagered: 0,
            payout: 0,
            net: 0,
            choices: [],
          };
          uAgg.wagered += stake;
          uAgg.payout += outcome.payout;
          uAgg.net += outcome.net;
          uAgg.choices.push(`${bet.choice}:${stake}`);
          perUserAgg.set(bet.user_id, uAgg);
        }

        for (const u of perUserAgg.values()) {
          const wonRound = u.net > 0 ? 1 : 0;
          this.db.run(
            `UPDATE users
             SET wallet = wallet + ?,
                 total_wagered = total_wagered + ?,
                 total_earned = total_earned + ?,
                 games_played = games_played + 1,
                 games_won = games_won + ?,
                 updated_at = ?
             WHERE user_id = ?`,
            [
              u.payout,
              u.wagered,
              Math.max(0, u.net),
              wonRound,
              now,
              String(u.userId),
            ]
          );

          const afterRow = this.db.get(
            'SELECT wallet FROM users WHERE user_id = ?',
            [String(u.userId)]
          );
          const walletAfter = Number(afterRow?.wallet) || 0;

          if (u.payout > 0) {
            this.db.run(
              `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
               VALUES (?, NULL, 'mp_payout', ?, ?, ?, ?)`,
              [
                String(u.userId),
                u.payout,
                walletAfter,
                `Trả thưởng phiên #${key} (${fresh.game_id.toUpperCase()}) — Nhận ${formatVnd(u.payout)} (Lãi ròng: ${formatVnd(u.net)})`,
                now,
              ]
            );
          }

          this.db.run(
            `INSERT INTO game_logs (user_id, game, bet, payout, net, won, detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              String(u.userId),
              `mp_${fresh.game_id}`,
              u.wagered,
              u.payout,
              u.net,
              wonRound,
              `#${key} | ${u.choices.join(',')} | ${JSON.stringify(sharedResult)}`,
              now,
            ]
          );

          participantRewards.push({
            userId: u.userId,
            gameId: fresh.game_id,
            wagered: u.wagered,
            payout: u.payout,
            net: u.net,
            won: u.net > 0,
          });
        }

        this.db.run(
          `UPDATE multiplayer_rounds
           SET status = ?, settled = 1, completed_at = ?,
               total_players = ?, total_bet_vnd = ?, total_payout_vnd = ?,
               total_won_vnd = ?, total_lost_vnd = ?, updated_at = ?
           WHERE round_id = ?`,
          [
            MP_ROUND_STATUS.COMPLETED,
            now,
            perUserAgg.size,
            roundTotalBet,
            roundTotalPayout,
            roundTotalWon,
            roundTotalLost,
            now,
            key,
          ]
        );
      });

      // Cập nhật Nhiệm vụ, EXP & Sự kiện Server cho từng người chơi sau khi giao dịch tiền đã khóa an toàn
      for (const p of participantRewards) {
        try {
          const baseExp = p.won ? 28 : 12;
          this.levelSystem?.awardExp?.(p.userId, baseExp);
          this.questSystem?.incrementProgress?.(p.userId, 'games_played', 1);
          if (p.gameId === GAME_IDS.BAUCUA) {
            this.questSystem?.incrementProgress?.(p.userId, 'baucua_played', 1);
          } else if (p.gameId === GAME_IDS.TAIXIU) {
            this.questSystem?.incrementProgress?.(p.userId, 'taixiu_played', 1);
          } else if (p.gameId === GAME_IDS.RACE) {
            this.questSystem?.incrementProgress?.(p.userId, 'race_played', 1);
          }
          if (p.won) {
            this.questSystem?.incrementProgress?.(p.userId, 'game_wins', 1);
            if (p.net > 0) {
              this.questSystem?.incrementProgress?.(p.userId, 'vnd_earned', p.net);
            }
            this.eventSystem?.recordMetric?.(p.userId, 'game_wins', 1);
          }
          this.eventSystem?.recordMetric?.(p.userId, 'total_wagered', p.wagered);
        } catch (hookErr) {
          logger.warn('MultiplayerRoundSystem', `Lỗi phụ cập nhật Quest/EXP cho ${p.userId}`, hookErr);
        }
      }

      // BƯỚC 12: Hiển thị Bảng Kết Quả Chính Thức Chung Toàn Server
      await this._renderBoardNow(key, { phase: 'COMPLETED' });
      const finalSnapshot = this.getRoundSnapshot(key);

      if (finalSnapshot) {
        this.logSystem?.send?.(
          'game',
          '🏁 Kết Thúc Phiên Cược Chung',
          `Mã phiên: \`#${key}\` (${finalSnapshot.round.game_id.toUpperCase()}) • Người chơi: **${finalSnapshot.round.total_players}** • Tổng cược: **${formatVnd(finalSnapshot.round.total_bet_vnd)}** • Trả thưởng: **${formatVnd(finalSnapshot.round.total_payout_vnd)}**`
        );
      }

      // Dọn dẹp tham chiếu message sau khi kết thúc để tiết kiệm RAM
      this._messageRefs.delete(key);
      return finalSnapshot;
    } finally {
      this._finalizingRounds.delete(key);
    }
  }

  // ==========================================================================
  // 6. Chức Năng Quản Trị Của ADMIN / OWNER (STOP, EXTEND, SETTINGS)
  // ==========================================================================

  /**
   * Dừng khẩn cấp phiên đang chạy (`CANCELLED`) & Hoàn 100% tiền cược cho mọi người chơi.
   * CHỈ ADMIN / OWNER mới được phép gọi (người mở phiên thường bị từ chối!).
   */
  async stopRound({ guildId, gameId = null, roundId = null, actorId, reason = 'Quản trị viên dừng phiên' }) {
    if (!hasBotRole(this.db, actorId, BOT_ROLES.ADMIN)) {
      return {
        ok: false,
        code: 'FORBIDDEN_ADMIN_ONLY',
        error: '⛔ Chỉ **ADMIN** hoặc **OWNER** mới có quyền dừng phiên cược đang chạy!',
      };
    }

    let targetRound = null;
    if (roundId) {
      targetRound = this.db.get(
        'SELECT * FROM multiplayer_rounds WHERE round_id = ? AND guild_id = ?',
        [String(roundId), String(guildId)]
      );
    } else {
      const actives = this.getActiveRounds(guildId, gameId);
      targetRound = actives[0] || null;
    }

    if (!targetRound) {
      return {
        ok: false,
        code: 'NO_ACTIVE_ROUND',
        error: '⚠️ Không tìm thấy phiên cược nào đang hoạt động để dừng.',
      };
    }

    const key = targetRound.round_id;
    if (
      targetRound.status === MP_ROUND_STATUS.COMPLETED ||
      targetRound.status === MP_ROUND_STATUS.CANCELLED ||
      targetRound.settled === 1 ||
      targetRound.refunded === 1
    ) {
      return {
        ok: false,
        code: 'ALREADY_FINISHED',
        error: `⚠️ Phiên \`#${key}\` đã kết thúc hoặc đã hoàn tiền trước đó.`,
      };
    }

    this._clearRoundTimers(key);
    const actorRole = getUserBotRole(this.db, actorId);

    const txRes = this.db.transaction(() => {
      const now = this._now();
      const fresh = this.db.get(
        'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
        [key]
      );
      if (
        !fresh ||
        fresh.settled === 1 ||
        fresh.refunded === 1 ||
        fresh.status === MP_ROUND_STATUS.COMPLETED ||
        fresh.status === MP_ROUND_STATUS.CANCELLED
      ) {
        return {
          ok: false,
          code: 'ALREADY_FINISHED',
          error: `⚠️ Phiên \`#${key}\` đã được tất toán hoặc hoàn tiền.`,
        };
      }

      const activeBets = this.db.all(
        `SELECT * FROM multiplayer_bets
         WHERE round_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0`,
        [key]
      );

      let totalRefunded = 0;
      const refundedUsers = new Set();

      for (const bet of activeBets) {
        const upd = this.db.run(
          `UPDATE multiplayer_bets
           SET status = 'REFUNDED', payout = amount, net = 0, settled_tx_done = 1, updated_at = ?
           WHERE bet_id = ? AND status = 'ACTIVE' AND settled_tx_done = 0`,
          [now, bet.bet_id]
        );
        if (!upd.changes) continue;

        const refundAmt = Number(bet.amount) || 0;
        totalRefunded += refundAmt;
        refundedUsers.add(bet.user_id);

        this.db.run(
          'UPDATE users SET wallet = wallet + ?, updated_at = ? WHERE user_id = ?',
          [refundAmt, now, String(bet.user_id)]
        );
        const afterUser = this.db.get(
          'SELECT wallet FROM users WHERE user_id = ?',
          [String(bet.user_id)]
        );
        const walletAfter = Number(afterUser?.wallet) || 0;

        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, ?, 'mp_cancel_refund', ?, ?, ?, ?)`,
          [
            String(bet.user_id),
            String(actorId),
            refundAmt,
            walletAfter,
            `Hoàn 100% tiền cược phiên #${key} bị hủy (${reason})`,
            now,
          ]
        );
      }

      this.db.run(
        `UPDATE multiplayer_rounds
         SET status = ?, refunded = 1, cancelled_by = ?, cancel_reason = ?,
             completed_at = ?, updated_at = ?
         WHERE round_id = ?`,
        [
          MP_ROUND_STATUS.CANCELLED,
          String(actorId),
          String(reason || 'Quản trị viên dừng phiên'),
          now,
          now,
          key,
        ]
      );

      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'MP_ROUND_STOP',
        targetId: key,
        details: `Dừng phiên #${key} (${fresh.game_id}) • Hoàn trả ${formatVnd(totalRefunded)} cho ${refundedUsers.size} người chơi • Lý do: ${reason}`,
      });

      return {
        ok: true,
        roundId: key,
        gameId: fresh.game_id,
        refundedUsersCount: refundedUsers.size,
        totalRefundedVnd: totalRefunded,
      };
    });

    if (!txRes.ok) return txRes;

    await this._renderBoardNow(key, { phase: 'CANCELLED' });
    this._messageRefs.delete(key);

    this.logSystem?.send?.(
      'admin',
      '🛑 Admin Dừng Phiên & Hoàn Tiền 100%',
      `Người thực hiện: <@${actorId}> (${actorRole})\nMã phiên: \`#${key}\` • Hoàn tiền: **${formatVnd(txRes.totalRefundedVnd)}** (${txRes.refundedUsersCount} người chơi)\nLý do: ${reason}`
    );

    return {
      ...txRes,
      snapshot: this.getRoundSnapshot(key),
    };
  }

  /**
   * Gia hạn thêm thời gian đặt cược khi phiên đang `BETTING` (Chỉ ADMIN / OWNER).
   */
  async extendRound({ guildId, gameId = null, roundId = null, addSeconds, actorId }) {
    if (!hasBotRole(this.db, actorId, BOT_ROLES.ADMIN)) {
      return {
        ok: false,
        code: 'FORBIDDEN_ADMIN_ONLY',
        error: '⛔ Chỉ **ADMIN** hoặc **OWNER** mới có quyền gia hạn thời gian phiên cược!',
      };
    }

    const extraSec = Math.floor(Number(addSeconds));
    if (!Number.isFinite(extraSec) || extraSec < 5 || extraSec > 300) {
      return {
        ok: false,
        code: 'INVALID_DURATION',
        error: '❌ Số giây gia hạn phải từ **5 giây** đến **300 giây**.',
      };
    }

    let targetRound = null;
    if (roundId) {
      targetRound = this.db.get(
        'SELECT * FROM multiplayer_rounds WHERE round_id = ? AND guild_id = ?',
        [String(roundId), String(guildId)]
      );
    } else {
      const actives = this.getActiveRounds(guildId, gameId);
      targetRound = actives[0] || null;
    }

    if (!targetRound) {
      return {
        ok: false,
        code: 'NO_ACTIVE_ROUND',
        error: '⚠️ Không tìm thấy phiên cược nào đang hoạt động để gia hạn.',
      };
    }

    const actorRole = getUserBotRole(this.db, actorId);
    const txRes = this.db.transaction(() => {
      const now = this._now();
      const fresh = this.db.get(
        'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
        [targetRound.round_id]
      );
      if (!fresh || fresh.status !== MP_ROUND_STATUS.BETTING || now >= Number(fresh.ends_at)) {
        return {
          ok: false,
          code: 'ROUND_NOT_BETTING',
          error: '⛔ Chỉ có thể gia hạn khi phiên vẫn đang ở trạng thái nhận cược (`BETTING`).',
        };
      }

      const newEndsAt = Number(fresh.ends_at) + extraSec * 1000;
      const newDuration = Number(fresh.duration_sec) + extraSec;
      const remAfter = newEndsAt - now;

      this.db.run(
        `UPDATE multiplayer_rounds
         SET ends_at = ?, duration_sec = ?,
             notified_30s = CASE WHEN ? > 30000 THEN 0 ELSE notified_30s END,
             notified_10s = CASE WHEN ? > 10000 THEN 0 ELSE notified_10s END,
             notified_5s  = CASE WHEN ? > 5000  THEN 0 ELSE notified_5s  END,
             updated_at = ?
         WHERE round_id = ? AND status = ?`,
        [
          newEndsAt,
          newDuration,
          remAfter,
          remAfter,
          remAfter,
          now,
          fresh.round_id,
          MP_ROUND_STATUS.BETTING,
        ]
      );

      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'MP_ROUND_EXTEND',
        targetId: fresh.round_id,
        details: `Gia hạn phiên #${fresh.round_id} (${fresh.game_id}) thêm +${extraSec}s`,
      });

      return {
        ok: true,
        roundId: fresh.round_id,
        extraSec,
        newEndsAt,
      };
    });

    if (!txRes.ok) return txRes;

    this._scheduleRoundTimers(txRes.roundId);
    await this._renderBoardNow(txRes.roundId, { phase: 'EXTENDED' });

    this.logSystem?.send?.(
      'admin',
      '⏱️ Gia Hạn Phiên Cược Chung',
      `Người thực hiện: <@${actorId}> (${actorRole}) • Phiên \`#${txRes.roundId}\` được cộng thêm **+${extraSec} giây**.`
    );

    return {
      ...txRes,
      snapshot: this.getRoundSnapshot(txRes.roundId),
    };
  }

  /**
   * Cấu hình thời gian đếm ngược, giới hạn cược, quyền sửa/hủy cược (ADMIN/OWNER)
   * và chế độ nhiều bàn cùng lúc (CHỈ OWNER `1243061570247069696`).
   */
  updateSettings({
    actorId,
    gameId = null,
    durationSec = null,
    minBet = null,
    maxBet = null,
    allowEditCancelBet = null,
    multiTableEnabled = null,
    maxTablesPerGame = null,
  }) {
    if (!hasBotRole(this.db, actorId, BOT_ROLES.ADMIN)) {
      return {
        ok: false,
        code: 'FORBIDDEN_ADMIN_ONLY',
        error: '⛔ Chỉ **ADMIN** hoặc **OWNER** mới có quyền chỉnh sửa cấu hình phiên cược!',
      };
    }

    // Chế độ nhiều bàn (`multiTableEnabled`) CHỈ DUY NHẤT OWNER được phép bật/tắt (Mục 3)
    if (multiTableEnabled !== null || maxTablesPerGame !== null) {
      if (!isOwner(actorId)) {
        return {
          ok: false,
          code: 'FORBIDDEN_OWNER_ONLY',
          error: '👑 Chỉ **OWNER tối cao** mới có quyền bật/tắt hoặc chỉnh số lượng bàn cược song song!',
        };
      }
    }

    const changes = [];

    if (gameId !== null && durationSec !== null) {
      if (!this.isSupportedGame(gameId)) {
        return { ok: false, code: 'UNSUPPORTED_GAME', error: '❌ Trò chơi không hợp lệ.' };
      }
      const sec = Math.floor(Number(durationSec));
      if (!Number.isFinite(sec) || sec < 10 || sec > 600) {
        return {
          ok: false,
          code: 'INVALID_DURATION',
          error: '❌ Thời gian đặt cược của phiên phải nằm trong khoảng **10 giây – 600 giây**.',
        };
      }
      const curDurations = { ...(this.db.getSetting('mpRoundDurations') || {}) };
      curDurations[gameId] = sec;
      this.db.setSetting('mpRoundDurations', curDurations);
      changes.push(`Thời gian ${gameId}: ${sec}s`);
    }

    if (minBet !== null) {
      const vMin = Math.floor(Number(minBet));
      const curMax = Number(maxBet ?? this.db.getSetting('maxBet') ?? 50_000_000);
      if (!Number.isFinite(vMin) || vMin < 10 || vMin > curMax) {
        return {
          ok: false,
          code: 'INVALID_MIN_BET',
          error: '❌ Cược tối thiểu không hợp lệ (phải >= 10 VNĐ và <= cược tối đa).',
        };
      }
      this.db.setSetting('minBet', vMin);
      changes.push(`Cược tối thiểu: ${formatVnd(vMin)}`);
    }

    if (maxBet !== null) {
      const vMax = Math.floor(Number(maxBet));
      const curMin = Number(this.db.getSetting('minBet') ?? 100);
      if (!Number.isFinite(vMax) || vMax < curMin) {
        return {
          ok: false,
          code: 'INVALID_MAX_BET',
          error: '❌ Cược tối đa phải lớn hơn hoặc bằng mức cược tối thiểu.',
        };
      }
      this.db.setSetting('maxBet', vMax);
      changes.push(`Cược tối đa: ${formatVnd(vMax)}`);
    }

    if (allowEditCancelBet !== null) {
      const flag = Boolean(allowEditCancelBet);
      this.db.setSetting('mpAllowEditCancelBet', flag);
      changes.push(`Cho phép sửa/hủy cược: ${flag ? 'BẬT' : 'TẮT'}`);
    }

    if (multiTableEnabled !== null) {
      const flag = Boolean(multiTableEnabled);
      this.db.setSetting('mpMultiTableEnabled', flag);
      changes.push(`Chế độ nhiều bàn (Owner): ${flag ? 'BẬT' : 'TẮT'}`);
    }

    if (maxTablesPerGame !== null) {
      const tables = Math.max(1, Math.min(10, Math.floor(Number(maxTablesPerGame))));
      this.db.setSetting('mpMaxTablesPerGame', tables);
      changes.push(`Số bàn tối đa/trò: ${tables}`);
    }

    if (changes.length > 0) {
      const actorRole = getUserBotRole(this.db, actorId);
      this.db.recordAudit({
        actorId,
        actorRole,
        action: 'MP_SETTINGS_UPDATE',
        targetId: gameId || 'global',
        details: changes.join(' | '),
      });
      this.logSystem?.send?.(
        'admin',
        '⚙️ Cập Nhật Cấu Hình Multiplayer Round',
        `Người thực hiện: <@${actorId}> (${actorRole})\nThay đổi: ${changes.join(' • ')}`
      );
    }

    return {
      ok: true,
      changes,
      settings: this.getSettingsSummary(),
    };
  }

  // ==========================================================================
  // 7. Đồng Hồ Cột Mốc (30s / 10s / 5s / 0s) & Cập Nhật Bảng Chung Chống Spam
  // ==========================================================================

  _clearRoundTimers(roundId) {
    const key = String(roundId);
    const set = this._roundTimers.get(key);
    if (set) {
      for (const t of set) clearTimeout(t);
      this._roundTimers.delete(key);
    }
    const deb = this._renderDebounce.get(key);
    if (deb) {
      clearTimeout(deb);
      this._renderDebounce.delete(key);
    }
  }

  _scheduleRoundTimers(roundId) {
    const key = String(roundId);
    this._clearRoundTimers(key);

    const round = this.db.get(
      'SELECT * FROM multiplayer_rounds WHERE round_id = ?',
      [key]
    );
    if (!round || round.status !== MP_ROUND_STATUS.BETTING) return;

    const now = this._now();
    const remMs = Number(round.ends_at) - now;
    if (remMs <= 0) {
      this.finalizeRound(key).catch((err) => {
        logger.error('MultiplayerRoundSystem', `Lỗi chốt phiên #${key}`, err);
      });
      return;
    }

    const timers = new Set();
    const addMilestone = (thresholdMs, colFlag, milestoneTag) => {
      if (remMs > thresholdMs && !round[colFlag]) {
        const delay = remMs - thresholdMs;
        const t = setTimeout(() => {
          timers.delete(t);
          const cur = this.db.get(
            'SELECT status, ends_at FROM multiplayer_rounds WHERE round_id = ?',
            [key]
          );
          if (!cur || cur.status !== MP_ROUND_STATUS.BETTING) return;
          this.db.run(
            `UPDATE multiplayer_rounds SET ${colFlag} = 1, updated_at = ? WHERE round_id = ?`,
            [this._now(), key]
          );
          this._renderBoardNow(key, { milestone: milestoneTag }).catch(() => {});
        }, delay);
        if (typeof t.unref === 'function') t.unref();
        timers.add(t);
      }
    };

    // Các mốc cảnh báo chuẩn Mục 5: 30s -> 10s -> 5s -> 0s khóa sổ
    addMilestone(30_000, 'notified_30s', '30s');
    addMilestone(10_000, 'notified_10s', '10s');
    addMilestone(5_000, 'notified_5s', '5s');

    const endTimer = setTimeout(() => {
      timers.delete(endTimer);
      this.finalizeRound(key).catch((err) => {
        logger.error('MultiplayerRoundSystem', `Lỗi khi kết thúc phiên #${key}`, err);
      });
    }, remMs);
    if (typeof endTimer.unref === 'function') endTimer.unref();
    timers.add(endTimer);

    this._roundTimers.set(key, timers);
  }

  _scheduleBoardRender(roundId, delayMs = 350) {
    const key = String(roundId);
    if (this._renderDebounce.has(key)) return;
    const t = setTimeout(() => {
      this._renderDebounce.delete(key);
      this._renderBoardNow(key, { phase: 'BET_UPDATE' }).catch(() => {});
    }, delayMs);
    if (typeof t.unref === 'function') t.unref();
    this._renderDebounce.set(key, t);
  }

  async _resolveBoardMessage(round) {
    const cached = this._messageRefs.get(round.round_id);
    if (cached && typeof cached.edit === 'function') return cached;
    if (!this.client || !round.channel_id || !round.message_id) return null;

    try {
      const channel =
        this.client.channels?.cache?.get(round.channel_id) ||
        (await this.client.channels?.fetch?.(round.channel_id).catch(() => null));
      if (!channel || !channel.messages?.fetch) return null;
      const msg = await channel.messages.fetch(round.message_id).catch(() => null);
      if (msg) {
        this._messageRefs.set(round.round_id, msg);
      }
      return msg;
    } catch {
      return null;
    }
  }

  async _renderBoardNow(roundId, meta = {}) {
    if (typeof this.boardRenderer !== 'function') return;
    const deb = this._renderDebounce.get(String(roundId));
    if (deb) {
      clearTimeout(deb);
      this._renderDebounce.delete(String(roundId));
    }

    const snapshot = this.getRoundSnapshot(roundId);
    if (!snapshot) return;

    const msg = await this._resolveBoardMessage(snapshot.round);
    try {
      await this.boardRenderer(snapshot, { ...meta, message: msg });
    } catch (err) {
      logger.warn(
        'MultiplayerRoundSystem',
        `Không thể cập nhật bảng hiển thị phiên #${roundId}`,
        err
      );
    }
  }

  // ==========================================================================
  // 8. Tự Động Khôi Phục Phiên Khi Bot Khởi Động Lại (Mục 14) & Dọn Dẹp Tắt Máy
  // ==========================================================================

  /**
   * Kiểm tra toàn bộ các phiên chưa hoàn tất trong SQLite khi Bot vừa khởi động lại:
   * - Nếu đang `WAITING` / `BETTING` và `now < ends_at`: khôi phục bộ đếm thời gian còn lại.
   * - Nếu đã quá hạn `ends_at` hoặc bị gián đoạn giữa `LOCKED` / `DRAWING` / `SETTLING`:
   *   tự động khóa cược và tất toán an toàn bằng kết quả đã lưu (TUYỆT ĐỐI không sinh lại kết quả mới!).
   */
  async recoverActiveRounds() {
    const placeholders = MP_ACTIVE_STATUSES.map(() => '?').join(', ');
    const pendingRounds = this.db.all(
      `SELECT * FROM multiplayer_rounds
       WHERE status IN (${placeholders})
       ORDER BY created_at ASC`,
      [...MP_ACTIVE_STATUSES]
    );

    let resumed = 0;
    let settled = 0;

    for (const r of pendingRounds) {
      const now = this._now();
      if (
        (r.status === MP_ROUND_STATUS.WAITING || r.status === MP_ROUND_STATUS.BETTING) &&
        now < Number(r.ends_at)
      ) {
        if (r.status === MP_ROUND_STATUS.WAITING) {
          this.db.run(
            'UPDATE multiplayer_rounds SET status = ?, updated_at = ? WHERE round_id = ?',
            [MP_ROUND_STATUS.BETTING, now, r.round_id]
          );
        }
        this._scheduleRoundTimers(r.round_id);
        await this._renderBoardNow(r.round_id, { phase: 'RECOVERED' });
        resumed += 1;
      } else {
        await this.finalizeRound(r.round_id, { skipAnimation: true });
        settled += 1;
      }
    }

    if (pendingRounds.length > 0) {
      logger.info(
        'MultiplayerRoundSystem',
        `Khôi phục sau khởi động: Tiếp tục đếm ngược ${resumed} phiên, tất toán an toàn ${settled} phiên quá hạn.`
      );
    }

    return { total: pendingRounds.length, resumed, settled };
  }

  shutdown() {
    for (const roundId of Array.from(this._roundTimers.keys())) {
      this._clearRoundTimers(roundId);
    }
    for (const t of this._renderDebounce.values()) {
      clearTimeout(t);
    }
    this._renderDebounce.clear();
    this._messageRefs.clear();
  }
}
