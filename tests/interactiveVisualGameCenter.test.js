import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { getSlashCommandsJSON } from '../src/commands/index.js';
import {
  buildBauCuaBoardPayload,
  buildCoinflipBoardPayload,
  buildGuessBoardPayload,
  buildRaceBoardPayload,
  buildRpsBoardPayload,
  buildTaiXiuBoardPayload,
  handleGameComponentInteraction,
} from '../src/commands/games/index.js';
import {
  buildGameCenterHomePayload,
  buildGameDetailPayload,
  handleGameCenterInteraction,
} from '../src/commands/games/gameCenter.js';
import { runWithConfirmLock } from '../src/commands/games/bettingPanel.js';
import {
  BUILTIN_QUESTS,
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  GAME_CATALOG,
  OFFICIAL_GAME_ORDER,
  SHOP_ITEMS,
} from '../src/config/constants.js';
import { createBotSystems } from '../src/systems/index.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';
import {
  ASSET_PATHS,
  ASSETS_DIR,
  buildAssetAttachment,
  buildBauCuaResultAttachment,
  buildThreeDiceResultAttachment,
} from '../src/utils/assetRegistry.js';

describe('DISCORD GAME BOT PRO – Interactive Visual Game Center & Zero-Boss Guarantee', () => {
  it('1. Đảm bảo tuyệt đối KHÔNG tồn tại Đấu Boss ở bất kỳ lệnh, game, nhiệm vụ, sự kiện hay tài nguyên nào', () => {
    assert.deepEqual(OFFICIAL_GAME_ORDER, [
      'baucua',
      'taixiu',
      'noitu',
      'rps',
      'guess',
      'coinflip',
      'race',
    ]);
    assert.equal(Object.keys(GAME_CATALOG).length, 7);

    const allCmdJson = JSON.stringify(getSlashCommandsJSON()).toLowerCase();
    assert.equal(allCmdJson.includes('boss'), false, 'Slash commands must never mention boss');

    const questsJson = JSON.stringify(BUILTIN_QUESTS).toLowerCase();
    assert.equal(questsJson.includes('boss'), false, 'Quests must never mention boss');

    const eventsJson = JSON.stringify({ EVENT_TYPES, EVENT_TYPE_LABELS }).toLowerCase();
    assert.equal(eventsJson.includes('boss'), false, 'Events must never mention boss');

    const walkFiles = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walkFiles(full));
        else out.push(full);
      }
      return out;
    };
    const assetFiles = walkFiles(ASSETS_DIR);
    assert.ok(assetFiles.length >= 40, 'Phải có đầy đủ bộ tài nguyên PNG/GIF trong assets/');
    for (const f of assetFiles) {
      assert.equal(f.toLowerCase().includes('boss'), false, `Asset file must not be boss: ${f}`);
    }
  });

  it('2. Kiểm định toàn bộ tài nguyên hình ảnh PNG & GIF cục bộ + Bộ kết xuất 3 xúc xắc động (< 5ms)', () => {
    const flatPaths = [
      ASSET_PATHS.GAME_CENTER_BANNER,
      ASSET_PATHS.VICTORY_BANNER,
      ASSET_PATHS.DEFEAT_BANNER,
      ASSET_PATHS.QUEST_BANNER,
      ASSET_PATHS.SHOP_BANNER,
      ASSET_PATHS.GAME_BAUCUA,
      ASSET_PATHS.GAME_TAIXIU,
      ASSET_PATHS.GAME_NOITU,
      ASSET_PATHS.GAME_RPS,
      ASSET_PATHS.GAME_GUESS,
      ASSET_PATHS.GAME_COINFLIP,
      ASSET_PATHS.GAME_RACE,
      ASSET_PATHS.BAUCUA_GRID,
      ASSET_PATHS.BAUCUA_SHAKE_GIF,
      ASSET_PATHS.DICE_ROLL_GIF,
      ASSET_PATHS.COIN_FLIP_GIF,
      ASSET_PATHS.COIN_SAP,
      ASSET_PATHS.COIN_NGUA,
      ASSET_PATHS.RPS_COUNTDOWN_GIF,
      ASSET_PATHS.GUESS_VAULT_GIF,
      ASSET_PATHS.RACE_RUN_GIF,
      ...Object.values(ASSET_PATHS.BAUCUA_MASCOT),
      ...Object.values(ASSET_PATHS.DICE_FACE),
      ...Object.values(ASSET_PATHS.RPS_HAND),
      ...Object.values(ASSET_PATHS.RACE_ANIMAL),
    ];

    for (const rel of flatPaths) {
      const { attachment, url } = buildAssetAttachment(rel);
      assert.ok(url.startsWith('attachment://'));
      const buf = attachment.attachment;
      assert.ok(Buffer.isBuffer(buf) && buf.length > 100, `Buffer rỗng ở ${rel}`);
      if (rel.endsWith('.png')) {
        assert.equal(buf[0], 0x89);
        assert.equal(buf[1], 0x50); // 'P'
      } else if (rel.endsWith('.gif')) {
        assert.equal(buf.subarray(0, 3).toString('ascii'), 'GIF');
      }
    }

    const diceRes = buildThreeDiceResultAttachment([6, 5, 2], true);
    assert.equal(diceRes.attachment.attachment[0], 0x89);
    const bcRes = buildBauCuaResultAttachment(['bau', 'cua', 'tom'], true);
    assert.equal(bcRes.attachment.attachment[0], 0x89);
  });

  it('3. Kiểm định Game Center (/games), Bảng Đặt Cược Chung (100..Tất cả, không trừ tiền sớm) & khóa chống nhấn đúp', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'visual-gc-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem } = systems;
      try {
        const mockUser = { id: 'player-gc-1', username: 'VisualTester' };
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: mockUser.id,
          targetName: mockUser.username,
          mode: 'set',
          amount: 100_000,
        });

        // Kiểm tra Game Center PRO MAX Home & Detail (Discord Components V2)
        const home = buildGameCenterHomePayload(mockUser, 'guild-1', systems);
        assert.equal(validateCv2Payload(home).valid, true);
        assert.ok(home.files.length >= 1);
        assert.ok(home.components.length >= 2 && home.components.length <= 3);
        assert.ok(extractCv2Text(home).includes('Bầu Cua'));
        assert.ok(extractCv2Text(home).includes('GAME CENTER PRO MAX'));

        const detail = buildGameDetailPayload(mockUser, 'guild-1', 'taixiu', systems, true);
        assert.equal(validateCv2Payload(detail).valid, true);
        assert.equal(detail.files.length, 1);
        assert.ok(extractCv2Text(detail).includes('LUẬT CHƠI'));

        // Chặn mở bàn trực tiếp nếu bấm Tham Gia từ kênh chưa được gán cho game đó
        db.setGameChannel('guild-1', 'taixiu', 'chan-taixiu', '1243061570247069696');
        let ephemeralRedirect = null;
        await handleGameCenterInteraction(
          {
            isButton: () => true,
            isStringSelectMenu: () => false,
            customId: `gc:join:${mockUser.id}:taixiu`,
            user: mockUser,
            guildId: 'guild-1',
            channelId: 'chan-general',
            reply: async (p) => {
              ephemeralRedirect = p;
            },
          },
          systems,
          () => ({})
        );
        assert.equal(validateCv2Payload(ephemeralRedirect).valid, true);
        assert.ok(extractCv2Text(ephemeralRedirect).includes('<#chan-taixiu>'));

        // Kiểm tra cả 6 bảng đặt cược Components V2 đều hợp lệ chuẩn Discord API (<= 40 components) và KHÔNG trừ tiền khi chọn chip / hủy
        const boards = [
          buildBauCuaBoardPayload(mockUser, systems),
          buildTaiXiuBoardPayload(mockUser, systems),
          buildCoinflipBoardPayload(mockUser, systems),
          buildRpsBoardPayload(mockUser, systems),
          buildGuessBoardPayload(mockUser, systems),
          buildRaceBoardPayload(mockUser, systems),
        ];
        for (const b of boards) {
          const check = validateCv2Payload(b);
          assert.equal(check.valid, true, check.reason || 'Valid V2 payload');
          assert.ok(b.files.length >= 1);
        }

        // Bấm chọn chip 100 VNĐ, 500 VNĐ, Tất cả rồi bấm Hủy -> Số dư ví giữ nguyên 100.000 VNĐ!
        for (const chipVal of ['100', '500', 'all']) {
          await handleGameComponentInteraction(
            {
              isButton: () => true,
              isStringSelectMenu: () => false,
              isModalSubmit: () => false,
              customId: `vgame:taixiu:chip:${mockUser.id}:${chipVal}`,
              user: mockUser,
              guildId: 'guild-1',
              channelId: 'chan-taixiu',
              update: async () => {},
            },
            systems
          );
        }
        await handleGameComponentInteraction(
          {
            isButton: () => true,
            isStringSelectMenu: () => false,
            isModalSubmit: () => false,
            customId: `vgame:taixiu:cancel:${mockUser.id}`,
            user: mockUser,
            guildId: 'guild-1',
            channelId: 'chan-taixiu',
            update: async () => {},
          },
          systems
        );
        assert.equal(economySystem.getBalance(mockUser.id).wallet, 100_000);

        // Kiểm tra khóa chống bấm đúp nút Xác nhận (runWithConfirmLock)
        let releaseFirst;
        const gate = new Promise((r) => {
          releaseFirst = r;
        });
        const p1 = runWithConfirmLock('taixiu', mockUser.id, async () => {
          await gate;
          return 'ok';
        });
        const p2 = await runWithConfirmLock('taixiu', mockUser.id, async () => 'duplicate');
        assert.equal(p2.locked, true);
        releaseFirst();
        const r1 = await p1;
        assert.equal(r1.locked, false);
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Kiểm định Đoán Số nhiều lượt có gợi ý Lớn Hơn / Nhỏ Hơn, Tài Xỉu luật 3/18, Trứng Thú Cưng, Sự Kiện Nối Từ & Chống Farm Cướp lặp mục tiêu', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'visual-rules-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const {
        db,
        economySystem,
        gameSystem,
        shopSystem,
        petSystem,
        crimeSystem,
        questSystem,
        eventSystem,
        wordChainSystem,
      } = systems;

      try {
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'u-main',
          targetName: 'MainPlayer',
          mode: 'set',
          amount: 500_000,
        });
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'u-victim',
          targetName: 'VictimPlayer',
          mode: 'set',
          amount: 200_000,
        });

        // A. Đoán Số nhiều lượt: Gợi ý Lớn Hơn -> Gợi ý Nhỏ Hơn -> Đoán trúng nhận thưởng!
        const started = gameSystem.startGuessSession({
          userId: 'u-main',
          username: 'MainPlayer',
          difficulty: 'easy', // 1..20, 4 lượt
          bet: 10_000,
          secretOverride: 14,
        });
        assert.equal(started.balanceAfterBet, 490_000);

        const t1 = gameSystem.submitGuessTurn({ userId: 'u-main', guessNumber: 8 });
        assert.equal(t1.finished, false);
        assert.equal(t1.hint, 'higher'); // 14 > 8 -> gợi ý lớn hơn

        const t2 = gameSystem.submitGuessTurn({ userId: 'u-main', guessNumber: 18 });
        assert.equal(t2.finished, false);
        assert.equal(t2.hint, 'lower'); // 14 < 18 -> gợi ý nhỏ hơn

        const t3 = gameSystem.submitGuessTurn({ userId: 'u-main', guessNumber: 14 });
        assert.equal(t3.finished, true);
        assert.equal(t3.won, true);
        assert.ok(t3.payout >= 22_000);
        assert.equal(economySystem.getBalance('u-main').wallet, 490_000 + t3.payout);

        // B. Trứng Thú Cưng Ngẫu Nhiên trong /shop -> nở ra thú thật trong bảng pets
        assert.ok(SHOP_ITEMS.pet_egg);
        shopSystem.buyItem('u-main', 'MainPlayer', 'pet_egg', 1);
        const hatched = shopSystem.useItem('u-main', 'MainPlayer', 'pet_egg');
        assert.ok(hatched.effectMessage.includes('nở thành'));
        assert.equal(petSystem.getUserPets('u-main').length, 1);

        // C. Sự kiện Nối Từ (noitu_event) + Nhiệm vụ hằng ngày play_noitu
        const ev = eventSystem.createEvent({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          name: 'Giải Đấu Nối Từ Server',
          type: EVENT_TYPES.NOITU_EVENT,
          rewardVnd: 50_000,
          durationHours: 24,
        });
        const room = wordChainSystem.createRoom({
          guildId: 'g-1',
          channelId: 'c-1',
          hostId: 'u-main',
          hostName: 'MainPlayer',
        });
        wordChainSystem.joinRoom({
          guildId: 'g-1',
          channelId: 'c-1',
          userId: 'u-victim',
          username: 'VictimPlayer',
          roomId: room.roomId,
        });
        wordChainSystem.startMatch({ roomId: room.roomId, channelId: 'c-1', actorId: 'u-main' });
        wordChainSystem.surrender({ userId: 'u-victim' });

        const lb = eventSystem.getEventLeaderboard(ev.id);
        assert.equal(lb.length, 1);
        assert.equal(lb[0].user_id, 'u-main');

        const dailyQuests = questSystem.getUserQuests('u-main', 'MainPlayer', 'daily');
        const noituQuest = dailyQuests.find((q) => q.metric === 'play_noitu');
        assert.ok(noituQuest && noituQuest.progress >= 1);

        // D. Chống farm cướp lặp lại cùng 1 nạn nhân (ngay cả khi hết cooldown cá nhân 10 phút)
        const t0 = Date.now();
        crimeSystem.rob({
          robberId: 'u-main',
          robberName: 'MainPlayer',
          victimId: 'u-victim',
          victimName: 'VictimPlayer',
          now: t0,
        });
        // Sau 15 phút (đã qua robCooldownSec 10 phút nhưng chưa hết robSameTargetCooldownSec 60 phút) -> Chặn!
        assert.throws(
          () =>
            crimeSystem.rob({
              robberId: 'u-main',
              robberName: 'MainPlayer',
              victimId: 'u-victim',
              victimName: 'VictimPlayer',
              now: t0 + 15 * 60 * 1000,
            }),
          /Chống farm mục tiêu lặp lại/
        );
      } finally {
        wordChainSystem.shutdownCleanup();
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
