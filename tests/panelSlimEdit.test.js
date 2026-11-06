import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AttachmentBuilder } from 'discord.js';
import {
  applySlimEdit,
  collectReferencedAttachmentNames,
  forgetPanelAttachments,
  getKnownAttachmentNames,
  rememberPanelAttachments,
  resetPanelAttachmentCache,
} from '../src/utils/panelAttachments.js';

/**
 * Kiểm thử tối ưu "không tải lại ảnh mỗi lần cập nhật bảng".
 *
 * Đây là nguyên nhân chính khiến các tương tác trên VPS gói FREE mất 1.6–7 giây:
 * mỗi lần bấm nút / gửi modal, bảng lại upload lại toàn bộ ảnh (có bảng tới 5 ảnh).
 * Discord giữ nguyên tệp đính kèm cũ khi edit, nên chỉ cần không gửi lại `files`.
 */
describe('Panel Slim Edit — Tái Sử Dụng Ảnh Đã Đăng, Không Upload Lại', () => {
  const makePayload = (fileName) => ({
    flags: 0,
    components: [
      {
        type: 17,
        components: [
          { type: 12, items: [{ media: { url: `attachment://${fileName}` }, description: 'bảng' }] },
        ],
      },
    ],
    files: [new AttachmentBuilder(Buffer.from('x'), { name: fileName })],
  });

  const makeMessage = (id, names) => ({
    id,
    attachments: new Map(names.map((n, i) => [String(i), { name: n }])),
  });

  it('1. Bỏ `files` khi ảnh đã có sẵn trên tin nhắn (không upload lại)', () => {
    resetPanelAttachmentCache();
    const payload = makePayload('guess_active.png');
    const message = makeMessage('m-1', ['guess_active.png']);

    const slim = applySlimEdit(payload, message);
    assert.equal(slim.files, undefined, 'Không được gửi lại file');
    assert.equal(slim.attachments, undefined, 'Không được xoá ảnh cũ');
    // Nội dung vẫn giữ nguyên tham chiếu ảnh cũ
    assert.deepEqual([...collectReferencedAttachmentNames(slim)], ['guess_active.png']);
  });

  it('2. Giữ `files` khi bảng cần ảnh MỚI chưa có trên tin nhắn (VD: banner thắng/thua)', () => {
    resetPanelAttachmentCache();
    const payload = makePayload('guess_win.png');
    const message = makeMessage('m-2', ['guess_active.png']);

    const slim = applySlimEdit(payload, message);
    assert.ok(Array.isArray(slim.files) && slim.files.length === 1, 'Ảnh mới phải được upload');
  });

  it('3. Bảng hoàn toàn bằng chữ thì xoá ảnh cũ (attachments: []) như hành vi trước', () => {
    resetPanelAttachmentCache();
    const textOnly = { flags: 0, components: [{ type: 17, components: [{ type: 10, content: 'chỉ chữ' }] }] };
    const slim = applySlimEdit(textOnly, makeMessage('m-3', ['old.png']));
    assert.deepEqual(slim.attachments, []);
  });

  it('4. rememberPanelAttachments ghi nhớ tên tệp để lần cập nhật sau không upload lại', () => {
    resetPanelAttachmentCache();
    const payload = makePayload('race_roster.png');
    rememberPanelAttachments({ id: 'm-4' }, payload);

    const known = getKnownAttachmentNames({ id: 'm-4' });
    assert.equal(known.has('race_roster.png'), true);

    const nextEdit = applySlimEdit(makePayload('race_roster.png'), { id: 'm-4' });
    assert.equal(nextEdit.files, undefined, 'Lần cập nhật thứ 2 phải bỏ upload');

    forgetPanelAttachments('m-4');
    assert.equal(getKnownAttachmentNames({ id: 'm-4' }).size, 0, 'Phải xoá được dấu vết');
  });

  it('5. Bảng Đua Thú 5 ảnh: lần đầu upload cả 5, các lần sau không upload ảnh nào', () => {
    resetPanelAttachmentCache();
    const names = ['horse.png', 'cheetah.png', 'eagle.png', 'wolf.png', 'tiger.png'];
    const payload = {
      flags: 0,
      components: [
        {
          type: 17,
          components: [
            { type: 12, items: names.map((n) => ({ media: { url: `attachment://${n}` } })) },
          ],
        },
      ],
      files: names.map((n) => new AttachmentBuilder(Buffer.from('x'), { name: n })),
    };

    // Lần mở bảng đầu tiên: chưa có gì trên tin nhắn => upload đủ 5 ảnh
    const fresh = applySlimEdit(payload, { id: 'm-5', attachments: new Map() });
    assert.equal(fresh.files.length, 5);

    // Sau khi đăng: mọi lần cập nhật đều không upload lại
    rememberPanelAttachments({ id: 'm-5' }, payload);
    const edit = applySlimEdit(payload, { id: 'm-5' });
    assert.equal(edit.files, undefined);
  });
});
