import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import { GAME_IDS, HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { safeHandleInteraction } from '../src/events/interactionCreate.js';
import { createBotSystems } from '../src/systems/index.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';
import { globalGuard } from '../src/utils/locks.js';

describe('Auto-Delete Previous Panels & Strict Per-Game Channel Enforcement (All 7 Games)', () => {
  it('tự động xóa bảng cũ (/menu, /help...) ngay khi người chơi mở bảng mới trong đoạn chat', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'panel-clean-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        const deletedMsgIds = [];
        let msgCounter = 0;

        const makeInteraction = (cmdName, userId) => {
          let currentMsg = null;
          return {
            guildId: 'guild-1',
            channelId: 'chan-general',
            commandName: cmdName,
            replied: false,
            deferred: false,
            user: {
              id: userId,
              username: 'BossBao',
              bot: false,
              displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            },
            isChatInputCommand: () => true,
            options: { getString: () => null, getUser: () => null, getSubcommand: () => null },
            async reply() {
              this.replied = true;
              const id = `msg-${++msgCounter}`;
              currentMsg = {
                id,
                channelId: 'chan-general',
                flags: { has: () => false },
                delete: async () => {
                  deletedMsgIds.push(id);
                },
              };
              return currentMsg;
            },
            async fetchReply() {
              return currentMsg;
            },
          };
        };

        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(makeInteraction('menu', 'u-clean-1'), systems);
        assert.deepEqual(deletedMsgIds, []);

        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(makeInteraction('menu', 'u-clean-1'), systems);
        assert.deepEqual(deletedMsgIds, ['msg-1']);

        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(makeInteraction('help', 'u-clean-1'), systems);
        assert.deepEqual(deletedMsgIds, ['msg-1', 'msg-2']);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('bắt buộc TẤT CẢ 7 trò chơi (baucua, taixiu, coinflip, guess, race, rps, noitu) phải gán kênh riêng và chơi đúng kênh', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'game-chan-all7-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db } = systems;
      try {
        const allGames = Object.values(GAME_IDS);
        assert.equal(allGames.length, 7);

        // 1. Khi chưa cài kênh: cả 7 trò đều bị chặn bằng tin nhắn ẩn (Ephemeral) ở kênh chung
        for (const gameCmd of allGames) {
          let blockedReply = null;
          globalGuard.lastActionAt.clear();
          await safeHandleInteraction(
            {
              guildId: 'guild-strict',
              channelId: 'chan-chat-chung',
              commandName: gameCmd,
              user: { id: 'player-1', username: 'Player', bot: false },
              isChatInputCommand: () => true,
              options: {
                getInteger: () => 1000,
                getString: () => null,
                getSubcommand: () => 'lobby',
                getUser: () => null,
              },
              reply: async (p) => {
                blockedReply = p;
              },
            },
            systems
          );
          assert.equal(validateCv2Payload(blockedReply).valid, true);
          assert.ok(
            (blockedReply.flags & MessageFlags.Ephemeral) !== 0,
            `Game ${gameCmd} phải phản hồi Ephemeral Components V2`
          );
          assert.match(extractCv2Text(blockedReply), /chưa được/);
        }

        // 2. OWNER gán kênh riêng biệt cho từng trò qua db / /admin game setchannel
        db.setGameChannel('guild-strict', 'baucua', 'chan-baucua', HARDCODED_OWNER_ID);
        db.setGameChannel('guild-strict', 'taixiu', 'chan-taixiu', HARDCODED_OWNER_ID);
        db.setGameChannel('guild-strict', 'noitu', 'chan-noitu', HARDCODED_OWNER_ID);

        // 3. Gọi /noitu ở nhầm kênh Bầu Cua -> Chặn Ephemeral V2 và chỉ sang <#chan-noitu>
        let wrongNoitu = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            guildId: 'guild-strict',
            channelId: 'chan-baucua',
            commandName: 'noitu',
            user: { id: 'player-1', username: 'Player', bot: false },
            isChatInputCommand: () => true,
            options: { getSubcommand: () => 'lobby' },
            reply: async (p) => {
              wrongNoitu = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(wrongNoitu).valid, true);
        assert.ok((wrongNoitu.flags & MessageFlags.Ephemeral) !== 0);
        assert.match(extractCv2Text(wrongNoitu), /<#chan-noitu>/);

        // 4. Bấm nút cũ của Bầu Cua ở nhầm kênh Tài Xỉu cũng bị chặn sạch sẽ
        let wrongBtn = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            guildId: 'guild-strict',
            channelId: 'chan-taixiu',
            customId: 'baucua:roll:s1',
            user: { id: 'player-1', username: 'Player', bot: false },
            isChatInputCommand: () => false,
            isButton: () => true,
            reply: async (p) => {
              wrongBtn = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(wrongBtn).valid, true);
        assert.ok((wrongBtn.flags & MessageFlags.Ephemeral) !== 0);
        assert.match(extractCv2Text(wrongBtn), /<#chan-baucua>/);

        // 5. Gọi /noitu lobby tại ĐÚNG kênh chan-noitu -> Thành công!
        let okNoitu = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            guildId: 'guild-strict',
            channelId: 'chan-noitu',
            commandName: 'noitu',
            user: { id: 'player-1', username: 'Player', bot: false },
            isChatInputCommand: () => true,
            options: { getSubcommand: () => 'lobby' },
            reply: async (p) => {
              okNoitu = p;
            },
          },
          systems
        );
        assert.equal(validateCv2Payload(okNoitu).valid, true);
        assert.match(extractCv2Text(okNoitu), /NỐI TỪ TIẾNG VIỆT PRO/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
