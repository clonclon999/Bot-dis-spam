import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  COMMAND_MAP,
  routeComponentInteraction,
} from '../src/commands/index.js';
import { HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { safeHandleInteraction } from '../src/events/interactionCreate.js';
import { createBotSystems } from '../src/systems/index.js';

describe('Interactive UI Commands (Buttons, Select Menus, Modals, Maintenance & Ban Guards)', () => {
  it('vận hành mượt mà Bàn Bầu Cua tương tác, Cửa hàng Mua Nhanh, Nhiệm vụ Nhận Nhanh & ADMIN PRO Dashboard Modal', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ui-cmd-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem, questSystem } = systems;

      try {
        economySystem.adminAdjustWallet({
          actorId: HARDCODED_OWNER_ID,
          actorRole: 'OWNER',
          targetId: 'u-ui-1',
          targetName: 'PlayerUI',
          mode: 'set',
          amount: 500_000,
        });

        // 1. Mở bàn hình ảnh /baucua -> Chọn 2 linh vật trên lưới 6 cửa -> Bấm Xác Nhận Lắc Bầu Cua
        let bcReply = null;
        await COMMAND_MAP.get('baucua').execute(
          {
            user: { id: 'u-ui-1', username: 'PlayerUI' },
            options: { getInteger: () => null, getString: () => null },
            reply: async (p) => {
              bcReply = p;
            },
          },
          systems
        );
        assert.equal(bcReply.components.length, 5);
        assert.equal(bcReply.files.length, 1);

        await routeComponentInteraction(
          {
            customId: 'vgame:baucua:pick:u-ui-1:bau',
            user: { id: 'u-ui-1', username: 'PlayerUI' },
            update: async () => {},
          },
          systems
        );
        await routeComponentInteraction(
          {
            customId: 'vgame:baucua:pick:u-ui-1:cua',
            user: { id: 'u-ui-1', username: 'PlayerUI' },
            update: async () => {},
          },
          systems
        );

        const bcEdits = [];
        await routeComponentInteraction(
          {
            customId: 'vgame:baucua:confirm:u-ui-1',
            user: { id: 'u-ui-1', username: 'PlayerUI' },
            deferUpdate: async () => {},
            editReply: async (p) => {
              bcEdits.push(p);
            },
          },
          systems
        );
        assert.equal(bcEdits.length, 2); // Bước 1: GIF lắc xúc xắc -> Bước 2: Ảnh 3 xúc xắc thực tế + Bảng thanh toán
        assert.match(bcEdits[1].embeds[0].data.description, /Bảng Thanh Toán Chi Tiết/);

        // 2. Mua nhanh vật phẩm từ Select Menu trên /shop
        let quickBought = null;
        await routeComponentInteraction(
          {
            customId: 'shop:quickbuy:u-ui-1',
            user: { id: 'u-ui-1', username: 'PlayerUI' },
            isStringSelectMenu: () => true,
            values: ['lucky_ticket'],
            reply: async (p) => {
              quickBought = p;
            },
          },
          systems
        );
        assert.match(quickBought.embeds[0].data.title, /Mua Nhanh Thành Công/);

        // 3. Bấm nút Nhận Thưởng Ngay trên bảng /quest
        questSystem.incrementMetric('u-ui-1', 'work_count', 5);
        let questUpdated = null;
        await routeComponentInteraction(
          {
            customId: 'quest:claim_all:u-ui-1:daily',
            user: { id: 'u-ui-1', username: 'PlayerUI' },
            update: async (p) => {
              questUpdated = p;
            },
          },
          systems
        );
        assert.match(questUpdated.embeds[0].data.fields[0].name, /Đã Nhận Thưởng/);

        // 4. Mở ADMIN PRO Dashboard & nộp Modal cộng tiền nhanh
        let dashReply = null;
        await COMMAND_MAP.get('admin').execute(
          {
            user: { id: HARDCODED_OWNER_ID, username: 'Owner' },
            options: {
              getSubcommandGroup: () => 'system',
              getSubcommand: () => 'dashboard',
            },
            reply: async (p) => {
              dashReply = p;
            },
          },
          systems
        );
        assert.match(dashReply.embeds[0].data.title, /ADMIN PRO/);

        let modalResult = null;
        await routeComponentInteraction(
          {
            customId: `admdash:money_submit:${HARDCODED_OWNER_ID}`,
            user: { id: HARDCODED_OWNER_ID, username: 'Owner' },
            isModalSubmit: () => true,
            fields: {
              getTextInputValue: (k) => (k === 'target_id' ? '100000000000000001' : '50000'),
            },
            reply: async (p) => {
              modalResult = p;
            },
          },
          systems
        );
        assert.match(modalResult.content, /70\.000 VNĐ/);

        // 5. Kiểm tra Chế độ Bảo trì (Maintenance) chặn người chơi thường nhưng cho phép OWNER
        db.setSetting('maintenanceMode', true);
        let maintBlocked = null;
        await safeHandleInteraction(
          {
            user: { id: 'regular-999', username: 'Member', bot: false },
            isChatInputCommand: () => true,
            commandName: 'balance',
            reply: async (p) => {
              maintBlocked = p;
            },
          },
          systems
        );
        assert.match(maintBlocked.embeds[0].data.title, /Bảo Trì/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
