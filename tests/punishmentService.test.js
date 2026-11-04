import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PermissionsBitField } from 'discord.js';
import { VIOLATION_TYPES } from '../src/config/defaults.js';
import { MentionDetector } from '../src/services/mentionDetector.js';
import { PunishmentService } from '../src/services/punishmentService.js';
import { GuildStore } from '../src/storage/guildStore.js';

function createEnforcementFixture({ botCanTimeout = true } = {}) {
  const sentWarnings = [];
  const sentModLogs = [];
  const timeouts = [];
  let deletedCount = 0;

  const botPerms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ManageMessages,
    ...(botCanTimeout ? [PermissionsBitField.Flags.ModerateMembers] : []),
  ]);

  const me = {
    id: 'bot-999',
    permissions: botPerms,
    roles: {
      highest: {
        comparePositionTo: () => (botCanTimeout ? 1 : -1),
      },
    },
  };

  const logChannel = {
    id: 'log-chan-1',
    isTextBased: () => true,
    permissionsFor: () => botPerms,
    send: async (payload) => {
      sentModLogs.push(payload);
      return { id: `logmsg-${sentModLogs.length}` };
    },
  };

  const chatChannel = {
    id: 'chat-chan-1',
    isTextBased: () => true,
    permissionsFor: () => botPerms,
    send: async (payload) => {
      sentWarnings.push(payload);
      return {
        id: `warnmsg-${sentWarnings.length}`,
        delete: async () => {},
      };
    },
  };

  const targetMember = {
    id: 'offender-1',
    guild: { id: 'guild-1', ownerId: 'owner-1' },
    permissions: new PermissionsBitField([]),
    moderatable: botCanTimeout,
    roles: { highest: {} },
    timeout: async (durationMs, reason) => {
      timeouts.push({ durationMs, reason });
    },
  };

  const guild = {
    id: 'guild-1',
    name: 'Test Server',
    ownerId: 'owner-1',
    members: {
      me,
      cache: new Map([['offender-1', targetMember]]),
    },
    channels: {
      cache: new Map([
        ['log-chan-1', logChannel],
        ['chat-chan-1', chatChannel],
      ]),
    },
  };

  const makeMessage = (content = '<@1> <@2> <@3> <@4> <@5> <@6>') => ({
    id: `msg-${Math.random()}`,
    guild,
    channelId: chatChannel.id,
    channel: chatChannel,
    author: {
      id: 'offender-1',
      tag: 'Offender#1234',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    member: targetMember,
    content,
    deletable: true,
    delete: async () => {
      deletedCount += 1;
    },
  });

  return {
    guild,
    makeMessage,
    getDeletedCount: () => deletedCount,
    sentWarnings,
    sentModLogs,
    timeouts,
  };
}

describe('PunishmentService Progressive Escalation & Anti-Flood', () => {
  it('thực thi đúng thang xử phạt lũy tiến (Mức 1 Cảnh cáo -> Mức 2..5 Timeout tăng dần)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'antispam-punish-'));
    try {
      const guildStore = new GuildStore(tmpDir);
      await guildStore.init();
      const config = guildStore.updateConfig('guild-1', {
        logChannelId: 'log-chan-1',
        autoDeleteWarnSeconds: 0,
      });

      const detector = new MentionDetector();
      const service = new PunishmentService({ guildStore, mentionDetector: detector });
      const fx = createEnforcementFixture({ botCanTimeout: true });

      const normalViolation = {
        type: VIOLATION_TYPES.MASS_MENTION_SINGLE,
        severity: 'normal',
        mentionCount: 6,
        reason: 'Mention 6 lần trong một tin nhắn.',
      };

      // Lần 1: Mức 1 -> Xóa tin + Cảnh cáo, CHƯA timeout
      const r1 = await service.enforce({
        message: fx.makeMessage(),
        violation: normalViolation,
        config,
        now: 10_000,
      });
      assert.equal(r1.strikeLevel, 1);
      assert.equal(r1.actions.messageDeleted, true);
      assert.equal(r1.actions.warningSent, true);
      assert.equal(r1.actions.timeoutApplied, false);

      // Lần 2 (sau 15 giây): Mức 2 -> Timeout 5 phút (300.000 ms)
      const r2 = await service.enforce({
        message: fx.makeMessage(),
        violation: normalViolation,
        config,
        now: 25_000,
      });
      assert.equal(r2.strikeLevel, 2);
      assert.equal(r2.actions.timeoutApplied, true);
      assert.equal(fx.timeouts[0].durationMs, 5 * 60 * 1000);

      // Lần 3: Mức 3 -> Timeout 30 phút
      const r3 = await service.enforce({
        message: fx.makeMessage(),
        violation: normalViolation,
        config,
        now: 40_000,
      });
      assert.equal(r3.strikeLevel, 3);
      assert.equal(fx.timeouts[1].durationMs, 30 * 60 * 1000);

      // Lần 4: Mức 4 -> Timeout 2 giờ
      const r4 = await service.enforce({
        message: fx.makeMessage(),
        violation: normalViolation,
        config,
        now: 55_000,
      });
      assert.equal(r4.strikeLevel, 4);
      assert.equal(fx.timeouts[2].durationMs, 2 * 60 * 60 * 1000);

      // Lần 5: Mức 5 -> Timeout 24 giờ
      const r5 = await service.enforce({
        message: fx.makeMessage(),
        violation: normalViolation,
        config,
        now: 70_000,
      });
      assert.equal(r5.strikeLevel, 5);
      assert.equal(fx.timeouts[3].durationMs, 24 * 60 * 60 * 1000);

      assert.equal(fx.getDeletedCount(), 5);
      assert.equal(fx.sentModLogs.length, 5);
      await guildStore.flush();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('chống gửi thông báo hàng loạt khi người vi phạm xả nhiều tin cùng lúc & xử lý an toàn khi thiếu quyền', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'antispam-flood-'));
    try {
      const guildStore = new GuildStore(tmpDir);
      await guildStore.init();
      const config = guildStore.updateConfig('guild-1', {
        logChannelId: 'log-chan-1',
        warnCooldownSeconds: 10,
        autoDeleteWarnSeconds: 0,
      });

      const detector = new MentionDetector();
      const service = new PunishmentService({ guildStore, mentionDetector: detector });
      const fx = createEnforcementFixture({ botCanTimeout: false }); // Mô phỏng bot thiếu quyền ModerateMembers

      const criticalViolation = {
        type: VIOLATION_TYPES.EVERYONE_HERE,
        severity: 'critical',
        mentionCount: 1,
        reason: 'Spam @everyone trái phép.',
      };

      // Người dùng bắn 4 tin @everyone liên thanh trong vòng 300ms
      for (let i = 0; i < 4; i++) {
        await service.enforce({
          message: fx.makeMessage('@everyone raid!'),
          violation: criticalViolation,
          config,
          now: 100_000 + i * 80,
        });
      }

      // Cả 4 tin nhắn đều bị xóa sạch, nhưng kênh chat chỉ nhận ĐÚNG 1 thông báo cảnh cáo (không gây phiền)
      assert.equal(fx.getDeletedCount(), 4);
      assert.equal(fx.sentWarnings.length, 1);
      // Không crash dù thiếu quyền ModerateMembers
      assert.equal(fx.timeouts.length, 0);
      await guildStore.flush();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
