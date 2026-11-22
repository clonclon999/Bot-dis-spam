import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import {
  buildGayMeterPayload,
  computeGayPercent,
  gayMeterAliasCommand,
  gayMeterCommand,
  getGayTier,
  handleGayMeterInteraction,
  pickGayComment,
} from '../src/commands/core/gayMeter.js';
import { HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { extractCv2Text, validateCv2Payload } from '../src/ui/componentsV2.js';

/**
 * Kiểm thử chức năng giải trí "Máy đo độ gay".
 * Quy tắc bắt buộc:
 *  - OWNER `1243061570247069696` LUÔN LUÔN 0%.
 *  - Người khác: 0–100%, ổn định trong cùng ngày, đổi vào ngày khác.
 *  - Có câu bình luận hài hước theo mức + câu đùa phụ.
 */
describe('🔮 Máy Đo Độ Gay — OWNER Luôn 0%, Có Câu Bình Luận Hài Hước', () => {
  const DAY = 24 * 3600 * 1000;
  const today = new Date('2026-11-06T03:00:00.000Z').getTime(); // 10:00 giờ VN

  it('1. OWNER 1243061570247069696 luôn luôn 0% ở mọi thời điểm', () => {
    for (const now of [today, today + DAY, today + 30 * DAY, 0]) {
      assert.equal(computeGayPercent(HARDCODED_OWNER_ID, now), 0);
    }
    const data = pickGayComment(HARDCODED_OWNER_ID, computeGayPercent(HARDCODED_OWNER_ID, today), today);
    assert.equal(data.tier.label, 'TUYỆT ĐỐI DỊ TÍNH');

    const payload = buildGayMeterPayload(
      { id: HARDCODED_OWNER_ID, username: 'MrDon' },
      { percent: 0, isOwner: true, ...data }
    );
    assert.equal(validateCv2Payload(payload).valid, true);
    assert.match(extractCv2Text(payload), /0%/);
    assert.match(extractCv2Text(payload), /ĐẶC QUYỀN OWNER/);
    assert.match(extractCv2Text(payload), /khóa cứng 0%/i);
  });

  it('2. Người chơi khác: 0–100%, ổn định trong cùng ngày & đổi khi sang ngày mới', () => {
    const users = ['111111111111111111', '222222222222222222', '333333333333333333'];
    for (const uid of users) {
      const p1 = computeGayPercent(uid, today);
      const p2 = computeGayPercent(uid, today + 3600 * 1000); // cùng ngày
      assert.equal(p1, p2, 'Trong cùng ngày phải ra cùng chỉ số');
      assert.ok(p1 >= 0 && p1 <= 100, `Chỉ số phải trong 0–100 (nhận ${p1})`);
    }
    // Khác ngày thì phải có ít nhất một người đổi số (xác suất trùng toàn bộ là cực nhỏ)
    const before = users.map((u) => computeGayPercent(u, today));
    const after = users.map((u) => computeGayPercent(u, today + DAY));
    assert.notDeepEqual(before, after);
  });

  it('3. Mỗi mức đều có câu bình luận hài hước riêng + câu đùa phụ', () => {
    for (const percent of [0, 10, 30, 50, 70, 90, 100]) {
      const tier = getGayTier(percent);
      assert.ok(tier.lines.length >= 4, `Mức ${percent}% phải có nhiều câu bình luận`);
      const data = pickGayComment('123456789012345678', percent, today);
      assert.equal(typeof data.line, 'string');
      assert.ok(data.line.length > 10);
      assert.equal(typeof data.joke, 'string');
      assert.match(data.joke, /📌/);
    }
    // Ổn định: cùng người + cùng số => cùng câu
    const a = pickGayComment('999888777666555444', 42, today);
    const b = pickGayComment('999888777666444444'.replace('444444', '555444'), 42, today);
    assert.equal(a.line, b.line);
  });

  it('4. Payload kết quả hợp lệ Components V2 và có thanh tiến trình + nút Đo lại/Đóng', () => {
    const { tier, line, joke } = pickGayComment('555666777888999000', 55, today);
    const payload = buildGayMeterPayload(
      { id: '555666777888999000', username: 'Tester' },
      { percent: 55, isOwner: false, tier, line, joke }
    );
    assert.equal(validateCv2Payload(payload).valid, true);
    const json = JSON.stringify(payload.components);
    assert.match(extractCv2Text(payload), /55%/);
    assert.match(json, /gaymeter:again:555666777888999000/);
    assert.match(json, /gaymeter:close:555666777888999000/);
    assert.match(extractCv2Text(payload), /▰|▱/);
  });

  it('5. Lệnh /gay & /dogay tồn tại, trả về bảng kết quả và không lỗi khi không chọn người', async () => {
    assert.equal(gayMeterCommand.data.name, 'gay');
    assert.equal(gayMeterAliasCommand.data.name, 'dogay');

    let replied = null;
    const interaction = {
      user: { id: '123123123123123123', username: 'Player', bot: false },
      options: { getUser: () => null },
      deferred: false,
      replied: false,
      reply: async (payload) => {
        replied = payload;
      },
    };
    await gayMeterCommand.execute(interaction, {});
    assert.ok(replied, 'Phải trả lời bằng bảng kết quả');
    assert.equal(validateCv2Payload(replied).valid, true);

    // Đo người khác là OWNER -> luôn 0%
    let ownerReply = null;
    await gayMeterAliasCommand.execute(
      {
        user: { id: '123123123123123123', username: 'Player', bot: false },
        options: { getUser: () => ({ id: HARDCODED_OWNER_ID, username: 'MrDon' }) },
        deferred: false,
        replied: false,
        reply: async (p) => {
          ownerReply = p;
        },
      },
      {}
    );
    assert.match(extractCv2Text(ownerReply), /0%/);
  });

  it('6. Nút "Đóng" hoạt động; nút "Đo lại" trả về đúng bảng đã cập nhật', async () => {
    let updated = null;
    const closeInteraction = {
      customId: 'gaymeter:close:123123123123123123',
      user: { id: '123123123123123123', username: 'Player' },
      message: { components: [] },
      update: async (p) => {
        updated = p;
      },
      editReply: async (p) => {
        updated = p;
      },
    };
    assert.equal(await handleGayMeterInteraction(closeInteraction, {}), true);
    assert.ok(updated);
    assert.match(extractCv2Text(updated), /Đã đóng Máy Đo Độ Gay/);

    updated = null;
    const againInteraction = {
      customId: 'gaymeter:again:123123123123123123',
      user: { id: '123123123123123123', username: 'Player' },
      client: { users: { cache: new Map(), fetch: async () => null } },
      message: { components: [] },
      update: async (p) => {
        updated = p;
      },
      editReply: async (p) => {
        updated = p;
      },
    };
    assert.equal(await handleGayMeterInteraction(againInteraction, {}), true);
    assert.ok(updated, 'Bấm Đo lại phải trả về bảng mới');
    assert.equal(validateCv2Payload(updated).valid, true);

    // customId lạ -> không xử lý
    assert.equal(await handleGayMeterInteraction({ customId: 'core:something' }, {}), false);
  });
});
