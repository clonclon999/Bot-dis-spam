import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createBotSystems } from '../src/systems/index.js';
import { buildMultiplayerBoardPayload } from '../src/commands/games/multiplayerRound.js';
import { GAME_IDS, MP_ROUND_STATUS } from '../src/config/constants.js';
import { extractCv2Text } from '../src/ui/componentsV2.js';

/**
 * Kiểm thử hiệu năng tải lên (nguyên nhân gốc của AbortError "This operation was aborted"):
 *
 * Trước đây MỖI lần cập nhật bảng (cược mới, mốc 30/10/5s, đếm ngược 3-2-1) đều tải lại
 * toàn bộ ảnh banner + gallery lên Discord (~130–600 KB/lần). Trên VPS gói FREE việc này
 * vượt hạn 15 giây của @discordjs/rest => AbortError liên tục và bảng kết quả không được công bố.
 *
 * Giờ: ảnh CHỈ tải lên đúng 1 lần khi đăng bảng mới (isEdit=false) và 1 lần khi công bố kết quả.
 * Mọi bản cập nhật giữa phiên là tin nhắn siêu nhẹ (chỉ chữ).
 */
describe('Cập Nhật Bảng Siêu Nhẹ — Không Tải Lại Ảnh Mỗi Lần Cập Nhật', () => {
  const collectAttachmentUrls = (payload) => {
    const json = JSON.stringify(payload.components ?? []);
    return json.match(/attachment:\/\/[^"]+/g) ?? [];
  };

  it('1. Đăng bảng mới có ảnh, còn MỌI lần cập nhật giữa phiên thì không gửi file nào', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-board-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        for (const gameId of [GAME_IDS.BAUCUA, GAME_IDS.TAIXIU, GAME_IDS.RACE]) {
          systems.db.setGameChannel('g-slim', gameId, `chan-${gameId}`, '1243061570247069696');
          const round = await systems.multiplayerRoundSystem.startRound({
            guildId: 'g-slim',
            channelId: `chan-${gameId}`,
            gameId,
            userId: 'p-slim',
          });
          const roundId = round.round?.round_id || round.snapshot?.round?.round_id;
          const snap = systems.multiplayerRoundSystem.getRoundSnapshot(roundId);

          // (a) Đăng bảng mới: CÓ ảnh (1 lần duy nhất)
          const fresh = buildMultiplayerBoardPayload(snap, systems, { isEdit: false });
          assert.ok(fresh.files.length > 0, `${gameId}: bảng mới phải có ảnh`);
          assert.ok(
            collectAttachmentUrls(fresh).length > 0,
            `${gameId}: bảng mới phải tham chiếu ảnh attachment://`
          );

          // (b) Cập nhật bảng: KHÔNG file, KHÔNG tham chiếu ảnh, KHÔNG xóa ảnh cũ
          for (const meta of [
            { isEdit: true, phase: 'BET_UPDATE' },
            { isEdit: true, milestone: '30s' },
            { isEdit: true, milestone: '5s' },
            { isEdit: true, forcedCountdownSec: 3 },
          ]) {
            const slim = buildMultiplayerBoardPayload(snap, systems, meta);
            assert.equal(slim.files, undefined, `${gameId}: cập nhật không được đính kèm file`);
            assert.equal(
              slim.attachments,
              undefined,
              `${gameId}: cập nhật không được xoá ảnh cũ (attachments: [])`
            );
            assert.equal(
              collectAttachmentUrls(slim).length,
              0,
              `${gameId}: cập nhật không được tham chiếu ảnh`
            );
            // Nội dung chữ vẫn đầy đủ: mã phiên, tổng cược, luật...
            assert.match(extractCv2Text(slim), new RegExp(roundId));
          }
        }
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. Bảng KẾT QUẢ (khóa sổ / quay kết quả) vẫn đính kèm ảnh xúc xắc để công bố kết quả', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-result-'));
    try {
      const systems = await createBotSystems(tmpDir);
      try {
        systems.db.setGameChannel('g-res', GAME_IDS.BAUCUA, 'chan-res', '1243061570247069696');
        const round = await systems.multiplayerRoundSystem.startRound({
          guildId: 'g-res',
          channelId: 'chan-res',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p-res',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        // Khoá sổ + sinh kết quả như luồng thật
        systems.db.run('UPDATE multiplayer_rounds SET status = ? WHERE round_id = ?', [
          MP_ROUND_STATUS.LOCKED,
          roundId,
        ]);
        const lockedSnap = systems.multiplayerRoundSystem.getRoundSnapshot(roundId);
        const resultPayload = buildMultiplayerBoardPayload(lockedSnap, systems, {
          isEdit: true,
          phase: 'LOCKED',
        });
        assert.ok(
          resultPayload.files && resultPayload.files.length > 0,
          'Bảng kết quả PHẢI có ảnh xúc xắc để quay/công bố kết quả'
        );
      } finally {
        systems.multiplayerRoundSystem.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Chống dồn hàng cập nhật: 2 lần cập nhật liên tiếp chỉ vẽ 1 lần trong 2.5 giây', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-throttle-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        systems.db.setGameChannel('g-thr', GAME_IDS.BAUCUA, 'chan-thr', '1243061570247069696');
        const round = await mp.startRound({
          guildId: 'g-thr',
          channelId: 'chan-thr',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p-thr',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        let renders = 0;
        mp.setBoardRenderer(async () => {
          renders += 1;
        });
        mp.attachClient({
          channels: {
            cache: new Map([
              [
                'chan-thr',
                {
                  id: 'chan-thr',
                  messages: { fetch: async () => ({ id: 'm1', edit: async () => {} }) },
                  send: async () => ({ id: 'm1', delete: async () => {} }),
                },
              ],
            ]),
          },
        });
        mp.registerMessageRef(roundId, { id: 'm1', edit: async () => {} });

        // Bắn 5 lần cập nhật "cược mới" liên tiếp -> chỉ 1 lần vẽ
        for (let i = 0; i < 5; i += 1) {
          await mp._renderBoardNow(roundId, { phase: 'BET_UPDATE' });
        }
        assert.equal(renders, 1, 'Các cập nhật thường xuyên phải được gộp lại, không bắn liên tục');

        // Mốc quan trọng (khóa sổ / kết quả) luôn được vẽ ngay, không bị chặn
        await mp._renderBoardNow(roundId, { phase: 'LOCKED' });
        assert.equal(renders, 2, 'Mốc khóa sổ/kết quả phải được vẽ ngay');
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Sau khi đếm ngược 3-2-1 (khóa sổ), Bot ĐĂNG BẢNG KẾT QUẢ MỚI ở cuối kênh và xoá bảng cũ', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slim-postnew-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const mp = systems.multiplayerRoundSystem;
      try {
        systems.db.setGameChannel('g-post', GAME_IDS.BAUCUA, 'chan-post', '1243061570247069696');
        const round = await mp.startRound({
          guildId: 'g-post',
          channelId: 'chan-post',
          gameId: GAME_IDS.BAUCUA,
          userId: 'p-post',
        });
        const roundId = round.round?.round_id || round.snapshot?.round?.round_id;

        const sentPayloads = [];
        let oldDeleted = false;
        const oldBoard = { id: 'msg-old-board', edit: async () => {}, delete: async () => { oldDeleted = true; } };
        const editedPayloads = [];
        const newBoard = {
          id: 'msg-new-result',
          edit: async (payload) => { editedPayloads.push(payload); },
          delete: async () => {},
        };
        mp.attachClient({
          channels: {
            cache: new Map([
              [
                'chan-post',
                {
                  id: 'chan-post',
                  messages: { fetch: async () => null },
                  send: async (payload) => {
                    sentPayloads.push(payload);
                    return newBoard;
                  },
                },
              ],
            ]),
          },
        });
        mp.registerMessageRef(roundId, oldBoard);

        await mp.finalizeRound(roundId, { skipAnimation: true });

        assert.ok(sentPayloads.length >= 1, 'Phải đăng bảng kết quả MỚI xuống cuối kênh');
        assert.equal(oldDeleted, true, 'Bảng cũ phải được xoá để kênh gọn');
        assert.equal(mp.getMessageRef(roundId)?.id, 'msg-new-result', 'Bảng mới phải được ghi nhớ để cập nhật tiếp');
        // Bảng mới đăng ở đáy kênh ngay khi khóa sổ (kèm ảnh), sau đó được cập nhật thành KẾT QUẢ
        assert.ok(sentPayloads[0].files && sentPayloads[0].files.length > 0, 'Bảng mới phải có ảnh');
        assert.match(extractCv2Text(sentPayloads[0]), /KHÓA SỔ|LẮC BÁT|3 ➔ 2 ➔ 1/i);
        assert.ok(editedPayloads.length >= 1, 'Bảng mới phải được cập nhật tiếp thành bảng kết quả');
        assert.ok(
          editedPayloads.some((p) => /KẾT QUẢ PHIÊN/i.test(extractCv2Text(p))),
          'Phải có bản cập nhật công bố KẾT QUẢ PHIÊN trên chính bảng mới ở đáy kênh'
        );
      } finally {
        mp.shutdown();
        await systems.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
