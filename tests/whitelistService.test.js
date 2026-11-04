import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionsBitField } from 'discord.js';
import { createDefaultGuildConfig } from '../src/config/defaults.js';
import { evaluateExemption } from '../src/services/whitelistService.js';

function createMockGuildMessage({
  authorId = '100000000000000001',
  ownerId = '999999999999999999',
  channelId = '500000000000000001',
  parentId = null,
  isBot = false,
  permissions = [],
  roleIds = [],
} = {}) {
  const permBitField = new PermissionsBitField(permissions);
  const roleMap = new Map(roleIds.map((id) => [id, { id }]));

  return {
    guild: {
      id: 'guild-1',
      ownerId,
      members: { cache: new Map() },
    },
    channelId,
    channel: { id: channelId, parentId },
    system: false,
    author: { id: authorId, bot: isBot },
    member: {
      id: authorId,
      permissions: permBitField,
      roles: { cache: roleMap },
    },
  };
}

describe('Whitelist & Exemption Service', () => {
  it('miễn trừ tuyệt đối cho Server Owner, Admin và Moderator', () => {
    const config = createDefaultGuildConfig();

    // Chủ sở hữu máy chủ
    const ownerMsg = createMockGuildMessage({
      authorId: '999999999999999999',
      ownerId: '999999999999999999',
    });
    assert.equal(evaluateExemption(ownerMsg, config).exempt, true);

    // Administrator
    const adminMsg = createMockGuildMessage({
      permissions: [PermissionsBitField.Flags.Administrator],
    });
    assert.equal(evaluateExemption(adminMsg, config).exempt, true);

    // Moderator (ModerateMembers / ManageMessages / ManageGuild)
    const modMsg = createMockGuildMessage({
      permissions: [PermissionsBitField.Flags.ModerateMembers],
    });
    assert.equal(evaluateExemption(modMsg, config).exempt, true);
  });

  it('miễn trừ chính xác các Vai trò, Thành viên và Kênh (kể cả Thread con) trong Whitelist', () => {
    const config = createDefaultGuildConfig();
    config.whitelistRoles = ['role-vip'];
    config.whitelistUsers = ['user-trusted'];
    config.whitelistChannels = ['channel-free-ping'];

    const roleExempt = createMockGuildMessage({ roleIds: ['role-normal', 'role-vip'] });
    assert.deepEqual(evaluateExemption(roleExempt, config), {
      exempt: true,
      reason: 'whitelisted_role',
    });

    const userExempt = createMockGuildMessage({ authorId: 'user-trusted' });
    assert.deepEqual(evaluateExemption(userExempt, config), {
      exempt: true,
      reason: 'whitelisted_user',
    });

    const threadInWhitelistedChannel = createMockGuildMessage({
      channelId: 'thread-123',
      parentId: 'channel-free-ping',
    });
    assert.deepEqual(evaluateExemption(threadInWhitelistedChannel, config), {
      exempt: true,
      reason: 'whitelisted_channel',
    });
  });

  it('không miễn trừ thành viên thường và kiểm soát an toàn bot lạ', () => {
    const config = createDefaultGuildConfig();
    const regularMsg = createMockGuildMessage({
      authorId: '200000000000000002',
      roleIds: ['role-member'],
    });
    assert.equal(evaluateExemption(regularMsg, config, 'bot-self-id').exempt, false);

    // Chính bot hiện tại luôn được bỏ qua
    const selfMsg = createMockGuildMessage({ authorId: 'bot-self-id', isBot: true });
    assert.equal(evaluateExemption(selfMsg, config, 'bot-self-id').exempt, true);

    // Bot lạ không quyền quản trị bị kiểm tra khi protectAgainstBots = true
    const rogueBotMsg = createMockGuildMessage({ authorId: 'rogue-bot', isBot: true });
    assert.equal(evaluateExemption(rogueBotMsg, config, 'bot-self-id').exempt, false);

    // Nếu tắt protectAgainstBots -> bỏ qua bot khác
    config.protectAgainstBots = false;
    assert.equal(evaluateExemption(rogueBotMsg, config, 'bot-self-id').exempt, true);
  });
});
