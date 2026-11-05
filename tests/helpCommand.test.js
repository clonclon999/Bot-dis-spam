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
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';

describe('Slash Command /help, /menu & Central 39-Command Registry (Components V2)', () => {
  it('đăng ký đầy đủ 39 Slash Commands chuẩn giới hạn Discord API (bao gồm /game, /games & /noitu)', () => {
    const allJson = getSlashCommandsJSON();
    assert.equal(allJson.length, 39);
    for (const name of [
      'help', 'menu', 'game', 'games', 'balance', 'daily', 'baucua', 'taixiu', 'noitu',
      'quest', 'shop', 'pet', 'profile', 'rob', 'event', 'admin', 'owner', 'antispam',
    ]) {
      assert.ok(COMMAND_MAP.has(name), `Thiếu lệnh /${name}`);
    }

    for (const cmd of allJson) {
      assert.ok(cmd.description.length >= 1 && cmd.description.length <= 100);
    }
  });

  it('hiển thị 6 danh mục /help không bị trùng emoji 🏠 và điều hướng tại chỗ trên /menu bằng Components V2', async () => {
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
        assert.equal(validateCv2Payload(lastReply).valid, true);
        assert.match(extractCv2Text(lastReply), /GAMES/);

        // Kiểm tra SelectMenu option đầu tiên bên trong Container V2 không bị lặp emoji 🏠 trong label
        const containerJson = lastReply.components[0].toJSON();
        const selectRow = containerJson.components.find(
          (c) => c.type === 1 && c.components?.[0]?.type === 3
        );
        assert.equal(selectRow.components[0].options[0].label, 'Tổng Quan Hệ Thống');

        // Chuyển danh mục ngay trên cùng Container V2 bằng Select Menu
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
        assert.equal(validateCv2Payload(updatedPayload).valid, true);
        assert.match(extractCv2Text(updatedPayload), /ECONOMY/);

        // Kiểm tra /menu chuyển sang Hướng dẫn & quay lại Menu ngay trên cùng 1 tin nhắn V2
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
        assert.equal(validateCv2Payload(inPlaceView).valid, true);
        assert.match(extractCv2Text(inPlaceView), /TRUNG TÂM HƯỚNG DẪN/);

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
        assert.equal(validateCv2Payload(backToMenu).valid, true);
        assert.match(extractCv2Text(backToMenu), /Trung Tâm Điều Khiển Nhanh/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
