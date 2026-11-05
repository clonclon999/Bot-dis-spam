import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import { COMMAND_MAP, routeComponentInteraction } from '../src/commands/index.js';
import { HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { safeHandleInteraction } from '../src/events/interactionCreate.js';
import { createBotSystems } from '../src/systems/index.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';
import { globalGuard } from '../src/utils/locks.js';

describe('Interactive UI Commands (Discord Components V2: Buttons, Select Menus, Modals, Maintenance & Ban Guards)', () => {
  it('vận hành mượt mà Bàn Bầu Cua V2, Cửa hàng Mua Nhanh, Nhiệm vụ Nhận Nhanh & ADMIN PRO Dashboard Modal', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ui-cmd-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem } = systems;
      try {
        const uid = '222222222222222222';
        economySystem.ensureUser(uid, 'UiTester');
        economySystem.adminAdjustWallet({
          actorId: HARDCODED_OWNER_ID,
          actorRole: 'OWNER',
          targetId: uid,
          mode: 'set',
          amount: 100_000,
        });

        // 1. Mở Bàn Bầu Cua tương tác V2 -> Chọn 2 linh vật Cua + Cá -> Lắc Xúc Xắc (pre-commit RNG + staged animation)
        let baucuaBoard = null;
        await COMMAND_MAP.get('baucua').execute(
          {
            user: { id: uid, username: 'UiTester' },
            options: { getInteger: () => 5000 },
            reply: async (p) => {
              baucuaBoard = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(baucuaBoard).valid, true);
        assert.equal(baucuaBoard.components.length, 2); // 2 Container V2 (Bàn 6 linh vật + Bảng chọn & Cược)

        // Chọn Cua (5.000₫) -> Chọn thêm Cá (5.000₫) -> Xác Nhận & Lắc Xúc Xắc (tổng 10.000₫)
        await routeComponentInteraction(
          {
            customId: `vgame:baucua:pick:${uid}:cua`,
            user: { id: uid, username: 'UiTester' },
            isButton: () => true,
            update: async () => {},
          },
          systems
        );
        await routeComponentInteraction(
          {
            customId: `vgame:baucua:pick:${uid}:ca`,
            user: { id: uid, username: 'UiTester' },
            isButton: () => true,
            update: async () => {},
          },
          systems
        );

        let rolledStage = null;
        let rolledFinal = null;
        await routeComponentInteraction(
          {
            customId: `vgame:baucua:confirm:${uid}`,
            user: { id: uid, username: 'UiTester' },
            isButton: () => true,
            replied: false,
            deferred: false,
            async update(p) {
              this.replied = true;
              rolledStage = p;
            },
            async editReply(p) {
              rolledFinal = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(rolledStage).valid, true);
        assert.equal(validateCv2Payload(rolledFinal).valid, true);
        assert.match(extractCv2Text(rolledFinal), /KẾT QUẢ MỞ BÁT BẦU CUA/);

        // 2. Mua Nhanh trên SelectMenu của /shop
        let shopBuyReply = null;
        await routeComponentInteraction(
          {
            customId: `shop:quickbuy:${uid}`,
            user: { id: uid, username: 'UiTester' },
            isStringSelectMenu: () => true,
            values: ['pet_food'],
            reply: async (p) => {
              shopBuyReply = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(shopBuyReply).valid, true);
        assert.match(extractCv2Text(shopBuyReply), /Mua Nhanh Thành Công/);

        // 3. Làm nhiệm vụ /daily rồi bấm nút "Nhận Thưởng Ngay" trên /quest V2
        economySystem.claimPeriodicReward(uid, 'UiTester', 'daily');
        let questClaimBoard = null;
        await routeComponentInteraction(
          {
            customId: `quest:claim_all:${uid}:daily`,
            user: { id: uid, username: 'UiTester' },
            isButton: () => true,
            update: async (p) => {
              questClaimBoard = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(questClaimBoard).valid, true);
        assert.match(extractCv2Text(questClaimBoard), /Đã Nhận Thưởng Tức Thì/);

        // 4. OWNER mở ADMIN PRO Dashboard V2 & gửi Modal điều chỉnh tiền
        let modalShown = null;
        await routeComponentInteraction(
          {
            customId: `admdash:money_modal:${HARDCODED_OWNER_ID}`,
            user: { id: HARDCODED_OWNER_ID, username: 'Owner' },
            showModal: async (m) => {
              modalShown = m;
            },
          },
          systems
        );
        assert.ok(modalShown);

        let modalResult = null;
        await routeComponentInteraction(
          {
            customId: `admdash:money_submit:${HARDCODED_OWNER_ID}`,
            user: { id: HARDCODED_OWNER_ID, username: 'Owner' },
            isModalSubmit: () => true,
            fields: {
              getTextInputValue: (k) => (k === 'target_id' ? uid : '25000'),
            },
            reply: async (p) => {
              modalResult = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(modalResult).valid, true);
        assert.match(extractCv2Text(modalResult), /Cập Nhật Số Dư Thành Công/);

        // 5. Bật chế độ Bảo trì -> Chặn MEMBER (bằng Ephemeral Components V2) nhưng vẫn cho phép OWNER thao tác
        db.setSetting('maintenanceMode', true);
        let maintBlocked = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            user: { id: uid, username: 'UiTester', bot: false },
            isChatInputCommand: () => true,
            commandName: 'balance',
            reply: async (p) => {
              maintBlocked = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(maintBlocked).valid, true);
        assert.ok((maintBlocked.flags & MessageFlags.Ephemeral) !== 0);
        assert.match(extractCv2Text(maintBlocked), /Bảo Trì/);

        db.setSetting('maintenanceMode', false);

        // 6. Khóa tài khoản người chơi -> Bị chặn tức thì ở cửa ngõ Interaction bằng V2 Ephemeral
        db.run('UPDATE users SET is_banned = 1, ban_reason = ? WHERE user_id = ?', [
          'Dùng macro auto-click',
          uid,
        ]);
        let banBlocked = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            user: { id: uid, username: 'UiTester', bot: false },
            isChatInputCommand: () => true,
            commandName: 'balance',
            reply: async (p) => {
              banBlocked = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(banBlocked).valid, true);
        assert.ok((banBlocked.flags & MessageFlags.Ephemeral) !== 0);
        assert.match(extractCv2Text(banBlocked), /Khóa Khỏi Hệ Thống/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
