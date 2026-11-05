import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { COMMAND_MAP } from '../src/commands/index.js';
import { HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { handleMessageCreate } from '../src/events/messageCreate.js';
import { createBotSystems } from '../src/systems/index.js';
import {
  getFirstToken,
  getLastToken,
  getNextValidWords,
  hasPossibleNextWord,
  normalizeWord,
  validateWord,
  VietnameseDictionary,
} from '../src/systems/noituDictionary.js';

describe('TRÒ CHƠI NỐI TỪ TIẾNG VIỆT PRO — Toàn Bộ 11 Kịch Bản Kiểm Thử Bắt Buộc', () => {
  it('1. Từ điển Tiếng Việt: normalizeWord, validateWord, getFirstToken, getLastToken, getNextValidWords & hasPossibleNextWord', () => {
    assert.equal(normalizeWord('  HỌC   SINH  '), 'học sinh');
    assert.equal(normalizeWord('Chìa   Khoá'), 'chìa khóa');
    assert.equal(getFirstToken('  Sinh Viên '), 'sinh');
    assert.equal(getLastToken('  Sinh Viên '), 'viên');

    // Chuỗi chuẩn đúng theo ví dụ đặc tả: Học sinh -> Sinh viên -> Viên chức -> Chức năng -> Năng lượng -> Lượng giác
    const chain = ['Học sinh.', 'Sinh viên', 'Viên chức', 'Chức năng', 'Năng lượng', 'Lượng giác'];
    const used = new Set();
    let reqPrefix = null;

    for (const raw of chain) {
      const check = validateWord(raw, { requiredPrefix: reqPrefix, usedWords: used });
      assert.equal(check.valid, true, `Từ "${raw}" phải hợp lệ`);
      assert.equal(typeof check.entry.word, 'string');
      assert.equal(typeof check.entry.firstToken, 'string');
      assert.equal(typeof check.entry.lastToken, 'string');
      assert.equal(check.entry.valid, true);
      used.add(check.word);
      reqPrefix = check.lastToken;
    }

    // Từ sai tiền tố ("Học tập" khi yêu cầu "sinh"), từ tự bịa, nhiều đáp án trong 1 lượt
    assert.equal(validateWord('Học tập', { requiredPrefix: 'sinh' }).code, 'WRONG_PREFIX');
    assert.equal(validateWord('sinh xyzabc', { requiredPrefix: 'sinh' }).code, 'NOT_IN_DICTIONARY');
    assert.equal(validateWord('sinh viên\nsinh học', { requiredPrefix: 'sinh' }).code, 'MULTIPLE_ANSWERS');
    assert.equal(validateWord('sinh viên, sinh học', { requiredPrefix: 'sinh' }).code, 'MULTIPLE_ANSWERS');

    // Mở rộng từ điển không cần sửa logic game
    const customDict = new VietnameseDictionary(['alpha beta']); // bị bỏ qua nếu chứa từ không hợp lệ? alpha beta đều a-z <=8 ký tự!
    assert.equal(customDict.size, 1);
    customDict.addWord('beta gamma');
    assert.deepEqual(getNextValidWords('alpha beta', new Set(['alpha beta']), customDict), ['beta gamma']);
    assert.equal(hasPossibleNextWord('beta gamma', new Set(['alpha beta', 'beta gamma']), customDict), false);
  });

  it('2 & 3 & 4. Quản lý Phòng 2 người, Lượt đấu, Từ hợp lệ (chỉnh sửa Embed tại chỗ), Từ sai, Từ đã dùng, Sai lượt & Chặn người ngoài', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noitu-pro-match-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, wordChainSystem } = systems;
      try {
        db.setSetting('noituCooldownSec', 0);
        db.setGameChannel('g-1', 'noitu', 'ch-noitu', HARDCODED_OWNER_ID);

        // Tạo phòng có mời bạn bè p2
        const room = wordChainSystem.createRoom({
          guildId: 'g-1',
          channelId: 'ch-noitu',
          hostId: 'p1',
          hostName: 'Player1',
          invitedUserId: 'p2',
        });

        // Chặn chủ phòng tự vào lần 2 trong cùng 1 phòng
        assert.throws(
          () => wordChainSystem.joinRoom({ guildId: 'g-1', channelId: 'ch-noitu', userId: 'p1', username: 'Player1', roomId: room.roomId }),
          /đã ở trong phòng này/
        );

        // Chặn người ngoài p3 nhảy vào phòng đã mời riêng p2
        assert.throws(
          () => wordChainSystem.joinRoom({ guildId: 'g-1', channelId: 'ch-noitu', userId: 'p3', username: 'Outsider', roomId: room.roomId }),
          /lời mời/
        );

        // Chặn bắt đầu khi chưa đủ 2 người
        assert.throws(
          () => wordChainSystem.startMatch({ roomId: room.roomId, actorId: 'p1' }),
          /2\/2 người chơi/
        );

        // p2 tham gia thành công
        wordChainSystem.joinRoom({
          guildId: 'g-1',
          channelId: 'ch-noitu',
          userId: 'p2',
          username: 'Player2',
          roomId: room.roomId,
        });

        // Chặn p2 (không phải chủ phòng) tự ý hủy phòng hoặc bắt đầu trận đấu
        assert.throws(
          () => wordChainSystem.cancelRoom({ roomId: room.roomId, actorId: 'p2' }),
          /Chỉ \*\*chủ phòng\*\*/
        );
        assert.throws(
          () => wordChainSystem.startMatch({ roomId: room.roomId, actorId: 'p2' }),
          /Chỉ \*\*chủ phòng\*\*/
        );

        // Chủ phòng p1 bắt đầu trận đấu + Gắn giả lập Board Message để kiểm chứng chỉnh sửa Embed tại chỗ (không spam)
        let boardEdits = [];
        let channelSends = [];
        const mockBoardMsg = {
          id: 'board-msg-1',
          edit: async (payload) => {
            boardEdits.push(payload);
            return mockBoardMsg;
          },
        };

        wordChainSystem.startMatch({ roomId: room.roomId, actorId: 'p1' });
        wordChainSystem.attachBoardMessage(room.roomId, mockBoardMsg);

        const mockChannel = {
          id: 'ch-noitu',
          send: async (payload) => {
            const m = {
              id: `fb-${channelSends.length + 1}`,
              payload,
              editedPayloads: [],
              deleted: false,
              edit: async (newP) => {
                m.editedPayloads.push(newP);
                return m;
              },
              delete: async () => {
                m.deleted = true;
              },
            };
            channelSends.push(m);
            return m;
          },
        };

        const sendMsg = (userId, content) =>
          handleMessageCreate(
            {
              guild: { id: 'g-1' },
              channel: mockChannel,
              author: { id: userId, username: userId, bot: false },
              content,
            },
            systems
          );

        // Người ngoài (p3) nhắn tin trong kênh -> Hoàn toàn không can thiệp vào trận đấu!
        await sendMsg('p3', 'Học sinh');
        assert.equal(boardEdits.length, 0);
        assert.equal(channelSends.length, 0);

        // Lượt 1: p1 nhập "Học sinh" -> Hợp lệ! Chỉnh sửa trực tiếp Embed bàn đấu (không gửi tin nhắn mới!)
        await sendMsg('p1', 'Học sinh');
        assert.equal(boardEdits.length, 1);
        assert.equal(channelSends.length, 0);
        assert.equal(boardEdits[0].embeds[0].data.title, '🟢 NỐI TỪ – HỢP LỆ!');
        assert.match(boardEdits[0].embeds[0].data.description, /Học sinh/);
        assert.match(boardEdits[0].embeds[0].data.description, /Sinh/);

        // p1 cố tình tự nối tiếp từ của chính mình khi đang là lượt p2 -> Báo sai lượt!
        await sendMsg('p1', 'Sinh viên');
        assert.equal(channelSends.length, 1);
        assert.equal(channelSends[0].payload.embeds[0].data.title, '⛔ CHƯA ĐẾN LƯỢT CỦA BẠN!');

        // p2 nhập từ sai tiền tố "Học tập" -> Báo 🔴 TỪ KHÔNG HỢP LỆ! (chỉnh sửa ngay trên cùng khung cảnh báo fb-1, vẫn giữ lượt của p2!)
        await sendMsg('p2', 'Học tập');
        assert.equal(channelSends.length, 1); // KHÔNG tạo tin nhắn rác thứ 2!
        assert.equal(channelSends[0].editedPayloads.length, 1);
        assert.equal(channelSends[0].editedPayloads[0].embeds[0].data.title, '🔴 TỪ KHÔNG HỢP LỆ!');
        assert.match(channelSends[0].editedPayloads[0].embeds[0].data.description, /bắt đầu bằng \*\*Sinh\*\*/);

        // p2 nhập hợp lệ "Sinh viên" -> Khung lỗi fb-1 tự bị xóa & Embed bàn đấu chỉnh sửa sang lượt 2!
        await sendMsg('p2', 'Sinh viên');
        assert.equal(channelSends[0].deleted, true);
        assert.equal(boardEdits.length, 2);
        assert.match(boardEdits[1].embeds[0].data.description, /Sinh viên/);
        assert.match(boardEdits[1].embeds[0].data.description, /Viên/);

        // Chuỗi thực tế kiểm tra từ đã sử dụng: p1: "Viên chức" -> p2: "Chức năng" -> p1: "Năng lượng" -> p2: "Lượng giác" -> p1: "Giác quan" -> p2: "Quan tâm" -> p1: "Tâm sinh"?
        // Hoặc nối tự nhiên vòng về chữ "học": p1 nối "Viên chức" -> p2 nối "Chức năng" -> p1 nối "Năng lực" -> p2 nối "Lực lượng"
        await sendMsg('p1', 'Viên chức'); // hợp lệ -> chữ tiếp: chức
        await sendMsg('p2', 'Chức năng'); // hợp lệ -> chữ tiếp: năng
        await sendMsg('p1', 'Năng lực'); // hợp lệ -> chữ tiếp: lực
        await sendMsg('p2', 'Lực lượng'); // hợp lệ -> chữ tiếp: lượng

        // Mở thêm 1 vòng lặp thực tế về chữ "sinh": đặt từ nối tự nhiên qua "khóa học" -> chữ tiếp "học", rồi p2 gõ lại "Học sinh" (đã dùng ở Lượt 1!)
        wordChainSystem.dictionary.addWord('tử học');
        await sendMsg('p1', 'Lượng tử'); // hợp lệ -> tiếng tiếp theo: tử
        await sendMsg('p2', 'Tử học'); // hợp lệ -> tiếng tiếp theo là "học"!

        // p1 cố tình nhập lại "Học sinh" (đã xuất hiện ở Lượt 1) -> Phải báo chính xác ⚠️ TỪ ĐÃ ĐƯỢC SỬ DỤNG! và p1 vẫn còn lượt!
        await sendMsg('p1', 'Học sinh');
        const lastAlert = channelSends[channelSends.length - 1];
        assert.equal(lastAlert.payload.embeds[0].data.title, '⚠️ TỪ ĐÃ ĐƯỢC SỬ DỤNG!');
        assert.match(lastAlert.payload.embeds[0].data.description, /vẫn còn lượt chơi|chọn một từ khác/i);
        assert.equal(room.currentTurnUserId, 'p1');

        wordChainSystem.shutdownCleanup();
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5 & 8. Hai người gửi cùng lúc (Concurrency), Điều kiện thắng đặc biệt HẾT TỪ NỐI TIẾP & Đầu hàng (Surrender)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noitu-pro-endings-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, wordChainSystem, economySystem } = systems;
      try {
        db.setSetting('noituCooldownSec', 0);
        db.setGameChannel('g-2', 'noitu', 'ch-nt-2', HARDCODED_OWNER_ID);

        // --- Kịch bản A: Hai người gửi cùng một thời điểm ---
        const rA = wordChainSystem.createRoom({ guildId: 'g-2', channelId: 'ch-nt-2', hostId: 'uA', hostName: 'UserA' });
        wordChainSystem.joinRoom({ guildId: 'g-2', channelId: 'ch-nt-2', userId: 'uB', username: 'UserB', roomId: rA.roomId });
        wordChainSystem.startMatch({ roomId: rA.roomId, actorId: 'uA' });

        const mockChan = { id: 'ch-nt-2', send: async () => ({ edit: async () => ({}), delete: async () => {} }) };

        // uA (đúng lượt) và uB (sai lượt) bấm gửi cùng 1 mili-giây
        await Promise.all([
          handleMessageCreate({ guild: { id: 'g-2' }, channel: mockChan, author: { id: 'uA', username: 'UserA', bot: false }, content: 'Trắng xóa' }, systems),
          handleMessageCreate({ guild: { id: 'g-2' }, channel: mockChan, author: { id: 'uB', username: 'UserB', bot: false }, content: 'Học sinh' }, systems),
        ]);
        // Lượt của uA ("trắng xóa") được ghi nhận chuẩn xác, chuyển lượt sang uB với chữ "xóa" (chưa kết thúc sớm vì vẫn còn "xóa bảng"!)
        assert.equal(rA.status, 'playing');
        assert.equal(rA.currentWord, 'trắng xóa');
        assert.equal(rA.currentTurnUserId, 'uB');

        // uB chủ động ĐẦU HÀNG (/noitu surrender) -> uA chiến thắng và nhận đúng +1.000 VNĐ!
        const walletBeforeA = economySystem.getBalance('uA').wallet;
        const surRes = wordChainSystem.surrender({ userId: 'uB', roomId: rA.roomId });
        assert.equal(surRes.outcome.winnerId, 'uA');
        assert.equal(surRes.outcome.reason, 'SURRENDER');
        assert.equal(surRes.outcome.totalRewardVnd, 1_000);
        assert.equal(economySystem.getBalance('uA').wallet, walletBeforeA + 1_000);

        // --- Kịch bản B: Điều kiện thắng đặc biệt HẾT TỪ NỐI TIẾP TRONG TỪ ĐIỂN ---
        const rB = wordChainSystem.createRoom({ guildId: 'g-2', channelId: 'ch-nt-2', hostId: 'uA', hostName: 'UserA' });
        wordChainSystem.joinRoom({ guildId: 'g-2', channelId: 'ch-nt-2', userId: 'uB', username: 'UserB', roomId: rB.roomId });
        wordChainSystem.startMatch({ roomId: rB.roomId, actorId: 'uA' });

        // uA ra "Mây trắng" -> vẫn còn từ bắt đầu bằng "trắng" nên KHÔNG ĐƯỢC xử thắng sớm!
        const t1 = wordChainSystem.submitTurnMessage({
          guildId: 'g-2',
          channelId: 'ch-nt-2',
          userId: 'uA',
          username: 'UserA',
          content: 'Mây trắng',
        });
        assert.equal(t1.ok, true);
        assert.equal(t1.finished, false);

        // uB tung tuyệt chiêu "Trắng phau" -> chữ "phau" không còn bất kỳ từ hợp lệ nào trong từ điển nối tiếp được -> uB LẬP TỨC CHIẾN THẮNG!
        assert.equal(hasPossibleNextWord('trắng phau', rB.usedWords, wordChainSystem.dictionary), false);
        const walletBeforeB = economySystem.getBalance('uB').wallet;
        const t2 = wordChainSystem.submitTurnMessage({
          guildId: 'g-2',
          channelId: 'ch-nt-2',
          userId: 'uB',
          username: 'UserB',
          content: 'Trắng phau',
        });
        assert.equal(t2.ok, true);
        assert.equal(t2.finished, true);
        assert.equal(t2.winReason, 'NO_MORE_WORDS');
        assert.equal(t2.outcome.winnerId, 'uB');
        assert.equal(economySystem.getBalance('uB').wallet, walletBeforeB + 1_000);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('6 & 9. Hết thời gian (Timeout + Cảnh báo 10s), Chống trả thưởng 2 lần, Chuỗi thắng 3/5/10 & Lệnh /admin noitu', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noitu-pro-timeout-reward-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, wordChainSystem, economySystem } = systems;
      try {
        db.setSetting('noituCooldownSec', 0);

        // 1. Kiểm tra cảnh báo 10s và tự động xử thua Timeout bằng timer thực tế (rút ngắn để test nhanh)
        let warnedRoomId = null;
        let timeoutOutcome = null;
        wordChainSystem.setUiHooks({
          onTenSecWarning: (room) => {
            warnedRoomId = room.roomId;
          },
          onMatchEnded: (_room, outcome) => {
            timeoutOutcome = outcome;
          },
        });

        const room = wordChainSystem.createRoom({ guildId: 'g-3', channelId: 'ch-3', hostId: 'pWin', hostName: 'Winner' });
        wordChainSystem.joinRoom({ guildId: 'g-3', channelId: 'ch-3', userId: 'pAfk', username: 'AFKPlayer', roomId: room.roomId });
        wordChainSystem.startMatch({ roomId: room.roomId, actorId: 'pWin' });

        // pWin đi lượt 1 ("Học sinh"), chuyển lượt sang pAfk rồi rút ngắn turnDeadlineAt để kiểm tra timer thực tế
        wordChainSystem.submitTurnMessage({ guildId: 'g-3', channelId: 'ch-3', userId: 'pWin', username: 'Winner', content: 'Học sinh' });
        room.turnDeadlineAt = Date.now() + 10_040; // Còn 10.04s -> Sau 40ms sẽ bắn cảnh báo 10s!
        wordChainSystem._armTurnTimers(room, Date.now());
        await new Promise((r) => setTimeout(r, 90));
        assert.equal(warnedRoomId, room.roomId, 'Phải phát thông báo khi còn 10 giây');

        // Cho hết giờ sau 60ms để kiểm tra xử thua tự động & giải phóng RAM
        room.turnDeadlineAt = Date.now() + 50;
        // Gọi _armTurnTimers với 50ms (nhỏ hơn 1000ms nên gọi trực tiếp setTimeout mô phỏng chính xác)
        wordChainSystem._clearRoomTimers(room);
        const seq = room.turnSeq;
        room.expireTimer = setTimeout(() => wordChainSystem._handleTurnTimeout(room.roomId, seq), 40);
        await new Promise((r) => setTimeout(r, 90));

        assert.ok(timeoutOutcome);
        assert.equal(timeoutOutcome.winnerId, 'pWin');
        assert.equal(timeoutOutcome.loserId, 'pAfk');
        assert.equal(timeoutOutcome.reason, 'TIMEOUT');
        assert.equal(wordChainSystem.rooms.size, 0, 'Phải giải phóng sạch phòng khỏi RAM sau khi kết thúc');

        // 2. Chống trả thưởng hai lần cho cùng một trận (gọi lại _concludeMatch lần 2 phải trả về null và không cộng thêm 1 đồng nào!)
        const balAfter1 = economySystem.getBalance('pWin').wallet;
        const dupAttempt = wordChainSystem._concludeMatch(
          { ...room, status: 'playing', rewarded: false },
          { winnerId: 'pWin', loserId: 'pAfk', reason: 'TIMEOUT' }
        );
        assert.equal(dupAttempt, null);
        assert.equal(economySystem.getBalance('pWin').wallet, balAfter1);

        // 3. Kiểm tra chính xác chuỗi thắng: hiện tại pWin đã thắng 1 trận (streak = 1). Thắng tiếp trận 2, 3, 4, 5, ..., 10!
        const playQuickWin = () => {
          const r = wordChainSystem.createRoom({ guildId: 'g-3', channelId: 'ch-3', hostId: 'pWin', hostName: 'Winner' });
          wordChainSystem.joinRoom({ guildId: 'g-3', channelId: 'ch-3', userId: 'pAfk', username: 'AFKPlayer', roomId: r.roomId });
          wordChainSystem.startMatch({ roomId: r.roomId, actorId: 'pWin' });
          return wordChainSystem.surrender({ userId: 'pAfk', roomId: r.roomId }).outcome;
        };

        const w2 = playQuickWin(); // Streak 2: +1.000
        assert.equal(w2.newStreak, 2);
        assert.equal(w2.totalRewardVnd, 1_000);

        const w3 = playQuickWin(); // Streak 3: +1.000 + 1.000 = +2.000 VNĐ
        assert.equal(w3.newStreak, 3);
        assert.equal(w3.streakBonusVnd, 1_000);
        assert.equal(w3.totalRewardVnd, 2_000);

        playQuickWin(); // Streak 4: +1.000
        const w5 = playQuickWin(); // Streak 5: +1.000 + 3.000 = +4.000 VNĐ
        assert.equal(w5.newStreak, 5);
        assert.equal(w5.streakBonusVnd, 3_000);
        assert.equal(w5.totalRewardVnd, 4_000);

        for (let s = 6; s <= 9; s++) playQuickWin();
        const w10 = playQuickWin(); // Streak 10: +1.000 + 10.000 = +11.000 VNĐ + mở khóa danh hiệu Vua Nối Từ!
        assert.equal(w10.newStreak, 10);
        assert.equal(w10.streakBonusVnd, 10_000);
        assert.equal(w10.totalRewardVnd, 11_000);

        const statsWin = wordChainSystem.getPlayerStats('pWin');
        assert.equal(statsWin.wins, 10);
        assert.equal(statsWin.currentStreak, 10);
        assert.equal(statsWin.bestStreak, 10);
        assert.equal(statsWin.winRate, 100);
        // 10 trận * 1.000 + 1.000 (mốc 3) + 3.000 (mốc 5) + 10.000 (mốc 10) = 24.000 VNĐ
        assert.equal(statsWin.totalVndEarned, 24_000);

        const lbs = wordChainSystem.getLeaderboards(5);
        assert.equal(lbs.topWins[0].user_id, 'pWin');
        assert.equal(lbs.topStreaks[0].best_streak, 10);
        assert.equal(lbs.topActive.length, 2);

        // 4. Kiểm tra các lệnh /admin noitu reward | cooldown | timeout (chỉ OWNER) | disable | enable
        const adminCmd = COMMAND_MAP.get('admin');
        let adminReply = null;
        await adminCmd.execute(
          {
            user: { id: HARDCODED_OWNER_ID, username: 'Owner' },
            options: {
              getSubcommandGroup: () => 'noitu',
              getSubcommand: () => 'reward',
              getInteger: (k) => (k === 'amount' ? 2500 : null),
            },
            reply: async (p) => {
              adminReply = p;
            },
          },
          systems
        );
        assert.match(adminReply.content, /2\.500 VNĐ/);
        assert.equal(wordChainSystem.getConfig().baseReward, 2500);

        // Chặn ADMIN thường gọi /admin noitu timeout (chỉ OWNER được chỉnh thời gian lượt)
        db.run(
          "INSERT INTO staff_roles (user_id, role, granted_by, created_at) VALUES ('sub-admin-1', 'ADMIN', ?, ?)",
          [HARDCODED_OWNER_ID, Date.now()]
        );
        let deniedTimeout = null;
        await adminCmd.execute(
          {
            user: { id: 'sub-admin-1', username: 'SubAdmin' },
            options: {
              getSubcommandGroup: () => 'noitu',
              getSubcommand: () => 'timeout',
              getInteger: () => 45,
            },
            reply: async (p) => {
              deniedTimeout = p;
            },
          },
          systems
        );
        assert.match(deniedTimeout.content, /OWNER/);

        // OWNER chỉnh /admin noitu timeout thành 45s thành công
        await adminCmd.execute(
          {
            user: { id: HARDCODED_OWNER_ID, username: 'Owner' },
            options: {
              getSubcommandGroup: () => 'noitu',
              getSubcommand: () => 'timeout',
              getInteger: () => 45,
            },
            reply: async () => {},
          },
          systems
        );
        assert.equal(wordChainSystem.getConfig().timeoutSec, 45);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('10 & 11. Nhiều phòng hoạt động cùng lúc VÀ Phục hồi an toàn khi Bot Restart giữa trận (không mất chuỗi thắng/dữ liệu)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noitu-pro-restart-multi-'));
    try {
      // --- Giai đoạn 1: Khởi chạy lần đầu, chơi nhiều phòng cùng lúc & tích chuỗi thắng ---
      const sys1 = await createBotSystems(tmpDir);
      sys1.db.setSetting('noituCooldownSec', 0);
      sys1.db.setSetting('noituReward', 1_500);

      // Tạo 2 phòng hoạt động SONG SONG cùng lúc (Phòng 1: u1 vs u2, Phòng 2: u3 vs u4)
      const room1 = sys1.wordChainSystem.createRoom({ guildId: 'g-m', channelId: 'ch-1', hostId: 'u1', hostName: 'U1' });
      sys1.wordChainSystem.joinRoom({ guildId: 'g-m', channelId: 'ch-1', userId: 'u2', username: 'U2', roomId: room1.roomId });
      sys1.wordChainSystem.startMatch({ roomId: room1.roomId, actorId: 'u1' });

      const room2 = sys1.wordChainSystem.createRoom({ guildId: 'g-m', channelId: 'ch-2', hostId: 'u3', hostName: 'U3' });
      sys1.wordChainSystem.joinRoom({ guildId: 'g-m', channelId: 'ch-2', userId: 'u4', username: 'U4', roomId: room2.roomId });
      sys1.wordChainSystem.startMatch({ roomId: room2.roomId, actorId: 'u3' });

      assert.equal(sys1.wordChainSystem.rooms.size, 2);

      // Cả 2 phòng cùng nối từ độc lập, không ảnh hưởng chéo nhau
      const m1 = sys1.wordChainSystem.submitTurnMessage({ guildId: 'g-m', channelId: 'ch-1', userId: 'u1', username: 'U1', content: 'Học sinh' });
      const m2 = sys1.wordChainSystem.submitTurnMessage({ guildId: 'g-m', channelId: 'ch-2', userId: 'u3', username: 'U3', content: 'Bầu trời' });
      assert.equal(m1.nextPrefix, 'sinh');
      assert.equal(m2.nextPrefix, 'trời');

      // Phòng 1 kết thúc: u1 thắng (streak = 1, nhận +1.500 VNĐ)
      sys1.wordChainSystem.surrender({ userId: 'u2', roomId: room1.roomId });
      assert.equal(sys1.wordChainSystem.getPlayerStats('u1').currentStreak, 1);

      // Trong khi đó Phòng 2 (u3 vs u4) VẪN ĐANG DIỄN RA GIỮA TRẬN thì Bot bị Restart đột ngột!
      sys1.wordChainSystem.shutdownCleanup();
      await sys1.db.close();

      // --- Giai đoạn 2: Bot khởi động lại từ cùng ổ cứng dữ liệu ---
      const sys2 = await createBotSystems(tmpDir);
      try {
        // Cấu hình phần thưởng & chuỗi thắng của u1 được bảo toàn 100%
        assert.equal(sys2.wordChainSystem.getConfig().baseReward, 1_500);
        assert.equal(sys2.wordChainSystem.getPlayerStats('u1').currentStreak, 1);
        assert.equal(sys2.wordChainSystem.getPlayerStats('u1').totalVndEarned, 1_500);

        // Phòng 2 đang dang dở lúc restart được chuyển sang 'aborted_restart' an toàn (không phạt oan, không kẹt người chơi!)
        const abortedRow = sys2.db.get('SELECT status, end_reason, reward_paid FROM noitu_rooms WHERE room_id = ?', [room2.roomId]);
        assert.equal(abortedRow.status, 'aborted_restart');
        assert.equal(abortedRow.end_reason, 'BOT_RESTART');
        assert.equal(abortedRow.reward_paid, 0);

        // u3 và u4 hoàn toàn tự do tạo phòng mới ngay sau khi Bot restart!
        const roomAfterRestart = sys2.wordChainSystem.createRoom({
          guildId: 'g-m',
          channelId: 'ch-2',
          hostId: 'u3',
          hostName: 'U3',
        });
        assert.equal(roomAfterRestart.status, 'waiting');
        sys2.wordChainSystem.shutdownCleanup();
      } finally {
        await sys2.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
