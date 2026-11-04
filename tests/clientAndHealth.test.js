import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBotClient } from '../src/client.js';
import { loadEnv } from '../src/config/env.js';
import { MentionDetector } from '../src/services/mentionDetector.js';
import { PunishmentService } from '../src/services/punishmentService.js';
import { GuildStore } from '../src/storage/guildStore.js';
import { startHealthServer } from '../src/utils/healthServer.js';
import { redactSecrets } from '../src/utils/logger.js';

describe('Discord Client Factory, Env Validation & Cloud HealthServer', () => {
  it('khởi tạo Discord Client với cấu hình tối ưu RAM không phát sinh lỗi hay cảnh báo', async () => {
    const guildStore = new GuildStore('./data');
    const mentionDetector = new MentionDetector();
    const punishmentService = new PunishmentService({
      guildStore,
      mentionDetector,
    });

    const client = createBotClient({
      env: { autoDeployCommands: false, devGuildId: null },
      guildStore,
      mentionDetector,
      punishmentService,
    });

    assert.ok(client);
    client.destroy();
  });

  it('kiểm tra biến môi trường và tự động che giấu Token trong logger', () => {
    assert.throws(() => loadEnv({ requireToken: true }), /DISCORD_TOKEN/);

    const dummyGhPat = ['github', 'pat', '00000000000000000000000000'].join('_');
    const dummyClassic = ['ghp', '000000000000000000000000000000000000'].join('_');
    const fakeLog = `Error with token ${dummyGhPat} and ${dummyClassic}`;
    const redacted = redactSecrets(fakeLog);
    assert.ok(!redacted.includes(dummyGhPat));
    assert.ok(!redacted.includes(dummyClassic));
    assert.ok(redacted.includes('[REDACTED_GITHUB_TOKEN]'));
  });

  it('phản hồi HTTP 200 JSON chính xác trên cổng HealthServer cho Cloud', async () => {
    const server = startHealthServer({
      port: 0, // Để hệ điều hành cấp cổng ngẫu nhiên khả dụng
      getStatus: () => ({ ready: true, guilds: 3 }),
    });

    try {
      await new Promise((resolve) => {
        if (server.listening) resolve();
        else server.once('listening', resolve);
      });

      const addr = server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.ready, true);
      assert.equal(body.guilds, 3);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
