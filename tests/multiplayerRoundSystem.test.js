import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  COMMAND_MAP,
  routeComponentInteraction,
} from '../src/commands/index.js';
import { buildMultiplayerBoardPayload } from '../src/commands/games/multiplayerRound.js';
import {
  BOT_ROLES,
  GAME_IDS,
  HARDCODED_OWNER_ID,
  MP_ROUND_STATUS,
} from '../src/config/constants.js';
import { GameDatabase } from '../src/database/db.js';
import { EconomySystem } from '../src/systems/economySystem.js';
import { handleInteractionCreate } from '../src/events/interactionCreate.js';
import { createBotSystems } from '../src/systems/index.js';
import { MultiplayerRoundSystem } from '../src/systems/multiplayerRoundSystem.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';
import { ASSETS_DIR, ASSET_PATHS } from '../src/utils/assetRegistry.js';

describe('UPDATE PRO MAX – MULTIPLAYER ROUND SYSTEM & PREMIUM 3D VISUALS (PUBLIC START)', () => {
  it('1. PUBLIC START TUYỆT ĐỐI: Mọi thành viên thường (0 role, 0 quyền Admin) đều mở được phiên qua /game start & nút Mở phiên tiếp theo; người mở phiên KHÔNG có quyền quản trị', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-public-start-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        const gameCmd = COMMAND_MAP.get('game');
        assert.ok(gameCmd, 'Phải đăng ký lệnh /game');
        const cmdJson = gameCmd.data.toJSON();
        // TUYỆT ĐỐI KHÔNG gắn default_member_permissions chặn thành viên thường!
        assert.equal(
          cmdJson.default_member_permissions ?? null,
          null,
          'Lệnh /game KHÔNG ĐƯỢC khóa quyền default_member_permissions'
        );

        const normalMember = { id: 'member-normal-001', username: 'RegularMember' };
        const otherMember = { id: 'member-normal-002', username: 'SecondMember' };
        const adminId = 'staff-admin-001';
        systems.db.setStaffRole(adminId, BOT_ROLES.ADMIN, HARDCODED_OWNER_ID);

        // Kiểm tra cấu hình mặc định chuẩn Mục 5: Bầu Cua = 60s, Tài Xỉu = 60s, Đua Thú = 90s
        const defaults = systems.multiplayerRoundSystem.getSettingsSummary();
        assert.equal(defaults.durations.baucua, 60);
        assert.equal(defaults.durations.taixiu, 60);
        assert.equal(defaults.durations.race, 90);

        // Thành viên thường mở phiên Bầu Cua qua /game start
        let publicBoardPayload = null;
        await gameCmd.execute(
          {
            guildId: 'guild-mp-1',
            channelId: 'chan-baucua',
            user: normalMember,
            options: {
              getSubcommand: () => 'start',
              getString: (k) => (k === 'tro_choi' ? GAME_IDS.BAUCUA : null),
            },
            reply: async (p) => {
              publicBoardPayload = p;
              return { id: 'msg-board-bc-1', edit: async (ep) => { publicBoardPayload = ep; } };
            },
          },
          systems
        );

        assert.ok(publicBoardPayload, 'Thành viên thường phải nhận được bảng phiên công khai');
        const checkBoard = validateCv2Payload(publicBoardPayload);
        assert.equal(checkBoard.valid, true, checkBoard.reason);
        const boardTxt = extractCv2Text(publicBoardPayload);
        assert.match(boardTxt, /PHIÊN BẦU CUA TÔM CÁ 3D/);
        assert.match(boardTxt, /RegularMember/);
        assert.match(boardTxt, /BETTING/);

        const actives = systems.multiplayerRoundSystem.getActiveRounds('guild-mp-1', GAME_IDS.BAUCUA);
        assert.equal(actives.length, 1);
        const roundId = actives[0].round_id;
        assert.equal(actives[0].started_by, normalMember.id);

        // BẢO MẬT MỤC 3: Người mở phiên (thành viên thường) KHÔNG ĐƯỢC dừng phiên, gia hạn hay sửa settings!
        const stopAttemptByStarter = await systems.multiplayerRoundSystem.stopRound({
          guildId: 'guild-mp-1',
          roundId,
          actorId: normalMember.id,
          reason: 'Thử dừng trái phép',
        });
        assert.equal(stopAttemptByStarter.ok, false);
        assert.equal(stopAttemptByStarter.code, 'FORBIDDEN_ADMIN_ONLY');

        const extendAttemptByStarter = await systems.multiplayerRoundSystem.extendRound({
          guildId: 'guild-mp-1',
          roundId,
          addSeconds: 30,
          actorId: normalMember.id,
        });
        assert.equal(extendAttemptByStarter.ok, false);
        assert.equal(extendAttemptByStarter.code, 'FORBIDDEN_ADMIN_ONLY');

        const settingsAttemptByStarter = systems.multiplayerRoundSystem.updateSettings({
          actorId: normalMember.id,
          gameId: GAME_IDS.BAUCUA,
          durationSec: 120,
        });
        assert.equal(settingsAttemptByStarter.ok, false);
        assert.equal(settingsAttemptByStarter.code, 'FORBIDDEN_ADMIN_ONLY');

        // Chốt phiên hiện tại để kiểm tra nút `🚀 Mở phiên tiếp theo` (`mp:start_next:baucua`) bởi một thành viên thường khác!
        await systems.multiplayerRoundSystem.finalizeRound(roundId, { skipAnimation: true });

        let nextBoardReply = null;
        const handledNext = await routeComponentInteraction(
          {
            customId: `mp:start_next:${GAME_IDS.BAUCUA}`,
            guildId: 'guild-mp-1',
            channelId: 'chan-baucua',
            user: otherMember,
            isButton: () => true,
            reply: async (p) => {
              nextBoardReply = p;
              return { id: 'msg-board-bc-2', edit: async () => {} };
            },
          },
          systems
        );
        assert.equal(handledNext, true);
        assert.equal(validateCv2Payload(nextBoardReply).valid, true);
        assert.match(extractCv2Text(nextBoardReply), /SecondMember/);

        // Kiểm tra thành viên thường mở tiếp phiên Tài Xỉu (60s) và Đua Thú (90s)
        const txStart = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-mp-1',
          channelId: 'chan-taixiu',
          gameId: GAME_IDS.TAIXIU,
          userId: normalMember.id,
          username: normalMember.username,
        });
        assert.equal(txStart.ok, true);
        assert.equal(txStart.created, true);
        assert.equal(txStart.round.duration_sec, 60);

        const raceStart = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-mp-1',
          channelId: 'chan-race',
          gameId: GAME_IDS.RACE,
          userId: otherMember.id,
          username: otherMember.username,
        });
        assert.equal(raceStart.ok, true);
        assert.equal(raceStart.created, true);
        assert.equal(raceStart.round.duration_sec, 90);
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. Chống tạo trùng phiên khi 10 thành viên bấm START cùng lúc & Đa người chơi đặt cược / sửa / hủy đồng thời an toàn tuyệt đối', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-concurrency-'));
    try {
      let fakeNow = 1_762_340_000_000;
      const db = new GameDatabase(tmpDir);
      await db.init();
      const economySystem = new EconomySystem({ db });
      const mp = new MultiplayerRoundSystem({
        db,
        economySystem,
        nowFn: () => fakeNow,
        animationDelayMs: 0,
      });

      try {
        // 10 thành viên bấm START Bầu Cua ở cùng một micro-giây
        const startCalls = Array.from({ length: 10 }, (_, idx) =>
          mp.startRound({
            guildId: 'guild-race-cond',
            channelId: 'chan-bc',
            gameId: GAME_IDS.BAUCUA,
            userId: `u-starter-${idx + 1}`,
            username: `Starter${idx + 1}`,
          })
        );
        const startResults = await Promise.all(startCalls);
        const createdList = startResults.filter((r) => r.created);
        assert.equal(createdList.length, 1, 'Chỉ được phép tạo ĐÚNG 1 phiên duy nhất!');

        const masterRoundId = createdList[0].round.round_id;
        for (const r of startResults) {
          assert.equal(r.ok, true);
          assert.equal(r.round.round_id, masterRoundId);
        }

        // Cấp 100.000 VNĐ cho 6 người chơi và đặt cược đồng thời vào cùng phiên
        for (let i = 1; i <= 6; i += 1) {
          const uid = `u-bettor-${i}`;
          economySystem.ensureUser(uid, `Bettor${i}`);
          db.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', [uid]);
        }

        const doors = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];
        const betResults = await Promise.all(
          doors.map((door, idx) =>
            mp.placeBet({
              roundId: masterRoundId,
              userId: `u-bettor-${idx + 1}`,
              username: `Bettor${idx + 1}`,
              choice: door,
              amount: 10_000,
            })
          )
        );
        for (const br of betResults) {
          assert.equal(br.ok, true, br.error);
        }

        // Người chơi #1 đặt thêm cửa thứ 2 (`cua`: 15.000 VNĐ) rồi sửa vé cửa `bau` từ 10.000 -> 25.000 VNĐ
        const secondDoor = await mp.placeBet({
          roundId: masterRoundId,
          userId: 'u-bettor-1',
          username: 'Bettor1',
          choice: 'cua',
          amount: 15_000,
        });
        assert.equal(secondDoor.ok, true);
        assert.equal(economySystem.ensureUser('u-bettor-1').wallet, 75_000);

        const p1BauBet = mp.getUserRoundBets(masterRoundId, 'u-bettor-1').find((b) => b.choice === 'bau');
        const edited = await mp.editBet({
          roundId: masterRoundId,
          betId: p1BauBet.bet_id,
          userId: 'u-bettor-1',
          newAmount: 25_000,
        });
        assert.equal(edited.ok, true);
        assert.equal(economySystem.ensureUser('u-bettor-1').wallet, 60_000);

        // Người chơi #2 thử sửa/hủy vé của Người chơi #1 -> BỊ TỪ CHỐI NGHIÊM NGẶT!
        const hijackEdit = await mp.editBet({
          roundId: masterRoundId,
          betId: p1BauBet.bet_id,
          userId: 'u-bettor-2',
          newAmount: 1_000,
        });
        assert.equal(hijackEdit.ok, false);
        assert.equal(hijackEdit.code, 'FORBIDDEN_NOT_OWNER');

        const hijackCancel = await mp.cancelBet({
          roundId: masterRoundId,
          betId: p1BauBet.bet_id,
          userId: 'u-bettor-2',
        });
        assert.equal(hijackCancel.ok, false);
        assert.equal(hijackCancel.code, 'FORBIDDEN_NOT_OWNER');

        // Người chơi #6 tự hủy vé của mình -> Hoàn đủ 100% về 100.000 VNĐ
        const p6Bet = mp.getUserRoundBets(masterRoundId, 'u-bettor-6')[0];
        const cancelOk = await mp.cancelBet({
          roundId: masterRoundId,
          betId: p6Bet.bet_id,
          userId: 'u-bettor-6',
        });
        assert.equal(cancelOk.ok, true);
        assert.equal(economySystem.ensureUser('u-bettor-6').wallet, 100_000);

        const snapBeforeLock = mp.getRoundSnapshot(masterRoundId);
        assert.equal(snapBeforeLock.round.total_players, 5);
        assert.equal(snapBeforeLock.round.total_bet_vnd, 25_000 + 15_000 + 4 * 10_000);

        // Dịch chuyển đồng hồ vượt quá `ends_at` (60s) -> Mọi lệnh đặt/sửa/hủy cược mới bị TỪ CHỐI TỨC THÌ theo DB Timestamp!
        fakeNow += 61_000;
        const lateBet = await mp.placeBet({
          roundId: masterRoundId,
          userId: 'u-bettor-6',
          username: 'Bettor6',
          choice: 'nai',
          amount: 5_000,
        });
        assert.equal(lateBet.ok, false);
        assert.equal(lateBet.code, 'ROUND_LOCKED');

        const lateCancel = await mp.cancelBet({
          roundId: masterRoundId,
          betId: p1BauBet.bet_id,
          userId: 'u-bettor-1',
        });
        assert.equal(lateCancel.ok, false);
        assert.equal(lateCancel.code, 'ROUND_LOCKED');
      } finally {
        mp.shutdown();
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Dùng chung 1 kết quả duy nhất & Toán trả thưởng chính xác 100%: Bầu Cua (2x/3x/4x), Tài Xỉu (2x & Luật 3/18 Nhà cái thắng), Đua Thú (4.5x) & Phiên rỗng 0 giao dịch', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-payout-math-'));
    try {
      const db = new GameDatabase(tmpDir);
      await db.init();
      const economySystem = new EconomySystem({ db });
      const mp = new MultiplayerRoundSystem({
        db,
        economySystem,
        animationDelayMs: 0,
      });

      try {
        for (const uid of ['p1', 'p2', 'p3', 'p4']) {
          economySystem.ensureUser(uid, uid.toUpperCase());
          db.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', [uid]);
        }

        // --- A. BẦU CUA: Kiểm tra kết quả `[cua, cua, bau]` (Cua 2 nháy = 3x, Bầu 1 nháy = 2x, Tôm 0 nháy = 0x) ---
        const bcStart = await mp.startRound({
          guildId: 'g-math',
          channelId: 'c-bc',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p1',
          username: 'P1',
        });
        const bcId = bcStart.round.round_id;

        await mp.placeBet({ roundId: bcId, userId: 'p1', choice: 'cua', amount: 10_000 }); // Thắng 2 nháy -> hoàn 30k (ví 90k + 30k = 120k)
        await mp.placeBet({ roundId: bcId, userId: 'p2', choice: 'bau', amount: 10_000 }); // Thắng 1 nháy -> hoàn 20k (ví 90k + 20k = 110k)
        await mp.placeBet({ roundId: bcId, userId: 'p3', choice: 'tom', amount: 10_000 }); // Thua 0 nháy  -> hoàn 0  (ví 90k)

        // Khóa kết quả chính thức vào DB trước khi settle để kiểm định công thức trả thưởng chính xác
        const fixedBcResult = {
          gameId: GAME_IDS.BAUCUA,
          rolledIds: ['cua', 'cua', 'bau'],
          counts: { bau: 1, cua: 2, tom: 0, ca: 0, ga: 0, nai: 0 },
          isTriple: false,
          generatedAt: Date.now(),
        };
        db.run(
          'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
          [MP_ROUND_STATUS.LOCKED, JSON.stringify(fixedBcResult), bcId]
        );

        // Gọi finalizeRound 4 lần song song để chứng minh CHỐNG TRẢ THƯỞNG KÉP 100%!
        await Promise.all([
          mp.finalizeRound(bcId, { skipAnimation: true }),
          mp.finalizeRound(bcId, { skipAnimation: true }),
          mp.finalizeRound(bcId, { skipAnimation: true }),
          mp.finalizeRound(bcId, { skipAnimation: true }),
        ]);

        assert.equal(economySystem.ensureUser('p1').wallet, 120_000, '2 nháy Bầu Cua phải nhận 3x hoàn trả');
        assert.equal(economySystem.ensureUser('p2').wallet, 110_000, '1 nháy Bầu Cua phải nhận 2x hoàn trả');
        assert.equal(economySystem.ensureUser('p3').wallet, 90_000, '0 nháy mất đúng tiền cược');

        // Kiểm tra Bầu Cua 3 nháy đồng nhất (`[nai, nai, nai]` => 4x hoàn trả!)
        const bcTriple = await mp.startRound({
          guildId: 'g-math',
          channelId: 'c-bc',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p4',
        });
        await mp.placeBet({ roundId: bcTriple.round.round_id, userId: 'p4', choice: 'nai', amount: 10_000 });
        db.run(
          'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
          [
            MP_ROUND_STATUS.LOCKED,
            JSON.stringify({
              gameId: GAME_IDS.BAUCUA,
              rolledIds: ['nai', 'nai', 'nai'],
              counts: { bau: 0, cua: 0, tom: 0, ca: 0, ga: 0, nai: 3 },
              isTriple: true,
              generatedAt: Date.now(),
            }),
            bcTriple.round.round_id,
          ]
        );
        await mp.finalizeRound(bcTriple.round.round_id, { skipAnimation: true });
        assert.equal(economySystem.ensureUser('p4').wallet, 130_000, '3 nháy Bầu Cua phải nhận 4x hoàn trả (90k + 40k = 130k)');

        // --- B. TÀI XỈU: Luật Tổng 11–17 = TÀI (2x) VÀ Luật Bộ Ba 18 (`6-6-6`) = NHÀ CÁI THẮNG ---
        db.run('UPDATE users SET wallet = 100000');
        const txWinRound = await mp.startRound({
          guildId: 'g-math',
          channelId: 'c-tx',
          gameId: GAME_IDS.TAIXIU,
          userId: 'p1',
        });
        await mp.placeBet({ roundId: txWinRound.round.round_id, userId: 'p1', choice: 'tai', amount: 20_000 });
        await mp.placeBet({ roundId: txWinRound.round.round_id, userId: 'p2', choice: 'xiu', amount: 20_000 });
        db.run(
          'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
          [
            MP_ROUND_STATUS.LOCKED,
            JSON.stringify({
              gameId: GAME_IDS.TAIXIU,
              dice: [5, 5, 4],
              sum: 14,
              isTriple: false,
              houseWins: false,
              outcome: 'tai',
              generatedAt: Date.now(),
            }),
            txWinRound.round.round_id,
          ]
        );
        await mp.finalizeRound(txWinRound.round.round_id, { skipAnimation: true });
        assert.equal(economySystem.ensureUser('p1').wallet, 120_000, 'Thắng Tài nhận 2x hoàn trả');
        assert.equal(economySystem.ensureUser('p2').wallet, 80_000, 'Thua Xỉu mất tiền cược');

        // Bão 18 (`6-6-6`): Nhà cái thắng cả TÀI lẫn XỈU
        const txHouseRound = await mp.startRound({
          guildId: 'g-math',
          channelId: 'c-tx',
          gameId: GAME_IDS.TAIXIU,
          userId: 'p3',
        });
        await mp.placeBet({ roundId: txHouseRound.round.round_id, userId: 'p3', choice: 'tai', amount: 15_000 });
        await mp.placeBet({ roundId: txHouseRound.round.round_id, userId: 'p4', choice: 'xiu', amount: 15_000 });
        db.run(
          'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
          [
            MP_ROUND_STATUS.LOCKED,
            JSON.stringify({
              gameId: GAME_IDS.TAIXIU,
              dice: [6, 6, 6],
              sum: 18,
              isTriple: true,
              houseWins: true,
              outcome: 'house',
              generatedAt: Date.now(),
            }),
            txHouseRound.round.round_id,
          ]
        );
        await mp.finalizeRound(txHouseRound.round.round_id, { skipAnimation: true });
        assert.equal(economySystem.ensureUser('p3').wallet, 85_000, 'Tổng 18 Nhà cái thắng');
        assert.equal(economySystem.ensureUser('p4').wallet, 85_000, 'Tổng 18 Nhà cái thắng');

        // --- C. ĐUA THÚ: Hạng #1 nhận 4.5x hoàn trả ---
        db.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', ['p1']);
        const raceRound = await mp.startRound({
          guildId: 'g-math',
          channelId: 'c-race',
          gameId: GAME_IDS.RACE,
          userId: 'p1',
        });
        await mp.placeBet({ roundId: raceRound.round.round_id, userId: 'p1', choice: 'eagle', amount: 10_000 });
        db.run(
          'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
          [
            MP_ROUND_STATUS.LOCKED,
            JSON.stringify({
              gameId: GAME_IDS.RACE,
              winnerId: 'eagle',
              rankingIds: ['eagle', 'horse', 'cheetah', 'wolf', 'tiger'],
              generatedAt: Date.now(),
            }),
            raceRound.round.round_id,
          ]
        );
        await mp.finalizeRound(raceRound.round.round_id, { skipAnimation: true });
        assert.equal(economySystem.ensureUser('p1').wallet, 135_000, 'Đua Thú hạng 1 nhận 4.5x (90k + 45k = 135k)');

        // --- D. PHIÊN KHÔNG CÓ NGƯỜI ĐẶT CƯỢC: Kết thúc sạch, 0 phát sinh giao dịch ---
        const txCountBefore = db.get('SELECT COUNT(*) AS cnt FROM transactions').cnt;
        const emptyRound = await mp.startRound({
          guildId: 'g-math',
          channelId: 'c-tx',
          gameId: GAME_IDS.TAIXIU,
          userId: 'p1',
        });
        const emptySnap = await mp.finalizeRound(emptyRound.round.round_id, { skipAnimation: true });
        const txCountAfter = db.get('SELECT COUNT(*) AS cnt FROM transactions').cnt;
        assert.equal(emptySnap.round.status, MP_ROUND_STATUS.COMPLETED);
        assert.equal(emptySnap.round.total_players, 0);
        assert.equal(txCountAfter, txCountBefore, 'Phiên 0 người chơi KHÔNG phát sinh giao dịch mới');
      } finally {
        mp.shutdown();
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Phục hồi an toàn khi Bot Restart giữa chừng (tiếp tục phiên còn hạn, tự chốt phiên quá hạn & TUYỆT ĐỐI giữ nguyên kết quả đã lưu không quay lại)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-restart-recovery-'));
    try {
      let nowTs = 1_762_350_000_000;
      const db1 = new GameDatabase(tmpDir);
      await db1.init();
      const econ1 = new EconomySystem({ db: db1 });
      const mp1 = new MultiplayerRoundSystem({
        db: db1,
        economySystem: econ1,
        nowFn: () => nowTs,
        animationDelayMs: 0,
      });

      econ1.ensureUser('u-crash-1', 'CrashTester1');
      db1.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', ['u-crash-1']);

      // Phiên 1: Đang BETTING còn thời gian (sẽ được resume sau khi restart)
      const rAlive = await mp1.startRound({
        guildId: 'g-restart',
        channelId: 'c-1',
        gameId: GAME_IDS.BAUCUA,
        userId: 'u-crash-1',
      });

      // Phiên 2: Đang DRAWING dở dang khi Bot sập nguồn — ĐÃ LƯU `result_json` là `[5, 6, 4] = 15 (TÀI)`!
      const rMidDraw = await mp1.startRound({
        guildId: 'g-restart',
        channelId: 'c-2',
        gameId: GAME_IDS.TAIXIU,
        userId: 'u-crash-1',
      });
      await mp1.placeBet({
        roundId: rMidDraw.round.round_id,
        userId: 'u-crash-1',
        choice: 'tai',
        amount: 25_000,
      }); // Ví giảm còn 75.000 VNĐ

      const savedPreCrashResult = {
        gameId: GAME_IDS.TAIXIU,
        dice: [5, 6, 4],
        sum: 15,
        isTriple: false,
        houseWins: false,
        outcome: 'tai',
        generatedAt: nowTs,
      };
      db1.run(
        'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
        [MP_ROUND_STATUS.DRAWING, JSON.stringify(savedPreCrashResult), rMidDraw.round.round_id]
      );

      mp1.shutdown();
      await db1.close();

      // Khởi động lại tiến trình Bot sau 20 giây (Phiên 1 còn 40s, Phiên 2 phải tất toán từ `savedPreCrashResult`!)
      nowTs += 20_000;
      const db2 = new GameDatabase(tmpDir);
      await db2.init();
      const econ2 = new EconomySystem({ db: db2 });
      const mp2 = new MultiplayerRoundSystem({
        db: db2,
        economySystem: econ2,
        nowFn: () => nowTs,
        animationDelayMs: 0,
      });

      try {
        const rec = await mp2.recoverActiveRounds();
        assert.equal(rec.resumed, 1, 'Phải tiếp tục đếm ngược phiên còn thời gian');
        assert.equal(rec.settled, 1, 'Phải tất toán dứt điểm phiên bị kẹt giữa DRAWING');

        const snapAlive = mp2.getRoundSnapshot(rAlive.round.round_id);
        assert.equal(snapAlive.round.status, MP_ROUND_STATUS.BETTING);

        const snapSettled = mp2.getRoundSnapshot(rMidDraw.round.round_id);
        assert.equal(snapSettled.round.status, MP_ROUND_STATUS.COMPLETED);
        assert.deepEqual(
          snapSettled.round.result.dice,
          [5, 6, 4],
          'TUYỆT ĐỐI KHÔNG được sinh lại kết quả mới nếu kết quả đã lưu trong DB!'
        );
        // Ví 75.000 + hoàn 50.000 (2x của 25.000) = 125.000 VNĐ (không thiếu, không cộng đúp!)
        assert.equal(econ2.ensureUser('u-crash-1').wallet, 125_000);
      } finally {
        mp2.shutdown();
        await db2.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. ADMIN/OWNER STOP hoàn tiền 100% chống hoàn đúp, EXTEND, OWNER-only Multi-Table & Kiểm định Components V2 + 84 Tài nguyên 3D (Zero Boss Fight)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-admin-visuals-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        const adminId = 'admin-pro-99';
        systems.db.setStaffRole(adminId, BOT_ROLES.ADMIN, HARDCODED_OWNER_ID);
        systems.economySystem.ensureUser('u-ref-1', 'Ref1');
        systems.economySystem.ensureUser('u-ref-2', 'Ref2');
        systems.db.run("UPDATE users SET wallet = 50000 WHERE user_id IN ('u-ref-1', 'u-ref-2')");

        const started = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm',
          channelId: 'c-adm',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-ref-1',
        });
        const rid = started.round.round_id;
        await systems.multiplayerRoundSystem.placeBet({ roundId: rid, userId: 'u-ref-1', choice: 'bau', amount: 20_000 });
        await systems.multiplayerRoundSystem.placeBet({ roundId: rid, userId: 'u-ref-2', choice: 'cua', amount: 30_000 });

        // ADMIN gia hạn thêm +25 giây
        const extRes = await systems.multiplayerRoundSystem.extendRound({
          guildId: 'g-adm',
          roundId: rid,
          addSeconds: 25,
          actorId: adminId,
        });
        assert.equal(extRes.ok, true);
        assert.equal(extRes.snapshot.round.duration_sec, 85);

        // ADMIN dừng khẩn cấp phiên -> Hoàn 100% tiền về đúng 50.000 VNĐ cho cả 2 người chơi
        const stop1 = await systems.multiplayerRoundSystem.stopRound({
          guildId: 'g-adm',
          roundId: rid,
          actorId: adminId,
          reason: 'Bảo trì đột xuất',
        });
        assert.equal(stop1.ok, true);
        assert.equal(stop1.totalRefundedVnd, 50_000);
        assert.equal(systems.economySystem.ensureUser('u-ref-1').wallet, 50_000);
        assert.equal(systems.economySystem.ensureUser('u-ref-2').wallet, 50_000);

        // Gọi STOP lần 2 trên cùng phiên -> Chống hoàn tiền 2 lần!
        const stop2 = await systems.multiplayerRoundSystem.stopRound({
          guildId: 'g-adm',
          roundId: rid,
          actorId: adminId,
        });
        assert.equal(stop2.ok, false);
        assert.equal(stop2.code, 'ALREADY_FINISHED');
        assert.equal(systems.economySystem.ensureUser('u-ref-1').wallet, 50_000);

        // Phân quyền Multi-Table: ADMIN bị chặn, CHỈ DUY NHẤT OWNER (`1243061570247069696`) mở được!
        const adminTryMulti = systems.multiplayerRoundSystem.updateSettings({
          actorId: adminId,
          multiTableEnabled: true,
        });
        assert.equal(adminTryMulti.ok, false);
        assert.equal(adminTryMulti.code, 'FORBIDDEN_OWNER_ONLY');

        const ownerEnableMulti = systems.multiplayerRoundSystem.updateSettings({
          actorId: HARDCODED_OWNER_ID,
          multiTableEnabled: true,
          maxTablesPerGame: 2,
        });
        assert.equal(ownerEnableMulti.ok, true);

        const t1 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm',
          channelId: 'c-adm',
          gameId: GAME_IDS.TAIXIU,
          userId: 'u-ref-1',
        });
        const t2 = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm',
          channelId: 'c-adm',
          gameId: GAME_IDS.TAIXIU,
          userId: 'u-ref-2',
        });
        assert.equal(t1.created, true);
        assert.equal(t2.created, true);
        assert.notEqual(t1.round.round_id, t2.round.round_id);

        // Kiểm định toàn bộ trạng thái Components V2 của Bảng Phiên Chung (BETTING, 10s, 5s, DRAWING, COMPLETED, CANCELLED)
        for (const snap of [
          t1.snapshot,
          { ...t1.snapshot, remainingSec: 9 },
          { ...t1.snapshot, remainingSec: 4 },
          { ...t1.snapshot, round: { ...t1.snapshot.round, status: MP_ROUND_STATUS.DRAWING } },
          stop1.snapshot,
        ]) {
          const payload = buildMultiplayerBoardPayload(snap, systems);
          const v = validateCv2Payload(payload);
          assert.equal(v.valid, true, `Lỗi payload Components V2: ${v.reason}`);
        }

        const completedSnap = await systems.multiplayerRoundSystem.finalizeRound(t1.round.round_id, {
          skipAnimation: true,
        });
        const completedPayload = buildMultiplayerBoardPayload(completedSnap, systems);
        assert.equal(validateCv2Payload(completedPayload).valid, true);
        const completedText = extractCv2Text(completedPayload);
        assert.match(completedText, /KẾT QUẢ PHIÊN/);

        // Kiểm định đầy đủ bộ tài nguyên 3D riêng biệt của từng game & TUYỆT ĐỐI KHÔNG CÓ ĐẤU BOSS
        const mustExistPaths = [
          ASSET_PATHS.BAUCUA_BANNER_3D,
          ASSET_PATHS.BAUCUA_CASINO_TABLE,
          ASSET_PATHS.BAUCUA_WIN,
          ASSET_PATHS.BAUCUA_LOSE,
          ASSET_PATHS.BAUCUA_SPECIAL_TRIPLE,
          ASSET_PATHS.TAIXIU_BANNER_3D,
          ASSET_PATHS.TAIXIU_ZONE_TAI,
          ASSET_PATHS.TAIXIU_ZONE_XIU,
          ASSET_PATHS.TAIXIU_WIN,
          ASSET_PATHS.TAIXIU_LOSE,
          ASSET_PATHS.TAIXIU_RESULT_BOARD,
          ASSET_PATHS.TAIXIU_SPECIAL_TRIPLE,
          ASSET_PATHS.RACE_ICON,
          ASSET_PATHS.RACE_WIN,
          ASSET_PATHS.RACE_LOSE,
          ASSET_PATHS.NOITU_ICON,
          ASSET_PATHS.NOITU_TIMER_GIF,
          ASSET_PATHS.NOITU_WIN,
          ASSET_PATHS.NOITU_LOSE,
          ASSET_PATHS.COIN_ICON,
          ASSET_PATHS.COIN_WIN,
          ASSET_PATHS.COIN_LOSE,
          ASSET_PATHS.RPS_ICON,
          ASSET_PATHS.RPS_WIN,
          ASSET_PATHS.RPS_LOSE,
          ASSET_PATHS.GUESS_ICON,
          ASSET_PATHS.GUESS_WIN,
          ASSET_PATHS.GUESS_LOSE,
        ];
        for (const rel of mustExistPaths) {
          const full = path.join(ASSETS_DIR, rel);
          assert.equal(fs.existsSync(full), true, `Thiếu file tài nguyên 3D: ${rel}`);
          assert.ok(fs.statSync(full).size > 500, `File tài nguyên rỗng: ${rel}`);
        }
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Luồng tương tác Discord thực tế End-to-End qua handleInteractionCreate: Game Center Public Start (gửi sang kênh game riêng), Modal Đặt Cược, Sửa Cược, Biên Lai, Lịch Sử & BXH', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mp-e2e-ui-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        // Cài đặt kênh riêng cho Bầu Cua (`chan-dedicated-bc`), trong khi thành viên bấm nút từ `#game-center`
        systems.db.setGameChannel('guild-e2e', GAME_IDS.BAUCUA, 'chan-dedicated-bc', [], HARDCODED_OWNER_ID);

        let dedicatedBoardMsg = null;
        const mockGuild = {
          id: 'guild-e2e',
          channels: {
            cache: new Map([
              [
                'chan-dedicated-bc',
                {
                  id: 'chan-dedicated-bc',
                  isTextBased: () => true,
                  send: async (p) => {
                    dedicatedBoardMsg = p;
                    return { id: 'msg-dedicated-bc-1', edit: async (ep) => { dedicatedBoardMsg = ep; } };
                  },
                },
              ],
            ]),
            fetch: async () => null,
          },
        };

        const memberA = { id: 'u-e2e-member-a', username: 'MemberAlpha' };
        const memberB = { id: 'u-e2e-member-b', username: 'MemberBeta' };
        systems.economySystem.ensureUser(memberA.id, memberA.username);
        systems.economySystem.ensureUser(memberB.id, memberB.username);
        systems.db.run("UPDATE users SET wallet = 200000 WHERE user_id IN ('u-e2e-member-a', 'u-e2e-member-b')");

        // 1. Thành viên thường bấm nút `mp:start:baucua` từ kênh `#lobby` -> Tự động đăng bảng phiên vào `#chan-dedicated-bc`!
        let lobbyReply = null;
        await handleInteractionCreate(
          {
            customId: `mp:start:${GAME_IDS.BAUCUA}`,
            guildId: 'guild-e2e',
            guild: mockGuild,
            channelId: 'chan-lobby',
            user: memberA,
            isButton: () => true,
            reply: async (p) => { lobbyReply = p; },
          },
          systems
        );
        assert.ok(dedicatedBoardMsg, 'Bảng phiên phải được đăng tự động vào kênh Bầu Cua đã cấu hình');
        assert.equal(validateCv2Payload(dedicatedBoardMsg).valid, true);
        assert.equal(validateCv2Payload(lobbyReply).valid, true);

        const activeRound = systems.multiplayerRoundSystem.getActiveRounds('guild-e2e', GAME_IDS.BAUCUA)[0];
        assert.ok(activeRound);
        const roundId = activeRound.round_id;

        // 2. MemberBeta bấm chọn cửa `cua` (`mp:door:<roundId>:cua`) -> Mở Modal đặt cược
        let openedModal = null;
        await handleInteractionCreate(
          {
            customId: `mp:door:${roundId}:cua`,
            guildId: 'guild-e2e',
            channelId: 'chan-dedicated-bc',
            user: memberB,
            isButton: () => true,
            showModal: async (m) => { openedModal = m; },
          },
          systems
        );
        assert.ok(openedModal, 'Bấm cửa cược phải mở Modal nhập tiền');

        // 3. MemberBeta gửi Modal đặt cược `50k` vào cửa `cua` (`mp_modal:bet:<roundId>:cua`)
        let betConfirmPayload = null;
        await new Promise((r) => setTimeout(r, 700)); // vượt qua rate-limit 650ms của globalGuard
        await handleInteractionCreate(
          {
            customId: `mp_modal:bet:${roundId}:cua`,
            guildId: 'guild-e2e',
            channelId: 'chan-dedicated-bc',
            user: memberB,
            isModalSubmit: () => true,
            fields: { getTextInputValue: (k) => (k === 'amount' ? '50k' : '') },
            reply: async (p) => { betConfirmPayload = p; },
          },
          systems
        );
        assert.ok(betConfirmPayload);
        assert.equal(validateCv2Payload(betConfirmPayload).valid, true);
        assert.match(extractCv2Text(betConfirmPayload), /Đặt cược thành công/i);
        assert.equal(systems.economySystem.ensureUser(memberB.id).wallet, 150_000);

        // 4. MemberBeta bấm `📋 Cược của tôi` & gửi Modal sửa cược lên `80k`
        await new Promise((r) => setTimeout(r, 700));
        let myBetsPayload = null;
        await handleInteractionCreate(
          {
            customId: `mp:my_bets:${roundId}`,
            guildId: 'guild-e2e',
            channelId: 'chan-dedicated-bc',
            user: memberB,
            isButton: () => true,
            reply: async (p) => { myBetsPayload = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(myBetsPayload).valid, true);
        assert.match(extractCv2Text(myBetsPayload), /50\.000/);

        const betRow = systems.multiplayerRoundSystem.getUserRoundBets(roundId, memberB.id)[0];
        await new Promise((r) => setTimeout(r, 700));
        let editReplyPayload = null;
        await handleInteractionCreate(
          {
            customId: `mp_modal:edit:${roundId}:${betRow.bet_id}`,
            guildId: 'guild-e2e',
            channelId: 'chan-dedicated-bc',
            user: memberB,
            isModalSubmit: () => true,
            fields: {
              getTextInputValue: (k) => {
                if (k === 'amount') return '80k';
                if (k === 'choice') return 'tom';
                return '';
              },
            },
            reply: async (p) => { editReplyPayload = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(editReplyPayload).valid, true);
        assert.equal(systems.economySystem.ensureUser(memberB.id).wallet, 120_000);

        // 5. Tất toán phiên & kiểm tra cả 3 nút Hậu Kết Quả (`mp:detail`, `mp:history`, `mp:leaderboard`)
        await systems.multiplayerRoundSystem.finalizeRound(roundId, { skipAnimation: true });

        for (const btnCustomId of [
          `mp:detail:${roundId}`,
          `mp:history:${GAME_IDS.BAUCUA}`,
          `mp:leaderboard:${GAME_IDS.BAUCUA}`,
        ]) {
          let postReply = null;
          await routeComponentInteraction(
            {
              customId: btnCustomId,
              guildId: 'guild-e2e',
              channelId: 'chan-dedicated-bc',
              user: memberB,
              isButton: () => true,
              reply: async (p) => { postReply = p; },
            },
            systems
          );
          assert.ok(postReply, `Thiếu phản hồi cho nút ${btnCustomId}`);
          assert.equal(validateCv2Payload(postReply).valid, true);
        }
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
