import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PermissionsBitField } from 'discord.js';
import {
  handleMessageCreate,
  handleMessageUpdate,
} from '../src/events/messageCreate.js';
import { MentionDetector } from '../src/services/mentionDetector.js';
import { PunishmentService } from '../src/services/punishmentService.js';
import { GuildStore } from '../src/storage/guildStore.js';

describe('End-to-End Message Pipeline Integration', () => {
  it('bảo vệ Admin/Whitelist khỏi bị phạt và tự động chặn thành viên thường spam', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'antispam-e2e-'));
    try {
      const guildStore = new GuildStore(tmpDir);
      await guildStore.init();
      guildStore.modifyWhitelist('g-e2e', 'role', 'add', 'role-trusted');
      guildStore.updateConfig('g-e2e', { autoDeleteWarnSeconds: 0 });

      const mentionDetector = new MentionDetector();
      const punishmentService = new PunishmentService({
        guildStore,
        mentionDetector,
      });
      const ctx = { guildStore, mentionDetector, punishmentService };

      const botPerms = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.ModerateMembers,
      ]);

      const guild = {
        id: 'g-e2e',
        ownerId: 'owner-id',
        members: {
          me: {
            id: 'bot-self',
            permissions: botPerms,
            roles: { highest: { comparePositionTo: () => 1 } },
          },
          cache: new Map(),
        },
        channels: { cache: new Map() },
      };

      const channel = {
        id: 'c-general',
        isTextBased: () => true,
        permissionsFor: () => botPerms,
        send: async () => ({ id: 'warn-1', delete: async () => {} }),
      };

      const buildMsg = ({ authorId, content, isAdmin = false, roleIds = [] }) => {
        let deleted = false;
        let timedOut = false;
        const member = {
          id: authorId,
          guild,
          moderatable: !isAdmin,
          permissions: new PermissionsBitField(
            isAdmin ? [PermissionsBitField.Flags.Administrator] : []
          ),
          roles: {
            cache: new Map(roleIds.map((r) => [r, { id: r }])),
            highest: {},
          },
          timeout: async () => {
            timedOut = true;
          },
        };

        return {
          msg: {
            id: `m-${Math.random()}`,
            guild,
            channelId: channel.id,
            channel,
            client: { user: { id: 'bot-self' } },
            author: { id: authorId, tag: `${authorId}#0001`, bot: false },
            member,
            content,
            mentions: { everyone: content.includes('@everyone') },
            deletable: true,
            delete: async () => {
              deleted = true;
            },
          },
          wasDeleted: () => deleted,
          wasTimedOut: () => timedOut,
        };
      };

      // 1. Admin gửi @everyone + 8 mention -> KHÔNG bị xóa, KHÔNG bị timeout
      const adminCase = buildMsg({
        authorId: 'admin-user',
        isAdmin: true,
        content:
          '@everyone <@100000000000000001> <@100000000000000002> <@100000000000000003> <@100000000000000004> <@100000000000000005> <@100000000000000006>',
      });
      await handleMessageCreate(adminCase.msg, ctx);
      assert.equal(adminCase.wasDeleted(), false);
      assert.equal(adminCase.wasTimedOut(), false);

      // 2. Thành viên có vai trò Whitelist gửi @here -> KHÔNG bị xóa
      const wlCase = buildMsg({
        authorId: 'trusted-user',
        roleIds: ['role-trusted'],
        content: '@here Họp nhóm nhé mọi người!',
      });
      await handleMessageCreate(wlCase.msg, ctx);
      assert.equal(wlCase.wasDeleted(), false);

      // 3. Thành viên thường spam @everyone -> BỊ XÓA & TIMEOUT NGAY
      const spammerCase = buildMsg({
        authorId: 'spammer-999',
        content: '@everyone Vào link lừa đảo ngay!',
      });
      await handleMessageCreate(spammerCase.msg, ctx);
      assert.equal(spammerCase.wasDeleted(), true);
      assert.equal(spammerCase.wasTimedOut(), true);

      // 4. Thành viên thường lách luật sửa tin nhắn thành 6 mention -> BỊ XÓA
      const beforeEdit = buildMsg({
        authorId: 'editor-888',
        content: 'Xin chào',
      });
      const afterEdit = buildMsg({
        authorId: 'editor-888',
        content:
          '<@100000000000000001> <@100000000000000002> <@100000000000000003> <@100000000000000004> <@100000000000000005> <@100000000000000006>',
      });
      await handleMessageUpdate(beforeEdit.msg, afterEdit.msg, ctx);
      assert.equal(afterEdit.wasDeleted(), true);

      await guildStore.flush();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
