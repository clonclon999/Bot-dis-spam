import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createBotSystems } from '../src/systems/index.js';
import { ConcurrencyGuard } from '../src/utils/locks.js';

describe('VNĐ Economy, ACID Transfers, Concurrency Lock & Restart-Safe Bank Interest', () => {
  it('thực thi chuẩn xác /daily (streak), /work, /pay và chống số âm / chuyển cho chính mình / tài khoản đóng băng', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'econ-test-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem } = systems;
      try {
        const t0 = Date.now();
        const balA = economySystem.getBalance('u-a', 'Alice');
        assert.equal(balA.wallet, 20_000); // Vốn khởi điểm mặc định 20.000 VNĐ

        // Nhận /daily ngày 1
        const d1 = economySystem.claimPeriodicReward('u-a', 'Alice', 'daily', t0);
        assert.equal(d1.streak, 1);
        assert.ok(d1.balanceAfter > 20_000);

        // Chặn nhận /daily lần 2 ngay lập tức
        assert.throws(
          () => economySystem.claimPeriodicReward('u-a', 'Alice', 'daily', t0 + 5_000),
          /quay lại sau/
        );

        // Nhận /daily ngày 2 (sau 25 giờ) -> Streak tăng lên 2 + thưởng thêm
        const d2 = economySystem.claimPeriodicReward(
          'u-a',
          'Alice',
          'daily',
          t0 + 25 * 3600 * 1000
        );
        assert.equal(d2.streak, 2);
        assert.ok(d2.streakBonus > 0);

        // Đi làm /work
        const w = economySystem.work('u-a', 'Alice', t0 + 26 * 3600 * 1000);
        assert.ok(w.earned >= 3_000);

        // Chuyển khoản /pay hợp lệ sang Bob
        const beforeA = economySystem.getBalance('u-a').wallet;
        const payRes = economySystem.transfer({
          fromId: 'u-a',
          fromName: 'Alice',
          toId: 'u-b',
          toName: 'Bob',
          amount: 10_000,
          isBotTarget: false,
        });
        assert.equal(payRes.senderAfter, beforeA - 10_000);
        assert.equal(economySystem.getBalance('u-b').wallet, 20_000 + 10_000);

        // Chặn chuyển cho chính mình, chuyển cho Bot, chuyển vượt số dư
        assert.throws(() =>
          economySystem.transfer({
            fromId: 'u-a',
            fromName: 'Alice',
            toId: 'u-a',
            toName: 'Alice',
            amount: 5_000,
          })
        );
        assert.throws(() =>
          economySystem.transfer({
            fromId: 'u-a',
            fromName: 'Alice',
            toId: 'bot-1',
            toName: 'Bot',
            amount: 5_000,
            isBotTarget: true,
          })
        );
        assert.throws(() =>
          economySystem.transfer({
            fromId: 'u-a',
            fromName: 'Alice',
            toId: 'u-b',
            toName: 'Bob',
            amount: 999_999_999,
          })
        );

        // Khi OWNER đóng băng toàn bộ giao dịch -> Chặn mọi giao dịch ngay lập tức
        db.setSetting('freezeAllTransactions', true);
        assert.throws(
          () =>
            economySystem.transfer({
              fromId: 'u-a',
              fromName: 'Alice',
              toId: 'u-b',
              toName: 'Bob',
              amount: 2_000,
            }),
          /đóng băng/i
        );
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('tính lãi suất ngân hàng chính xác theo chu kỳ và TUYỆT ĐỐI KHÔNG cộng trùng khi restart Bot hoặc gọi lệnh liên tiếp', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bank-restart-'));
    try {
      const t0 = Date.now();
      const s1 = await createBotSystems(tmpDir);
      s1.economySystem.ensureUser('saver-1', 'Saver', t0);
      s1.economySystem.adminAdjustWallet({
        actorId: '1243061570247069696',
        actorRole: 'OWNER',
        targetId: 'saver-1',
        targetName: 'Saver',
        mode: 'set',
        amount: 200_000,
      });

      // Gửi 100.000 vào Ngân hàng thường (2%) và 100.000 vào Sổ tiết kiệm (2% * 1.5 = 3%) tại t0
      s1.bankSystem.deposit('saver-1', 'Saver', 100_000, 'checking', t0);
      s1.bankSystem.deposit('saver-1', 'Saver', 100_000, 'savings', t0);

      // Gọi settleInterest liên tiếp 5 lần khi chưa đủ 24h -> Lãi = 0
      for (let i = 0; i < 5; i++) {
        const early = s1.bankSystem.settleInterest('saver-1', 'Saver', t0 + 12 * 3600 * 1000);
        assert.equal(early.credited, 0);
      }

      // Đóng cơ sở dữ liệu (mô phỏng BotKeep restart container lần 1)
      await s1.db.close();

      // Mở lại cơ sở dữ liệu sau đúng 2 chu kỳ (48 giờ)
      const s2 = await createBotSystems(tmpDir);
      const t48h = t0 + 48 * 3600 * 1000 + 2000;
      const interest1 = s2.bankSystem.settleInterest('saver-1', 'Saver', t48h);

      // 2 chu kỳ: NH thường = 100k * 2% * 2 = 4.000; Tiết kiệm = 100k * 3% * 2 = 6.000 -> Tổng lãi = 10.000 VNĐ
      assert.equal(interest1.periodsApplied, 2);
      assert.equal(interest1.credited, 10_000);
      assert.equal(interest1.bank, 104_000);
      assert.equal(interest1.savings, 106_000);

      // Đóng & khởi động lại Bot lần 2 ngay sau đó -> Gọi lại /interest phải trả về 0 VNĐ (không bao giờ cộng trùng!)
      await s2.db.close();
      const s3 = await createBotSystems(tmpDir);
      try {
        const interestAfterRestart = s3.bankSystem.settleInterest(
          'saver-1',
          'Saver',
          t48h + 60_000
        );
        assert.equal(interestAfterRestart.credited, 0);
        assert.equal(interestAfterRestart.bank, 104_000);
        assert.equal(interestAfterRestart.savings, 106_000);
      } finally {
        await s3.db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('chặn đứng xung đột Race Condition khi bấm đồng thời bằng ConcurrencyGuard', async () => {
    const guard = new ConcurrencyGuard();
    const [r1, r2] = await Promise.all([
      guard.runExclusive('u-race', async () => {
        await new Promise((r) => setTimeout(r, 30));
        return 'first';
      }),
      guard.runExclusive('u-race', async () => 'second'),
    ]);

    assert.equal(r1.acquired, true);
    assert.equal(r2.acquired, false);
  });
});
