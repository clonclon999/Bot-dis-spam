import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { COMMAND_MAP } from '../src/commands/index.js';
import { buildMultiplayerBoardPayload } from '../src/commands/games/multiplayerRound.js';
import {
  BOT_ROLES,
  GAME_IDS,
  HARDCODED_OWNER_ID,
  MP_ROUND_STATUS,
} from '../src/config/constants.js';
import { GameDatabase } from '../src/database/db.js';
import { EconomySystem } from '../src/systems/economySystem.js';
import { createBotSystems } from '../src/systems/index.js';
import { MultiplayerRoundSystem } from '../src/systems/multiplayerRoundSystem.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';

describe('UPDATE PRO MAX – AUTO NEXT ROUND SYSTEM (All 7 Mandatory Scenarios)', () => {
  it('1. Phiên hoàn thành tự động mở vòng mới sau 10s nghỉ + Giao diện đầy đủ ("PHIÊN TIẾP THEO SẮP BẮT ĐẦU", Tổng tiền thanh toán, Round ID mới & Nút cược mở lại không spam)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autonext-flow-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        // Kiểm tra cấu hình mặc định chuẩn Mục 3
        const cfg = systems.multiplayerRoundSystem.getAutoNextConfig('guild-an-1');
        assert.equal(cfg.enabled, true, 'Auto Next Round mặc định phải BẬT');
        assert.equal(cfg.delaySec, 10, 'Thời gian nghỉ mặc định phải là 10 giây');
        assert.equal(cfg.games.baucua, true);
        assert.equal(cfg.games.taixiu, true);
        assert.equal(systems.multiplayerRoundSystem.getRoundDurationSec(GAME_IDS.BAUCUA), 60);
        assert.equal(systems.multiplayerRoundSystem.getRoundDurationSec(GAME_IDS.TAIXIU), 60);

        systems.economySystem.ensureUser('u-an-1', 'PlayerOne');
        systems.economySystem.ensureUser('u-an-2', 'PlayerTwo');
        systems.db.run("UPDATE users SET wallet = 100000 WHERE user_id IN ('u-an-1', 'u-an-2')");

        // Theo dõi số tin nhắn gửi mới vào kênh để chứng minh KHÔNG SPAM!
        const channelSentPayloads = [];
        let round1BoardEdits = [];
        const mockRound1Msg = {
          id: 'msg-r1',
          edit: async (p) => {
            round1BoardEdits.push(p);
          },
        };
        const mockClient = {
          channels: {
            cache: new Map([
              [
                'chan-bc-auto',
                {
                  id: 'chan-bc-auto',
                  send: async (p) => {
                    channelSentPayloads.push(p);
                    return { id: `msg-auto-${channelSentPayloads.length}`, edit: async () => {} };
                  },
                  messages: {
                    fetch: async (id) => (id === 'msg-r1' ? mockRound1Msg : null),
                  },
                },
              ],
            ]),
            fetch: async () => null,
          },
        };
        systems.multiplayerRoundSystem.attachClient(mockClient);

        // Mở phiên #1 và đặt cược
        const r1Start = await systems.multiplayerRoundSystem.startRound({
          guildId: 'guild-an-1',
          channelId: 'chan-bc-auto',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-an-1',
          username: 'PlayerOne',
        });
        const r1Id = r1Start.round.round_id;
        systems.multiplayerRoundSystem.registerMessageRef(r1Id, mockRound1Msg);

        await systems.multiplayerRoundSystem.placeBet({
          roundId: r1Id,
          userId: 'u-an-1',
          choice: 'bau',
          amount: 20_000,
        });
        await systems.multiplayerRoundSystem.placeBet({
          roundId: r1Id,
          userId: 'u-an-2',
          choice: 'cua',
          amount: 10_000,
        });

        systems.db.run(
          'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
          [
            MP_ROUND_STATUS.LOCKED,
            JSON.stringify({
              gameId: GAME_IDS.BAUCUA,
              rolledIds: ['bau', 'ga', 'nai'],
              counts: { bau: 1, cua: 0, tom: 0, ca: 0, ga: 1, nai: 1 },
              isTriple: false,
              generatedAt: Date.now(),
            }),
            r1Id,
          ]
        );

        // Chốt phiên #1 -> Chuyển COMPLETED + Lên lịch Auto Next 10s
        const completedSnap = await systems.multiplayerRoundSystem.finalizeRound(r1Id, {
          skipAnimation: true,
        });
        assert.equal(completedSnap.round.status, MP_ROUND_STATUS.COMPLETED);
        assert.equal(completedSnap.round.settled, 1);
        assert.equal(completedSnap.round.auto_next_state, 'PENDING');
        assert.ok(completedSnap.round.next_round_at > Date.now());

        // Kiểm tra Bảng Kết Quả trong thời gian chờ 10s
        const waitingResultBoard = round1BoardEdits.at(-1);
        assert.ok(waitingResultBoard);
        assert.equal(validateCv2Payload(waitingResultBoard).valid, true);
        const waitingText = extractCv2Text(waitingResultBoard);
        assert.match(waitingText, /PHIÊN TIẾP THEO SẮP BẮT ĐẦU/);
        assert.match(waitingText, /Tổng tiền thanh toán:\*\* \*\*40\.000 VNĐ\*\*/);
        assert.match(waitingText, /Thời gian còn lại trước khi mở phiên mới/);
        assert.equal(channelSentPayloads.length, 0, 'Trong thời gian nghỉ TUYỆT ĐỐI KHÔNG gửi tin nhắn spam');

        // Hết 10s nghỉ -> Tự động mở phiên #2 (không cần người mở phiên online, không cần Admin duyệt!)
        const autoRes = await systems.multiplayerRoundSystem.triggerAutoNextRound(r1Id);
        assert.equal(autoRes.ok, true);
        assert.equal(autoRes.created, true);
        const r2Id = autoRes.round.round_id;
        assert.notEqual(r2Id, r1Id);
        assert.equal(autoRes.round.status, MP_ROUND_STATUS.BETTING);
        assert.equal(autoRes.round.started_by, 'SYSTEM_AUTO');

        // Bảng kết quả phiên #1 được cập nhật hiển thị Round ID tiếp theo đã tạo
        const linkedR1Board = round1BoardEdits.at(-1);
        assert.equal(validateCv2Payload(linkedR1Board).valid, true);
        assert.match(extractCv2Text(linkedR1Board), new RegExp(r2Id));

        // Đúng 1 bảng phiên mới duy nhất được đăng với nút đặt cược đã kích hoạt lại!
        assert.equal(channelSentPayloads.length, 1, 'Chỉ đăng đúng 1 bảng phiên mới duy nhất');
        const newLiveBoard = channelSentPayloads[0];
        assert.equal(validateCv2Payload(newLiveBoard).valid, true);
        const newBoardTxt = extractCv2Text(newLiveBoard);
        assert.match(newBoardTxt, new RegExp(r2Id));
        assert.match(newBoardTxt, /Hệ Thống Tự Động/);

        // Xác nhận các nút cửa cược trên bảng mới đang BẬT (disabled !== true) và thành viên đặt cược ngay được!
        const controlJson = newLiveBoard.components[1].toJSON();
        const firstDoorBtn = controlJson.components[0].components[0];
        assert.notEqual(firstDoorBtn.disabled, true, 'Các nút đặt cược trên phiên mới phải được kích hoạt lại');

        const betOnR2 = await systems.multiplayerRoundSystem.placeBet({
          roundId: r2Id,
          userId: 'u-an-2',
          choice: 'tom',
          amount: 15_000,
        });
        assert.equal(betOnR2.ok, true, 'Thành viên tiếp tục đặt cược ngay trên phiên tự động mở');
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. Nhiều người cùng nhấn START đúng lúc Auto Next Round chuẩn bị mở phiên -> Đảm bảo chỉ có ĐÚNG 1 phiên hoạt động duy nhất', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autonext-race-start-'));
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
        const s1 = await mp.startRound({
          guildId: 'g-race-st',
          channelId: 'c-tx',
          gameId: GAME_IDS.TAIXIU,
          userId: 'u-init',
        });
        const r1Id = s1.round.round_id;
        await mp.finalizeRound(r1Id, { skipAnimation: true });

        // 8 thành viên bấm START đồng thời CÙNG LÚC với tiến trình Auto Next kích hoạt!
        const concurrentOps = [
          mp.triggerAutoNextRound(r1Id),
          ...Array.from({ length: 8 }, (_, idx) =>
            mp.startRound({
              guildId: 'g-race-st',
              channelId: 'c-tx',
              gameId: GAME_IDS.TAIXIU,
              userId: `u-clicker-${idx + 1}`,
              username: `Clicker${idx + 1}`,
            })
          ),
        ];

        await Promise.all(concurrentOps);

        const activeNow = mp.getActiveRounds('g-race-st', GAME_IDS.TAIXIU);
        assert.equal(activeNow.length, 1, 'TUYỆT ĐỐI chỉ có 1 phiên Tài Xỉu đang hoạt động!');
        assert.notEqual(activeNow[0].round_id, r1Id);

        // Gọi lại triggerAutoNextRound thêm lần nữa cũng không được tạo thêm phiên!
        const retryAuto = await mp.triggerAutoNextRound(r1Id);
        assert.equal(retryAuto.ok, false);
        assert.equal(mp.getActiveRounds('g-race-st', GAME_IDS.TAIXIU).length, 1);
      } finally {
        mp.shutdown();
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3 & 4. Bot Restart TRONG thời gian nghỉ VÀ Bot Restart SAU khi thanh toán nhưng TRƯỚC khi tạo phiên mới + Khóa chặn tạo phiên giữa lúc đang khôi phục', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autonext-restart-'));
    try {
      let nowTs = 1_762_400_000_000;

      // --- Kịch bản A: Bot sập nguồn TRONG thời gian nghỉ 10 giây (còn 6 giây nghỉ) ---
      const db1 = new GameDatabase(tmpDir);
      await db1.init();
      const econ1 = new EconomySystem({ db: db1 });
      const mp1 = new MultiplayerRoundSystem({
        db: db1,
        economySystem: econ1,
        nowFn: () => nowTs,
        animationDelayMs: 0,
      });

      econ1.ensureUser('u-res-1', 'ResPlayer');
      db1.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', ['u-res-1']);

      // Phiên Bầu Cua kết thúc ở t = 0 -> lịch mở phiên kế tiếp ở t + 10s
      const bc1 = await mp1.startRound({
        guildId: 'g-res',
        channelId: 'c-bc',
        gameId: GAME_IDS.BAUCUA,
        userId: 'u-res-1',
      });
      await mp1.placeBet({ roundId: bc1.round.round_id, userId: 'u-res-1', choice: 'cua', amount: 10_000 });
      db1.run(
        'UPDATE multiplayer_rounds SET status = ?, result_json = ? WHERE round_id = ?',
        [
          MP_ROUND_STATUS.LOCKED,
          JSON.stringify({
            gameId: GAME_IDS.BAUCUA,
            rolledIds: ['cua', 'bau', 'tom'],
            counts: { bau: 1, cua: 1, tom: 1, ca: 0, ga: 0, nai: 0 },
            isTriple: false,
            generatedAt: nowTs,
          }),
          bc1.round.round_id,
        ]
      );
      await mp1.finalizeRound(bc1.round.round_id, { skipAnimation: true });
      assert.equal(econ1.ensureUser('u-res-1').wallet, 110_000); // 90k + 20k

      // Phiên Tài Xỉu vừa thanh toán xong nhưng Bot sập lâu quá 10s trước khi tạo phiên tiếp theo!
      const tx1 = await mp1.startRound({
        guildId: 'g-res',
        channelId: 'c-tx',
        gameId: GAME_IDS.TAIXIU,
        userId: 'u-res-1',
      });
      await mp1.finalizeRound(tx1.round.round_id, { skipAnimation: true });
      // Giả lập lịch của Tài Xỉu đã đến hạn ở t + 2s (trước thời điểm khởi động lại t + 4s)
      db1.run(
        'UPDATE multiplayer_rounds SET next_round_at = ? WHERE round_id = ?',
        [nowTs + 2_000, tx1.round.round_id]
      );

      mp1.shutdown();
      await db1.close();

      // Khởi động lại ở t + 4s:
      // - Bầu Cua vẫn còn 6s nghỉ -> phải tiếp tục lịch chờ (`autoNextResumed === 1`), CHƯA mở ngay!
      // - Tài Xỉu đã quá thời điểm `next_round_at` -> phải tự động tạo phiên mới ngay sau khi khôi phục xong (`autoNextTriggered === 1`)!
      nowTs += 4_000;
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
        // Kiểm tra cứng ràng buộc Mục 4: Không tạo phiên mới khi bot ĐANG trong quá trình khôi phục (`_isRecovering = true`)
        mp2._isRecovering = true;
        const blockedDuringRecovery = await mp2.triggerAutoNextRound(tx1.round.round_id);
        assert.equal(blockedDuringRecovery.ok, false);
        assert.equal(blockedDuringRecovery.code, 'RECOVERING_STATE');
        mp2._isRecovering = false;

        const rec = await mp2.recoverActiveRounds();
        assert.equal(rec.autoNextTriggered, 1, 'Phiên Tài Xỉu quá hạn nghỉ phải được tạo ngay sau recovery');
        assert.equal(rec.autoNextResumed, 1, 'Phiên Bầu Cua còn 6s nghỉ phải tiếp tục lịch chờ');

        assert.equal(mp2.getActiveRounds('g-res', GAME_IDS.TAIXIU).length, 1);
        assert.equal(mp2.getActiveRounds('g-res', GAME_IDS.BAUCUA).length, 0);

        // Khi hết nốt 6s nghỉ còn lại của Bầu Cua -> mở phiên Bầu Cua mới chuẩn xác & không cộng tiền lần 2!
        nowTs += 6_000;
        const bcNext = await mp2.triggerAutoNextRound(bc1.round.round_id);
        assert.equal(bcNext.ok, true);
        assert.equal(bcNext.created, true);
        assert.equal(mp2.getActiveRounds('g-res', GAME_IDS.BAUCUA).length, 1);
        assert.equal(econ2.ensureUser('u-res-1').wallet, 110_000, 'Không bao giờ thanh toán 2 lần sau restart');
      } finally {
        mp2.shutdown();
        await db2.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5 & 6. Phiên bị CANCELLED, ADMIN tắt Auto Next khi đang chờ (KHÔNG hủy phiên đang BETTING, thành viên vẫn /game start được) & Bộ lệnh /game auto status|on|off|delay', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autonext-admin-cancel-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.animationDelayMs = 0;

      try {
        const gameCmd = COMMAND_MAP.get('game');
        const adminUser = { id: 'adm-auto-1', username: 'AdminPro' };
        const normalUser = { id: 'mem-auto-1', username: 'MemberNormal' };
        systems.db.setStaffRole(adminUser.id, BOT_ROLES.ADMIN, HARDCODED_OWNER_ID);
        systems.economySystem.ensureUser(normalUser.id, normalUser.username);
        systems.db.run('UPDATE users SET wallet = 100000 WHERE user_id = ?', [normalUser.id]);

        // Thành viên thường bị CHẶN dùng `/game auto off`, `/game auto on`, `/game auto delay`
        let memberDeniedReply = null;
        await gameCmd.execute(
          {
            guildId: 'g-adm-auto',
            channelId: 'c-1',
            user: normalUser,
            options: {
              getSubcommandGroup: () => 'auto',
              getSubcommand: () => 'off',
              getString: () => null,
            },
            reply: async (p) => { memberDeniedReply = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(memberDeniedReply).valid, true);
        assert.match(extractCv2Text(memberDeniedReply), /Không Đủ Quyền Cấu Hình/);

        // Kịch bản 5: Phiên bị CANCELLED -> Mặc định KHÔNG tự động mở phiên mới!
        const bcCancel = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm-auto',
          channelId: 'c-1',
          gameId: GAME_IDS.BAUCUA,
          userId: normalUser.id,
        });
        await systems.multiplayerRoundSystem.placeBet({
          roundId: bcCancel.round.round_id,
          userId: normalUser.id,
          choice: 'bau',
          amount: 30_000,
        });

        const stopped = await systems.multiplayerRoundSystem.stopRound({
          guildId: 'g-adm-auto',
          roundId: bcCancel.round.round_id,
          actorId: adminUser.id,
          reason: 'Kiểm tra hủy phiên',
        });
        assert.equal(stopped.ok, true);
        assert.equal(stopped.snapshot.round.auto_next_state, 'NONE');
        assert.equal(systems.economySystem.ensureUser(normalUser.id).wallet, 100_000);
        const tryTriggerCancelled = await systems.multiplayerRoundSystem.triggerAutoNextRound(
          bcCancel.round.round_id
        );
        assert.equal(tryTriggerCancelled.ok, false);

        // Kịch bản 6:
        // - Bầu Cua #2 hoàn tất và ĐANG CHỜ 10s mở vòng mới (`PENDING`)
        // - Tài Xỉu #1 ĐANG MỞ NHẬN CƯỢC (`BETTING`) có người đặt cược
        // -> ADMIN gõ `/game auto off`: hủy lịch chờ của Bầu Cua #2, nhưng GIỮ NGUYÊN Tài Xỉu #1!
        const bcWaiting = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm-auto',
          channelId: 'c-bc',
          gameId: GAME_IDS.BAUCUA,
          userId: normalUser.id,
        });
        await systems.multiplayerRoundSystem.finalizeRound(bcWaiting.round.round_id, {
          skipAnimation: true,
        });
        assert.equal(
          systems.multiplayerRoundSystem.getPendingAutoNextRounds('g-adm-auto').length,
          1
        );

        const txBetting = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm-auto',
          channelId: 'c-tx',
          gameId: GAME_IDS.TAIXIU,
          userId: normalUser.id,
        });
        await systems.multiplayerRoundSystem.placeBet({
          roundId: txBetting.round.round_id,
          userId: normalUser.id,
          choice: 'tai',
          amount: 25_000,
        });

        // Kiểm tra `/game auto status` trước khi tắt
        let statusReply = null;
        await gameCmd.execute(
          {
            guildId: 'g-adm-auto',
            channelId: 'c-bc',
            user: normalUser,
            options: {
              getSubcommandGroup: () => 'auto',
              getSubcommand: () => 'status',
            },
            reply: async (p) => { statusReply = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(statusReply).valid, true);
        assert.match(extractCv2Text(statusReply), /ĐANG BẬT/);

        // ADMIN chạy `/game auto off`
        let offReply = null;
        await gameCmd.execute(
          {
            guildId: 'g-adm-auto',
            channelId: 'c-bc',
            user: adminUser,
            options: {
              getSubcommandGroup: () => 'auto',
              getSubcommand: () => 'off',
              getString: () => null,
            },
            reply: async (p) => { offReply = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(offReply).valid, true);
        assert.match(extractCv2Text(offReply), /Đã Tắt Auto Next Round/);

        // Lịch chờ của Bầu Cua đã bị hủy -> không tạo phiên mới
        assert.equal(
          systems.multiplayerRoundSystem.getPendingAutoNextRounds('g-adm-auto').length,
          0
        );
        const afterOffTrigger = await systems.multiplayerRoundSystem.triggerAutoNextRound(
          bcWaiting.round.round_id
        );
        assert.equal(afterOffTrigger.ok, false);
        assert.equal(
          systems.multiplayerRoundSystem.getActiveRounds('g-adm-auto', GAME_IDS.BAUCUA).length,
          0
        );

        // Phiên Tài Xỉu đang `BETTING` TUYỆT ĐỐI KHÔNG bị hủy!
        const txStillAlive = systems.multiplayerRoundSystem.getRoundSnapshot(
          txBetting.round.round_id
        );
        assert.equal(txStillAlive.round.status, MP_ROUND_STATUS.BETTING);
        assert.equal(txStillAlive.round.total_bet_vnd, 25_000);

        // Thành viên thường vẫn dùng `/game start` mở phiên Bầu Cua mới bình thường khi Auto Next đang TẮT!
        const manualWhileOff = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-adm-auto',
          channelId: 'c-bc',
          gameId: GAME_IDS.BAUCUA,
          userId: normalUser.id,
        });
        assert.equal(manualWhileOff.ok, true);
        assert.equal(manualWhileOff.created, true);

        // Kiểm tra `/game auto delay` & `/game auto on`
        let delayReply = null;
        await gameCmd.execute(
          {
            guildId: 'g-adm-auto',
            channelId: 'c-bc',
            user: adminUser,
            options: {
              getSubcommandGroup: () => 'auto',
              getSubcommand: () => 'delay',
              getInteger: () => 15,
            },
            reply: async (p) => { delayReply = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(delayReply).valid, true);
        assert.equal(systems.multiplayerRoundSystem.getAutoNextConfig('g-adm-auto').delaySec, 15);

        let onReply = null;
        await gameCmd.execute(
          {
            guildId: 'g-adm-auto',
            channelId: 'c-bc',
            user: adminUser,
            options: {
              getSubcommandGroup: () => 'auto',
              getSubcommand: () => 'on',
              getString: () => null,
              getBoolean: () => true,
            },
            reply: async (p) => { onReply = p; },
          },
          systems
        );
        assert.equal(validateCv2Payload(onReply).valid, true);
        const updatedCfg = systems.multiplayerRoundSystem.getAutoNextConfig('g-adm-auto');
        assert.equal(updatedCfg.enabled, true);
        assert.equal(updatedCfg.allowOnCancelled, true);
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('7. Hai tiến trình Bot độc lập cùng cố gắng tạo phiên tiếp theo (Multi-Process DB Lock & Partial Unique Index) -> Đảm bảo chỉ tạo ĐÚNG 1 phiên', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'autonext-two-procs-'));
    try {
      const sharedDb = new GameDatabase(tmpDir);
      await sharedDb.init();
      const sharedEcon = new EconomySystem({ db: sharedDb });

      // Khởi tạo 2 tiến trình MultiplayerRoundSystem độc lập hoàn toàn (2 bộ nhớ _createLocks tách rời nhau!)
      const botProcessA = new MultiplayerRoundSystem({
        db: sharedDb,
        economySystem: sharedEcon,
        animationDelayMs: 0,
      });
      const botProcessB = new MultiplayerRoundSystem({
        db: sharedDb,
        economySystem: sharedEcon,
        animationDelayMs: 0,
      });

      try {
        const s1 = await botProcessA.startRound({
          guildId: 'g-dual-proc',
          channelId: 'c-bc',
          gameId: GAME_IDS.BAUCUA,
          userId: 'u-dual-1',
        });
        const sourceId = s1.round.round_id;
        await botProcessA.finalizeRound(sourceId, { skipAnimation: true });

        // Cả 2 tiến trình A và B cùng kích hoạt tạo phiên tiếp theo tại cùng thời điểm!
        const [resA, resB] = await Promise.all([
          botProcessA.triggerAutoNextRound(sourceId),
          botProcessB.triggerAutoNextRound(sourceId),
        ]);

        const winners = [resA, resB].filter((r) => r.ok && r.created);
        assert.equal(winners.length, 1, 'Chỉ ĐÚNG 1 tiến trình được phép tạo phiên mới!');

        const activeInDb = botProcessA.getActiveRounds('g-dual-proc', GAME_IDS.BAUCUA);
        assert.equal(activeInDb.length, 1, 'Trong CSDL chỉ có duy nhất 1 phiên đang hoạt động');

        // Thử vi phạm trực tiếp xuống SQLite bằng câu lệnh INSERT trùng bàn đang BETTING -> Bị Partial Unique Index chặn cứng!
        assert.throws(() => {
          sharedDb.run(
            `INSERT INTO multiplayer_rounds (
               round_id, guild_id, channel_id, table_index, game_id, status,
               started_by, duration_sec, starts_at, ends_at, created_at, updated_at
             ) VALUES ('BC-ROGUE-999', 'g-dual-proc', 'c-bc', 1, 'baucua', 'BETTING', 'rogue', 60, 1, 2, 1, 1)`
          );
        }, /UNIQUE constraint failed/);
      } finally {
        botProcessA.shutdown();
        botProcessB.shutdown();
        await sharedDb.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
