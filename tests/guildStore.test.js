import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { SYSTEM_LIMITS } from '../src/config/defaults.js';
import { GuildStore } from '../src/storage/guildStore.js';

describe('GuildStore Persistent Storage', () => {
  it('lưu bền vững cấu hình, whitelist và lịch sử qua các lần khởi động lại', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'antispam-store-'));

    try {
      const store1 = new GuildStore(tmpDir);
      await store1.init();

      store1.updateConfig('guild-abc', {
        maxMentionsPerMessage: 12,
        maxMentionsWindow: 8, // Sẽ tự nâng lên >= 12 để đảm bảo hợp lý
        timeWindowSeconds: 20,
        logChannelId: '987654321098765432',
      });

      store1.modifyWhitelist('guild-abc', 'role', 'add', 'role-111');
      store1.modifyWhitelist('guild-abc', 'user', 'add', 'user-222');

      store1.appendViolationLog('guild-abc', {
        id: 'log-1',
        timestamp: new Date().toISOString(),
        userId: 'spammer-1',
        userTag: 'Spammer#0001',
        channelId: 'chan-1',
        violationType: 'EVERYONE_HERE_SPAM',
        reason: 'Test reason',
        strikeLevel: 2,
        actions: { messageDeleted: true, warningSent: true, timeoutApplied: true },
      });

      await store1.flush();

      // Khởi tạo phiên mới đọc lại từ ổ cứng (mô phỏng khởi động lại bot)
      const store2 = new GuildStore(tmpDir);
      await store2.init();

      const loadedCfg = store2.getConfig('guild-abc');
      assert.equal(loadedCfg.maxMentionsPerMessage, 12);
      assert.equal(loadedCfg.maxMentionsWindow, 12);
      assert.equal(loadedCfg.timeWindowSeconds, 20);
      assert.equal(loadedCfg.logChannelId, '987654321098765432');
      assert.deepEqual(loadedCfg.whitelistRoles, ['role-111']);
      assert.deepEqual(loadedCfg.whitelistUsers, ['user-222']);
      assert.equal(loadedCfg.stats.totalViolations, 1);
      assert.equal(loadedCfg.stats.timeoutsIssued, 1);

      const logs = store2.getViolationLogs('guild-abc', { userId: 'spammer-1' });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].id, 'log-1');

      // Kiểm tra giới hạn tối đa bản ghi log mỗi guild để bảo vệ RAM & đĩa
      for (let i = 0; i < SYSTEM_LIMITS.MAX_LOGS_PER_GUILD + 25; i++) {
        store2.appendViolationLog('guild-abc', {
          id: `bulk-${i}`,
          timestamp: new Date().toISOString(),
          userId: 'spammer-2',
          actions: {},
        });
      }
      assert.equal(
        store2.getViolationLogs('guild-abc', { limit: 25 }).length,
        25
      );
      assert.equal(
        store2.logs.get('guild-abc').length,
        SYSTEM_LIMITS.MAX_LOGS_PER_GUILD
      );

      // Kiểm tra reset cấu hình
      const resetCfg = store2.resetConfig('guild-abc', { keepLogs: false });
      assert.equal(resetCfg.maxMentionsPerMessage, 5);
      assert.equal(store2.getViolationLogs('guild-abc').length, 0);
      await store2.flush();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
