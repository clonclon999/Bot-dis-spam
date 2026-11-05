import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ButtonStyle } from 'discord.js';
import { COMMAND_MAP } from '../src/commands/index.js';
import {
  buildMultiplayerBoardPayload,
  handleMultiplayerComponent,
} from '../src/commands/games/multiplayerRound.js';
import {
  GAME_IDS,
  HARDCODED_OWNER_ID,
  MP_ROUND_STATUS,
} from '../src/config/constants.js';
import { GameDatabase } from '../src/database/db.js';
import { EconomySystem } from '../src/systems/economySystem.js';
import { createBotSystems } from '../src/systems/index.js';
import { MultiplayerRoundSystem } from '../src/systems/multiplayerRoundSystem.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';
import { PanelCleaner } from '../src/utils/panelCleaner.js';

async function closeTestSystems(systems) {
  systems.multiplayerRoundSystem.shutdown();
  systems.noiTuSystem?.shutdown?.();
  await systems.db.close();
}

describe('UPDATE PRO MAX – AUTO STOP WHEN NO PLAYERS (All 7 Mandatory Scenarios)', () => {
  it('1. 1 phiên không có người chơi -> bộ đếm tăng lên 1 (không phát sinh giao dịch, vẫn tự mở phiên thứ 2) & KHÔNG tính phiên bị hủy bởi ADMIN', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t1-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        systems.economySystem.ensureUser('u-member-1', 'MemberOne');
        const txBefore = systems.db.get('SELECT COUNT(*) AS c FROM transactions').c;

        // Phiên bị ADMIN hủy (`CANCELLED`) khi 0 người chơi: TUYỆT ĐỐI KHÔNG ĐƯỢC TÍNH VÀO BỘ ĐẾM!
        const rCancel = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-as-1',
          channelId: 'chan-as-1',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-member-1',
          username: 'MemberOne',
        });
        await systems.multiplayerRoundSystem.stopRound({
          guildId: 'guild-as-1',
          roundId: rCancel.round.round_id,
          actorId: HARDCODED_OWNER_ID,
          reason: 'Kiểm tra hủy phiên không tăng bộ đếm',
        });
        assert.equal(
          systems.multiplayerRoundSystem.getIdleState('guild-as-1', GAME_IDS.BAUCUA).emptyStreak,
          0,
          'Phiên bị hủy bởi ADMIN không được tính vào bộ đếm phiên vắng'
        );

        // Mở phiên thực tế #1 không có ai đặt cược -> kết thúc thật sự (`COMPLETED`)
        const r1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-as-1',
          channelId: 'chan-as-1',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-member-1',
          username: 'MemberOne',
        });
        const snap1 = await systems.multiplayerRoundSystem.finalizeRound(r1.round.round_id, {
          skipAnimation: true,
        });

        // Gọi lặp finalizeRound lần 2 để chứng minh KHÔNG BAO GIỜ đếm trùng cùng 1 phiên
        await systems.multiplayerRoundSystem.finalizeRound(r1.round.round_id, {
          skipAnimation: true,
        });

        const idle1 = systems.multiplayerRoundSystem.getIdleState('guild-as-1', GAME_IDS.BAUCUA);
        assert.equal(idle1.emptyStreak, 1, '1 phiên vắng hoàn tất phải tăng bộ đếm đúng bằng 1');
        assert.equal(idle1.autoPaused, false, 'Mới 1 phiên vắng chưa tạm dừng Auto Next');
        assert.equal(snap1.round.auto_next_state, 'PENDING', 'Phiên thứ 2 vẫn được lên lịch mở tiếp');

        const txAfter = systems.db.get('SELECT COUNT(*) AS c FROM transactions').c;
        assert.equal(txAfter, txBefore, 'Không được phát sinh bất kỳ giao dịch VNĐ nào khi 0 người chơi');
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. 2 phiên liên tiếp không có người chơi -> tự động dừng Auto Next Round + Không tạo phiên thứ 3 + Hiển thị chuẩn thông báo "⏸️ PHÒNG CHƠI TẠM NGỪNG"', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t2-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        // Phiên vắng #1
        const r1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-as-2',
          channelId: 'chan-as-2',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-member-2',
          username: 'MemberTwo',
        });
        await systems.multiplayerRoundSystem.finalizeRound(r1.round.round_id, { skipAnimation: true });

        // Auto Next tự động mở Phiên #2
        const autoR2 = await systems.multiplayerRoundSystem.triggerAutoNextRound(r1.round.round_id);
        assert.equal(autoR2.ok, true, 'Sau 1 phiên vắng, phiên #2 vẫn mở tự động bình thường');
        const r2Id = autoR2.round.round_id;

        // Phiên vắng #2 kết thúc thật sự mà vẫn 0 người đặt cược
        const snap2 = await systems.multiplayerRoundSystem.finalizeRound(r2Id, { skipAnimation: true });

        const idle2 = systems.multiplayerRoundSystem.getIdleState('guild-as-2', GAME_IDS.BAUCUA);
        assert.equal(idle2.emptyStreak, 2, 'Đạt 2 phiên liên tiếp không người chơi');
        assert.equal(idle2.autoPaused, true, 'Auto Next Round của Bầu Cua phải tự động tạm ngừng');
        assert.equal(idle2.prevAutoNextEnabled, true, 'Lưu nguyên trạng thái cấu hình Auto Next trước đó');
        assert.equal(idle2.lastRoundId, r2Id, 'Lưu chính xác Round ID cuối cùng trong DB');
        assert.ok(idle2.pausedAt > 0, 'Lưu thời điểm tạm ngừng trong DB');

        const effCfg = systems.multiplayerRoundSystem.getAutoNextConfig('guild-as-2');
        assert.equal(effCfg.games.baucua, false, 'Auto Next của Bầu Cua đã tắt tự động');

        assert.equal(snap2.round.auto_next_state, 'AUTO_STOPPED_NO_PLAYERS');
        assert.equal(snap2.round.next_round_at, null);

        // Tuyệt đối không tạo thêm phiên thứ 3 kể cả khi cưỡng bức gọi triggerAutoNextRound
        const tryR3 = await systems.multiplayerRoundSystem.triggerAutoNextRound(r2Id);
        assert.equal(tryR3.ok, false);
        assert.equal(
          systems.multiplayerRoundSystem.getActiveRounds('guild-as-2', GAME_IDS.BAUCUA).length,
          0,
          'Tuyệt đối không có phiên thứ 3 nào được tạo tự động'
        );

        // Kiểm tra bảng giao diện Components V2 hiển thị đúng nguyên văn Mục 4 + Tên trò chơi + Round ID cuối cùng
        const boardPayload = buildMultiplayerBoardPayload(snap2, systems, { isEdit: true });
        const checkV2 = validateCv2Payload(boardPayload);
        assert.equal(checkV2.valid, true, `Board V2 lỗi: ${(checkV2.errors || []).join('; ')}`);

        const uiText = extractCv2Text(boardPayload);
        assert.match(uiText, /⏸️ PHÒNG CHƠI TẠM NGỪNG/);
        assert.match(uiText, /Không có người tham gia trong 2 phiên liên tiếp\./);
        assert.match(uiText, /Hệ thống đã tạm dừng tự động mở phiên mới\./);
        assert.match(uiText, /Thành viên có thể nhấn START bất cứ lúc nào để mở lại phòng chơi\./);
        assert.match(uiText, /BẦU CUA TÔM CÁ/);
        assert.ok(uiText.includes(r2Id), 'Phải hiển thị Round ID cuối cùng trên bảng tạm ngừng');
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Có ít nhất 1 người đặt cược hợp lệ -> bộ đếm phiên vắng đặt lại ngay về 0', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t3-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        systems.economySystem.ensureUser('u-bettor-3', 'BettorThree');
        systems.db.run("UPDATE users SET wallet = 100000 WHERE user_id = 'u-bettor-3'");

        // Phiên #1 không ai cược -> empty_streak = 1
        const r1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-as-3',
          channelId: 'chan-as-3',
          gameId: GAME_IDS.TAIXIU,
          userId: 'u-bettor-3',
          username: 'BettorThree',
        });
        await systems.multiplayerRoundSystem.finalizeRound(r1.round.round_id, { skipAnimation: true });
        assert.equal(
          systems.multiplayerRoundSystem.getIdleState('guild-as-3', GAME_IDS.TAIXIU).emptyStreak,
          1
        );

        // Phiên #2 có 1 cược hợp lệ -> empty_streak reset về 0 ngay lập tức và duy trì 0 sau khi hoàn tất!
        const r2 = await systems.multiplayerRoundSystem.triggerAutoNextRound(r1.round.round_id);
        const betRes = await systems.multiplayerRoundSystem.placeBet({
          roundId: r2.round.round_id,
          userId: 'u-bettor-3',
          username: 'BettorThree',
          choice: 'tai',
          amount: 10_000,
        });
        assert.equal(betRes.ok, true);
        assert.equal(
          systems.multiplayerRoundSystem.getIdleState('guild-as-3', GAME_IDS.TAIXIU).emptyStreak,
          0,
          'Bộ đếm phải reset về 0 ngay khi có ít nhất 1 người đặt cược hợp lệ'
        );

        const snap2 = await systems.multiplayerRoundSystem.finalizeRound(r2.round.round_id, {
          skipAnimation: true,
        });
        assert.equal(snap2.round.auto_next_state, 'PENDING');
        assert.equal(
          systems.multiplayerRoundSystem.getIdleState('guild-as-3', GAME_IDS.TAIXIU).emptyStreak,
          0
        );
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Thành viên thường dùng START sau khi tự động dừng -> mở phiên mới bình thường (không cần ADMIN/OWNER) & tự khôi phục Auto Next khi có người đặt cược', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t4-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        const regularMemberId = '999000111222333444'; // Thành viên thường 100%, không có quyền ADMIN/OWNER
        systems.economySystem.ensureUser(regularMemberId, 'RegularPlayer');
        systems.db.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', [regularMemberId]);

        // Đưa phòng Bầu Cua vào trạng thái tự động dừng sau 2 phiên vắng liên tiếp
        const r1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-as-4',
          channelId: 'chan-as-4',
          gameId: GAME_IDS.BAUCUA,
          userId: regularMemberId,
          username: 'RegularPlayer',
        });
        await systems.multiplayerRoundSystem.finalizeRound(r1.round.round_id, { skipAnimation: true });
        const r2 = await systems.multiplayerRoundSystem.triggerAutoNextRound(r1.round.round_id);
        await systems.multiplayerRoundSystem.finalizeRound(r2.round.round_id, { skipAnimation: true });

        assert.equal(
          systems.multiplayerRoundSystem.getIdleState('guild-as-4', GAME_IDS.BAUCUA).autoPaused,
          true
        );

        // Thành viên thường thực thi lệnh Slash `/game start` để mở lại phòng chơi
        const gameCmd = COMMAND_MAP.get('game');
        let startReplyPayload = null;
        const mockStartInteraction = {
          guildId: 'guild-as-4',
          channelId: 'chan-as-4',
          channel: { id: 'chan-as-4', parentId: null },
          user: { id: regularMemberId, username: 'RegularPlayer' },
          replied: false,
          deferred: false,
          options: {
            getSubcommandGroup: () => null,
            getSubcommand: () => 'start',
            getString: (k) => (k === 'tro_choi' ? GAME_IDS.BAUCUA : null),
          },
          reply: async (p) => {
            startReplyPayload = p;
            return { resource: { message: { id: 'msg-reopened-4', edit: async () => {} } } };
          },
        };

        await gameCmd.execute(mockStartInteraction, systems);
        assert.ok(startReplyPayload, 'Thành viên thường phải mở lại được phòng chơi bằng /game start');

        const activeRounds = systems.multiplayerRoundSystem.getActiveRounds(
          'guild-as-4',
          GAME_IDS.BAUCUA
        );
        assert.equal(activeRounds.length, 1, 'Có đúng 1 phiên mới được mở ở trạng thái BETTING');
        const reopenedRound = activeRounds[0];
        assert.notEqual(reopenedRound.round_id, r2.round.round_id, 'Tạo Round ID hoàn toàn mới');
        assert.equal(reopenedRound.status, MP_ROUND_STATUS.BETTING, 'Mở trạng thái nhận cược BETTING');

        // Ngay khi có ít nhất 1 người đặt cược hợp lệ -> reset bộ đếm = 0 & tự kích hoạt lại Auto Next theo cấu hình trước đó!
        const bet = await systems.multiplayerRoundSystem.placeBet({
          roundId: reopenedRound.round_id,
          userId: regularMemberId,
          username: 'RegularPlayer',
          choice: 'cua',
          amount: 15_000,
        });
        assert.equal(bet.ok, true);

        const restoredIdle = systems.multiplayerRoundSystem.getIdleState(
          'guild-as-4',
          GAME_IDS.BAUCUA
        );
        assert.equal(restoredIdle.emptyStreak, 0, 'Bộ đếm phiên vắng đặt lại = 0');
        assert.equal(restoredIdle.autoPaused, false, 'Gỡ cờ tạm ngừng tự động');
        assert.equal(
          systems.multiplayerRoundSystem.getAutoNextConfig('guild-as-4').games.baucua,
          true,
          'Tự động kích hoạt lại Auto Next Round theo cấu hình trước đó'
        );

        // Khi phiên mở lại hoàn tất -> Auto Next tự động lên lịch phiên kế tiếp!
        const snapReopened = await systems.multiplayerRoundSystem.finalizeRound(
          reopenedRound.round_id,
          { skipAnimation: true }
        );
        assert.equal(snapReopened.round.auto_next_state, 'PENDING');
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Bot khởi động lại sau khi đã tự động dừng -> Khôi phục nguyên trạng từ SQLite, KHÔNG tự mở lại phiên mới & KHÔNG tính phiên vắng do restart bất thường', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t5-'));
    try {
      let nowMs = 1_900_000_000_000;
      const db1 = new GameDatabase(tmpDir);
      await db1.init();
      const eco1 = new EconomySystem({ db: db1 });
      const mp1 = new MultiplayerRoundSystem({
        db: db1,
        economySystem: eco1,
        nowFn: () => nowMs,
        animationDelayMs: 0,
      });

      // Bầu Cua đạt 2 phiên vắng liên tiếp -> tự động dừng (`auto_paused = 1`)
      const bc1 = await mp1.startRound({
        guildId: 'guild-as-5',
        channelId: 'chan-bc-5',
        gameId: GAME_IDS.BAUCUA,
        userId: 'u-5',
        username: 'UserFive',
      });
      nowMs += 61_000;
      await mp1.finalizeRound(bc1.round.round_id, { skipAnimation: true });
      const bc2 = await mp1.triggerAutoNextRound(bc1.round.round_id);
      nowMs += 61_000;
      await mp1.finalizeRound(bc2.round.round_id, { skipAnimation: true });

      // Tài Xỉu đang chạy dở 1 phiên 0 người cược thì Bot bị sập/restart bất thường quá hạn!
      const txCrash = await mp1.startRound({
        guildId: 'guild-as-5',
        channelId: 'chan-tx-5',
        gameId: GAME_IDS.TAIXIU,
        userId: 'u-5',
        username: 'UserFive',
      });

      mp1.shutdown();
      await db1.close();

      // Khởi động lại tiến trình Bot mới trên cùng file SQLite (sau khi phiên Tài Xỉu đã quá hạn)
      nowMs += 120_000;
      const db2 = new GameDatabase(tmpDir);
      await db2.init();
      const eco2 = new EconomySystem({ db: db2 });
      const mp2 = new MultiplayerRoundSystem({
        db: db2,
        economySystem: eco2,
        nowFn: () => nowMs,
        animationDelayMs: 0,
      });

      const rec = await mp2.recoverActiveRounds();
      assert.equal(rec.settled, 1, 'Phiên Tài Xỉu quá hạn được tất toán an toàn khi khôi phục');

      // 1) Bầu Cua giữ nguyên trạng thái tạm ngừng từ DB, KHÔNG tự bật lại Auto Next, KHÔNG tạo phiên mới, giữ nguyên lịch sử!
      const bcIdleAfter = mp2.getIdleState('guild-as-5', GAME_IDS.BAUCUA);
      assert.equal(bcIdleAfter.emptyStreak, 2);
      assert.equal(bcIdleAfter.autoPaused, true);
      assert.equal(bcIdleAfter.lastRoundId, bc2.round.round_id);
      assert.equal(mp2.getAutoNextConfig('guild-as-5').games.baucua, false);
      assert.equal(mp2.getActiveRounds('guild-as-5', GAME_IDS.BAUCUA).length, 0);
      assert.equal(mp2.getRecentRounds('guild-as-5', GAME_IDS.BAUCUA, 10).length, 2);

      // 2) Tài Xỉu bị kết thúc do Bot restart bất thường KHÔNG bị cộng oan vào bộ đếm phiên vắng!
      const txIdleAfter = mp2.getIdleState('guild-as-5', GAME_IDS.TAIXIU);
      assert.equal(
        txIdleAfter.emptyStreak,
        0,
        'Phiên kết thúc do Bot restart bất thường không được tính vào bộ đếm phiên vắng'
      );
      assert.ok(
        txCrash.round.round_id,
        'Lịch sử phiên Tài Xỉu vẫn được bảo toàn nguyên vẹn'
      );

      mp2.shutdown();
      await db2.close();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Hai trò chơi khác nhau (Bầu Cua & Tài Xỉu) và hai Server khác nhau -> bộ đếm hoàn toàn độc lập', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t6-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        // Server A - Bầu Cua chạy 2 phiên vắng liên tiếp -> tự động dừng
        const bc1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-A',
          channelId: 'chan-A-bc',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-6',
          username: 'UserSix',
        });
        await systems.multiplayerRoundSystem.finalizeRound(bc1.round.round_id, { skipAnimation: true });
        const bc2 = await systems.multiplayerRoundSystem.triggerAutoNextRound(bc1.round.round_id);
        await systems.multiplayerRoundSystem.finalizeRound(bc2.round.round_id, { skipAnimation: true });

        // Server A - Tài Xỉu mới chạy 1 phiên vắng
        const tx1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-A',
          channelId: 'chan-A-tx',
          gameId: GAME_IDS.TAIXIU,
          userId: 'u-6',
          username: 'UserSix',
        });
        const txSnap1 = await systems.multiplayerRoundSystem.finalizeRound(tx1.round.round_id, {
          skipAnimation: true,
        });

        // Server B - Bầu Cua hoàn toàn chưa có phiên vắng nào
        const idleABc = systems.multiplayerRoundSystem.getIdleState('guild-A', GAME_IDS.BAUCUA);
        const idleATx = systems.multiplayerRoundSystem.getIdleState('guild-A', GAME_IDS.TAIXIU);
        const idleBBc = systems.multiplayerRoundSystem.getIdleState('guild-B', GAME_IDS.BAUCUA);

        assert.equal(idleABc.emptyStreak, 2);
        assert.equal(idleABc.autoPaused, true, 'Bầu Cua ở Server A đã tự động dừng');

        assert.equal(idleATx.emptyStreak, 1);
        assert.equal(idleATx.autoPaused, false, 'Tài Xỉu ở Server A hoàn toàn không bị ảnh hưởng');
        assert.equal(txSnap1.round.auto_next_state, 'PENDING');

        assert.equal(idleBBc.emptyStreak, 0);
        assert.equal(idleBBc.autoPaused, false, 'Bầu Cua ở Server B hoàn toàn độc lập');
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('7. Nhiều người đặt cược cùng thời điểm -> nguyên tử 100%, không đếm sai phiên vắng', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t7-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        // Trước đó phòng đã có 1 phiên vắng (`empty_streak = 1`)
        const emptyFirst = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-as-7',
          channelId: 'chan-as-7',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-init',
          username: 'Starter',
        });
        await systems.multiplayerRoundSystem.finalizeRound(emptyFirst.round.round_id, {
          skipAnimation: true,
        });
        assert.equal(
          systems.multiplayerRoundSystem.getIdleState('guild-as-7', GAME_IDS.BAUCUA).emptyStreak,
          1
        );

        // Phiên kế tiếp: 12 người chơi bấm đặt cược ĐỒNG THỜI (`Promise.all`)
        const rNext = await systems.multiplayerRoundSystem.triggerAutoNextRound(
          emptyFirst.round.round_id
        );
        const doors = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];
        const players = Array.from({ length: 12 }, (_, idx) => `u-conc-${idx + 1}`);
        for (const uid of players) {
          systems.economySystem.ensureUser(uid, uid);
          systems.db.run('UPDATE users SET wallet = 50000 WHERE user_id = ?', [uid]);
        }

        const concurrentBets = await Promise.all(
          players.map((uid, idx) =>
            Promise.resolve().then(() =>
              systems.multiplayerRoundSystem.placeBet({
                roundId: rNext.round.round_id,
                userId: uid,
                username: uid,
                choice: doors[idx % doors.length],
                amount: 5_000,
              })
            )
          )
        );
        assert.ok(concurrentBets.every((b) => b.ok === true), 'Tất cả 12 lệnh cược đồng thời đều hợp lệ');

        const snapDone = await systems.multiplayerRoundSystem.finalizeRound(
          rNext.round.round_id,
          { skipAnimation: true }
        );
        assert.equal(snapDone.round.total_players, 12);
        assert.equal(snapDone.round.auto_next_state, 'PENDING');

        const idleAfter = systems.multiplayerRoundSystem.getIdleState(
          'guild-as-7',
          GAME_IDS.BAUCUA
        );
        assert.equal(idleAfter.emptyStreak, 0, 'Không bao giờ đếm sai phiên vắng khi nhiều người cược cùng lúc');
        assert.equal(idleAfter.autoPaused, false);
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('8. Gộp trực tiếp game start vào /baucua, /taixiu, /race + Đếm ngược 3 -> 2 -> 1 -> HẾT THỜI GIAN! + Ảnh con vật 3D chân thực 400x400', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t8-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        systems.db.setGameChannel('guild-unify', 'baucua', 'chan-baucua', HARDCODED_OWNER_ID);
        systems.economySystem.ensureUser('u-unify-1', 'PlayerA');
        systems.economySystem.ensureUser('u-unify-2', 'PlayerB');
        systems.db.run("UPDATE users SET wallet = 100000 WHERE user_id IN ('u-unify-1', 'u-unify-2')");

        // 1) Thành viên A chỉ cần gõ thẳng `/baucua` trong kênh `#chan-baucua` -> Mở luôn Phiên Cược Chung!
        let openedPayload = null;
        await COMMAND_MAP.get('baucua').execute(
          {
            guildId: 'guild-unify',
            channelId: 'chan-baucua',
            channel: { id: 'chan-baucua', parentId: null },
            user: { id: 'u-unify-1', username: 'PlayerA' },
            replied: false,
            deferred: false,
            options: {
              getString: () => null,
              getInteger: () => null,
            },
            reply: async (p) => {
              openedPayload = p;
              return { resource: { message: { id: 'msg-unify-bc', edit: async () => {} } } };
            },
          },
          systems
        );

        assert.ok(openedPayload);
        assert.equal(validateCv2Payload(openedPayload).valid, true);
        const actives = systems.multiplayerRoundSystem.getActiveRounds('guild-unify', GAME_IDS.BAUCUA);
        assert.equal(actives.length, 1, '/baucua phải tự động mở ngay phiên cược chung như game start');
        const roundId = actives[0].round_id;

        // 2) Thành viên B gõ `/baucua cua:tom tien_cuoc_moi_cua:20000` -> Vào thẳng phiên chung đang mở và đặt 20.000 VNĐ cửa Tôm!
        let receiptPayload = null;
        await COMMAND_MAP.get('baucua').execute(
          {
            guildId: 'guild-unify',
            channelId: 'chan-baucua',
            channel: { id: 'chan-baucua', parentId: null },
            user: { id: 'u-unify-2', username: 'PlayerB' },
            replied: false,
            deferred: false,
            options: {
              getString: (k) => (k === 'cua' ? 'tom' : null),
              getInteger: (k) => (k === 'tien_cuoc_moi_cua' ? 20_000 : null),
            },
            reply: async (p) => {
              receiptPayload = p;
            },
          },
          systems
        );
        assert.ok(receiptPayload);
        assert.equal(validateCv2Payload(receiptPayload).valid, true);
        assert.match(extractCv2Text(receiptPayload), /20\.000 VNĐ.*TÔM|TOM/);

        const snapLive = systems.multiplayerRoundSystem.getRoundSnapshot(roundId);
        assert.equal(snapLive.round.total_players, 1);
        assert.equal(snapLive.round.total_bet_vnd, 20_000);

        // 3) Kiểm tra giao diện đếm ngược 3 -> 2 -> 1 -> HẾT THỜI GIAN!
        const p3 = buildMultiplayerBoardPayload(snapLive, systems, {
          isEdit: true,
          forcedCountdownSec: 3,
        });
        const p2 = buildMultiplayerBoardPayload(snapLive, systems, {
          isEdit: true,
          forcedCountdownSec: 2,
        });
        const p1 = buildMultiplayerBoardPayload(snapLive, systems, {
          isEdit: true,
          forcedCountdownSec: 1,
        });
        assert.match(extractCv2Text(p3), /\[ 3 GIÂY \]/);
        assert.match(extractCv2Text(p2), /\[ 2 GIÂY \]/);
        assert.match(extractCv2Text(p1), /\[ 1 GIÂY CUỐI! \]/);

        const lockedSnap = {
          ...snapLive,
          round: { ...snapLive.round, status: MP_ROUND_STATUS.DRAWING },
        };
        const p0 = buildMultiplayerBoardPayload(lockedSnap, systems, {
          isEdit: true,
          forcedCountdownSec: 0,
        });
        assert.equal(validateCv2Payload(p0).valid, true);
        assert.match(extractCv2Text(p0), /3 ➔ 2 ➔ 1 ➔ HẾT THỜI GIAN!/);
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('9. Bàn Bầu Cua truyền thống 3x2 (Nai•Bầu•Gà / Cá•Cua•Tôm) + 6 nút Blurple mở thẳng Modal nhập tiền + Tự xóa phiên cũ & tự xóa bảng phụ sau vài phút', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autostop-t9-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        systems.db.setGameChannel('g-ui', GAME_IDS.BAUCUA, 'chan-bc-ui');
        systems.economySystem.ensureUser('u-modal-1', 'ModalTester');

        // 1. Kiểm tra kích thước ảnh bàn Bầu Cua truyền thống 3x2 (1080x720) & Kéo-Búa-Bao (360x360)
        const boardBuf = await fsp.readFile(path.resolve('assets/baucua/board_grid.png'));
        assert.equal(boardBuf.readUInt32BE(16), 1080);
        assert.equal(boardBuf.readUInt32BE(20), 720);
        const rpsBuf = await fsp.readFile(path.resolve('assets/rps/paper.png'));
        assert.equal(rpsBuf.readUInt32BE(16), 360);
        assert.equal(rpsBuf.readUInt32BE(20), 360);

        // 2. Mở phiên 1 -> Kiểm tra chỉ đính kèm 1 ảnh bàn Bầu Cua truyền thống & đúng 2 hàng nút Blurple [Nai, Bầu, Gà] / [Cá, Cua, Tôm]
        let r1Deleted = false;
        let r1Msg = null;
        await COMMAND_MAP.get('baucua').execute(
          {
            guildId: 'g-ui',
            channelId: 'chan-bc-ui',
            channel: { id: 'chan-bc-ui', parentId: null },
            user: { id: 'u-modal-1', username: 'ModalTester' },
            replied: false,
            deferred: false,
            options: {
              getString: () => null,
              getInteger: () => null,
            },
            reply: async (payload) => {
              assert.equal(payload.files.length, 1, 'Bàn Bầu Cua gọn nhẹ chỉ đính kèm đúng 1 ảnh bàn truyền thống 3x2');
              const ctrlJson = payload.components[1].toJSON();
              const row1Labels = ctrlJson.components[0].components.map((b) => b.label);
              const row2Labels = ctrlJson.components[1].components.map((b) => b.label);
              assert.deepEqual(row1Labels, ['Nai', 'Bầu', 'Gà']);
              assert.deepEqual(row2Labels, ['Cá', 'Cua', 'Tôm']);
              for (const b of [...ctrlJson.components[0].components, ...ctrlJson.components[1].components]) {
                assert.equal(b.style, ButtonStyle.Primary, 'Tất cả 6 nút linh vật phải mang màu xanh Blurple');
              }
              r1Msg = {
                id: 'msg-r1-live',
                edit: async () => {},
                delete: async () => {
                  r1Deleted = true;
                },
              };
              return { resource: { message: r1Msg } };
            },
          },
          systems
        );

        const activeRound = systems.multiplayerRoundSystem.getActiveRounds('g-ui', GAME_IDS.BAUCUA)[0];
        assert.ok(activeRound);

        // 3. Bấm vào nút cửa bất kỳ -> LUÔN hiện Modal nhập tiền cược (kể cả khi trước đó có chipPref cũ)
        systems.multiplayerRoundSystem.setUserChipPreference('u-modal-1', 50_000);
        let openedModalJson = null;
        await handleMultiplayerComponent(
          {
            customId: `mp:door:${activeRound.round_id}:nai`,
            user: { id: 'u-modal-1', username: 'ModalTester' },
            showModal: async (modal) => {
              openedModalJson = modal.toJSON();
            },
          },
          systems
        );
        assert.ok(openedModalJson, 'Ấn nút cửa phải hiện ngay bảng nhập tiền cược Modal');
        assert.equal(openedModalJson.custom_id, `mp_modal:bet:${activeRound.round_id}:nai`);

        // 4. Đặt cược & tất toán Phiên 1 -> Khi chuyển sang Phiên 2, bảng Phiên 1 tự động bị xóa!
        await systems.multiplayerRoundSystem.placeBet({
          roundId: activeRound.round_id,
          userId: 'u-modal-1',
          username: 'ModalTester',
          choice: 'nai',
          amount: 10_000,
        });

        let r2Sent = false;
        systems.multiplayerRoundSystem.attachClient({
          channels: {
            cache: new Map([
              [
                'chan-bc-ui',
                {
                  id: 'chan-bc-ui',
                  messages: { fetch: async (id) => (id === 'msg-r1-live' ? r1Msg : null) },
                  send: async () => {
                    r2Sent = true;
                    return { id: 'msg-r2-live', edit: async () => {}, delete: async () => {} };
                  },
                },
              ],
            ]),
          },
        });

        await systems.multiplayerRoundSystem.finalizeRound(activeRound.round_id, { skipAnimation: true });
        await systems.multiplayerRoundSystem.triggerAutoNextRound(activeRound.round_id);
        assert.equal(r2Sent, true, 'Phiên 2 đã được đăng');
        assert.equal(r1Deleted, true, 'Bảng kết quả Phiên 1 tự động biến mất khi sang Phiên 2');

        // 5. Các bảng phụ trợ / kết quả mini-game tự động biến mất sau TTL
        const cleaner = new PanelCleaner({ panelTtlMs: 40, resultTtlMs: 30 });
        let auxDeleted = false;
        const auxMsg = {
          id: 'msg-aux-gc',
          delete: async () => {
            auxDeleted = true;
          },
        };
        await cleaner.registerUserPanel({
          channelId: 'chan-bc-ui',
          userId: 'u-modal-1',
          commandName: 'games',
          message: auxMsg,
        });
        assert.equal(auxDeleted, false);
        await new Promise((r) => setTimeout(r, 70));
        assert.equal(auxDeleted, true, 'Bảng phụ trợ tự động biến mất sau thời gian chờ');
        cleaner.clearAllTimers();
      } finally {
        await closeTestSystems(systems);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
