import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PermissionsBitField } from 'discord.js';
import { antispamCommand } from '../src/commands/antispam.js';
import { MentionDetector } from '../src/services/mentionDetector.js';
import { PunishmentService } from '../src/services/punishmentService.js';
import { GuildStore } from '../src/storage/guildStore.js';

function createMockInteraction({
  subcommand,
  options = {},
  isAdmin = true,
  inGuild = true,
}) {
  const replies = [];
  const adminPerms = new PermissionsBitField(
    isAdmin
      ? [
          PermissionsBitField.Flags.Administrator,
          PermissionsBitField.Flags.ManageGuild,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.ModerateMembers,
        ]
      : []
  );

  const guild = {
    id: 'guild-cmd-test',
    name: 'Command Test Server',
    ownerId: 'owner-999',
    members: {
      me: {
        id: 'bot-id',
        permissions: new PermissionsBitField([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.ModerateMembers,
        ]),
      },
    },
  };

  return {
    inGuild: () => inGuild,
    guild: inGuild ? guild : null,
    client: { ws: { ping: 42 } },
    member: {
      id: isAdmin ? 'admin-1' : 'member-1',
      guild,
      permissions: adminPerms,
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => (options[name] !== undefined ? options[name] : null),
      getBoolean: (name) => (options[name] !== undefined ? options[name] : null),
      getChannel: (name) => options[name] ?? null,
      getRole: (name) => options[name] ?? null,
      getUser: (name) => options[name] ?? null,
    },
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
    getLastReply: () => replies[replies.length - 1],
  };
}

describe('Slash Command /antispam (All 7 Subcommands)', () => {
  it('định nghĩa đầy đủ schema hợp lệ cho cả 7 subcommand theo chuẩn Discord', () => {
    const json = antispamCommand.data.toJSON();
    assert.equal(json.name, 'antispam');
    assert.ok(json.description.length <= 100);

    const subs = json.options.map((o) => o.name);
    assert.deepEqual(subs, [
      'on',
      'off',
      'config',
      'whitelist',
      'logs',
      'status',
      'reset',
    ]);

    // Kiểm tra mọi mô tả đều không vượt quá giới hạn 100 ký tự của Discord
    for (const sub of json.options) {
      assert.ok(sub.description.length >= 1 && sub.description.length <= 100);
      for (const opt of sub.options ?? []) {
        assert.ok(opt.description.length >= 1 && opt.description.length <= 100);
      }
    }
  });

  it('kiểm tra quyền truy cập và thực thi chính xác toàn bộ 7 lệnh con', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'antispam-cmd-'));
    try {
      const guildStore = new GuildStore(tmpDir);
      await guildStore.init();
      const mentionDetector = new MentionDetector();
      const punishmentService = new PunishmentService({
        guildStore,
        mentionDetector,
      });
      const ctx = { guildStore, mentionDetector, punishmentService };

      // 0. Thành viên không có quyền bị chặn an toàn
      const unauth = createMockInteraction({ subcommand: 'off', isAdmin: false });
      await antispamCommand.execute(unauth, ctx);
      assert.match(unauth.getLastReply().embeds[0].data.title, /Không đủ quyền/);

      // 1. /antispam off
      const offInt = createMockInteraction({ subcommand: 'off' });
      await antispamCommand.execute(offInt, ctx);
      assert.equal(guildStore.getConfig('guild-cmd-test').enabled, false);

      // 2. /antispam on
      const mockLogChannel = {
        id: '777777777777777777',
        isTextBased: () => true,
        permissionsFor: () => guildStore && offInt.guild.members.me.permissions,
      };
      const onInt = createMockInteraction({
        subcommand: 'on',
        options: { log_channel: mockLogChannel },
      });
      await antispamCommand.execute(onInt, ctx);
      assert.equal(guildStore.getConfig('guild-cmd-test').enabled, true);
      assert.equal(
        guildStore.getConfig('guild-cmd-test').logChannelId,
        '777777777777777777'
      );

      // 3. /antispam config
      const cfgInt = createMockInteraction({
        subcommand: 'config',
        options: {
          max_mentions_msg: 4,
          max_mentions_window: 7,
          time_window: 12,
          block_everyone: true,
        },
      });
      await antispamCommand.execute(cfgInt, ctx);
      const updatedCfg = guildStore.getConfig('guild-cmd-test');
      assert.equal(updatedCfg.maxMentionsPerMessage, 4);
      assert.equal(updatedCfg.maxMentionsWindow, 7);
      assert.equal(updatedCfg.timeWindowSeconds, 12);

      // 4. /antispam whitelist (add -> list -> remove -> clear)
      const wlAdd = createMockInteraction({
        subcommand: 'whitelist',
        options: {
          action: 'add',
          role: { id: 'role-mod-helper' },
          user: { id: 'user-vip' },
        },
      });
      await antispamCommand.execute(wlAdd, ctx);
      assert.deepEqual(guildStore.getConfig('guild-cmd-test').whitelistRoles, [
        'role-mod-helper',
      ]);

      const wlList = createMockInteraction({
        subcommand: 'whitelist',
        options: { action: 'list' },
      });
      await antispamCommand.execute(wlList, ctx);
      assert.match(wlList.getLastReply().embeds[0].data.title, /Danh sách Miễn trừ/);

      const wlRemove = createMockInteraction({
        subcommand: 'whitelist',
        options: { action: 'remove', role: { id: 'role-mod-helper' } },
      });
      await antispamCommand.execute(wlRemove, ctx);
      assert.deepEqual(guildStore.getConfig('guild-cmd-test').whitelistRoles, []);

      const wlClear = createMockInteraction({
        subcommand: 'whitelist',
        options: { action: 'clear' },
      });
      await antispamCommand.execute(wlClear, ctx);
      assert.deepEqual(guildStore.getConfig('guild-cmd-test').whitelistUsers, []);

      // 5. /antispam logs
      guildStore.appendViolationLog('guild-cmd-test', {
        id: 'entry-1',
        timestamp: new Date().toISOString(),
        userId: '888888888888888888',
        userTag: 'BadGuy#0001',
        channelId: '123456789012345678',
        violationType: 'EVERYONE_HERE_SPAM',
        reason: 'Spam @everyone',
        contentPreview: '@everyone hello',
        strikeLevel: 2,
        actions: { messageDeleted: true, warningSent: true, timeoutApplied: true, timeoutSeconds: 300 },
      });
      const logsInt = createMockInteraction({
        subcommand: 'logs',
        options: { user: { id: '888888888888888888' }, limit: 5, reset_strikes: true },
      });
      await antispamCommand.execute(logsInt, ctx);
      assert.match(logsInt.getLastReply().embeds[0].data.title, /Lịch sử Xử lý Vi phạm/);

      // 6. /antispam status
      const statusInt = createMockInteraction({ subcommand: 'status' });
      await antispamCommand.execute(statusInt, ctx);
      assert.match(
        statusInt.getLastReply().embeds[0].data.title,
        /Trạng thái Hệ thống/
      );

      // 7. /antispam reset
      const resetInt = createMockInteraction({
        subcommand: 'reset',
        options: { keep_logs: true },
      });
      await antispamCommand.execute(resetInt, ctx);
      assert.equal(guildStore.getConfig('guild-cmd-test').maxMentionsPerMessage, 5);
      assert.equal(guildStore.getViolationLogs('guild-cmd-test').length, 1);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
