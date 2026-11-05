import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import { createBotSystems } from '../src/systems/index.js';
import {
  ensureAcked,
  installReplyFallback,
  respondPrimary,
} from '../src/ui/interactionHelpers.js';
import { safeHandleInteraction } from '../src/events/interactionCreate.js';
import { validateCv2Payload } from '../src/ui/componentsV2.js';
import { warmUpAssetCache } from '../src/utils/assetRegistry.js';

/**
 * Bộ kiểm thử chống lỗi Discord "Ứng dụng không phản hồi" (ack timeout 3 giây).
 *
 * Nguyên nhân thực tế trên VPS gói FREE: lệnh /baucua (mở phiên chung) phải dựng bảng
 * Components V2 + đọc nhiều tệp ảnh + mở giao dịch SQLite. Khi đĩa/CPU bận, phản hồi đầu tiên
 * vượt mốc 3 giây => Discord hiện "Ứng dụng không phản hồi" dù Bot vẫn online bình thường.
 */
describe('Chống Lỗi "Ứng Dụng Không Phản Hồi" — Auto-Ack, Reply Fallback & Lưới An Toàn', () => {
  it('1. ensureAcked: chỉ defer 1 lần, không lỗi khi Interaction đã được ack hoặc mock không hỗ trợ', async () => {
    let deferCount = 0;
    const interaction = {
      deferred: false,
      replied: false,
      deferReply: async () => {
        deferCount += 1;
        interaction.deferred = true;
      },
    };

    assert.equal(await ensureAcked(interaction), true);
    assert.equal(deferCount, 1);
    assert.equal(await ensureAcked(interaction), true, 'Đã defer trước đó thì không defer lại');
    assert.equal(deferCount, 1);

    // Mock không có deferReply (dùng trong unit test cũ) => trả false, tuyệt đối không ném lỗi
    assert.equal(await ensureAcked({ deferred: false, replied: false }), false);

    // Defer Ephemeral đúng cờ
    let capturedFlags = null;
    await ensureAcked(
      { deferred: false, replied: false, deferReply: async (o) => { capturedFlags = o?.flags ?? 0; } },
      { ephemeral: true }
    );
    assert.equal(capturedFlags, MessageFlags.Ephemeral);

    // Lỗi "Interaction đã được ack" (40060) từ Discord phải được coi là thành công
    const alreadyAcked = {
      deferred: false,
      replied: false,
      deferReply: async () => {
        const err = new Error('Interaction has already been acknowledged.');
        err.code = 40060;
        throw err;
      },
    };
    assert.equal(await ensureAcked(alreadyAcked), true);
  });

  it('2. installReplyFallback: reply() sau khi defer tự chuyển thành editReply() (không còn lỗi 40060)', async () => {
    let editPayload = null;
    let replyCalls = 0;
    const interaction = {
      deferred: true,
      replied: false,
      reply: async () => {
        replyCalls += 1;
        return 'reply';
      },
      editReply: async (payload) => {
        editPayload = payload;
        return 'edited';
      },
    };

    installReplyFallback(interaction);
    const res = await interaction.reply({ contentV2: 'bảng mới' });
    assert.equal(res, 'edited');
    assert.equal(replyCalls, 0, 'Không được gọi reply thô khi Interaction đã được defer');
    assert.deepEqual(editPayload, { contentV2: 'bảng mới' });

    // Chưa ack => gọi reply thô như bình thường
    let plainCalls = 0;
    const plain = {
      deferred: false,
      replied: false,
      reply: async () => {
        plainCalls += 1;
        return 'plain';
      },
      editReply: async () => 'x',
    };
    installReplyFallback(plain);
    assert.equal(await plain.reply({ a: 1 }), 'plain');
    assert.equal(plainCalls, 1);
    assert.equal(installReplyFallback(plain), plain, 'Không gắn lớp đệm 2 lần');
  });

  it('3. respondPrimary: trả về tin nhắn sau defer hoặc reply thường', async () => {
    const sentMessage = { id: 'msg-1' };
    const deferredInteraction = {
      deferred: true,
      replied: false,
      editReply: async () => ({ resource: { message: sentMessage } }),
      reply: async () => null,
    };
    assert.equal(await respondPrimary(deferredInteraction, { files: [] }), sentMessage);

    const freshMessage = { id: 'msg-2' };
    const freshInteraction = {
      deferred: false,
      replied: false,
      reply: async () => ({ resource: { message: freshMessage } }),
    };
    assert.equal(await respondPrimary(freshInteraction, { files: [] }), freshMessage);
  });

  it('4. /baucua xử lý chậm > 3s vẫn được ack tự động và đăng bảng bằng editReply (không lỗi "không phản hồi")', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ack-slow-baucua-'));
    try {
      const systems = await createBotSystems(tmpDir);
      systems.multiplayerRoundSystem.getRoundDurationSec = () => 120;
      // Kênh chơi Bầu Cua đã được Admin cài đặt đúng như trên server thật
      systems.db.setGameChannel('guild-ack', 'baucua', 'chan-ack-baucua', '1243061570247069696');
      try {
        let deferPayload = null;
        let editedPayload = null;
        const interaction = {
          deferred: false,
          replied: false,
          guildId: 'guild-ack',
          channelId: 'chan-ack-baucua',
          commandName: 'baucua',
          user: { id: 'player-ack', username: 'Player', bot: false },
          member: { permissions: { has: () => false } },
          isChatInputCommand: () => true,
          isRepliable: () => true,
          deferReply: async (options) => {
            deferPayload = options ?? {};
            interaction.deferred = true;
          },
          editReply: async (payload) => {
            editedPayload = payload;
            return { resource: { message: { id: 'board-ack-1' } } };
          },
          reply: async () => {
            throw new Error('Phải dùng editReply sau khi đã defer!');
          },
          followUp: async () => ({ id: 'follow' }),
          options: { getString: () => 'chung', getInteger: () => null, getSubcommand: () => null },
        };

        // Giả lập SQLite/CPU bận kéo dài 2.5 giây (trước mốc 3 giây của Discord)
        const originalStartRound = systems.multiplayerRoundSystem.startRound.bind(
          systems.multiplayerRoundSystem
        );
        systems.multiplayerRoundSystem.startRound = async (args) => {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          return originalStartRound(args);
        };

        await safeHandleInteraction(interaction, systems);

        assert.equal(interaction.deferred, true, 'Phải được ack (defer) trước mốc 3 giây');
        assert.deepEqual(deferPayload, {}, 'Defer công khai để bảng phiên hiện cho cả kênh');
        assert.ok(editedPayload, 'Bảng phiên phải được gửi qua editReply sau khi defer');
        assert.equal(validateCv2Payload(editedPayload).valid, true, 'Bảng phiên vẫn đúng chuẩn Components V2');
        assert.equal(editedPayload.files.length > 0, true, 'Vẫn đính kèm ảnh bảng Bầu Cua');

        const actives = systems.multiplayerRoundSystem.getActiveRounds('guild-ack', 'baucua');
        assert.equal(actives.length, 1, 'Phiên chung vẫn được mở bình thường dù phản hồi chậm');
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Nút bấm cũ/hết hạn không còn im lặng: luôn gửi thông báo Ephemeral thay vì để Discord báo "không phản hồi"', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ack-stale-component-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        let replyPayload = null;
        const interaction = {
          deferred: false,
          replied: false,
          guildId: 'guild-stale',
          channelId: 'chan-stale',
          customId: 'khong_ton_tai:nut_cu:123',
          user: { id: 'player-stale', username: 'Player', bot: false },
          member: { permissions: { has: () => false } },
          isChatInputCommand: () => false,
          isButton: () => true,
          isStringSelectMenu: () => false,
          isModalSubmit: () => false,
          isRepliable: () => true,
          reply: async (payload) => {
            replyPayload = payload;
            interaction.replied = true;
          },
          followUp: async () => null,
        };

        await safeHandleInteraction(interaction, systems);

        assert.ok(replyPayload, 'Phải có phản hồi thay vì im lặng');
        assert.equal(validateCv2Payload(replyPayload).valid, true);
        assert.equal((replyPayload.flags & MessageFlags.Ephemeral) !== 0, true);
      } finally {
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. warmUpAssetCache nạp sẵn toàn bộ ảnh/GIF game vào RAM để lệnh đầu tiên không bị chậm', async () => {
    const loaded = await warmUpAssetCache({ batchSize: 25 });
    assert.ok(loaded >= 60, `Phải nạp sẵn được nhiều tệp tài nguyên (thực tế: ${loaded})`);
  });
});
