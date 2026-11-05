import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createBotSystems } from '../src/systems/index.js';

describe('All 6 Fair Crypto-RNG Games (Bầu Cua, Tài Xỉu, Coinflip, Guess, Race, RPS PvE & PvP)', () => {
  it('xử lý chính xác đặt cược, kết toán trả thưởng & lịch sử cho cả 6 trò chơi', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'games-pro-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db, economySystem, gameSystem } = systems;
      try {
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'player-1',
          targetName: 'GamerOne',
          mode: 'set',
          amount: 500_000,
        });
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'player-2',
          targetName: 'GamerTwo',
          mode: 'set',
          amount: 500_000,
        });

        // 1. Bầu Cua đa cửa (Bầu + Cua + Tôm)
        const bc = gameSystem.playBauCua({
          userId: 'player-1',
          username: 'GamerOne',
          bets: { bau: 5_000, cua: 5_000, tom: 5_000 },
        });
        assert.equal(bc.rolledMascots.length, 3);
        assert.equal(bc.totalBet, 15_000);
        assert.ok(bc.balanceAfter >= 0);

        // 2. Tài Xỉu + Bảng thống kê cá nhân
        const tx = gameSystem.playTaiXiu({
          userId: 'player-1',
          username: 'GamerOne',
          choice: 'tai',
          bet: 10_000,
        });
        assert.equal(tx.dice.length, 3);
        assert.ok(tx.sum >= 3 && tx.sum <= 18);
        const dash = gameSystem.getTaiXiuDashboard('player-1');
        assert.equal(dash.personal.total, 1);
        assert.equal(dash.recentLogs.length, 1);

        // 3. Coinflip
        const cf = gameSystem.playCoinflip({
          userId: 'player-1',
          username: 'GamerOne',
          side: 'sap',
          bet: 5_000,
        });
        assert.ok(['sap', 'ngua'].includes(cf.resultSide));

        // 4. Đoán số (Guess) — Tối đa không vượt quá 5 lượt đoán ở mọi độ khó
        assert.equal(gameSystem.getGuessModeConfig('easy').maxAttempts, 4);
        assert.equal(gameSystem.getGuessModeConfig('medium').maxAttempts, 5);
        assert.equal(gameSystem.getGuessModeConfig('hard').maxAttempts, 5);

        const hardSess = gameSystem.startGuessSession({
          userId: 'player-1',
          username: 'GamerOne',
          difficulty: 'hard',
          bet: 2_000,
        });
        assert.equal(hardSess.maxAttempts, 5);
        // Đoán sai đủ 5 lượt trên chế độ Khó -> kết thúc ván đúng ở lượt thứ 5
        const wrongVal = hardSess.secret === 1 ? 2 : 1;
        let lastStep = null;
        for (let i = 1; i <= 5; i += 1) {
          lastStep = gameSystem.submitGuessTurn({
            userId: 'player-1',
            username: 'GamerOne',
            guessNumber: wrongVal,
          });
        }
        assert.equal(lastStep.finished, true);
        assert.equal(lastStep.won, false);

        const gs = gameSystem.playGuess({
          userId: 'player-1',
          username: 'GamerOne',
          difficulty: 'easy',
          guessNumber: 2,
          bet: 5_000,
        });
        assert.ok(gs.secret >= 1 && gs.secret <= 5);

        // 5. Đua thú (Race) kèm 3 khung hình trực tiếp & trả thưởng bục Top 1–2–3 (2.4x / 1.4x / 1.1x)
        const rc = gameSystem.playRace({
          userId: 'player-1',
          username: 'GamerOne',
          animalId: 'horse',
          bet: 5_000,
        });
        assert.equal(rc.frames.length, 3);
        assert.ok(rc.winner.id);
        assert.ok(rc.rank >= 1 && rc.rank <= 5);
        if (rc.rank === 1) assert.equal(rc.multiplier, 2.4);
        else if (rc.rank === 2) assert.equal(rc.multiplier, 1.4);
        else if (rc.rank === 3) assert.equal(rc.multiplier, 1.1);
        else assert.equal(rc.multiplier, 0);

        // 6. Oẳn Tù Tì PvE & PvP (chuyển tiền nguyên tử giữa 2 người chơi)
        const rpsBot = gameSystem.playRpsBot({
          userId: 'player-1',
          username: 'GamerOne',
          choice: 'rock',
          bet: 5_000,
        });
        assert.ok(['win', 'lose', 'tie'].includes(rpsBot.outcome));

        const p1Before = economySystem.getBalance('player-1').wallet;
        const p2Before = economySystem.getBalance('player-2').wallet;
        const pvp = gameSystem.settleRpsPvp({
          p1Id: 'player-1',
          p1Name: 'GamerOne',
          p1Choice: 'rock', // Búa thắng Kéo
          p2Id: 'player-2',
          p2Name: 'GamerTwo',
          p2Choice: 'scissors',
          bet: 20_000,
        });
        assert.equal(pvp.outcome, 'p1');
        assert.equal(pvp.winnerId, 'player-1');
        assert.equal(economySystem.getBalance('player-1').wallet, p1Before + 20_000);
        assert.equal(economySystem.getBalance('player-2').wallet, p2Before - 20_000);

        // 7. Khi Admin tạm tắt trò chơi Bầu Cua -> Chặn đặt cược ngay
        const gamesEnabled = { ...db.getSetting('gamesEnabled'), baucua: false };
        db.setSetting('gamesEnabled', gamesEnabled);
        assert.throws(
          () =>
            gameSystem.playBauCua({
              userId: 'player-1',
              username: 'GamerOne',
              bets: { bau: 5_000 },
            }),
          /tạm khóa/
        );
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
