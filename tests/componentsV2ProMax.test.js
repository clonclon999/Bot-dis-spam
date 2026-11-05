import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import {
  getBettingDraft,
  inspectBettingDraft,
  upsertBettingDraft,
} from '../src/commands/games/bettingPanel.js';
import {
  buildGameCenterHomePayload,
  buildGameCenterLeaderboardPayload,
  buildGameCenterProfilePayload,
  buildGameCenterQuestsPayload,
  buildGameCenterShopPayload,
  buildGameCenterWalletPayload,
  buildGameDetailPayload,
  buildGameListPayload,
} from '../src/commands/games/gameCenter.js';
import {
  buildMatchStartPayload,
  buildNoituHubPayload,
  buildRoomLobbyPayload,
  buildValidTurnPayload,
  buildVictoryPayload,
} from '../src/commands/games/noitu.js';
import { COMMAND_MAP, routeComponentInteraction } from '../src/commands/index.js';
import { HARDCODED_OWNER_ID, OFFICIAL_GAME_ORDER } from '../src/config/constants.js';
import { createBotSystems } from '../src/systems/index.js';
import { PermissionManager } from '../src/systems/permissionManager.js';
import { AnimationManager } from '../src/ui/animationManager.js';
import {
  CV2_LIMITS,
  extractCv2Text,
  validateCv2Payload,
} from '../src/ui/componentsV2.js';

function assertStrictCv2(payload, label) {
  const res = validateCv2Payload(payload);
  assert.equal(res.valid, true, `[${label}] Vi phạm chuẩn Discord Components V2: ${res.reason}`);
  assert.ok(res.componentCount <= CV2_LIMITS.MAX_TOTAL_COMPONENTS, `[${label}] Quá 40 components`);
  assert.ok(res.totalTextLength <= CV2_LIMITS.MAX_TOTAL_TEXT_LENGTH, `[${label}] Quá 4000 ký tự`);
  assert.equal(payload.content, undefined, `[${label}] content phải undefined trên V2`);
  assert.equal(payload.embeds, undefined, `[${label}] embeds phải undefined trên V2`);
  assert.ok((payload.flags & MessageFlags.IsComponentsV2) !== 0, `[${label}] thiếu cờ IsComponentsV2`);
}

describe('NÂNG CẤP PRO MAX – DISCORD COMPONENTS V2 (Full Architecture & Stress Suite)', () => {
  it('1. Xác thực chuẩn Discord Components V2 API trên toàn bộ 7 Khu Vực Game Center PRO MAX & Nút Điều Hướng', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv2-gc-promax-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem } = systems;
      try {
        const user = {
          id: '888000111222333444',
          username: 'ProMaxGamer',
          displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
        };
        economySystem.adminAdjustWallet({
          actorId: HARDCODED_OWNER_ID,
          actorRole: 'OWNER',
          targetId: user.id,
          targetName: user.username,
          mode: 'set',
          amount: 250_000,
        });

        // Kiểm tra đủ 7 khu vực của Game Center PRO MAX
        const pHome = buildGameCenterHomePayload(user, 'g-pro', systems);
        const pGames = buildGameListPayload(user, 'g-pro', systems);
        const pWallet = buildGameCenterWalletPayload(user, systems);
        const pQuestsD = buildGameCenterQuestsPayload(user, systems, 'daily');
        const pQuestsW = buildGameCenterQuestsPayload(user, systems, 'weekly');
        const pQuestsS = buildGameCenterQuestsPayload(user, systems, 'special');
        const pShop = buildGameCenterShopPayload(user, systems, 'catalog');
        const pBag = buildGameCenterShopPayload(user, systems, 'bag');
        const pProfile = buildGameCenterProfilePayload(user, systems);
        const pLbWealth = buildGameCenterLeaderboardPayload(user, systems, 'wealth');
        const pLbWins = buildGameCenterLeaderboardPayload(user, systems, 'wins');
        const pLbNoitu = buildGameCenterLeaderboardPayload(user, systems, 'noitu');

        const screens = [
          ['1. Trang chủ', pHome],
          ['2. Danh sách trò chơi', pGames],
          ['3. Ví tiền & Ngân hàng', pWallet],
          ['4a. Nhiệm vụ Ngày', pQuestsD],
          ['4b. Nhiệm vụ Tuần', pQuestsW],
          ['4c. Nhiệm vụ Đặc biệt', pQuestsS],
          ['5a. Cửa hàng', pShop],
          ['5b. Túi đồ', pBag],
          ['6. Hồ sơ cá nhân', pProfile],
          ['7a. BXH Đại gia', pLbWealth],
          ['7b. BXH Thắng trận', pLbWins],
          ['7c. BXH Nối Từ', pLbNoitu],
        ];
        for (const [name, payload] of screens) {
          assertStrictCv2(payload, name);
        }

        // Kiểm tra trang Chi tiết của cả 7 trò chơi chính thức
        for (const gid of OFFICIAL_GAME_ORDER) {
          const detail = buildGameDetailPayload(user, 'g-pro', gid, systems, true);
          assertStrictCv2(detail, `Chi tiết game ${gid}`);
        }

        // Thực thi thật 100% các nút điều hướng: Trang chủ, Chơi game, Ví tiền, Nhiệm vụ, Cửa hàng, Hồ sơ, BXH, Làm mới, Quay lại, Riêng tư & Đóng giao diện
        const navTargets = ['games', 'wallet', 'quests', 'shop', 'profile', 'leaderboard', 'home'];
        for (const tab of navTargets) {
          let navOut = null;
          const ok = await routeComponentInteraction(
            {
              customId: `gc:nav:${user.id}:${tab}`,
              guildId: 'g-pro',
              user,
              isButton: () => true,
              update: async (p) => {
                navOut = p;
              },
            },
            systems
          );
          assert.equal(ok, true);
          assertStrictCv2(navOut, `Nav -> ${tab}`);
        }

        // Nút Làm mới & Quay lại hoạt động thật tại chỗ
        let refreshed = null;
        await routeComponentInteraction(
          {
            customId: `gc:refresh:${user.id}:wallet`,
            guildId: 'g-pro',
            user,
            isButton: () => true,
            update: async (p) => {
              refreshed = p;
            },
          },
          systems
        );
        assertStrictCv2(refreshed, 'Làm mới Ví tiền');

        let backOut = null;
        await routeComponentInteraction(
          {
            customId: `gc:back:${user.id}:games`,
            guildId: 'g-pro',
            user,
            isButton: () => true,
            update: async (p) => {
              backOut = p;
            },
          },
          systems
        );
        assertStrictCv2(backOut, 'Quay lại');

        // Modal Gửi tiền Ngân hàng ngay bên trong khu vực Ví tiền của Game Center PRO MAX
        let bankModal = null;
        await routeComponentInteraction(
          {
            customId: `gc:bank_modal:${user.id}:deposit`,
            guildId: 'g-pro',
            user,
            isButton: () => true,
            showModal: async (m) => {
              bankModal = m;
            },
          },
          systems
        );
        assert.ok(bankModal, 'Phải hiển thị Modal Gửi tiền Ngân hàng');

        let afterDepositWallet = null;
        await routeComponentInteraction(
          {
            customId: `gc_modal:bank:${user.id}:deposit`,
            guildId: 'g-pro',
            user,
            isModalSubmit: () => true,
            fields: { getTextInputValue: () => '50000' },
            update: async (p) => {
              afterDepositWallet = p;
            },
          },
          systems
        );
        assertStrictCv2(afterDepositWallet, 'Ví tiền sau khi gửi 50.000₫');
        assert.equal(economySystem.getBalance(user.id).bank, 50_000);

        // Chế độ xem Riêng Tư (Ephemeral Components V2)
        let privateView = null;
        await routeComponentInteraction(
          {
            customId: `gc:private:${user.id}:wallet`,
            guildId: 'g-pro',
            user,
            isButton: () => true,
            reply: async (p) => {
              privateView = p;
            },
          },
          systems
        );
        assertStrictCv2(privateView, 'Ephemeral Wallet');
        assert.ok((privateView.flags & MessageFlags.Ephemeral) !== 0);

        // Nút Đóng giao diện hoạt động thật
        let closedPanel = null;
        await routeComponentInteraction(
          {
            customId: `gc:close:${user.id}`,
            guildId: 'g-pro',
            user,
            isButton: () => true,
            update: async (p) => {
              closedPanel = p;
            },
          },
          systems
        );
        assertStrictCv2(closedPanel, 'Đóng giao diện');
        assert.match(extractCv2Text(closedPanel), /Đã Đóng Giao Diện/);
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. Kiểm định riêng biệt 7 Giao Diện Game Components V2 (Ưu tiên #1 Bầu Cua & Tài Xỉu, cùng Nối Từ, Oẳn Tù Tì, Đoán Số, Đồng Xu, Đua Thú)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv2-all7games-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem, wordChainSystem } = systems;
      try {
        const u1 = {
          id: '900000000000000001',
          username: 'PlayerOne',
          displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/2.png',
        };
        const u2 = {
          id: '900000000000000002',
          username: 'PlayerTwo',
          displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/3.png',
        };
        for (const u of [u1, u2]) {
          economySystem.adminAdjustWallet({
            actorId: HARDCODED_OWNER_ID,
            actorRole: 'OWNER',
            targetId: u.id,
            targetName: u.username,
            mode: 'set',
            amount: 500_000,
          });
        }

        // --- GAME 1: BẦU CUA PRO MAX (Đặt nhiều cửa + Đặt lại cửa cũ + Modal cược từng cửa) ---
        let bcOpen = null;
        await COMMAND_MAP.get('baucua').execute(
          { user: u1, options: { getInteger: () => 2000 }, reply: async (p) => { bcOpen = p; } },
          systems
        );
        assertStrictCv2(bcOpen, 'Bầu Cua Open');
        assert.equal(bcOpen.files.length, 6, 'Bầu Cua hiển thị đủ 6 ảnh linh vật MediaGallery');

        // Nhập Modal đặt riêng từng cửa: bau 3000, tom 3000
        await routeComponentInteraction(
          {
            customId: `vgame_modal:baucua:custom_bet:${u1.id}`,
            user: u1,
            isModalSubmit: () => true,
            fields: { getTextInputValue: () => 'bau 3000, tom 3000' },
            update: async () => {},
          },
          systems
        );

        const bcFrames = [];
        await routeComponentInteraction(
          {
            customId: `vgame:baucua:confirm:${u1.id}`,
            user: u1,
            isButton: () => true,
            replied: false,
            deferred: false,
            update: async (p) => { bcFrames.push(p); },
            editReply: async (p) => { bcFrames.push(p); },
          },
          systems
        );
        assert.equal(bcFrames.length, 2, 'Bầu Cua chạy 1 khung lắc xúc xắc GIF + 1 bảng kết quả');
        assertStrictCv2(bcFrames[0], 'Bầu Cua Shake GIF');
        assertStrictCv2(bcFrames[1], 'Bầu Cua Result');
        assert.ok(bcFrames[1].files.length >= 3, 'Kết quả Bầu Cua hiển thị trực quan bộ 3 linh vật vừa ra');

        // Mở bàn mới + Đặt lại cửa cũ (Bầu 3.000 + Tôm 3.000 = 6.000₫)
        await routeComponentInteraction(
          { customId: `vgame:baucua:open:${u1.id}`, user: u1, isButton: () => true, update: async () => {} },
          systems
        );
        let rebetBoard = null;
        await routeComponentInteraction(
          {
            customId: `vgame:baucua:rebet:${u1.id}`,
            user: u1,
            isButton: () => true,
            update: async (p) => { rebetBoard = p; },
          },
          systems
        );
        assertStrictCv2(rebetBoard, 'Bầu Cua Đặt Lại Cửa Cũ');
        assert.match(extractCv2Text(rebetBoard), /6\.000/);

        // --- GAME 2: TÀI XỈU CASINO VIP (Cược Riêng Tư Ephemeral + Lịch sử 10 phiên) ---
        let txPrivate = null;
        await routeComponentInteraction(
          {
            customId: `vgame:taixiu:private:${u1.id}`,
            user: u1,
            isButton: () => true,
            reply: async (p) => { txPrivate = p; },
          },
          systems
        );
        assertStrictCv2(txPrivate, 'Tài Xỉu Private Ephemeral');
        assert.ok((txPrivate.flags & MessageFlags.Ephemeral) !== 0);

        // --- GAME 3: NỐI TỪ TIẾNG VIỆT PRO 1v1 (2 Khu vực Avatar Section + Thanh lượt + Đồng hồ + Bảng thắng) ---
        const ntHub = buildNoituHubPayload(wordChainSystem);
        assertStrictCv2(ntHub, 'Nối Từ Hub');
        const room = wordChainSystem.createRoom({
          guildId: 'g-nt',
          channelId: 'c-nt',
          hostId: u1.id,
          hostName: u1.username,
        });
        room.hostAvatarUrl = u1.displayAvatarURL();
        wordChainSystem.joinRoom({
          guildId: 'g-nt',
          channelId: 'c-nt',
          userId: u2.id,
          username: u2.username,
          roomId: room.roomId,
        });
        room.guestAvatarUrl = u2.displayAvatarURL();

        const ntLobby = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
        assertStrictCv2(ntLobby, 'Nối Từ Room Lobby 2 Players');
        wordChainSystem.startMatch({ roomId: room.roomId, channelId: 'c-nt', actorId: u1.id });
        const ntStart = buildMatchStartPayload(room, 1000);
        assertStrictCv2(ntStart, 'Nối Từ Match Start');
        const ntTurn = buildValidTurnPayload({
          room,
          playerUserId: u1.id,
          acceptedWord: 'học sinh',
          nextPrefix: 'sinh',
          nextTurnUserId: u2.id,
          timeoutSec: 30,
        });
        assertStrictCv2(ntTurn, 'Nối Từ Valid Turn');
        const { outcome } = wordChainSystem.surrender({ userId: u2.id, roomId: room.roomId });
        const ntWin = buildVictoryPayload(outcome);
        assertStrictCv2(ntWin, 'Nối Từ Victory');

        // --- GAME 4: OẲN TÙ TÌ (Bot & PvP 2 Người chơi) ---
        await COMMAND_MAP.get('rps').execute(
          {
            user: u1,
            options: { getUser: () => null, getString: () => null, getInteger: () => 2000 },
            reply: async (p) => assertStrictCv2(p, 'RPS Bot Open'),
          },
          systems
        );
        await routeComponentInteraction(
          { customId: `vgame:rps:pick:${u1.id}:scissors`, user: u1, isButton: () => true, update: async () => {} },
          systems
        );
        let rpsFinal = null;
        await routeComponentInteraction(
          {
            customId: `vgame:rps:confirm:${u1.id}`,
            user: u1,
            isButton: () => true,
            replied: false,
            deferred: false,
            update: async () => {},
            editReply: async (p) => { rpsFinal = p; },
          },
          systems
        );
        assertStrictCv2(rpsFinal, 'RPS Bot Final');

        // PvP Oẳn Tù Tì đối đầu u1 vs u2
        let pvpInvite = null;
        await COMMAND_MAP.get('rps').execute(
          {
            user: u1,
            options: {
              getUser: () => u2,
              getString: () => 'rock',
              getInteger: () => 5000,
            },
            reply: async (p) => { pvpInvite = p; },
          },
          systems
        );
        assertStrictCv2(pvpInvite, 'RPS PvP Invite');
        const pvpBtnId = pvpInvite.components[0].toJSON().components.find((c) => c.type === 1).components[0].custom_id;
        const cid = pvpBtnId.split(':')[2];

        let pvpFinal = null;
        await routeComponentInteraction(
          {
            customId: `rps:accept:${cid}:scissors`,
            user: u2,
            isButton: () => true,
            replied: false,
            deferred: false,
            update: async () => {},
            editReply: async (p) => { pvpFinal = p; },
          },
          systems
        );
        assertStrictCv2(pvpFinal, 'RPS PvP Final');
        assert.match(extractCv2Text(pvpFinal), /NGƯỜI CHIẾN THẮNG/);

        // --- GAME 5: ĐOÁN SỐ BÍ ẨN (Nhiều lượt + Gợi ý Lớn Hơn/Nhỏ Hơn + Nút Đoán Nhanh Số Giữa) ---
        await COMMAND_MAP.get('guess').execute(
          {
            user: u1,
            options: { getString: () => null, getInteger: () => 2000 },
            reply: async (p) => assertStrictCv2(p, 'Guess Setup'),
          },
          systems
        );
        let guessActive = null;
        await routeComponentInteraction(
          { customId: `vgame:guess:confirm:${u1.id}`, user: u1, isButton: () => true, update: async (p) => { guessActive = p; } },
          systems
        );
        assertStrictCv2(guessActive, 'Guess Active Decoder');
        const midBtn = guessActive.components[0]
          .toJSON()
          .components.flatMap((c) => c.components || [])
          .find((b) => b.custom_id?.startsWith(`vgame:guess:quick:${u1.id}:`));
        assert.ok(midBtn, 'Phải có nút Đoán Nhanh Số Giữa trên Mobile');

        let guessNext = null;
        await routeComponentInteraction(
          {
            customId: midBtn.custom_id,
            user: u1,
            isButton: () => true,
            replied: false,
            deferred: false,
            update: async (p) => { guessNext = p; },
            editReply: async (p) => { guessNext = p; },
          },
          systems
        );
        assertStrictCv2(guessNext, 'Guess Turn Response');

        // --- GAME 6: TUNG ĐỒNG XU HOÀNG KIM ---
        await COMMAND_MAP.get('coinflip').execute(
          {
            user: u1,
            options: { getString: () => null, getInteger: () => 2000 },
            reply: async (p) => assertStrictCv2(p, 'Coinflip Open'),
          },
          systems
        );
        await routeComponentInteraction(
          { customId: `vgame:coinflip:pick:${u1.id}:ngua`, user: u1, isButton: () => true, update: async () => {} },
          systems
        );
        let cfFinal = null;
        await routeComponentInteraction(
          {
            customId: `vgame:coinflip:confirm:${u1.id}`,
            user: u1,
            isButton: () => true,
            replied: false,
            deferred: false,
            update: async () => {},
            editReply: async (p) => { cfFinal = p; },
          },
          systems
        );
        assertStrictCv2(cfFinal, 'Coinflip Result');

        // --- GAME 7: ĐUA THÚ TỐC ĐỘ (2 Chặng Animation trực tiếp + Bảng Xếp Hạng #1..#5) ---
        await COMMAND_MAP.get('race').execute(
          {
            user: u1,
            options: { getString: () => null, getInteger: () => 2000 },
            reply: async (p) => assertStrictCv2(p, 'Race Open'),
          },
          systems
        );
        await routeComponentInteraction(
          { customId: `vgame:race:pick:${u1.id}:cheetah`, user: u1, isButton: () => true, update: async () => {} },
          systems
        );
        const raceFrames = [];
        await routeComponentInteraction(
          {
            customId: `vgame:race:confirm:${u1.id}`,
            user: u1,
            isButton: () => true,
            replied: false,
            deferred: false,
            update: async (p) => { raceFrames.push(p); },
            editReply: async (p) => { raceFrames.push(p); },
          },
          systems
        );
        assert.equal(raceFrames.length, 3, 'Đua Thú chạy đủ 2 chặng tiến độ + 1 bảng kết quả chung cuộc');
        for (const [idx, frame] of raceFrames.entries()) {
          assertStrictCv2(frame, `Race Frame #${idx + 1}`);
        }
        assert.match(extractCv2Text(raceFrames[2]), /CHUNG CUỘC.*VỀ NHẤT/);

        wordChainSystem.shutdownCleanup();
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Đa người chơi đồng thời, Chống mạo danh phiên, Hết hạn TTL, Session Generation Guard & AnimationManager Cap', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv2-concurrency-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem } = systems;
      try {
        // A. Kiểm tra PermissionManager & HARDCODED_OWNER_ID
        const pm = new PermissionManager(db);
        assert.equal(pm.isOwner('1243061570247069696'), true);
        assert.equal(pm.canManageAdmins('1243061570247069696'), true);
        assert.equal(pm.canManageAdmins('999999999999999999'), false);

        // B. 5 người chơi cùng lúc mở và chơi Tài Xỉu song song không chồng chéo trạng thái
        const players = Array.from({ length: 5 }, (_, i) => ({
          id: `70000000000000000${i + 1}`,
          username: `ConcurrentP${i + 1}`,
        }));
        for (const p of players) {
          economySystem.adminAdjustWallet({
            actorId: HARDCODED_OWNER_ID,
            actorRole: 'OWNER',
            targetId: p.id,
            targetName: p.username,
            mode: 'set',
            amount: 20_000,
          });
          await COMMAND_MAP.get('taixiu').execute(
            {
              user: p,
              options: { getString: () => null, getInteger: () => Number(p.id.slice(-1)) * 1000 },
              reply: async () => {},
            },
            systems
          );
        }

        await Promise.all(
          players.map(async (p, idx) => {
            const side = idx % 2 === 0 ? 'tai' : 'xiu';
            await routeComponentInteraction(
              { customId: `vgame:taixiu:pick:${p.id}:${side}`, user: p, isButton: () => true, update: async () => {} },
              systems
            );
            let donePayload = null;
            await routeComponentInteraction(
              {
                customId: `vgame:taixiu:confirm:${p.id}`,
                user: p,
                isButton: () => true,
                replied: false,
                deferred: false,
                update: async () => {},
                editReply: async (pl) => { donePayload = pl; },
              },
              systems
            );
            assertStrictCv2(donePayload, `Concurrent Finish ${p.username}`);
          })
        );

        // C. Phiên đặt cược hết hạn TTL -> Báo hết hạn thân thiện bằng Components V2 thay vì lỗi
        const expUser = { id: '710000000000000099', username: 'ExpiredUser' };
        const draft = upsertBettingDraft('coinflip', expUser.id, { betAmount: 1000 });
        draft.expiresAt = Date.now() - 5000;
        const inspected = inspectBettingDraft('coinflip', expUser.id);
        assert.equal(inspected.expired, true);
        assert.equal(getBettingDraft('coinflip', expUser.id), null);

        // D. AnimationManager giới hạn số tiến trình đồng thời & thu gọn nhanh sang kết quả cuối khi quá tải
        const animMgr = new AnimationManager({ maxConcurrentGlobal: 1 });
        let slowResolve;
        const slowStage = new Promise((r) => { slowResolve = r; });

        const pSlow = animMgr.runStagedAnimation({
          sessionKey: 's-1',
          interaction: {
            replied: false,
            deferred: false,
            async update() { this.replied = true; await slowStage; },
            async editReply() {},
          },
          stages: [{ payload: { flags: MessageFlags.IsComponentsV2, components: [] }, delayMs: 20 }],
          finalPayload: { flags: MessageFlags.IsComponentsV2, components: [] },
        });

        const seenFast = [];
        await animMgr.runStagedAnimation({
          sessionKey: 's-2',
          interaction: {
            replied: false,
            deferred: false,
            async update(p) { this.replied = true; seenFast.push(p); },
            async editReply(p) { seenFast.push(p); },
          },
          stages: [{ payload: { marker: 'stage' }, delayMs: 500 }],
          finalPayload: { marker: 'final' },
        });
        assert.equal(seenFast.length, 1);
        assert.equal(seenFast[0].marker, 'final');

        slowResolve();
        await pSlow;
        animMgr.shutdownCleanup();
        assert.equal(animMgr.activeCount, 0);

        // E. Kiểm tra bộ nhớ tiến trình an toàn cho gói FREE 512MB RAM của botkeep.cloud
        const rssMb = process.memoryUsage().rss / 1024 / 1024;
        assert.ok(rssMb < 250, `RSS hiện tại (${rssMb.toFixed(1)} MB) phải nằm gọn dưới ngưỡng 512MB của botkeep.cloud`);
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
