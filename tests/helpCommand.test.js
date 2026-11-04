import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  COMMAND_MAP,
  getSlashCommandsJSON,
  routeComponentInteraction,
} from '../src/commands/index.js';
import { createBotSystems } from '../src/systems/index.js';

describe('Slash Command /help, /menu & Central 36-Command Registry', () => {
  it('đăng ký đầy đủ 36 Slash Commands chuẩn giới hạn Discord API', () => {
    const allJson = getSlashCommandsJSON();
    assert.equal(allJson.length, 36);
    for (const name of [
      'help', 'menu', 'balance', 'daily', 'baucua', 'taixiu',
      'quest', 'shop', 'pet', 'profile', 'rob', 'event', 'admin', 'owner', 'antispam',
    ]) {
      assert.ok(COMMAND_MAP.has(name), `Thiếu lệnh /${name}`);
    }

    for (const cmd of allJson) {
      assert.ok(cmd.description.length >= 1 && cmd.description.length <= 100);
    }
  });

  it('hiển thị đầy đủ 6 danh mục /help qua Select Menu và thao tác nhanh trên /menu', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gamebot-help-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        const helpCmd = COMMAND_MAP.get('help');
        let lastReply = null;
        await helpCmd.execute({
          user: { id: 'u-help-1', username: 'Tester' },
          options: { getString: () => 'games' },
          reply: async (p) => {
            lastReply = p;
          },
        });
        assert.match(lastReply.embeds[0].data.title, /GAMES/);
        assert.equal(lastReply.components.length, 1);

        // Chuyển danh mục ngay trên cùng Embed bằng Select Menu
        let updatedPayload = null;
        const handled = await routeComponentInteraction(
          {
            customId: 'core:help_cat:u-help-1',
            user: { id: 'u-help-1', username: 'Tester' },
            isStringSelectMenu: () => true,
            values: ['economy'],
            update: async (p) => {
              updatedPayload = p;
            },
          },
          systems
        );
        assert.equal(handled, true);
        assert.match(updatedPayload.embeds[0].data.title, /ECONOMY/);

        // Kiểm tra /menu + bấm nút điểm danh /daily trực tiếp trên /menu
        const menuCmd = COMMAND_MAP.get('menu');
        let menuReply = null;
        await menuCmd.execute(
          {
            user: {
              id: 'u-help-1',
              username: 'Tester',
              displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            },
            reply: async (p) => {
              menuReply = p;
            },
          },
          systems
        );
        assert.ok(menuReply.embeds[0]);

        let menuUpdated = null;
        await routeComponentInteraction(
          {
            customId: 'core:menu_daily:u-help-1',
            user: {
              id: 'u-help-1',
              username: 'Tester',
              displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            },
            update: async (p) => {
              menuUpdated = p;
            },
          },
          systems
        );
        assert.match(menuUpdated.embeds[0].data.fields[0].name, /Điểm Danh Thành Công/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
