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

describe('Slash Command /help, /menu & Central 38-Command Registry', () => {
  it('đăng ký đầy đủ 38 Slash Commands chuẩn giới hạn Discord API (bao gồm /games & /noitu)', () => {
    const allJson = getSlashCommandsJSON();
    assert.equal(allJson.length, 38);
    for (const name of [
      'help', 'menu', 'games', 'balance', 'daily', 'baucua', 'taixiu', 'noitu',
      'quest', 'shop', 'pet', 'profile', 'rob', 'event', 'admin', 'owner', 'antispam',
    ]) {
      assert.ok(COMMAND_MAP.has(name), `Thiếu lệnh /${name}`);
    }

    for (const cmd of allJson) {
      assert.ok(cmd.description.length >= 1 && cmd.description.length <= 100);
    }
  });

  it('hiển thị 6 danh mục /help không bị trùng emoji 🏠 và điều hướng tại chỗ trên /menu', async () => {
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
        // Kiểm tra SelectMenu option đầu tiên không bị lặp emoji 🏠 trong label
        const firstOptLabel = lastReply.components[0].components[0].options[0].data.label;
        assert.equal(firstOptLabel, 'Tổng Quan Hệ Thống');

        // Chuyển danh mục ngay trên cùng Embed bằng Select Menu
        let updatedPayload = null;
        const handled = await routeComponentInteraction(
          {
            customId: 'core:help_cat:u-help-1:0',
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

        // Kiểm tra /menu chuyển sang Hướng dẫn & quay lại Menu ngay trên cùng 1 tin nhắn
        let inPlaceView = null;
        await routeComponentInteraction(
          {
            customId: 'core:menu_help:u-help-1',
            user: {
              id: 'u-help-1',
              username: 'Tester',
              displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            },
            update: async (p) => {
              inPlaceView = p;
            },
          },
          systems
        );
        assert.match(inPlaceView.embeds[0].data.title, /TRUNG TÂM HƯỚNG DẪN/);

        let backToMenu = null;
        await routeComponentInteraction(
          {
            customId: 'core:menu_back:u-help-1',
            user: {
              id: 'u-help-1',
              username: 'Tester',
              displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            },
            update: async (p) => {
              backToMenu = p;
            },
          },
          systems
        );
        assert.match(backToMenu.embeds[0].data.author.name, /Trung Tâm Điều Khiển Nhanh/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
