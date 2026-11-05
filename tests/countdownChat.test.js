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

  it('4. 🔥 Kênh bị treo (channel.send không bao giờ trả về) thì phiên VẪN chốt kết quả bình thường — không đứng yên', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'countdown-freeze-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        // Kênh "chết": send treo vĩnh viễn, fetch treo vĩnh viễn (mô phỏng Discord/WebSocket kẹt)
        mp.attachClient({
          channels: {
            cache: new Map([
              [
                'chan-freeze',
                {
                  id: 'chan-freeze',
                  messages: { fetch: () => new Promise(() => {}) },
                  send: () => new Promise(() => {}),
                },
              ],
            ]),
            fetch: () => new Promise(() => {}),
          },
        });

        const round = await mp.startRound({
          guildId: 'guild-freeze',
          channelId: 'chan-freeze',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p-freeze',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        // Tin nhắn chat "HẾT THỜI GIAN" phải tự bỏ cuộc sau ~2.5s thay vì treo mãi
        const chatStart = Date.now();
        const sentOk = await mp.chatTimeUp(roundId);
        assert.equal(sentOk, false, 'Gửi thất bại phải trả về false');
        assert.ok(
          Date.now() - chatStart < 6_000,
          `chatTimeUp phải có giới hạn thời gian (thực tế ${Date.now() - chatStart}ms)`
        );

        // Chốt phiên: kết quả + trạng thái PHẢI hoàn tất dù kênh treo
        const t0 = Date.now();
        await mp.finalizeRound(roundId, { skipAnimation: true });
        const elapsed = Date.now() - t0;

        const row = systems.db.get(
          'SELECT status, result_json FROM multiplayer_rounds WHERE round_id = ?',
          [roundId]
        );
        assert.equal(row.status, 'COMPLETED', 'Phiên phải được công bố kết quả, không kẹt ở LOCKED');
        assert.ok(row.result_json, 'Kết quả chung phải được sinh và lưu vào DB');
        assert.ok(elapsed < 15_000, `Chốt phiên không được treo (thực tế ${elapsed}ms)`);
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Khóa chốt phiên bị kẹt quá 120 giây sẽ tự giải phóng để chốt lại (self-heal)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'countdown-heal-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        const round = await mp.startRound({
          guildId: 'guild-heal',
          channelId: 'chan-heal',
          gameId: GAME_IDS.TAIXIU,
          userId: 'p-heal',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        // Giả lập một lần chốt trước đó bị treo từ 30 giây trước
        mp._finalizingRounds.add(String(roundId));
        mp._finalizingSince.set(String(roundId), Date.now() - 130_000);

        await mp.finalizeRound(roundId, { skipAnimation: true });

        const row = systems.db.get('SELECT status FROM multiplayer_rounds WHERE round_id = ?', [roundId]);
        assert.equal(row.status, 'COMPLETED', 'Phải tự chữa lành và chốt xong phiên bị kẹt');
        assert.equal(mp._finalizingRounds.has(String(roundId)), false, 'Phải giải phóng khóa sau khi xong');
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Bộ quét an toàn tự chốt lại phiên bị kẹt (mất timer / restart) — kết quả luôn được công bố', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'countdown-sweep-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        const round = await mp.startRound({
          guildId: 'guild-sweep',
          channelId: 'chan-sweep',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p-sweep',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        // Mô phỏng timer bị mất & phiên đã quá giờ từ 5 giây trước
        mp._clearRoundTimers(roundId);
        systems.db.run('UPDATE multiplayer_rounds SET ends_at = ? WHERE round_id = ?', [
          Date.now() - 5_000,
          roundId,
        ]);

        const handled = await mp.sweepStuckRounds();
        assert.equal(handled >= 1, true, 'Bộ quét phải phát hiện phiên quá hạn');

        const row = systems.db.get('SELECT status, result_json FROM multiplayer_rounds WHERE round_id = ?', [roundId]);
        assert.equal(row.status, 'COMPLETED', 'Phiên bị kẹt phải được chốt và công bố kết quả');
        assert.ok(row.result_json);
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
