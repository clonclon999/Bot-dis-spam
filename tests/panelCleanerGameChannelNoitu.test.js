import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import { HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { safeHandleInteraction } from '../src/events/interactionCreate.js';
import { handleMessageCreate } from '../src/events/messageCreate.js';
import { createBotSystems } from '../src/systems/index.js';
import { globalGuard } from '../src/utils/locks.js';

describe('Auto-Delete Previous Panels, Per-Game Dedicated Channels & Pure-Vietnamese Nối Từ', () => {
  it('tự động xóa bảng cũ (/menu, /help...) ngay khi người chơi mở bảng mới trong đoạn chat', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'panel-clean-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        let deletedMsgIds = [];
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
            options: { getString: () => null, getUser: () => null },
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

        // Lần 1: Mở /menu -> tạo msg-1
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(makeInteraction('menu', 'u-clean-1'), systems);
        assert.deepEqual(deletedMsgIds, []);

        // Lần 2: Mở tiếp /menu -> msg-1 tự động bị xóa ngay!
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(makeInteraction('menu', 'u-clean-1'), systems);
        assert.deepEqual(deletedMsgIds, ['msg-1']);

        // Lần 3: Mở /help -> msg-2 tự động bị xóa ngay!
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

  it('bắt buộc mỗi trò chơi phải chơi đúng kênh đã gán và chặn Ephemeral nếu gọi nhầm kênh', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'game-chan-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db } = systems;
      try {
        // 1. Khi chưa gán kênh cho Bầu Cua trên guild-99 -> Chặn bằng thông báo Ephemeral
        let reply1 = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            guildId: 'guild-99',
            channelId: 'chan-chat-chung',
            commandName: 'baucua',
            user: { id: 'player-chan-1', username: 'Player', bot: false },
            isChatInputCommand: () => true,
            options: { getInteger: () => null, getString: () => null },
            reply: async (p) => {
              reply1 = p;
            },
          },
          systems
        );
        assert.equal(reply1.flags, MessageFlags.Ephemeral);
        assert.match(reply1.embeds[0].data.description, /chưa được Quản trị viên chỉ định kênh/);

        // 2. OWNER gán Bầu Cua vào #kênh-bầu-cua (chan-baucua) và Tài Xỉu vào #kênh-tài-xỉu (chan-taixiu)
        db.setGameChannel('guild-99', 'baucua', 'chan-baucua', HARDCODED_OWNER_ID);
        db.setGameChannel('guild-99', 'taixiu', 'chan-taixiu', HARDCODED_OWNER_ID);

        // 3. Gọi /baucua ở nhầm kênh Tài Xỉu -> Bị chặn Ephemeral chỉ đúng sang <#chan-baucua>
        let wrongChanReply = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            guildId: 'guild-99',
            channelId: 'chan-taixiu',
            commandName: 'baucua',
            user: { id: 'player-chan-1', username: 'Player', bot: false },
            isChatInputCommand: () => true,
            options: { getInteger: () => null, getString: () => null },
            reply: async (p) => {
              wrongChanReply = p;
            },
          },
          systems
        );
        assert.equal(wrongChanReply.flags, MessageFlags.Ephemeral);
        assert.match(wrongChanReply.embeds[0].data.description, /<#chan-baucua>/);

        // 4. Gọi /baucua tại ĐÚNG kênh chan-baucua -> Mở bàn Bầu Cua thành công!
        let okReply = null;
        globalGuard.lastActionAt.clear();
        await safeHandleInteraction(
          {
            guildId: 'guild-99',
            channelId: 'chan-baucua',
            commandName: 'baucua',
            user: { id: 'player-chan-1', username: 'Player', bot: false },
            isChatInputCommand: () => true,
            options: { getInteger: () => null, getString: () => null },
            reply: async (p) => {
              okReply = p;
            },
          },
          systems
        );
        assert.match(okReply.embeds[0].data.title, /Bầu Cua/);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('chơi Nối Từ Tiếng Việt đời thường mượt mà, chặn từ Hán-Việt khó, chuẩn hóa dấu thanh và tự dọn thẻ Bot cũ', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noitu-test-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, wordChainSystem, economySystem } = systems;
      try {
        db.setGameChannel('guild-vn', 'noitu', 'chan-noitu', HARDCODED_OWNER_ID);

        // Khởi tạo ván Đấu với Bot và đặt từ mở màn cố định "chìa khóa" để kiểm thử chính xác
        const session = wordChainSystem.startSession({
          guildId: 'guild-vn',
          channelId: 'chan-noitu',
          mode: 'bot',
          startedBy: HARDCODED_OWNER_ID,
        });
        session.currentWord = 'ổ khóa';
        session.nextSyllable = 'khóa';
        session.usedWords = new Set(['ổ khóa']);

        // 1. Gõ trên điện thoại kiểu dấu cũ "khoá cửa" -> Tự chuẩn hóa thành "khóa cửa" và HỢP LỆ!
        const r1 = wordChainSystem.submitWord({
          guildId: 'guild-vn',
          channelId: 'chan-noitu',
          userId: 'u-vn-1',
          username: 'NgBao',
          content: 'khoá cửa',
        });
        assert.equal(r1.ok, true);
        assert.equal(r1.playerWord, 'khóa cửa');
        assert.ok(r1.botWord || r1.roundWon);
        assert.ok(economySystem.getBalance('u-vn-1').wallet > 20_000);

        // 2. Chặn từ Hán-Việt cổ/khó (ví dụ "vô vi" / "bất khả" / "phụ mẫu")
        session.currentWord = 'áo vô';
        session.nextSyllable = 'vô';
        const hv = wordChainSystem.submitWord({
          guildId: 'guild-vn',
          channelId: 'chan-noitu',
          userId: 'u-vn-1',
          username: 'NgBao',
          content: 'vô vi',
        });
        assert.equal(hv.ok, false);
        assert.equal(hv.code, 'HAN_VIET');

        // 3. Bình luận bắt đầu bằng dấu chấm `.` được bỏ qua tự nhiên (không báo lỗi)
        const sideChat = wordChainSystem.submitWord({
          guildId: 'guild-vn',
          channelId: 'chan-noitu',
          userId: 'u-vn-1',
          username: 'NgBao',
          content: '.trò này vui quá anh em ơi',
        });
        assert.equal(sideChat, null);

        // 4. Kiểm tra qua pipeline messageCreate: chỉ kênh chan-noitu mới chạy Nối Từ và thẻ Bot cũ tự xóa
        session.currentWord = 'nhà cửa';
        session.nextSyllable = 'cửa';
        session.usedWords = new Set(['nhà cửa']);

        let botDeletedIds = [];
        let botMsgSeq = 0;
        const reactions = [];

        const mockChannel = {
          id: 'chan-noitu',
          send: async () => {
            const id = `bot-turn-${++botMsgSeq}`;
            return {
              id,
              delete: async () => {
                botDeletedIds.push(id);
              },
            };
          },
        };

        await handleMessageCreate(
          {
            guild: { id: 'guild-vn' },
            channel: mockChannel,
            author: { id: 'u-vn-2', username: 'Player2', bot: false },
            content: 'cửa sổ',
            react: async (emj) => reactions.push(emj),
          },
          systems
        );
        assert.deepEqual(reactions, ['✅']);
        assert.equal(botMsgSeq, 1);

        // Lượt tiếp theo nối đúng -> Thẻ phản hồi lượt trước của Bot (`bot-turn-1`) tự động bị xóa!
        const nextSyl = wordChainSystem.getSession('chan-noitu').nextSyllable;
        const validNext = wordChainSystem.lexicon.getCandidates(
          nextSyl,
          wordChainSystem.getSession('chan-noitu').usedWords
        )[0];
        assert.ok(validNext);

        await handleMessageCreate(
          {
            guild: { id: 'guild-vn' },
            channel: mockChannel,
            author: { id: 'u-vn-2', username: 'Player2', bot: false },
            content: validNext,
            react: async (emj) => reactions.push(emj),
          },
          systems
        );
        assert.deepEqual(botDeletedIds, ['bot-turn-1']);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
