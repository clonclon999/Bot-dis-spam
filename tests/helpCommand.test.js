import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MessageFlags, PermissionsBitField } from 'discord.js';
import { getSlashCommandsJSON, COMMAND_MAP } from '../src/commands/index.js';
import { handleInteractionCreate } from '../src/events/interactionCreate.js';
import { GuildStore } from '../src/storage/guildStore.js';

function createHelpInteraction({
  topic = null,
  isPublic = null,
  isAdmin = false,
  inGuild = true,
}) {
  const replies = [];
  const guild = {
    id: 'guild-help-1',
    name: 'Help Test Server',
    ownerId: 'owner-1',
  };

  return {
    isChatInputCommand: () => true,
    commandName: 'help',
    inGuild: () => inGuild,
    guildId: inGuild ? guild.id : null,
    guild: inGuild ? guild : null,
    member: inGuild
      ? {
          id: isAdmin ? 'admin-1' : 'member-1',
          guild,
          permissions: new PermissionsBitField(
            isAdmin ? [PermissionsBitField.Flags.ManageGuild] : []
          ),
        }
      : null,
    options: {
      getString: (name) => (name === 'topic' ? topic : null),
      getBoolean: (name) => (name === 'public' ? isPublic : null),
    },
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
    getLastReply: () => replies[replies.length - 1],
  };
}

describe('Slash Command /help & Central Command Registry', () => {
  it('đăng ký đầy đủ /help và /antispam trong COMMAND_MAP với mô tả hợp lệ <= 100 ký tự', () => {
    const allJson = getSlashCommandsJSON();
    assert.equal(allJson.length, 2);
    assert.ok(COMMAND_MAP.has('help'));
    assert.ok(COMMAND_MAP.has('antispam'));

    for (const cmd of allJson) {
      assert.ok(cmd.description.length >= 1 && cmd.description.length <= 100);
      for (const opt of cmd.options ?? []) {
        assert.ok(opt.description.length >= 1 && opt.description.length <= 100);
      }
    }
  });

  it('hiển thị đúng cả 3 chủ đề /help và ngăn thành viên thường gửi công khai làm loãng kênh', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'antispam-help-'));
    try {
      const guildStore = new GuildStore(tmpDir);
      await guildStore.init();
      guildStore.updateConfig('guild-help-1', { maxMentionsPerMessage: 7 });

      // 1. Mặc định (overview) + thành viên thường cố bật public: true -> vẫn bị ép Ephemeral
      const memberTryPublic = createHelpInteraction({
        topic: null,
        isPublic: true,
        isAdmin: false,
      });
      await handleInteractionCreate(memberTryPublic, { guildStore });
      const r1 = memberTryPublic.getLastReply();
      assert.equal(r1.flags, MessageFlags.Ephemeral);
      assert.match(r1.embeds[0].data.title, /Hướng dẫn Sử dụng/);
      assert.match(r1.embeds[0].data.fields[0].value, /\*\*7\*\* mention/);

      // 2. Chủ đề commands + Admin bật public: true -> được gửi công khai (không gắn cờ Ephemeral)
      const adminPublicCmds = createHelpInteraction({
        topic: 'commands',
        isPublic: true,
        isAdmin: true,
      });
      await handleInteractionCreate(adminPublicCmds, { guildStore });
      const r2 = adminPublicCmds.getLastReply();
      assert.equal(r2.flags, undefined);
      assert.match(r2.embeds[0].data.title, /Danh sách Chi tiết/);

      // 3. Chủ đề rules
      const rulesInt = createHelpInteraction({ topic: 'rules', isAdmin: false });
      await handleInteractionCreate(rulesInt, { guildStore });
      const r3 = rulesInt.getLastReply();
      assert.equal(r3.flags, MessageFlags.Ephemeral);
      assert.match(r3.embeds[0].data.title, /Quy tắc Phát hiện/);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
