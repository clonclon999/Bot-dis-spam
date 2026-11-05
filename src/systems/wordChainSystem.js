import crypto from 'node:crypto';
import { GAME_IDS } from '../config/constants.js';
import { formatVnd } from '../utils/format.js';
import {
  getFirstToken,
  getLastToken,
  normalizeWord,
  VietnameseDictionary,
} from './noituDictionary.js';

const LOBBY_IDLE_EXPIRE_MS = 10 * 60 * 1000; // Tự động hủy phòng chờ bỏ hoang sau 10 phút

/**
 * Hệ Thống Trò Chơi Nối Từ Tiếng Việt PRO (`WordChainSystem`) — Đối kháng 2 người chơi:
 * - Quản lý đa phòng đồng thời (`Map<roomId, Room>`), khóa lượt nghiêm ngặt, chống người ngoài can thiệp.
 * - Từ điển cục bộ O(1) (`VietnameseDictionary`), tự phát hiện trường hợp hết từ nối tiếp để xử thắng ngay.
 * - Bộ đếm thời gian thông minh bằng `setTimeout` đơn lẻ (cảnh báo 10s + xử thua AFK), tuyệt đối không dùng vòng lặp `setInterval`.
 * - Thưởng VNĐ nguyên tử + thưởng chuỗi thắng (3 / 5 / 10 trận), chống cộng thưởng trùng 2 lần 100%.
 * - Lưu bền vững SQLite & phục hồi an toàn khi Bot khởi động lại giữa trận (`aborted_restart`).
 */
export class WordChainSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   * @param {import('./levelSystem.js').LevelSystem} deps.levelSystem
   * @param {import('./questSystem.js').QuestSystem} [deps.questSystem]
   * @param {import('./eventSystem.js').EventSystem} [deps.eventSystem]
   * @param {VietnameseDictionary} [deps.dictionary]
   */
  constructor({ db, economySystem, levelSystem, questSystem, eventSystem, dictionary }) {
    this.db = db;
    this.economySystem = economySystem;
    this.levelSystem = levelSystem;
    this.questSystem = questSystem;
    this.eventSystem = eventSystem;

    this.dictionary = dictionary ?? new VietnameseDictionary();

    /** @type {Map<string, object>} Các phòng đang hoạt động (`waiting` | `playing`) trong RAM */
    this.rooms = new Map();
    /** @type {Map<string, string>} `userId` -> `roomId` đang tham gia */
    this.playerRoomMap = new Map();
    /** @type {Map<string, number>} `userId` -> dấu thời gian kết thúc/tạo phòng gần nhất (cooldown) */
    this.cooldownMap = new Map();

    /**
     * Hook giao diện Discord để tự động cập nhật Embed khi còn 10s hoặc khi hết giờ xử thua AFK.
     * @type {{ onTenSecWarning?: (room: object) => Promise<void> | void, onMatchEnded?: (room: object, outcome: object) => Promise<void> | void }}
     */
    this.uiHooks = {};

    this._loadCustomWordsFromDb();
    this._recoverInterruptedRoomsOnStartup();
  }

  setUiHooks(hooks = {}) {
    this.uiHooks = { ...this.uiHooks, ...hooks };
  }

  _loadCustomWordsFromDb() {
    try {
      const rows = this.db.all('SELECT word FROM wordchain_custom_words');
      if (rows.length > 0) {
        this.dictionary.loadWords(rows.map((r) => r.word));
      }
    } catch {
      // Bỏ qua nếu bảng chưa sẵn sàng
    }
  }

  /**
   * Chính sách an toàn khi Bot khởi động lại giữa trận:
   * - Đóng an toàn các phòng `waiting` / `playing` bị gián đoạn thành `aborted_restart`.
   * - Giữ nguyên 100% chuỗi thắng (`current_streak`), thống kê và số dư VNĐ của cả 2 người chơi.
   * - Giải phóng khóa người chơi để họ có thể tạo phòng mới ngay sau khi Bot online lại.
   */
  _recoverInterruptedRoomsOnStartup(now = Date.now()) {
    try {
      const interrupted = this.db.all(
        "SELECT * FROM noitu_rooms WHERE status IN ('waiting', 'playing')"
      );
      if (interrupted.length === 0) return 0;

      this.db.transaction(() => {
        for (const r of interrupted) {
          this.db.run(
            `UPDATE noitu_rooms
             SET status = 'aborted_restart', end_reason = 'BOT_RESTART', ended_at = ?
             WHERE room_id = ?`,
            [now, r.room_id]
          );

          if (r.status === 'playing' && r.guest_id) {
            this.db.run(
              `INSERT OR IGNORE INTO noitu_matches (
                 room_id, guild_id, channel_id, player1_id, player2_id,
                 winner_id, loser_id, end_reason, total_turns, last_word,
                 words_json, base_reward_vnd, streak_bonus_vnd, total_reward_vnd,
                 winner_streak_after, started_at, ended_at
               ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'BOT_RESTART', ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
              [
                r.room_id,
                r.guild_id,
                r.channel_id,
                r.host_id,
                r.guest_id,
                r.turn_count || 0,
                r.current_word || null,
                r.used_words_json || '[]',
                r.started_at || r.created_at || now,
                now,
              ]
            );
          }
        }
      });

      return interrupted.length;
    } catch {
      return 0;
    }
  }

  // ==========================================================================
  // Cấu hình & Kiểm tra điều kiện
  // ==========================================================================

  isEnabled() {
    const enabledMap = this.db.getSetting('gamesEnabled') || {};
    return enabledMap[GAME_IDS.NOITU] !== false;
  }

  assertEnabled() {
    if (!this.isEnabled()) {
      throw new Error('Trò chơi **🔤 Nối Từ Tiếng Việt PRO** hiện đang tạm khóa bởi Quản trị viên.');
    }
  }

  getConfig() {
    return {
      enabled: this.isEnabled(),
      baseReward: Math.max(0, Math.trunc(Number(this.db.getSetting('noituReward') ?? 1_000))),
      streak3Bonus: Math.max(0, Math.trunc(Number(this.db.getSetting('noituStreak3Bonus') ?? 1_000))),
      streak5Bonus: Math.max(0, Math.trunc(Number(this.db.getSetting('noituStreak5Bonus') ?? 3_000))),
      streak10Bonus: Math.max(0, Math.trunc(Number(this.db.getSetting('noituStreak10Bonus') ?? 10_000))),
      timeoutSec: Math.max(5, Math.trunc(Number(this.db.getSetting('noituTimeoutSec') ?? 30))),
      cooldownSec: Math.max(0, Math.trunc(Number(this.db.getSetting('noituCooldownSec') ?? 5))),
    };
  }

  _checkCooldown(userId, now = Date.now()) {
    const cooldownSec = this.getConfig().cooldownSec;
    if (cooldownSec <= 0) return;

    const prev = this.cooldownMap.get(String(userId)) ?? 0;
    const elapsedMs = now - prev;
    const requiredMs = cooldownSec * 1000;
    if (elapsedMs < requiredMs) {
      const waitSec = Math.ceil((requiredMs - elapsedMs) / 1000);
      throw new Error(`⏳ Vui lòng đợi **${waitSec} giây** trước khi tham gia phòng Nối Từ mới!`);
    }
  }

  _stampCooldown(userId, now = Date.now()) {
    this.cooldownMap.set(String(userId), now);
    if (this.cooldownMap.size > 2000) {
      const cutoff = now - 3600_000;
      for (const [k, ts] of this.cooldownMap.entries()) {
        if (ts < cutoff) this.cooldownMap.delete(k);
      }
    }
  }

  _generateRoomId() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const num = crypto.randomInt(1000, 10000);
      const id = `NT-${num}`;
      if (!this.rooms.has(id)) {
        const existsInDb = this.db.get('SELECT room_id FROM noitu_rooms WHERE room_id = ?', [id]);
        if (!existsInDb) return id;
      }
    }
    return `NT-${Date.now().toString(36).toUpperCase()}`;
  }

  // ==========================================================================
  // Mở rộng từ điển
  // ==========================================================================

  addCustomWord(rawWord, actorId) {
    const norm = normalizeWord(rawWord);
    const tokens = norm ? norm.split(' ') : [];
    if (tokens.length !== 2) {
      throw new Error('Từ thêm vào phải gồm đúng **2 tiếng tiếng Việt** hợp lệ (ví dụ: `bánh tráng`).');
    }
    if (this.dictionary.getEntry(norm)?.valid) {
      throw new Error(`Từ **"${norm}"** đã có sẵn trong từ điển rồi!`);
    }
    const ok = this.dictionary.addWord(norm, true);
    if (!ok && !this.dictionary.getEntry(norm)?.valid) {
      throw new Error('Từ chứa ký tự không hợp lệ.');
    }
    this.db.run(
      'INSERT OR REPLACE INTO wordchain_custom_words (word, added_by, created_at) VALUES (?, ?, ?)',
      [norm, String(actorId), Date.now()]
    );
    return norm;
  }

  // ==========================================================================
  // Quản lý Phòng Chơi (2 Người Chơi, Đa Phòng Đồng Thời)
  // ==========================================================================

  getRoom(roomId) {
    if (!roomId) return null;
    return this.rooms.get(String(roomId).trim().toUpperCase()) ?? null;
  }

  getPlayerActiveRoom(userId) {
    const roomId = this.playerRoomMap.get(String(userId));
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRoomMap.delete(String(userId));
      return null;
    }
    return room;
  }

  getChannelRooms(channelId, statusFilter = null) {
    const out = [];
    const ch = String(channelId);
    for (const room of this.rooms.values()) {
      if (room.channelId === ch && (!statusFilter || room.status === statusFilter)) {
        out.push(room);
      }
    }
    return out;
  }

  attachBoardMessage(roomId, message) {
    const room = this.getRoom(roomId);
    if (!room || !message) return;
    room.boardMessage = message;
    room.boardMessageId = message.id ?? null;
    if (room.boardMessageId) {
      this.db.run('UPDATE noitu_rooms SET board_message_id = ? WHERE room_id = ?', [
        String(room.boardMessageId),
        room.roomId,
      ]);
    }
  }

  /**
   * Tạo phòng Nối Từ mới cho 2 người chơi (có thể mời đích danh bạn bè).
   */
  createRoom({
    guildId,
    channelId,
    hostId,
    hostName,
    invitedUserId = null,
    invitedIsBot = false,
    now = Date.now(),
  }) {
    this.assertEnabled();
    const hId = String(hostId);
    this._checkCooldown(hId, now);

    const existingRoom = this.getPlayerActiveRoom(hId);
    if (existingRoom) {
      throw new Error(
        `Bạn đang tham gia phòng **${existingRoom.roomId}** tại <#${existingRoom.channelId}>! Hãy hoàn tất hoặc hủy phòng đó trước.`
      );
    }

    let invId = invitedUserId ? String(invitedUserId) : null;
    if (invId) {
      if (invitedIsBot) {
        throw new Error('Không thể mời Bot vào phòng đấu Nối Từ 2 người!');
      }
      if (invId === hId) {
        throw new Error('Bạn không thể tự mời chính mình vào cùng một phòng!');
      }
    }

    const u = this.economySystem.ensureUser(hId, hostName || '', now);
    this.economySystem.assertCanTransact(u);

    const roomId = this._generateRoomId();
    const timeoutSec = this.getConfig().timeoutSec;

    const room = {
      roomId,
      guildId: String(guildId),
      channelId: String(channelId),
      boardMessageId: null,
      boardMessage: null,
      feedbackMessage: null,
      hostId: hId,
      hostName: String(hostName || 'Player 1'),
      guestId: null,
      guestName: null,
      invitedUserId: invId,
      status: 'waiting',
      currentTurnUserId: null,
      currentWord: null,
      requiredPrefix: null,
      usedWords: new Set(),
      wordHistory: [],
      turnCount: 0,
      turnSeq: 0,
      turnTimeoutSec: timeoutSec,
      turnDeadlineAt: null,
      rewarded: false,
      lobbyTimer: null,
      warningTimer: null,
      expireTimer: null,
      createdAt: now,
      startedAt: null,
    };

    this.db.run(
      `INSERT INTO noitu_rooms (
         room_id, guild_id, channel_id, host_id, host_name, invited_user_id,
         status, turn_timeout_sec, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      [roomId, room.guildId, room.channelId, room.hostId, room.hostName, room.invitedUserId, timeoutSec, now]
    );

    this.rooms.set(roomId, room);
    this.playerRoomMap.set(hId, roomId);

    // Tự động giải phóng phòng chờ bị bỏ quên sau 10 phút để không rò rỉ RAM
    room.lobbyTimer = setTimeout(() => {
      if (this.rooms.get(roomId)?.status === 'waiting') {
        try {
          this.cancelRoom({ roomId, actorId: hId, forceSystem: true });
        } catch {
          // Bỏ qua
        }
      }
    }, LOBBY_IDLE_EXPIRE_MS);
    room.lobbyTimer.unref?.();

    return room;
  }

  /**
   * Người chơi thứ 2 tham gia phòng chờ.
   */
  joinRoom({ guildId, channelId, userId, username, roomId = null, now = Date.now() }) {
    this.assertEnabled();
    const uId = String(userId);
    this._checkCooldown(uId, now);

    const active = this.getPlayerActiveRoom(uId);
    if (active) {
      if (roomId && active.roomId === String(roomId).trim().toUpperCase()) {
        throw new Error('Bạn đã ở trong phòng này rồi! Không được phép tham gia hai vị trí trong cùng một phòng.');
      }
      throw new Error(
        `Bạn đang ở trong phòng **${active.roomId}** rồi! Mỗi người chỉ được tham gia một phòng tại một thời điểm.`
      );
    }

    let room = null;
    if (roomId) {
      room = this.getRoom(roomId);
      if (!room || room.guildId !== String(guildId)) {
        throw new Error(`Không tìm thấy phòng chờ mang mã **${String(roomId).toUpperCase()}**!`);
      }
    } else {
      const waitingInChannel = this.getChannelRooms(channelId, 'waiting');
      room =
        waitingInChannel.find((r) => r.invitedUserId === uId && !r.guestId) ||
        waitingInChannel.find((r) => !r.invitedUserId && !r.guestId) ||
        waitingInChannel[0] ||
        null;

      if (!room) {
        throw new Error('Hiện không có phòng chờ nào đang mở trong kênh này! Hãy gõ `/noitu create` để tạo phòng mới.');
      }
    }

    if (room.status !== 'waiting') {
      throw new Error(`Phòng **${room.roomId}** đã bắt đầu thi đấu hoặc đã kết thúc!`);
    }
    if (room.hostId === uId || room.guestId === uId) {
      throw new Error('Bạn đã ở trong phòng này rồi! Không được tham gia hai lượt trong cùng một phòng.');
    }
    if (room.guestId) {
      throw new Error(`Phòng **${room.roomId}** đã đủ **2/2** người chơi!`);
    }
    if (room.invitedUserId && room.invitedUserId !== uId) {
      throw new Error(`Phòng **${room.roomId}** đang dành riêng cho lời mời gửi tới <@${room.invitedUserId}>!`);
    }

    const u = this.economySystem.ensureUser(uId, username || '', now);
    this.economySystem.assertCanTransact(u);

    room.guestId = uId;
    room.guestName = String(username || 'Player 2');
    this.playerRoomMap.set(uId, room.roomId);

    this.db.run(
      'UPDATE noitu_rooms SET guest_id = ?, guest_name = ? WHERE room_id = ?',
      [room.guestId, room.guestName, room.roomId]
    );

    return room;
  }

  /**
   * Hủy phòng trước khi trận đấu bắt đầu (CHỈ chủ phòng mới có quyền hủy).
   */
  cancelRoom({ roomId = null, channelId = null, actorId, forceSystem = false, now = Date.now() }) {
    let room = roomId ? this.getRoom(roomId) : this.getPlayerActiveRoom(actorId);
    if (!room && channelId) {
      room = this.getChannelRooms(channelId, 'waiting')[0] ?? null;
    }
    if (!room) {
      throw new Error('Không tìm thấy phòng chờ nào để hủy!');
    }
    if (room.status !== 'waiting') {
      throw new Error('Trận đấu đã bắt đầu, không thể hủy phòng! Hãy dùng `/noitu surrender` nếu muốn đầu hàng.');
    }
    if (!forceSystem && room.hostId !== String(actorId)) {
      throw new Error('⛔ Chỉ **chủ phòng** mới có quyền hủy phòng trước khi trận đấu bắt đầu!');
    }

    this._clearRoomTimers(room);
    room.status = 'cancelled';
    this.rooms.delete(room.roomId);
    this.playerRoomMap.delete(room.hostId);
    if (room.guestId) this.playerRoomMap.delete(room.guestId);

    this.db.run(
      `UPDATE noitu_rooms
       SET status = 'cancelled', end_reason = 'HOST_CANCELLED', ended_at = ?
       WHERE room_id = ?`,
      [now, room.roomId]
    );

    return room;
  }

  /**
   * Chủ phòng bắt đầu trận đấu khi đã đủ 2 người chơi.
   */
  startMatch({ roomId = null, channelId = null, actorId, now = Date.now() }) {
    this.assertEnabled();
    const aId = String(actorId);

    let room = roomId ? this.getRoom(roomId) : this.getPlayerActiveRoom(aId);
    if (!room && channelId) {
      room = this.getChannelRooms(channelId, 'waiting')[0] ?? null;
    }
    if (!room) {
      throw new Error('Không tìm thấy phòng chờ để bắt đầu! Hãy dùng `/noitu create` tạo phòng trước.');
    }
    if (room.status !== 'waiting') {
      throw new Error(`Phòng **${room.roomId}** đã bắt đầu thi đấu rồi!`);
    }
    if (room.hostId !== aId) {
      throw new Error('⛔ Chỉ **chủ phòng** mới có quyền bắt đầu trận đấu!');
    }
    if (!room.guestId) {
      throw new Error('Cần đủ **2/2 người chơi** trong phòng mới có thể bắt đầu trận đấu!');
    }

    this._clearRoomTimers(room);

    const timeoutSec = this.getConfig().timeoutSec;
    room.status = 'playing';
    room.startedAt = now;
    room.currentTurnUserId = room.hostId;
    room.currentWord = null;
    room.requiredPrefix = null;
    room.usedWords = new Set();
    room.wordHistory = [];
    room.turnCount = 0;
    room.turnSeq = 1;
    room.turnTimeoutSec = timeoutSec;
    room.turnDeadlineAt = now + timeoutSec * 1000;

    this.db.run(
      `UPDATE noitu_rooms
       SET status = 'playing',
           current_turn_user_id = ?,
           turn_timeout_sec = ?,
           turn_deadline_at = ?,
           started_at = ?
       WHERE room_id = ?`,
      [room.currentTurnUserId, timeoutSec, room.turnDeadlineAt, now, room.roomId]
    );

    this._armTurnTimers(room, now);
    return room;
  }

  // ==========================================================================
  // Xử lý Lượt Đấu, Kiểm tra Từ Cuối Cùng & Đầu Hàng
  // ==========================================================================

  /**
   * Xử lý tin nhắn trong kênh Nối Từ:
   * - Người ngoài phòng gửi tin nhắn -> trả về `null` (không can thiệp vào trận đấu).
   * - Đúng người trong phòng nhưng sai lượt -> trả về `{ ok: false, code: 'WRONG_TURN' }`.
   * - Đúng lượt -> kiểm tra từ điển, từ lặp, số đáp án và kiểm tra còn từ nối tiếp hay không.
   */
  submitTurnMessage({ guildId, channelId, userId, username, content, now = Date.now() }) {
    const chId = String(channelId);
    const uId = String(userId);

    const playingRooms = this.getChannelRooms(chId, 'playing');
    if (playingRooms.length === 0) return null;

    // Chỉ xét phòng đang thi đấu mà người gửi thực sự là 1 trong 2 tuyển thủ (chặn người ngoài can thiệp!)
    const room = playingRooms.find((r) => r.hostId === uId || r.guestId === uId);
    if (!room) return null;

    const rawText = String(content ?? '').trim();
    if (!rawText) return null;

    const opponentId = uId === room.hostId ? room.guestId : room.hostId;

    // 1. Chặn trả lời khi chưa đến lượt (không được tự nối từ của chính mình)
    if (room.currentTurnUserId !== uId) {
      return {
        ok: false,
        code: 'WRONG_TURN',
        room,
        currentTurnUserId: room.currentTurnUserId,
      };
    }

    // 2. Nếu đồng hồ đã chạm mốc hết giờ trước khi tin nhắn tới -> xử thua Timeout ngay
    if (room.turnDeadlineAt && now >= room.turnDeadlineAt) {
      const outcome = this._concludeMatch(room, {
        winnerId: opponentId,
        loserId: uId,
        reason: 'TIMEOUT',
        now,
      });
      return {
        ok: false,
        code: 'TIMEOUT',
        finished: true,
        room,
        outcome,
      };
    }

    const remainingSec = Math.max(1, Math.ceil((room.turnDeadlineAt - now) / 1000));

    // 3. Kiểm tra từ với Từ điển Tiếng Việt cục bộ
    const check = this.dictionary.validateWord(rawText, {
      requiredPrefix: room.requiredPrefix,
      usedWords: room.usedWords,
    });

    if (!check.valid) {
      return {
        ok: false,
        code: check.code, // 'WRONG_PREFIX' | 'ALREADY_USED' | 'NOT_IN_DICTIONARY' | 'MULTIPLE_ANSWERS' | 'TOO_LONG' | 'SINGLE_TOKEN' | 'INVALID_CHARS'
        word: check.word,
        firstToken: check.firstToken,
        requiredPrefix: room.requiredPrefix,
        remainingSec,
        room,
      };
    }

    // 4. Từ hợp lệ! Ghi nhận vào lịch sử ván hiện tại
    const acceptedWord = check.word;
    const lastToken = getLastToken(acceptedWord);

    room.usedWords.add(acceptedWord);
    room.wordHistory.push({ userId: uId, username: username || '', word: acceptedWord, at: now });
    room.currentWord = acceptedWord;
    room.turnCount += 1;

    // 5. Cơ chế tìm từ cuối cùng (Mục 4): Kiểm tra trong từ điển còn từ hợp lệ nào bắt đầu bằng `lastToken` chưa dùng không
    const stillHasNextWord = this.dictionary.hasPossibleNextWord(lastToken, room.usedWords);

    if (!stillHasNextWord) {
      // Điều kiện kết thúc đặc biệt: Tiếng cuối không còn bất kỳ từ hợp lệ nào nối tiếp được -> Người vừa nối CHIẾN THẮNG!
      const outcome = this._concludeMatch(room, {
        winnerId: uId,
        loserId: opponentId,
        reason: 'NO_MORE_WORDS',
        now,
      });

      return {
        ok: true,
        finished: true,
        winReason: 'NO_MORE_WORDS',
        playerUserId: uId,
        acceptedWord,
        lastToken,
        room,
        outcome,
      };
    }

    // 6. Vẫn còn từ hợp lệ -> Chuyển lượt cho đối thủ và đặt lại đồng hồ đếm ngược
    const timeoutSec = this.getConfig().timeoutSec;
    room.currentTurnUserId = opponentId;
    room.requiredPrefix = lastToken;
    room.turnSeq += 1;
    room.turnTimeoutSec = timeoutSec;
    room.turnDeadlineAt = now + timeoutSec * 1000;

    this.db.run(
      `UPDATE noitu_rooms
       SET current_turn_user_id = ?,
           current_word = ?,
           required_prefix = ?,
           used_words_json = ?,
           turn_count = ?,
           turn_timeout_sec = ?,
           turn_deadline_at = ?
       WHERE room_id = ?`,
      [
        room.currentTurnUserId,
        room.currentWord,
        room.requiredPrefix,
        JSON.stringify([...room.usedWords]),
        room.turnCount,
        room.turnTimeoutSec,
        room.turnDeadlineAt,
        room.roomId,
      ]
    );

    this._armTurnTimers(room, now);

    return {
      ok: true,
      finished: false,
      playerUserId: uId,
      nextTurnUserId: opponentId,
      acceptedWord,
      firstToken: getFirstToken(acceptedWord),
      nextPrefix: lastToken,
      timeoutSec,
      turnCount: room.turnCount,
      room,
    };
  }

  /**
   * Người chơi chủ động chịu thua / đầu hàng (`/noitu surrender` hoặc nút `🏳️ Đầu hàng`).
   */
  surrender({ userId, roomId = null, now = Date.now() }) {
    const uId = String(userId);
    const room = roomId ? this.getRoom(roomId) : this.getPlayerActiveRoom(uId);

    if (!room || room.status !== 'playing') {
      throw new Error('Bạn hiện không ở trong trận đấu Nối Từ nào đang diễn ra để đầu hàng!');
    }
    if (room.hostId !== uId && room.guestId !== uId) {
      throw new Error('⛔ Người ngoài không được phép can thiệp vào trận đấu này!');
    }

    const winnerId = uId === room.hostId ? room.guestId : room.hostId;
    const outcome = this._concludeMatch(room, {
      winnerId,
      loserId: uId,
      reason: 'SURRENDER',
      now,
    });

    return { room, outcome };
  }

  // ==========================================================================
  // Bộ hẹn giờ thông minh chống AFK (Không dùng vòng lặp kiểm tra liên tục)
  // ==========================================================================

  _clearRoomTimers(room) {
    if (!room) return;
    if (room.lobbyTimer) {
      clearTimeout(room.lobbyTimer);
      room.lobbyTimer = null;
    }
    if (room.warningTimer) {
      clearTimeout(room.warningTimer);
      room.warningTimer = null;
    }
    if (room.expireTimer) {
      clearTimeout(room.expireTimer);
      room.expireTimer = null;
    }
  }

  _armTurnTimers(room, now = Date.now()) {
    this._clearRoomTimers(room);
    if (room.status !== 'playing') return;

    const capturedSeq = room.turnSeq;
    const totalMs = Math.max(1_000, room.turnDeadlineAt - now);

    // Hẹn giờ thông báo khi còn đúng 10 giây (nếu tổng thời gian lượt > 10s)
    if (totalMs > 10_000) {
      room.warningTimer = setTimeout(() => {
        if (room.status !== 'playing' || room.turnSeq !== capturedSeq) return;
        Promise.resolve(this.uiHooks.onTenSecWarning?.(room)).catch(() => {});
      }, totalMs - 10_000);
      room.warningTimer.unref?.();
    }

    // Hẹn giờ xử thua tự động khi hết thời gian lượt
    room.expireTimer = setTimeout(() => {
      this._handleTurnTimeout(room.roomId, capturedSeq);
    }, totalMs);
    room.expireTimer.unref?.();
  }

  _handleTurnTimeout(roomId, expectedSeq) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing' || room.turnSeq !== expectedSeq) return null;

    const loserId = room.currentTurnUserId;
    const winnerId = loserId === room.hostId ? room.guestId : room.hostId;

    const outcome = this._concludeMatch(room, {
      winnerId,
      loserId,
      reason: 'TIMEOUT',
      now: Date.now(),
    });

    if (outcome) {
      Promise.resolve(this.uiHooks.onMatchEnded?.(room, outcome)).catch(() => {});
    }
    return outcome;
  }

  // ==========================================================================
  // Kết toán Trận Đấu, Chuỗi Thắng & Trả Thưởng VNĐ Nguyên Tử (Chống Trả 2 Lần)
  // ==========================================================================

  _ensurePlayerStatsRow(userId, username = '', now = Date.now()) {
    const existing = this.db.get('SELECT * FROM noitu_stats WHERE user_id = ?', [String(userId)]);
    if (existing) {
      if (username && existing.username !== username) {
        this.db.run('UPDATE noitu_stats SET username = ? WHERE user_id = ?', [
          username,
          String(userId),
        ]);
      }
      return existing;
    }

    this.db.run(
      `INSERT INTO noitu_stats (
         user_id, username, total_matches, wins, losses,
         current_streak, best_streak, total_turns_played, total_vnd_earned, last_match_at, updated_at
       ) VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      [String(userId), String(username || ''), now]
    );
    return this.db.get('SELECT * FROM noitu_stats WHERE user_id = ?', [String(userId)]);
  }

  /**
   * Kết thúc trận đấu và phát thưởng VNĐ duy nhất đúng 1 lần trong Transaction ACID.
   */
  _concludeMatch(room, { winnerId, loserId, reason, now = Date.now() }) {
    if (!room || room.rewarded || room.status !== 'playing') {
      return null;
    }

    // Đánh dấu đồng bộ ngay lập tức trước mọi thao tác để chặn 100% Race Condition
    room.rewarded = true;
    room.status = 'finished';
    this._clearRoomTimers(room);

    // Giải phóng RAM của phòng & bản đồ khóa người chơi ngay khi kết thúc
    this.rooms.delete(room.roomId);
    this.playerRoomMap.delete(room.hostId);
    if (room.guestId) this.playerRoomMap.delete(room.guestId);
    this._stampCooldown(room.hostId, now);
    if (room.guestId) this._stampCooldown(room.guestId, now);

    const usedWordsArray = [...room.usedWords];
    const winnerName = winnerId === room.hostId ? room.hostName : room.guestName;
    const loserName = loserId === room.hostId ? room.hostName : room.guestName;
    const winnerTurns = room.wordHistory.filter((h) => h.userId === winnerId).length;
    const loserTurns = room.wordHistory.filter((h) => h.userId === loserId).length;
    const lastWord = room.currentWord;
    const totalTurns = room.turnCount;

    // Xóa bộ đệm tạm thời trong đối tượng phòng
    room.usedWords.clear();
    room.wordHistory = [];

    const cfg = this.getConfig();

    const txOutcome = this.db.transaction(() => {
      // Lớp bảo vệ thứ 2 ngay trong SQLite chống trả thưởng 2 lần cho cùng 1 mã phòng
      const dbRoom = this.db.get(
        'SELECT reward_paid, status FROM noitu_rooms WHERE room_id = ?',
        [room.roomId]
      );
      if (!dbRoom || dbRoom.reward_paid === 1 || dbRoom.status === 'finished') {
        return null;
      }

      const winnerUser = this.economySystem.ensureUser(winnerId, winnerName || '', now);
      this.economySystem.ensureUser(loserId, loserName || '', now);

      const winStats = this._ensurePlayerStatsRow(winnerId, winnerName || '', now);
      this._ensurePlayerStatsRow(loserId, loserName || '', now);

      const newStreak = (winStats.current_streak || 0) + 1;
      const newBestStreak = Math.max(winStats.best_streak || 0, newStreak);

      // Tính thưởng chuỗi thắng đúng theo quy định (3 trận: +1.000, 5 trận: +3.000, 10 trận: +10.000)
      let streakBonusVnd = 0;
      if (newStreak === 3) {
        streakBonusVnd = cfg.streak3Bonus;
      } else if (newStreak === 5) {
        streakBonusVnd = cfg.streak5Bonus;
      } else if (newStreak >= 10 && newStreak % 10 === 0) {
        streakBonusVnd = cfg.streak10Bonus;
      }

      const baseRewardVnd = cfg.baseReward;
      const totalRewardVnd = baseRewardVnd + streakBonusVnd;
      const winnerBalanceAfter = winnerUser.wallet + totalRewardVnd;

      // Cộng tiền thắng vào ví người chiến thắng
      this.db.run(
        `UPDATE users
         SET wallet = ?,
             total_earned = total_earned + ?,
             games_played = games_played + 1,
             games_won = games_won + 1,
             updated_at = ?
         WHERE user_id = ?`,
        [winnerBalanceAfter, totalRewardVnd, now, String(winnerId)]
      );

      this.db.run(
        'UPDATE users SET games_played = games_played + 1, updated_at = ? WHERE user_id = ?',
        [now, String(loserId)]
      );

      if (totalRewardVnd > 0) {
        const note =
          streakBonusVnd > 0
            ? `Thắng trận Nối Từ ${room.roomId} (+${formatVnd(baseRewardVnd)} & thưởng chuỗi ${newStreak} trận +${formatVnd(streakBonusVnd)})`
            : `Thắng trận Nối Từ ${room.roomId} (${totalTurns} lượt)`;

        this.db.run(
          `INSERT INTO transactions (user_id, counterparty_id, type, amount, balance_after, note, created_at)
           VALUES (?, ?, 'noitu_win', ?, ?, ?, ?)`,
          [String(winnerId), String(loserId), totalRewardVnd, winnerBalanceAfter, note, now]
        );
      }

      this.db.run(
        `INSERT INTO game_logs (user_id, game, bet, payout, net, won, detail, created_at)
         VALUES (?, 'noitu', 0, ?, ?, 1, ?, ?)`,
        [
          String(winnerId),
          totalRewardVnd,
          totalRewardVnd,
          `Thắng phòng ${room.roomId} (${reason}) sau ${totalTurns} lượt`,
          now,
        ]
      );

      // Cập nhật thống kê Nối Từ của người thắng & người thua
      this.db.run(
        `UPDATE noitu_stats
         SET total_matches = total_matches + 1,
             wins = wins + 1,
             current_streak = ?,
             best_streak = ?,
             total_turns_played = total_turns_played + ?,
             total_vnd_earned = total_vnd_earned + ?,
             last_match_at = ?,
             updated_at = ?
         WHERE user_id = ?`,
        [newStreak, newBestStreak, winnerTurns, totalRewardVnd, now, now, String(winnerId)]
      );

      this.db.run(
        `UPDATE noitu_stats
         SET total_matches = total_matches + 1,
             losses = losses + 1,
             current_streak = 0,
             total_turns_played = total_turns_played + ?,
             last_match_at = ?,
             updated_at = ?
         WHERE user_id = ?`,
        [loserTurns, now, now, String(loserId)]
      );

      // Lưu kết quả phòng & lịch sử trận đấu bền vững
      this.db.run(
        `UPDATE noitu_rooms
         SET status = 'finished',
             current_word = ?,
             used_words_json = ?,
             turn_count = ?,
             winner_id = ?,
             loser_id = ?,
             end_reason = ?,
             reward_vnd = ?,
             streak_bonus_vnd = ?,
             reward_paid = 1,
             ended_at = ?
         WHERE room_id = ?`,
        [
          lastWord,
          JSON.stringify(usedWordsArray),
          totalTurns,
          String(winnerId),
          String(loserId),
          reason,
          baseRewardVnd,
          streakBonusVnd,
          now,
          room.roomId,
        ]
      );

      this.db.run(
        `INSERT INTO noitu_matches (
           room_id, guild_id, channel_id, player1_id, player2_id,
           winner_id, loser_id, end_reason, total_turns, last_word,
           words_json, base_reward_vnd, streak_bonus_vnd, total_reward_vnd,
           winner_streak_after, started_at, ended_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          room.roomId,
          room.guildId,
          room.channelId,
          room.hostId,
          room.guestId,
          String(winnerId),
          String(loserId),
          reason,
          totalTurns,
          lastWord,
          JSON.stringify(usedWordsArray),
          baseRewardVnd,
          streakBonusVnd,
          totalRewardVnd,
          newStreak,
          room.startedAt || room.createdAt,
          now,
        ]
      );

      return {
        roomId: room.roomId,
        winnerId: String(winnerId),
        loserId: String(loserId),
        reason,
        totalTurns,
        lastWord,
        baseRewardVnd,
        streakBonusVnd,
        totalRewardVnd,
        newStreak,
        newBestStreak,
        winnerBalanceAfter,
      };
    });

    if (!txOutcome) return null;

    // Cộng EXP, tiến độ Nhiệm vụ & Danh hiệu ngoài khối lõi
    this.levelSystem?.grantExp?.(winnerId, 30, now);
    this.levelSystem?.grantExp?.(loserId, 10, now);
    this.questSystem?.incrementMetric?.(winnerId, 'games_played', 1, now);
    this.questSystem?.incrementMetric?.(winnerId, 'game_wins', 1, now);
    this.questSystem?.incrementMetric?.(loserId, 'games_played', 1, now);

    const winRow = this.db.get('SELECT wins FROM noitu_stats WHERE user_id = ?', [String(winnerId)]);
    if ((winRow?.wins ?? 0) >= 10) {
      this.levelSystem?.unlockSpecificTitle?.(winnerId, 'vua_noi_tu');
    }

    return txOutcome;
  }

  // ==========================================================================
  // Thống Kê Cá Nhân & 3 Bảng Xếp Hạng Chuyên Biệt (Mục 9)
  // ==========================================================================

  getPlayerStats(userId, username = '') {
    const row = this._ensurePlayerStatsRow(userId, username);
    const totalMatches = row.total_matches || 0;
    const wins = row.wins || 0;
    const losses = row.losses || 0;
    const winRate =
      totalMatches > 0 ? Number(((wins / totalMatches) * 100).toFixed(1)) : 0;

    return {
      userId: String(userId),
      totalMatches,
      wins,
      losses,
      winRate,
      currentStreak: row.current_streak || 0,
      bestStreak: row.best_streak || 0,
      totalTurnsPlayed: row.total_turns_played || 0,
      totalVndEarned: row.total_vnd_earned || 0,
    };
  }

  getLeaderboards(limit = 10) {
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));

    const topWins = this.db.all(
      `SELECT user_id, username, wins, total_matches, best_streak, total_vnd_earned
       FROM noitu_stats
       WHERE wins > 0
       ORDER BY wins DESC, best_streak DESC, total_vnd_earned DESC
       LIMIT ?`,
      [safeLimit]
    );

    const topStreaks = this.db.all(
      `SELECT user_id, username, best_streak, current_streak, wins, total_matches
       FROM noitu_stats
       WHERE best_streak > 0
       ORDER BY best_streak DESC, wins DESC
       LIMIT ?`,
      [safeLimit]
    );

    const topActive = this.db.all(
      `SELECT user_id, username, total_matches, wins, total_turns_played, total_vnd_earned
       FROM noitu_stats
       WHERE total_matches > 0
       ORDER BY total_matches DESC, wins DESC
       LIMIT ?`,
      [safeLimit]
    );

    return { topWins, topStreaks, topActive };
  }

  /**
   * Giải phóng toàn bộ timer trong RAM khi tắt tiến trình Bot.
   */
  shutdownCleanup() {
    for (const room of this.rooms.values()) {
      this._clearRoomTimers(room);
    }
  }
}
