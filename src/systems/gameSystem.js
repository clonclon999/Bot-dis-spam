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
    const minBet = Number(this.db.getSetting('minBet') ?? 1_000);
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

      // Cập nhật tiến trình nhiệm vụ & sự kiện
      this.questSystem?.incrementMetric(userId, 'games_played', 1, now);
      if (gameId === GAME_IDS.BAUCUA) {
        this.questSystem?.incrementMetric(userId, 'play_baucua', 1, now);
        if (wonFlag) this.eventSystem?.recordProgress(userId, 'baucua_event', 1, now);
      }
      if (gameId === GAME_IDS.TAIXIU) {
        this.questSystem?.incrementMetric(userId, 'play_taixiu', 1, now);
        if (wonFlag) this.eventSystem?.recordProgress(userId, 'taixiu_event', 1, now);
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

    // Luật chuẩn Tài Xỉu 3 xúc xắc: Bộ ba đồng nhất (Bão 3..18) nhà cái ăn; 4-10 = Xỉu; 11-17 = Tài
    let outcome = 'bao';
    if (!isTriple) {
      outcome = sum >= 11 ? 'tai' : 'xiu';
    }

    const won = outcome === choice;
    const rawPayout = won ? cleanBet * 2 : 0;
    const facesStr = dice.map((d) => `${DICE_FACES[d]}(${d})`).join(' ');
    const outcomeLabel = isTriple
      ? `BÃO ${dice[0]} (${sum} điểm)`
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
  // ĐOÁN SỐ (/guess) — Thưởng theo độ khó
  // ==========================================================================

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
  // ĐUA THÚ (/race) — Tạo khung hình diễn biến cuộc đua để cập nhật Embed mượt
  // ==========================================================================

  playRace({ userId, username, animalId, bet, now = Date.now() }) {
    this.assertGameAllowed(GAME_IDS.RACE);
    const chosen = RACE_ANIMALS.find((a) => a.id === animalId);
    if (!chosen) throw new Error('Thú đua được chọn không hợp lệ.');

    const cleanBet = this.validateBetAmount(bet);
    const winner = pickOne(RACE_ANIMALS);
    const trackLen = 12;

    // Dựng 3 khung hình tiến độ chặng đua dẫn tới kết quả thật của crypto.randomInt
    const frames = [1, 2, 3].map((step) => {
      return RACE_ANIMALS.map((animal) => {
        let pos;
        if (step === 3) {
          pos = animal.id === winner.id ? trackLen : secureInt(6, trackLen - 1);
        } else {
          const base = step * 3;
          pos = Math.min(trackLen - 1, base + secureInt(0, 3));
        }
        const bar = `${'━'.repeat(pos)}${animal.emoji}${'─'.repeat(Math.max(0, trackLen - pos))}🏁`;
        return `${bar} **${animal.name}**`;
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

    return { ...settled, chosen, winner, frames };
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
      this.questSystem?.incrementMetric(winner.user_id, 'game_wins', 1, now);
      this.questSystem?.incrementMetric(loser.user_id, 'games_played', 1, now);

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
