import {
  BAUCUA_MASCOTS,
  DICE_FACES,
  GAME_IDS,
  GAME_LABELS,
  LOG_CATEGORIES,
  RACE_ANIMALS,
  RPS_CHOICES,
} from '../config/constants.js';
import { formatVnd } from '../utils/format.js';
import { pickOne, rollDice, secureInt } from '../utils/rng.js';

/**
 * Hệ thống Trò Chơi Công Bằng (Gaming Engine):
 * - Sử dụng 100% `crypto.randomInt` — hoàn toàn ngẫu nhiên, không bị can thiệp bởi Admin hay Pet.
 * - Mọi ván cược được kiểm tra giới hạn `minBet`/`maxBet`, số dư ví thực tế và ghi nhật ký đầy đủ.
 */
export class GameSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   * @param {import('./levelSystem.js').LevelSystem} deps.levelSystem
   * @param {import('./questSystem.js').QuestSystem} deps.questSystem
   * @param {import('./eventSystem.js').EventSystem} deps.eventSystem
   * @param {import('./logSystem.js').LogSystem} deps.logSystem
   */
  constructor({ db, economySystem, levelSystem, questSystem, eventSystem, logSystem }) {
    this.db = db;
    this.economySystem = economySystem;
    this.levelSystem = levelSystem;
    this.questSystem = questSystem;
    this.eventSystem = eventSystem;
    this.logSystem = logSystem;

    /**
     * Phiên người chơi đang mở bàn tương tác theo từng trò chơi (`gameId` -> `Map<userId, expiresAt>`).
     * @type {Map<string, Map<string, number>>}
     */
    this.activePlayersByGame = new Map();

    /**
     * Phiên Đoán Số nhiều lượt có gợi ý Lớn Hơn / Nhỏ Hơn (`userId` -> Session).
     * @type {Map<string, object>}
     */
    this.guessSessions = new Map();
  }

  touchActivePlayer(gameId, userId, ttlMs = 180_000, now = Date.now()) {
    if (!gameId || !userId) return;
    let bucket = this.activePlayersByGame.get(gameId);
    if (!bucket) {
      bucket = new Map();
      this.activePlayersByGame.set(gameId, bucket);
    }
    bucket.set(String(userId), now + ttlMs);
    if (bucket.size > 500) {
      for (const [uid, exp] of bucket.entries()) {
        if (exp <= now) bucket.delete(uid);
      }
    }
  }

  releaseActivePlayer(gameId, userId) {
    if (!gameId || !userId) return;
    this.activePlayersByGame.get(gameId)?.delete(String(userId));
  }

  getActivePlayerCount(gameId, now = Date.now()) {
    const bucket = this.activePlayersByGame.get(gameId);
    let count = 0;
    if (bucket) {
      for (const [uid, exp] of bucket.entries()) {
        if (exp > now) count += 1;
        else bucket.delete(uid);
      }
    }
    if (gameId === GAME_IDS.GUESS) {
      for (const [uid, sess] of this.guessSessions.entries()) {
        if (sess.expiresAt > now && !bucket?.has(uid)) count += 1;
      }
    }
    return count;
  }

  assertGameAllowed(gameId) {
    const gamesEnabled = this.db.getSetting('gamesEnabled') || {};
    if (gamesEnabled[gameId] === false) {
      throw new Error(
        `Trò chơi **${GAME_LABELS[gameId] || gameId}** hiện đang tạm khóa bảo trì bởi Quản trị viên.`
      );
    }
  }

  validateBetAmount(bet) {
    const clean = Math.trunc(Number(bet));
    const minBet = Number(this.db.getSetting('minBet') ?? 100);
    const maxBet = Number(this.db.getSetting('maxBet') ?? 5_000_000);

    if (!Number.isSafeInteger(clean) || clean < minBet) {
      throw new Error(`Mức cược tối thiểu là **${formatVnd(minBet)}**.`);
    }
    if (clean > maxBet) {
      throw new Error(`Mức cược tối đa cho mỗi lượt là **${formatVnd(maxBet)}**.`);
    }
    return clean;
  }

  /**
   * Chốt kết quả ván chơi nguyên tử trong SQLite Transaction.
   */
  _settleSinglePlayerGame({
    userId,
    username,
    gameId,
    totalBet,
    rawPayout,
    won,
    detail,
    now = Date.now(),
  }) {
    const payoutMult = Number(this.db.getSetting('gamePayoutMultiplier') ?? 1.0);
    // Nếu hòa (rawPayout === totalBet), hoàn đúng gốc; nếu thắng (rawPayout > totalBet), nhân hệ số thưởng trên phần lãi
    let finalPayout = 0;
    if (rawPayout === totalBet) {
      finalPayout = totalBet;
    } else if (rawPayout > totalBet) {
      const profit = rawPayout - totalBet;
      finalPayout = totalBet + Math.round(profit * payoutMult);
    }

    const res = this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      if (user.wallet < totalBet) {
        throw new Error(
          `Số dư ví không đủ để đặt cược! Cần **${formatVnd(totalBet)}**, hiện có **${formatVnd(user.wallet)}**.`
        );
      }

      const net = finalPayout - totalBet;
      const nextWallet = user.wallet + net;
      const wonFlag = net > 0 ? 1 : 0;

      this.db.run(
        `UPDATE users
         SET wallet = ?,
             total_wagered = total_wagered + ?,
             total_earned = total_earned + ?,
             games_played = games_played + 1,
             games_won = games_won + ?,
             updated_at = ?
         WHERE user_id = ?`,
        [
          nextWallet,
          totalBet,
          net > 0 ? net : 0,
          wonFlag,
          now,
          String(userId),
        ]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(userId),
          net >= 0 ? 'game_win' : 'game_loss',
          net,
          nextWallet,
          `${GAME_LABELS[gameId]}: ${detail}`,
          now,
        ]
      );

      this.db.run(
        `INSERT INTO game_logs (user_id, game, bet, payout, net, won, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [String(userId), gameId, totalBet, finalPayout, net, wonFlag, detail, now]
      );

      // Cập nhật tiến trình nhiệm vụ hằng ngày cho từng trò chơi & sự kiện
      this.questSystem?.incrementMetric(userId, 'games_played', 1, now);
      this.questSystem?.incrementMetric(userId, `play_${gameId}`, 1, now);
      if (gameId === GAME_IDS.BAUCUA && wonFlag) {
        this.eventSystem?.recordProgress(userId, 'baucua_event', 1, now);
      }
      if (gameId === GAME_IDS.TAIXIU && wonFlag) {
        this.eventSystem?.recordProgress(userId, 'taixiu_event', 1, now);
      }
      if (wonFlag) {
        this.questSystem?.incrementMetric(userId, 'game_wins', 1, now);
        if (user.level >= 5) {
          this.questSystem?.incrementMetric(userId, 'veteran_wins', 1, now);
        }
        if (net > 0) {
          this.questSystem?.incrementMetric(userId, 'vnd_earned', net, now);
          this.eventSystem?.recordProgress(userId, 'rich_race', net, now);
        }
      }

      const expRes = this.levelSystem?.grantExp(userId, wonFlag ? 22 : 10, now);
      this.levelSystem?.evaluateMilestoneTitles(userId);

      return {
        totalBet,
        payout: finalPayout,
        net,
        won: Boolean(wonFlag),
        isTie: net === 0 && rawPayout === totalBet,
        balanceAfter: nextWallet,
        expResult: expRes,
      };
    });

    if (Math.abs(res.net) >= 100_000) {
      this.logSystem?.send(
        LOG_CATEGORIES.GAME,
        `${GAME_LABELS[gameId]} — <@${userId}> ${res.net >= 0 ? 'thắng' : 'thua'} **${formatVnd(Math.abs(res.net))}** (${detail}).`
      );
    }

    return res;
  }

  // ==========================================================================
  // 4.1. BẦU CUA (Hỗ trợ đặt cược 1 hoặc nhiều linh vật cùng lúc)
  // ==========================================================================

  /**
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.username
   * @param {Record<string, number>} params.bets - Ví dụ `{ bau: 10000, cua: 5000 }`
   * @param {number} [params.now]
   */
  playBauCua({ userId, username, bets, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.BAUCUA);

    const validIds = new Set(BAUCUA_MASCOTS.map((m) => m.id));
    const entries = Object.entries(bets || {}).filter(([, amt]) => Number(amt) > 0);
    if (entries.length === 0) {
      throw new Error('Vui lòng chọn ít nhất 1 linh vật để đặt cược!');
    }

    let totalBet = 0;
    const cleanBets = {};
    for (const [mId, amt] of entries) {
      if (!validIds.has(mId)) {
        throw new Error(`Linh vật không hợp lệ: ${mId}`);
      }
      const cleanAmt = this.validateBetAmount(amt);
      cleanBets[mId] = cleanAmt;
      totalBet += cleanAmt;
    }

    const maxBet = Number(this.db.getSetting('maxBet') ?? 5_000_000);
    if (totalBet > maxBet) {
      throw new Error(
        `Tổng tiền cược các cửa (**${formatVnd(totalBet)}**) vượt quá hạn mức tối đa (**${formatVnd(maxBet)}**).`
      );
    }

    // Tung 3 xúc xắc Bầu Cua bằng crypto.randomInt
    const rolledMascots = [
      pickOne(BAUCUA_MASCOTS),
      pickOne(BAUCUA_MASCOTS),
      pickOne(BAUCUA_MASCOTS),
    ];

    const counts = {};
    for (const m of rolledMascots) {
      counts[m.id] = (counts[m.id] || 0) + 1;
    }

    let rawPayout = 0;
    const breakdown = [];
    for (const [mId, stake] of Object.entries(cleanBets)) {
      const hit = counts[mId] || 0;
      const mascotObj = BAUCUA_MASCOTS.find((x) => x.id === mId);
      if (hit > 0) {
        const winReturn = stake + stake * hit; // Hoàn gốc + nhân số lần xuất hiện
        rawPayout += winReturn;
        breakdown.push(`${mascotObj.emoji} ${mascotObj.name} (x${hit}): +${formatVnd(stake * hit)}`);
      } else {
        breakdown.push(`${mascotObj.emoji} ${mascotObj.name}: -${formatVnd(stake)}`);
      }
    }

    const detail = `Kết quả: ${rolledMascots.map((m) => m.emoji).join(' ')}`;
    const settled = this._settleSinglePlayerGame({
      userId,
      username,
      gameId: GAME_IDS.BAUCUA,
      totalBet,
      rawPayout,
      won: rawPayout > totalBet,
      detail,
      now,
    });

    return {
      ...settled,
      rolledMascots,
      breakdown,
      cleanBets,
    };
  }

  // ==========================================================================
  // 4.2 & 4.3. TÀI XỈU & TÀI XỈU NÂNG CAO (Thống kê cá nhân + Lịch sử cầu)
  // ==========================================================================

  /**
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.username
   * @param {'tai' | 'xiu'} params.choice
   * @param {number} params.bet
   * @param {number} [params.now]
   */
  playTaiXiu({ userId, username, choice, bet, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.TAIXIU);
    if (choice !== 'tai' && choice !== 'xiu') {
      throw new Error('Lựa chọn chỉ nhận Tài (tai) hoặc Xỉu (xiu).');
    }

    const cleanBet = this.validateBetAmount(bet);
    const dice = rollDice(3, 6);
    const sum = dice[0] + dice[1] + dice[2];
    const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
    const isExtremeHouse = sum === 3 || sum === 18;

    // Quy tắc chuẩn: Tổng 4–10 = Xỉu; Tổng 11–17 = Tài; Tổng 3 hoặc 18 = Nhà cái thắng
    let outcome = 'bao';
    if (!isExtremeHouse) {
      outcome = sum >= 11 ? 'tai' : 'xiu';
    }

    const won = outcome === choice;
    const rawPayout = won ? cleanBet * 2 : 0;
    const facesStr = dice.map((d) => `${DICE_FACES[d]}(${d})`).join(' ');
    const outcomeLabel = isExtremeHouse
      ? `NHÀ CÁI THẮNG (${sum} điểm)`
      : outcome === 'tai'
        ? `TÀI (${sum} điểm)`
        : `XỈU (${sum} điểm)`;

    const settled = this._settleSinglePlayerGame({
      userId,
      username,
      gameId: GAME_IDS.TAIXIU,
      totalBet: cleanBet,
      rawPayout,
      won,
      detail: `${facesStr} => ${outcomeLabel}`,
      now,
    });

    return {
      ...settled,
      choice,
      dice,
      diceFaces: dice.map((d) => DICE_FACES[d]),
      sum,
      isTriple,
      isExtremeHouse,
      outcome,
      outcomeLabel,
    };
  }

  getTaiXiuDashboard(userId) {
    const recentLogs = this.db.all(
      "SELECT detail, won, net, created_at FROM game_logs WHERE game = 'taixiu' ORDER BY id DESC LIMIT 10"
    );

    const personal = this.db.get(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(won), 0) AS wins,
         COALESCE(SUM(net), 0) AS total_net
       FROM game_logs
       WHERE user_id = ? AND game = 'taixiu'`,
      [String(userId)]
    );

    const total = personal?.total || 0;
    const wins = personal?.wins || 0;
    const winRate = total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0;

    return {
      recentLogs,
      personal: {
        total,
        wins,
        losses: total - wins,
        winRate,
        totalNet: personal?.total_net || 0,
      },
    };
  }

  // ==========================================================================
  // TUNG ĐỒNG XU (/coinflip)
  // ==========================================================================

  playCoinflip({ userId, username, side, bet, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.COINFLIP);
    if (side !== 'sap' && side !== 'ngua') {
      throw new Error('Vui lòng chọn Sấp (sap) hoặc Ngửa (ngua).');
    }
    const cleanBet = this.validateBetAmount(bet);
    const resultSide = secureInt(0, 1) === 0 ? 'sap' : 'ngua';
    const won = side === resultSide;

    const settled = this._settleSinglePlayerGame({
      userId,
      username,
      gameId: GAME_IDS.COINFLIP,
      totalBet: cleanBet,
      rawPayout: won ? cleanBet * 2 : 0,
      won,
      detail: `Đồng xu: ${resultSide === 'sap' ? 'Sấp' : 'Ngửa'}`,
      now,
    });

    return { ...settled, chosenSide: side, resultSide };
  }

  // ==========================================================================
  // ĐOÁN SỐ (/guess) — Hỗ trợ phiên Nhiều Lượt (Gợi ý Lớn Hơn / Nhỏ Hơn) & 1 Lượt
  // ==========================================================================

  getGuessModeConfig(difficulty = 'easy') {
    const modes = {
      easy: { id: 'easy', max: 20, maxAttempts: 4, mult: 2.2, label: 'Dễ (1 – 20 • 4 lượt)' },
      medium: { id: 'medium', max: 50, maxAttempts: 5, mult: 2.8, label: 'Trung bình (1 – 50 • 5 lượt)' },
      hard: { id: 'hard', max: 100, maxAttempts: 6, mult: 3.5, label: 'Khó (1 – 100 • 6 lượt)' },
    };
    return modes[difficulty] ?? modes.easy;
  }

  getGuessSession(userId, now = Date.now()) {
    const sess = this.guessSessions.get(String(userId));
    if (!sess) return null;
    if (sess.expiresAt <= now) {
      this.guessSessions.delete(String(userId));
      return null;
    }
    return sess;
  }

  /**
   * Khởi tạo phiên Đoán Số nhiều lượt: chỉ trừ tiền cược nguyên tử sau khi người chơi bấm Xác Nhận.
   */
  startGuessSession({ userId, username, difficulty = 'easy', bet, secretOverride = null, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.GUESS);
    const uId = String(userId);
    const existing = this.getGuessSession(uId, now);
    if (existing) {
      throw new Error('Bạn đang có một ván Đoán Số chưa hoàn thành! Hãy đoán tiếp trên bảng hiện tại.');
    }

    const mode = this.getGuessModeConfig(difficulty);
    const cleanBet = this.validateBetAmount(bet);

    const walletAfterBet = this.db.transaction(() => {
      const user = this.economySystem.ensureUser(uId, username, now);
      this.economySystem.assertCanTransact(user);
      if (user.wallet < cleanBet) {
        throw new Error(
          `Số dư ví không đủ để đặt cược! Cần **${formatVnd(cleanBet)}**, hiện có **${formatVnd(user.wallet)}**.`
        );
      }
      const nextWallet = user.wallet - cleanBet;
      this.db.run(
        `UPDATE users
         SET wallet = ?, total_wagered = total_wagered + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, cleanBet, now, uId]
      );
      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'game_bet', ?, ?, ?, ?)`,
        [uId, -cleanBet, nextWallet, `Đặt cược Đoán Số (${mode.label})`, now]
      );
      return nextWallet;
    });

    const secret =
      Number.isInteger(secretOverride) && secretOverride >= 1 && secretOverride <= mode.max
        ? secretOverride
        : secureInt(1, mode.max);

    const session = {
      userId: uId,
      username: String(username || ''),
      difficulty: mode.id,
      mode,
      bet: cleanBet,
      secret,
      maxAttempts: mode.maxAttempts,
      attemptsUsed: 0,
      history: [],
      walletAfterBet,
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000,
    };

    this.guessSessions.set(uId, session);
    return {
      userId: uId,
      mode,
      bet: cleanBet,
      maxAttempts: session.maxAttempts,
      remainingAttempts: session.maxAttempts,
      balanceAfterBet: walletAfterBet,
    };
  }

  /**
   * Xử lý từng lượt dự đoán trong phiên Đoán Số tương tác (trả gợi ý Lớn Hơn / Nhỏ Hơn hoặc Kết toán thắng/thua).
   */
  submitGuessTurn({ userId, username, guessNumber, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.GUESS);
    const uId = String(userId);
    const session = this.getGuessSession(uId, now);
    if (!session) {
      throw new Error('Phiên Đoán Số của bạn không tồn tại hoặc đã hết hạn. Hãy bấm tạo ván mới!');
    }

    const pick = Math.trunc(Number(guessNumber));
    if (!Number.isSafeInteger(pick) || pick < 1 || pick > session.mode.max) {
      throw new Error(`Vui lòng nhập số nguyên hợp lệ từ **1** đến **${session.mode.max}**!`);
    }

    session.attemptsUsed += 1;
    const remainingAttempts = Math.max(0, session.maxAttempts - session.attemptsUsed);

    if (pick === session.secret) {
      this.guessSessions.delete(uId);
      session.history.push({ attempt: session.attemptsUsed, guess: pick, hint: 'correct' });

      const payoutMult = Number(this.db.getSetting('gamePayoutMultiplier') ?? 1.0);
      const rawReturn = Math.round(session.bet * (session.mode.mult + remainingAttempts * 0.15));
      const profit = rawReturn - session.bet;
      const finalPayout = session.bet + Math.round(profit * payoutMult);
      const net = finalPayout - session.bet;

      const settled = this.db.transaction(() => {
        const user = this.economySystem.ensureUser(uId, username || session.username, now);
        const nextWallet = user.wallet + finalPayout;
        this.db.run(
          `UPDATE users
           SET wallet = ?,
               total_earned = total_earned + ?,
               games_played = games_played + 1,
               games_won = games_won + 1,
               updated_at = ?
           WHERE user_id = ?`,
          [nextWallet, net, now, uId]
        );
        this.db.run(
          `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
           VALUES (?, 'game_win', ?, ?, ?, ?)`,
          [uId, finalPayout, nextWallet, `Thắng Đoán Số #${session.secret} ở lượt ${session.attemptsUsed}/${session.maxAttempts}`, now]
        );
        this.db.run(
          `INSERT INTO game_logs (user_id, game, bet, payout, net, won, detail, created_at)
           VALUES (?, 'guess', ?, ?, ?, 1, ?, ?)`,
          [uId, session.bet, finalPayout, net, `${session.mode.label}: trúng số ${session.secret} sau ${session.attemptsUsed} lượt`, now]
        );

        this.questSystem?.incrementMetric(uId, 'games_played', 1, now);
        this.questSystem?.incrementMetric(uId, 'play_guess', 1, now);
        this.questSystem?.incrementMetric(uId, 'game_wins', 1, now);
        if (net > 0) {
          this.questSystem?.incrementMetric(uId, 'vnd_earned', net, now);
          this.eventSystem?.recordProgress(uId, 'rich_race', net, now);
        }
        const expRes = this.levelSystem?.grantExp(uId, 25, now);
        this.levelSystem?.evaluateMilestoneTitles(uId);

        return { balanceAfter: nextWallet, expRes };
      });

      return {
        finished: true,
        won: true,
        hint: 'correct',
        pick,
        secret: session.secret,
        attemptsUsed: session.attemptsUsed,
        maxAttempts: session.maxAttempts,
        remainingAttempts,
        history: session.history,
        totalBet: session.bet,
        payout: finalPayout,
        net,
        balanceAfter: settled.balanceAfter,
        mode: session.mode,
      };
    }

    const hint = session.secret > pick ? 'higher' : 'lower';
    session.history.push({ attempt: session.attemptsUsed, guess: pick, hint });

    if (remainingAttempts === 0) {
      this.guessSessions.delete(uId);
      const settledLoss = this.db.transaction(() => {
        const user = this.economySystem.ensureUser(uId, username || session.username, now);
        this.db.run(
          `UPDATE users SET games_played = games_played + 1, updated_at = ? WHERE user_id = ?`,
          [now, uId]
        );
        this.db.run(
          `INSERT INTO game_logs (user_id, game, bet, payout, net, won, detail, created_at)
           VALUES (?, 'guess', ?, 0, ?, 0, ?, ?)`,
          [uId, session.bet, -session.bet, `${session.mode.label}: hết ${session.maxAttempts} lượt, số bí mật ${session.secret}`, now]
        );
        this.questSystem?.incrementMetric(uId, 'games_played', 1, now);
        this.questSystem?.incrementMetric(uId, 'play_guess', 1, now);
        this.levelSystem?.grantExp(uId, 10, now);
        return user.wallet;
      });

      return {
        finished: true,
        won: false,
        hint,
        pick,
        secret: session.secret,
        attemptsUsed: session.attemptsUsed,
        maxAttempts: session.maxAttempts,
        remainingAttempts: 0,
        history: session.history,
        totalBet: session.bet,
        payout: 0,
        net: -session.bet,
        balanceAfter: settledLoss,
        mode: session.mode,
      };
    }

    return {
      finished: false,
      won: false,
      hint,
      pick,
      attemptsUsed: session.attemptsUsed,
      maxAttempts: session.maxAttempts,
      remainingAttempts,
      history: session.history,
      totalBet: session.bet,
      mode: session.mode,
    };
  }

  playGuess({ userId, username, difficulty = 'easy', guessNumber, bet, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.GUESS);
    const modes = {
      easy: { max: 5, mult: 4.5, label: 'Dễ (1 - 5)' },
      medium: { max: 10, mult: 9.0, label: 'Trung bình (1 - 10)' },
      hard: { max: 25, mult: 22.0, label: 'Khó (1 - 25)' },
    };
    const mode = modes[difficulty] ?? modes.easy;
    const pick = Math.trunc(Number(guessNumber));
    if (pick < 1 || pick > mode.max) {
      throw new Error(`Ở chế độ **${mode.label}**, vui lòng chọn số từ **1** đến **${mode.max}**!`);
    }

    const cleanBet = this.validateBetAmount(bet);
    const secret = secureInt(1, mode.max);
    const won = pick === secret;
    const rawPayout = won ? Math.round(cleanBet * mode.mult) : 0;

    const settled = this._settleSinglePlayerGame({
      userId,
      username,
      gameId: GAME_IDS.GUESS,
      totalBet: cleanBet,
      rawPayout,
      won,
      detail: `${mode.label}: đoán ${pick}, kết quả ${secret}`,
      now,
    });

    return { ...settled, mode, pick, secret };
  }

  // ==========================================================================
  // ĐUA THÚ (/race) — Tạo khung hình diễn biến cuộc đua từng giai đoạn + thứ hạng chung cuộc
  // ==========================================================================

  playRace({ userId, username, animalId, bet, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.RACE);
    const chosen = RACE_ANIMALS.find((a) => a.id === animalId);
    if (!chosen) throw new Error('Thú đua được chọn không hợp lệ.');

    const cleanBet = this.validateBetAmount(bet);
    const winner = pickOne(RACE_ANIMALS);
    const others = RACE_ANIMALS.filter((a) => a.id !== winner.id);
    // Trộn ngẫu nhiên thứ hạng #2..#5 công bằng bằng crypto.randomInt
    for (let i = others.length - 1; i > 0; i -= 1) {
      const j = secureInt(0, i);
      [others[i], others[j]] = [others[j], others[i]];
    }
    const standings = [winner, ...others];
    const trackLen = 14;

    // Dựng 3 chặng đường đua trực tiếp dẫn tới thứ hạng thật của crypto.randomInt
    const finalScores = new Map([
      [standings[0].id, trackLen],
      [standings[1].id, trackLen - 1],
      [standings[2].id, trackLen - 2],
      [standings[3].id, trackLen - 4],
      [standings[4].id, trackLen - 5],
    ]);

    const frames = [1, 2, 3].map((step) => {
      return RACE_ANIMALS.map((animal, laneIdx) => {
        let pos;
        if (step === 3) {
          pos = finalScores.get(animal.id) ?? 9;
        } else {
          const base = step * 4;
          pos = Math.min(trackLen - 2, base + secureInt(0, 3));
        }
        const filled = '█'.repeat(pos);
        const empty = '░'.repeat(Math.max(0, trackLen - pos));
        const mark = animal.id === chosen.id ? ' ⭐' : '';
        return `\`Làn ${laneIdx + 1}\` [${filled}${animal.emoji}${empty}]🏁 **${animal.name}**${mark}`;
      }).join('\n');
    });

    const won = chosen.id === winner.id;
    const rawPayout = won ? Math.round(cleanBet * 4.5) : 0;

    const settled = this._settleSinglePlayerGame({
      userId,
      username,
      gameId: GAME_IDS.RACE,
      totalBet: cleanBet,
      rawPayout,
      won,
      detail: `Chọn ${chosen.name}, về nhất: ${winner.name}`,
      now,
    });

    return { ...settled, chosen, winner, standings, frames };
  }

  // ==========================================================================
  // OẲN TÙ TÌ (/rps) — Chơi với Bot (PvE) & Thách đấu Người chơi khác (PvP)
  // ==========================================================================

  playRpsBot({ userId, username, choice, bet, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.RPS);
    const userMove = RPS_CHOICES[choice];
    if (!userMove) throw new Error('Lựa chọn Oẳn Tù Tì không hợp lệ.');

    const cleanBet = this.validateBetAmount(bet);
    const botMove = pickOne(Object.values(RPS_CHOICES));

    let rawPayout = 0;
    let outcome = 'lose';
    if (userMove.id === botMove.id) {
      outcome = 'tie';
      rawPayout = cleanBet;
    } else if (userMove.beats === botMove.id) {
      outcome = 'win';
      rawPayout = cleanBet * 2;
    }

    const settled = this._settleSinglePlayerGame({
      userId,
      username,
      gameId: GAME_IDS.RPS,
      totalBet: cleanBet,
      rawPayout,
      won: outcome === 'win',
      detail: `${userMove.name} vs ${botMove.name} (${outcome})`,
      now,
    });

    return { ...settled, userMove, botMove, outcome };
  }

  /**
   * Quyết toán trận Oẳn Tù Tì đối kháng (PvP) giữa 2 người chơi trong 1 Transaction ACID duy nhất.
   */
  settleRpsPvp({
    p1Id,
    p1Name,
    p1Choice,
    p2Id,
    p2Name,
    p2Choice,
    bet,
    now = Date.now(),
  }) {
    this.assertGameAllowed(GAME_IDS.RPS);
    const move1 = RPS_CHOICES[p1Choice];
    const move2 = RPS_CHOICES[p2Choice];
    if (!move1 || !move2) throw new Error('Nước đi PvP không hợp lệ.');

    const cleanBet = this.validateBetAmount(bet);

    return this.db.transaction(() => {
      const u1 = this.economySystem.ensureUser(p1Id, p1Name, now);
      const u2 = this.economySystem.ensureUser(p2Id, p2Name, now);

      this.economySystem.assertCanTransact(u1);
      this.economySystem.assertCanTransact(u2);

      if (u1.wallet < cleanBet) {
        throw new Error(`<@${p1Id}> không còn đủ **${formatVnd(cleanBet)}** để quyết toán trận đấu.`);
      }
      if (u2.wallet < cleanBet) {
        throw new Error(`<@${p2Id}> không còn đủ **${formatVnd(cleanBet)}** để quyết toán trận đấu.`);
      }

      if (move1.id === move2.id) {
        return { outcome: 'tie', winnerId: null, move1, move2, bet: cleanBet };
      }

      const p1Won = move1.beats === move2.id;
      const winner = p1Won ? u1 : u2;
      const loser = p1Won ? u2 : u1;

      const winAfter = winner.wallet + cleanBet;
      const loseAfter = loser.wallet - cleanBet;

      this.db.run(
        `UPDATE users SET wallet = ?, total_wagered = total_wagered + ?, total_earned = total_earned + ?, games_played = games_played + 1, games_won = games_won + 1, updated_at = ? WHERE user_id = ?`,
        [winAfter, cleanBet, cleanBet, now, winner.user_id]
      );
      this.db.run(
        `UPDATE users SET wallet = ?, total_wagered = total_wagered + ?, games_played = games_played + 1, updated_at = ? WHERE user_id = ?`,
        [loseAfter, cleanBet, now, loser.user_id]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'rps_pvp_win', ?, ?, 'Thắng Oẳn Tù Tì PvP', ?)`,
        [winner.user_id, loser.user_id, cleanBet, winAfter, now]
      );
      this.db.run(
        `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
         VALUES (?, ?, 'rps_pvp_loss', ?, ?, 'Thua Oẳn Tù Tì PvP', ?)`,
        [loser.user_id, winner.user_id, -cleanBet, loseAfter, now]
      );

      this.questSystem?.incrementMetric(winner.user_id, 'games_played', 1, now);
      this.questSystem?.incrementMetric(winner.user_id, 'play_rps', 1, now);
      this.questSystem?.incrementMetric(winner.user_id, 'game_wins', 1, now);
      this.questSystem?.incrementMetric(loser.user_id, 'games_played', 1, now);
      this.questSystem?.incrementMetric(loser.user_id, 'play_rps', 1, now);

      return {
        outcome: p1Won ? 'p1' : 'p2',
        winnerId: winner.user_id,
        loserId: loser.user_id,
        move1,
        move2,
        bet: cleanBet,
      };
    });
  }
}
