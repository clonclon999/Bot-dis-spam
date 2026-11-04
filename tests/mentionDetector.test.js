import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDefaultGuildConfig, VIOLATION_TYPES } from '../src/config/defaults.js';
import {
  MentionDetector,
  parseExplicitMentions,
  stripCodeSegments,
} from '../src/services/mentionDetector.js';

function mockMessage({
  id = 'msg-1',
  guildId = 'guild-100',
  authorId = '111111111111111111',
  content = '',
  mentionsEveryone = false,
  repliedUserId = null,
}) {
  return {
    id,
    guildId,
    guild: { id: guildId },
    author: { id: authorId, tag: 'Member#0001' },
    content,
    mentions: {
      everyone: mentionsEveryone,
      repliedUser: repliedUserId ? { id: repliedUserId } : null,
    },
  };
}

describe('MentionDetector & Explicit Mention Parser', () => {
  it('loại bỏ code block & inline code, tránh bắt nhầm @everyone hoặc email', () => {
    const clean = stripCodeSegments('Hướng dẫn dùng `@everyone` và ```\n@here\n```');
    assert.ok(!clean.includes('@everyone'));
    assert.ok(!clean.includes('@here'));

    const parsedCode = parseExplicitMentions({
      content: 'Đừng gõ `@everyone` hoặc liên hệ support@everyone.org nhé!',
      authorId: '111111111111111111',
    });
    assert.equal(parsedCode.hasEveryoneOrHere, false);
    assert.equal(parsedCode.totalExplicitMentions, 0);
  });

  it('phát hiện chính xác @everyone và @here (cả cờ Discord lẫn văn bản thô)', () => {
    const detector = new MentionDetector();
    const config = createDefaultGuildConfig();

    const v1 = detector.inspectMessage(
      mockMessage({ content: 'Chào cả nhà @everyone vào xem ngay!' }),
      config,
      1000
    );
    assert.ok(v1);
    assert.equal(v1.type, VIOLATION_TYPES.EVERYONE_HERE);
    assert.equal(v1.severity, 'critical');

    const v2 = detector.inspectMessage(
      mockMessage({ content: 'Ping @here gấp!', authorId: '222222222222222222' }),
      config,
      2000
    );
    assert.ok(v2);
    assert.equal(v2.type, VIOLATION_TYPES.EVERYONE_HERE);
  });

  it('bỏ qua mention ngầm định khi Reply bình thường để tránh xử phạt nhầm', () => {
    const detector = new MentionDetector();
    const config = createDefaultGuildConfig();
    const now = 10_000;

    // Gửi 6 câu trả lời liên tiếp bằng nút Reply của Discord (không gõ <@id> trong nội dung)
    for (let i = 0; i < 6; i++) {
      const res = detector.inspectMessage(
        mockMessage({
          id: `reply-${i}`,
          content: `Câu trả lời bình thường số ${i}`,
          repliedUserId: '999999999999999999',
        }),
        config,
        now + i * 500
      );
      assert.equal(res, null);
    }
  });

  it('phát hiện mention quá nhiều người hoặc lặp 1 người nhiều lần trong 1 tin nhắn', () => {
    const detector = new MentionDetector();
    const config = createDefaultGuildConfig(); // maxMentionsPerMessage = 5

    // 5 mention -> vẫn trong ngưỡng cho phép
    const okMsg = detector.inspectMessage(
      mockMessage({
        content:
          '<@200000000000000001> <@200000000000000002> <@200000000000000003> <@200000000000000004> <@200000000000000005>',
      }),
      config,
      1000
    );
    assert.equal(okMsg, null);

    // 6 mention khác nhau trong 1 tin -> vi phạm MASS_MENTION_SINGLE
    const badMsg = detector.inspectMessage(
      mockMessage({
        authorId: '333333333333333333',
        content:
          '<@200000000000000001> <@200000000000000002> <@200000000000000003> <@200000000000000004> <@200000000000000005> <@&300000000000000006>',
      }),
      config,
      2000
    );
    assert.ok(badMsg);
    assert.equal(badMsg.type, VIOLATION_TYPES.MASS_MENTION_SINGLE);
    assert.equal(badMsg.mentionCount, 6);

    // Spam tag cùng 1 người 6 lần trong 1 tin nhắn -> cũng bị bắt chính xác
    const duplicateTargetMsg = detector.inspectMessage(
      mockMessage({
        authorId: '444444444444444444',
        content: Array(6).fill('<@200000000000000001>').join(' '),
      }),
      config,
      3000
    );
    assert.ok(duplicateTargetMsg);
    assert.equal(duplicateTargetMsg.type, VIOLATION_TYPES.MASS_MENTION_SINGLE);
  });

  it('phát hiện mention quá nhiều thành viên trong khoảng thời gian ngắn (Burst Window)', () => {
    const detector = new MentionDetector();
    const config = createDefaultGuildConfig(); // maxMentionsPerMessage = 5, maxMentionsWindow = 8 trong 10s
    const start = 50_000;

    // Tin 1: 5 mention (tổng = 5 <= 8 -> OK)
    assert.equal(
      detector.inspectMessage(
        mockMessage({
          id: 'b1',
          content:
            '<@200000000000000001> <@200000000000000002> <@200000000000000003> <@200000000000000004> <@200000000000000005>',
        }),
        config,
        start
      ),
      null
    );

    // Tin 2 sau 3 giây: thêm 4 mention (tổng = 9 > 8 trong 10s -> VI PHẠM)
    const burstViolation = detector.inspectMessage(
      mockMessage({
        id: 'b2',
        content:
          '<@200000000000000006> <@200000000000000007> <@200000000000000008> <@200000000000000009>',
      }),
      config,
      start + 3_000
    );
    assert.ok(burstViolation);
    assert.equal(burstViolation.type, VIOLATION_TYPES.MENTION_BURST_WINDOW);
    assert.equal(burstViolation.mentionCount, 9);
  });

  it('phát hiện spam mention lặp đi lặp lại trong nhiều tin nhắn liên tiếp', () => {
    const detector = new MentionDetector();
    const config = createDefaultGuildConfig(); // maxSameTargetMessages = 2, maxRepeatMessages = 3 trong 15s
    const t0 = 100_000;

    // Trường hợp A: Mention lặp lại cùng 1 nạn nhân qua 3 tin nhắn liên tiếp
    assert.equal(
      detector.inspectMessage(
        mockMessage({ id: 'r1', authorId: '555555555555555555', content: 'Này <@900000000000000001>' }),
        config,
        t0
      ),
      null
    );
    assert.equal(
      detector.inspectMessage(
        mockMessage({ id: 'r2', authorId: '555555555555555555', content: 'Alo <@900000000000000001>' }),
        config,
        t0 + 2_000
      ),
      null
    );
    const sameTargetViolation = detector.inspectMessage(
      mockMessage({ id: 'r3', authorId: '555555555555555555', content: 'Đâu rồi <@900000000000000001>' }),
      config,
      t0 + 4_000
    );
    assert.ok(sameTargetViolation);
    assert.equal(sameTargetViolation.type, VIOLATION_TYPES.REPEATED_TARGET_HARASSMENT);

    // Trường hợp B: Gửi 4 tin nhắn liên tiếp mỗi tin tag 1 người khác nhau
    const targets = [
      '800000000000000001',
      '800000000000000002',
      '800000000000000003',
      '800000000000000004',
    ];
    for (let i = 0; i < 3; i++) {
      assert.equal(
        detector.inspectMessage(
          mockMessage({
            id: `m-${i}`,
            authorId: '666666666666666666',
            content: `Ping <@${targets[i]}>`,
          }),
          config,
          t0 + i * 1_500
        ),
        null
      );
    }
    const multiMsgViolation = detector.inspectMessage(
      mockMessage({
        id: 'm-3',
        authorId: '666666666666666666',
        content: `Ping <@${targets[3]}>`,
      }),
      config,
      t0 + 4_500
    );
    assert.ok(multiMsgViolation);
    assert.equal(multiMsgViolation.type, VIOLATION_TYPES.REPEATED_MENTION_MESSAGES);
  });

  it('phát hiện lách luật bằng cách sửa tin nhắn (messageUpdate) và tự dọn RAM', () => {
    const detector = new MentionDetector();
    const config = createDefaultGuildConfig();

    const oldMsg = mockMessage({ content: 'Xin chào mọi người' });
    const editedNormal = mockMessage({ content: 'Xin chào mọi người nha!' });
    assert.equal(detector.inspectEditedMessage(oldMsg, editedNormal, config, 1000), null);

    const editedEveryone = mockMessage({ content: 'Xin chào @everyone' });
    const editViolation = detector.inspectEditedMessage(
      oldMsg,
      editedEveryone,
      config,
      2000
    );
    assert.ok(editViolation);
    assert.equal(editViolation.type, VIOLATION_TYPES.EVERYONE_HERE);

    // Kiểm tra dọn dẹp bộ nhớ sweepExpired
    detector.inspectMessage(
      mockMessage({ content: 'Hi <@700000000000000001>' }),
      config,
      5_000
    );
    assert.equal(detector.activeTrackerCount, 1);
    const swept = detector.sweepExpired(200_000, 60_000);
    assert.equal(swept, 1);
    assert.equal(detector.activeTrackerCount, 0);
  });
});
