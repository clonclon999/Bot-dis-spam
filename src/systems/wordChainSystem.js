import { GAME_IDS, TITLES } from '../config/constants.js';
import {
  defaultViLexicon,
  isHanVietRestricted,
  parseTwoSyllableViWord,
  VietnameseLexicon,
} from '../config/vietnameseWords.js';
import { formatVnd } from '../utils/format.js';
import { pickOne } from '../utils/rng.js';

/**
 * Hệ thống Trò chơi Nối Từ Tiếng Việt Đời Thường (`WordChainSystem`):
 * - Hỗ trợ 2 chế độ:
 *   1. `bot` (Đấu với Bot): Người chơi nối 1 từ -> Bot đáp lại ngay bằng từ Tiếng Việt đời thường dễ nối.
 *   2. `pvp` (Cộng đồng): Nhiều người chơi nối luân phiên, tích lũy Hũ Thưởng Chuỗi (Pot).
 * - Chặn từ Hán-Việt cổ/khó, tự chuẩn hóa dấu thanh trên điện thoại (`hoà` = `hòa`, `khoá` = `khóa`).
 */
export class WordChainSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   * @param {import('./levelSystem.js').LevelSystem} deps.levelSystem
   * @param {import('./questSystem.js').QuestSystem} deps.questSystem
   * @param {import('./eventSystem.js').EventSystem} deps.eventSystem
   */
  constructor({ db, economySystem, levelSystem, questSystem, eventSystem }) {
    this.db = db;
    this.economySystem = economySystem;
    this.levelSystem = levelSystem;
    this.questSystem = questSystem;
    this.eventSystem = eventSystem;

    this.lexicon = new VietnameseLexicon();
    /** @type {Map<string, object>} Khóa `channelId` -> Phiên chơi đang mở */
    this.sessions = new Map();

    this._loadCustomWordsFromDb();
  }

  _loadCustomWordsFromDb() {
    try {
      const rows = this.db.all('SELECT word FROM wordchain_custom_words');
      if (rows.length > 0) {
        this.lexicon.addCustomWords(rows.map((r) => r.word));
      }
    } catch {
      // Bỏ qua nếu bảng chưa sẵn sàng
    }
  }

  assertEnabled() {
    const enabledMap = this.db.getSetting('gamesEnabled') || {};
    if (enabledMap[GAME_IDS.NOITU] === false) {
      throw new Error('Trò chơi **🔤 Nối Từ Tiếng Việt** hiện đang tạm khóa bảo trì bởi Quản trị viên.');
    }
  }

  getSession(channelId) {
    return this.sessions.get(String(channelId)) ?? null;
  }

  /**
   * Khởi tạo hoặc làm mới ván Nối Từ tại kênh được chỉ định.
   * @param {object} params
   * @param {string} params.guildId
   * @param {string} params.channelId
   * @param {'bot' | 'pvp'} [params.mode='bot']
   * @param {string} params.startedBy
   */
  startSession({ guildId, channelId, mode = 'bot', startedBy }) {
    this.assertEnabled();
    const cleanMode = mode === 'pvp' ? 'pvp' : 'bot';
    const starter = this.lexicon.pickStarterWord(pickOne);
    const [, second] = starter.split(' ');

    const session = {
      guildId: String(guildId),
      channelId: String(channelId),
      mode: cleanMode,
      currentWord: starter,
      nextSyllable: second,
      lastUserId: null,
      lastUsername: null,
      chainLength: 1,
      potVnd: 2_000,
      usedWords: new Set([starter]),
      startedBy: String(startedBy),
      updatedAt: Date.now(),
    };

    this.sessions.set(String(channelId), session);
    return session;
  }

  stopSession(channelId) {
    const existing = this.sessions.get(String(channelId)) ?? null;
    this.sessions.delete(String(channelId));
    return existing;
  }

  skipWord(channelId) {
    this.assertEnabled();
    const session = this.sessions.get(String(channelId));
    if (!session) {
      throw new Error('Hiện chưa có ván Nối Từ nào đang mở! Hãy gõ `/noitu start` để bắt đầu.');
    }

    const starter = this.lexicon.pickStarterWord(pickOne);
    const [, second] = starter.split(' ');
    session.currentWord = starter;
    session.nextSyllable = second;
    session.lastUserId = null;
    session.chainLength = 1;
    session.potVnd = 2_000;
    session.usedWords = new Set([starter]);
    session.updatedAt = Date.now();
    return session;
  }

  /**
   * Thêm từ ghép Tiếng Việt mới vào từ điển bởi ADMIN / OWNER.
   */
  addCustomWord(rawWord, actorId) {
    const parsed = parseTwoSyllableViWord(rawWord);
    if (!parsed.validFormat) {
      throw new Error('Từ thêm vào phải gồm đúng **2 âm tiết tiếng Việt** hợp lệ (ví dụ: `bánh tráng`).');
    }
    if (isHanVietRestricted(parsed.first, parsed.second)) {
      throw new Error(`Từ **"${parsed.word}"** chứa gốc Hán-Việt khó, không phù hợp tiêu chí thuần Việt đời thường.`);
    }
    if (this.lexicon.hasWord(parsed.word)) {
      throw new Error(`Từ **"${parsed.word}"** đã có sẵn trong từ điển rồi!`);
    }

    this.lexicon.addCustomWords([parsed.word]);
    this.db.run(
      'INSERT OR REPLACE INTO wordchain_custom_words (word, added_by, created_at) VALUES (?, ?, ?)',
      [parsed.word, String(actorId), Date.now()]
    );
    return parsed.word;
  }

  /**
   * Mua gợi ý 1 từ hợp lệ (phí 1.000 VNĐ) hiển thị kín cho riêng người hỏi.
   */
  buyHint(channelId, userId, username, now = Date.now()) {
    this.assertEnabled();
    const session = this.sessions.get(String(channelId));
    if (!session) {
      throw new Error('Chưa có ván Nối Từ nào đang chạy trong kênh này! Hãy dùng `/noitu start`.');
    }

    const candidates = this.lexicon.getCandidates(
      session.nextSyllable,
      session.usedWords
    );
    if (candidates.length === 0) {
      throw new Error('Không còn từ nối tiếp nào! Hãy bấm **Đổi Từ Mới** (`/noitu skip`) nhé.');
    }

    const hintFee = 1_000;
    const picked = pickOne(candidates);

    this.db.transaction(() => {
      const u = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(u);
      if (u.wallet < hintFee) {
        throw new Error(`Bạn cần **${formatVnd(hintFee)}** trong ví để xem gợi ý từ nối.`);
      }
      const after = u.wallet - hintFee;
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        after,
        now,
        String(userId),
      ]);
      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'noitu_hint', ?, ?, 'Mua gợi ý Nối Từ', ?)`,
        [String(userId), -hintFee, after, now]
      );
    });

    return { hintWord: picked, fee: hintFee };
  }

  /**
   * Xử lý một tin nhắn người chơi gửi vào kênh `#nối-từ`.
   * Trả về `null` nếu không phải lượt chơi (ví dụ bình luận bắt đầu bằng dấu `.` hoặc chưa mở phòng).
   */
  submitWord({ guildId, channelId, userId, username, content, now = Date.now() }) {
    const session = this.sessions.get(String(channelId));
    if (!session) return null;

    const trimmed = String(content ?? '').trim();
    if (!trimmed) return null;

    // Cho phép người chơi trò chuyện ngoài lề bằng dấu chấm `.` ở đầu câu mà không bị bắt lỗi
    if (/^[.!/?~]/.test(trimmed)) return null;

    const enabledMap = this.db.getSetting('gamesEnabled') || {};
    if (enabledMap[GAME_IDS.NOITU] === false) return null;

    // Bỏ qua các câu chat quá dài (> 4 khoảng trắng)
    if (trimmed.split(/\s+/).length > 4) {
      return {
        ok: false,
        code: 'FORMAT',
        reason: 'Trong kênh Nối Từ, hãy nhập từ ghép **2 tiếng** (hoặc thêm dấu `.` ở đầu nếu muốn chat ngoài lề nhé)!',
      };
    }

    const parsed = parseTwoSyllableViWord(trimmed);
    if (!parsed.validFormat) {
      return {
        ok: false,
        code: 'FORMAT',
        reason: 'Vui lòng nhập đúng **cụm 2 tiếng Tiếng Việt** không kèm số hay ký tự lạ!',
      };
    }

    if (session.mode === 'pvp' && session.lastUserId === String(userId)) {
      return {
        ok: false,
        code: 'SAME_USER',
        reason: 'Ở chế độ **Cộng đồng**, bạn vừa nối lượt trước rồi! Hãy chờ người tiếp theo (hoặc bấm chuyển sang **Đấu với Bot** nếu chơi 1 mình).',
      };
    }

    if (parsed.first !== session.nextSyllable) {
      return {
        ok: false,
        code: 'WRONG_PREFIX',
        reason: `Từ tiếp theo phải bắt đầu bằng chữ **"${session.nextSyllable}"** (từ hiện tại: **${session.currentWord}**)!`,
      };
    }

    if (isHanVietRestricted(parsed.first, parsed.second)) {
      return {
        ok: false,
        code: 'HAN_VIET',
        reason: `Từ **"${parsed.word}"** mang âm Hán-Việt / từ cổ khó! Hãy dùng **từ Tiếng Việt đời thường** gần gũi nhé.`,
      };
    }

    if (session.usedWords.has(parsed.word)) {
      return {
        ok: false,
        code: 'USED',
        reason: `Từ **"${parsed.word}"** đã được nối trong ván này rồi, hãy nghĩ từ khác nhé!`,
      };
    }

    if (!this.lexicon.hasWord(parsed.word)) {
      return {
        ok: false,
        code: 'UNKNOWN_WORD',
        reason: `Từ **"${parsed.word}"** chưa có trong từ điển Tiếng Việt thông dụng (hoặc không có nghĩa)!`,
      };
    }

    // Lượt nối HỢP LỆ!
    session.usedWords.add(parsed.word);
    session.chainLength += 1;
    session.currentWord = parsed.word;
    session.nextSyllable = parsed.second;
    session.lastUserId = String(userId);
    session.lastUsername = username;
    session.updatedAt = now;

    const baseTurnVnd = Math.max(0, Number(this.db.getSetting('noituTurnReward') ?? 500));
    const winBotBonus = Math.max(1000, Number(this.db.getSetting('noituWinBotReward') ?? 15_000));

    // Chế độ 1: Đấu với Bot (PvE)
    if (session.mode === 'bot') {
      const botWord = this.lexicon.pickFriendlyBotReply(
        parsed.second,
        session.usedWords,
        pickOne
      );

      // Người chơi dồn được Bot vào thế bí -> Thắng lớn & tự mở ván mới!
      if (!botWord) {
        const totalPrize = baseTurnVnd + winBotBonus;
        const settled = this._creditWordChainReward({
          userId,
          username,
          vnd: totalPrize,
          exp: 45,
          wonRound: true,
          chainLength: session.chainLength,
          note: `Thắng áp đảo Bot Nối Từ với từ khóa "${parsed.word}"`,
          now,
        });

        const nextStarter = this.lexicon.pickStarterWord(pickOne);
        const [, nextSyl] = nextStarter.split(' ');
        session.currentWord = nextStarter;
        session.nextSyllable = nextSyl;
        session.chainLength = 1;
        session.usedWords = new Set([nextStarter]);
        session.lastUserId = null;

        return {
          ok: true,
          mode: 'bot',
          playerWord: parsed.word,
          roundWon: true,
          prizeVnd: totalPrize,
          balanceAfter: settled.balanceAfter,
          newStarterWord: nextStarter,
          nextSyllable: nextSyl,
        };
      }

      // Bot nối tiếp thành công
      const [, botSecond] = botWord.split(' ');
      session.usedWords.add(botWord);
      session.chainLength += 1;
      session.currentWord = botWord;
      session.nextSyllable = botSecond;

      // Đảm bảo không bao giờ để người chơi kẹt ở âm tiết cụt đường
      const remainingForHuman = this.lexicon.getCandidates(botSecond, session.usedWords);
      let autoResetStarter = null;
      let bonusDraw = 0;

      if (remainingForHuman.length === 0) {
        bonusDraw = 3_000;
        autoResetStarter = this.lexicon.pickStarterWord(pickOne);
        const [, freshSyl] = autoResetStarter.split(' ');
        session.currentWord = autoResetStarter;
        session.nextSyllable = freshSyl;
        session.chainLength = 1;
        session.usedWords = new Set([autoResetStarter]);
        session.lastUserId = null;
      }

      const settled = this._creditWordChainReward({
        userId,
        username,
        vnd: baseTurnVnd + bonusDraw,
        exp: 8,
        wonRound: bonusDraw > 0,
        chainLength: session.chainLength,
        note: `Nối từ "${parsed.word}"`,
        now,
      });

      return {
        ok: true,
        mode: 'bot',
        playerWord: parsed.word,
        botWord,
        roundWon: false,
        autoResetStarter,
        bonusDraw,
        earnedVnd: baseTurnVnd + bonusDraw,
        balanceAfter: settled.balanceAfter,
        nextSyllable: session.nextSyllable,
        chainLength: session.chainLength,
      };
    }

    // Chế độ 2: Nối Từ Cộng Đồng (PvP)
    session.potVnd += 500;
    const remaining = this.lexicon.getCandidates(parsed.second, session.usedWords);

    if (remaining.length === 0) {
      // Người chơi vừa tung ra từ khóa kết liễu ván -> Ẵm trọn Hũ Thưởng Chuỗi!
      const totalPot = baseTurnVnd + session.potVnd;
      const endedChain = session.chainLength;
      const settled = this._creditWordChainReward({
        userId,
        username,
        vnd: totalPot,
        exp: 40,
        wonRound: true,
        chainLength: endedChain,
        note: `Thắng Hũ Nối Từ Cộng Đồng (${endedChain} từ)`,
        now,
      });

      const nextStarter = this.lexicon.pickStarterWord(pickOne);
      const [, nextSyl] = nextStarter.split(' ');
      session.currentWord = nextStarter;
      session.nextSyllable = nextSyl;
      session.chainLength = 1;
      session.potVnd = 2_000;
      session.usedWords = new Set([nextStarter]);
      session.lastUserId = null;

      return {
        ok: true,
        mode: 'pvp',
        playerWord: parsed.word,
        roundWon: true,
        prizeVnd: totalPot,
        endedChain,
        balanceAfter: settled.balanceAfter,
        newStarterWord: nextStarter,
        nextSyllable: nextSyl,
      };
    }

    const settled = this._creditWordChainReward({
      userId,
      username,
      vnd: baseTurnVnd,
      exp: 8,
      wonRound: false,
      chainLength: session.chainLength,
      note: `Nối từ cộng đồng "${parsed.word}"`,
      now,
    });

    return {
      ok: true,
      mode: 'pvp',
      playerWord: parsed.word,
      roundWon: false,
      earnedVnd: baseTurnVnd,
      potVnd: session.potVnd,
      chainLength: session.chainLength,
      nextSyllable: session.nextSyllable,
      balanceAfter: settled.balanceAfter,
    };
  }

  _creditWordChainReward({
    userId,
    username,
    vnd,
    exp,
    wonRound,
    chainLength,
    note,
    now,
  }) {
    return this.db.transaction(() => {
      const u = this.economySystem.ensureUser(userId, username, now);
      // Nếu hệ thống đang đóng băng giao dịch toàn cục thì chỉ ghi nhận điểm không cộng tiền
      const canCredit = !this.db.getSetting('freezeAllTransactions') && !u.is_frozen && !u.is_banned;
      const addVnd = canCredit ? vnd : 0;
      const nextWallet = u.wallet + addVnd;

      this.db.run(
        `UPDATE users
         SET wallet = ?, total_earned = total_earned + ?, games_played = games_played + 1,
             games_won = games_won + ?, updated_at = ?
         WHERE user_id = ?`,
        [nextWallet, addVnd, wonRound ? 1 : 0, now, String(userId)]
      );

      if (addVnd > 0) {
        this.db.run(
          `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
           VALUES (?, 'noitu_reward', ?, ?, ?, ?)`,
          [String(userId), addVnd, nextWallet, note, now]
        );
      }

      const prevStat = this.db.get(
        'SELECT * FROM wordchain_stats WHERE user_id = ?',
        [String(userId)]
      );
      const nextTurns = (prevStat?.correct_turns ?? 0) + 1;
      const nextWins = (prevStat?.rounds_won ?? 0) + (wonRound ? 1 : 0);
      const bestChain = Math.max(prevStat?.best_chain ?? 0, chainLength);
      const totalEarnedStat = (prevStat?.total_vnd ?? 0) + addVnd;

      this.db.run(
        `INSERT OR REPLACE INTO wordchain_stats (user_id, correct_turns, rounds_won, best_chain, total_vnd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [String(userId), nextTurns, nextWins, bestChain, totalEarnedStat, now]
      );

      if (nextTurns >= 25 && TITLES.vua_noi_tu) {
        this.levelSystem?.unlockSpecificTitle(userId, 'vua_noi_tu');
      }

      this.questSystem?.incrementMetric(userId, 'games_played', 1, now);
      if (wonRound) {
        this.questSystem?.incrementMetric(userId, 'game_wins', 1, now);
      }
      if (addVnd > 0) {
        this.questSystem?.incrementMetric(userId, 'vnd_earned', addVnd, now);
        this.eventSystem?.recordProgress(userId, 'rich_race', addVnd, now);
      }
      this.levelSystem?.grantExp(userId, exp, now);

      return { balanceAfter: nextWallet, correctTurns: nextTurns };
    });
  }

  getLeaderboard(limit = 10) {
    return this.db.all(
      `SELECT user_id, correct_turns, rounds_won, best_chain, total_vnd
       FROM wordchain_stats
       ORDER BY correct_turns DESC, rounds_won DESC
       LIMIT ?`,
      [limit]
    );
  }
}
