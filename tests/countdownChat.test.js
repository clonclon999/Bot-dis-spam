import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createBotSystems } from '../src/systems/index.js';
import { GAME_IDS } from '../src/config/constants.js';

/**
 * Kiểm thử tính năng CHAT ĐẾM NGƯỢC LÊN KÊNH:
 * tới mốc 3 – 2 – 1 giây cuối, Bot phải gửi HẲN tin nhắn vào kênh (không chỉ sửa bảng),
 * mỗi mốc đúng 1 lần, tự xóa sau vài giây, và chat thêm "HẾT THỜI GIAN" khi khóa sổ.
 */
describe('Chat Đếm Ngược 3 – 2 – 1 Lên Kênh Khi Sắp Hết Giờ Đặt Cược', () => {
  const makeChannel = (sentLog) => ({
    id: 'chan-countdown',
    messages: { fetch: async () => null },
    send: async (payload) => {
      const msg = {
        id: `cd-msg-${sentLog.length + 1}`,
        payload,
        deleted: false,
        delete: async () => {
          msg.deleted = true;
          return msg;
        },
      };
      sentLog.push(msg);
      return msg;
    },
  });

  it('1. chatCountdown gửi đúng tin nhắn cho mốc 3, 2, 1 và KHÔNG BAO GIỜ gửi trùng', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'countdown-chat-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        const sent = [];
        mp.attachClient({ channels: { cache: new Map([['chan-countdown', makeChannel(sent)]]) } });

        const round = await mp.startRound({
          guildId: 'guild-cd',
          channelId: 'chan-countdown',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p-cd',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        // Mốc 3
        assert.equal(await mp.chatCountdown(roundId, 3), true);
        assert.equal(sent.length, 1);
        assert.match(sent[0].payload.content, /3\*\*.*KHÓA SỔ|CHUẨN BỊ KHÓA SỔ/);
        assert.match(sent[0].payload.content, new RegExp(roundId));

        // Gọi lại mốc 3 (VD: do bot schedule lại) -> tuyệt đối không chat trùng
        assert.equal(await mp.chatCountdown(roundId, 3), false);
        assert.equal(sent.length, 1, 'Mỗi mốc giây chỉ được chat đúng 1 lần');

        // Mốc 2 & 1
        assert.equal(await mp.chatCountdown(roundId, 2), true);
        assert.equal(await mp.chatCountdown(roundId, 1), true);
        assert.equal(sent.length, 3);
        assert.match(sent[1].payload.content, /2\*\*/);
        assert.match(sent[2].payload.content, /1\*\*/);
        assert.match(sent[2].payload.content, /KHÓA CỬA NGAY/);

        // Mốc không hợp lệ bị bỏ qua
        assert.equal(await mp.chatCountdown(roundId, 0), false);
        assert.equal(await mp.chatCountdown(roundId, 5), false);
        assert.equal(sent.length, 3);

        // Đã chốt phiên thì không chat đếm ngược nữa
        await mp.finalizeRound(roundId, { skipAnimation: true });
        assert.equal(await mp.chatCountdown(roundId, 1), false);
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. finalizeRound tự chat "HẾT THỜI GIAN" đúng 1 lần cho mỗi phiên', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'countdown-timeup-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        const sent = [];
        mp.attachClient({ channels: { cache: new Map([['chan-countdown', makeChannel(sent)]]) } });

        const round = await mp.startRound({
          guildId: 'guild-cd2',
          channelId: 'chan-countdown',
          gameId: GAME_IDS.TAIXIU,
          userId: 'p-cd2',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        await mp.finalizeRound(roundId, { skipAnimation: true });

        const timeUpMsgs = sent.filter((m) => /HẾT THỜI GIAN/.test(m.payload.content));
        assert.equal(timeUpMsgs.length, 1, 'Phải chat đúng 1 tin "HẾT THỜI GIAN"');

        // Chốt lại lần nữa (idempotent) -> không chat thêm
        await mp.finalizeRound(roundId, { skipAnimation: true });
        assert.equal(
          sent.filter((m) => /HẾT THỜI GIAN/.test(m.payload.content)).length,
          1
        );
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Không có client / kênh bị xóa thì bỏ qua an toàn, không ném lỗi', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'countdown-noclient-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        const round = await mp.startRound({
          guildId: 'guild-cd3',
          channelId: 'chan-missing',
          gameId: GAME_IDS.RACE,
          userId: 'p-cd3',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        assert.equal(await mp.chatCountdown(roundId, 3), false);
        assert.equal(await mp.chatTimeUp(roundId), false);

        // Kênh không tồn tại trong cache -> bỏ qua, không crash
        mp.attachClient({ channels: { cache: new Map() } });
        assert.equal(await mp.chatCountdown(roundId, 3), false);
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
