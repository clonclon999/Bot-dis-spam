import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EVENT_TYPES } from '../src/config/constants.js';
import { createBotSystems } from '../src/systems/index.js';

describe('Quests, Shop (Mystery Box), Pets, Titles, Crime/Wanted, Events & Backup/Restore', () => {
  it('vận hành khép kín Nhiệm vụ, Cửa hàng, Thú cưng, Danh hiệu, Truy nã, Sự kiện & Sao lưu SQLite', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'full-eco-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const {
        db,
        economySystem,
        questSystem,
        shopSystem,
        petSystem,
        levelSystem,
        crimeSystem,
        eventSystem,
      } = systems;

      try {
        // Cấp vốn thử nghiệm cho Hero & Target
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'hero-1',
          targetName: 'Hero',
          mode: 'set',
          amount: 2_000_000,
        });
        economySystem.adminAdjustWallet({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'victim-1',
          targetName: 'Victim',
          mode: 'set',
          amount: 300_000,
        });

        // 1. PETS: Mua Cáo Tuyết Cửu Vĩ, cho ăn, huấn luyện lên cấp, đổi tên
        const boughtPet = petSystem.buyPet('hero-1', 'Hero', 'fox_snow', 'Hồ Ly');
        assert.equal(boughtPet.pet.nickname, 'Hồ Ly');
        const fed = petSystem.feedPet('hero-1', 'Hero', boughtPet.pet.id);
        assert.equal(fed.pet.hunger, 100);
        const upg = petSystem.upgradePet('hero-1', 'Hero', boughtPet.pet.id);
        assert.equal(upg.pet.level, 2);
        const renamed = petSystem.renamePet('hero-1', boughtPet.pet.id, 'Cửu Vĩ');
        assert.equal(renamed.nickname, 'Cửu Vĩ');
        const bonuses = petSystem.getActivePetBonuses('hero-1');
        assert.ok(bonuses.expBonusPct > 0);
        assert.ok(bonuses.questBonusPct > 0);

        // 2. SHOP & MYSTERY BOX: Mua Hộp Quà Bí Ẩn + Bán vật phẩm
        shopSystem.buyItem('hero-1', 'Hero', 'mystery_box', 2);
        const openBox = shopSystem.useItem('hero-1', 'Hero', 'mystery_box');
        assert.ok(openBox.effectMessage.length > 5);
        const sold = shopSystem.sellItem('hero-1', 'Hero', 'mystery_box', 1);
        assert.ok(sold.totalProceeds > 0);

        // 3. QUESTS: Hoàn thành nhiệm vụ hằng ngày (đủ 9 nhiệm vụ chuẩn Mục 13) & chống nhận thưởng trùng
        const dailyList = questSystem.getUserQuests('hero-1', 'Hero', 'daily');
        assert.equal(dailyList.length, 9);
        questSystem.incrementMetric('hero-1', 'work_count', 5);
        const claimed = questSystem.claimRewards('hero-1', 'Hero', 'daily_work_5');
        assert.equal(claimed.claimedQuests.length, 1);
        assert.throws(
          () => questSystem.claimRewards('hero-1', 'Hero', 'daily_work_5'),
          /nhận thưởng|chưa có nhiệm vụ/i
        );

        // 4. LEVELS & TITLES: Danh hiệu Đại Gia đã được tự động mở khóa khi tài sản >= 1.000.000 VNĐ
        levelSystem.evaluateMilestoneTitles('hero-1');
        const equippedTitle = levelSystem.equipTitle('hero-1', 'dai_gia');
        assert.match(equippedTitle.name, /Đại Gia/);

        // 5. CRIME & WANTED: Treo thưởng truy nã, Bảo vệ OWNER khỏi bị cướp, Bảo hiểm chống cướp
        const bounty = crimeSystem.placeBounty({
          placerId: 'hero-1',
          placerName: 'Hero',
          targetId: 'victim-1',
          targetName: 'Victim',
          amount: 20_000,
          reason: 'Thử nghiệm truy nã',
        });
        assert.equal(bounty.totalBounty, 20_000);
        assert.equal(crimeSystem.getWantedList().length, 1);

        // Chặn cướp tài khoản OWNER
        assert.throws(
          () =>
            crimeSystem.rob({
              robberId: 'hero-1',
              robberName: 'Hero',
              victimId: '1243061570247069696',
              victimName: 'Owner',
            }),
          /OWNER|ADMIN|Ban Quản Trị/i
        );

        // Khi Victim mua bảo hiểm /protect -> Chặn cướp tuyệt đối
        crimeSystem.buyProtection('victim-1', 'Victim', 24);
        assert.throws(
          () =>
            crimeSystem.rob({
              robberId: 'hero-1',
              robberName: 'Hero',
              victimId: 'victim-1',
              victimName: 'Victim',
            }),
          /Bảo Hiểm/i
        );

        // 6. SERVER EVENTS: Tạo sự kiện Đua Top, ghi nhận điểm, dừng & tự phát thưởng Top 3
        const ev = eventSystem.createEvent({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          type: EVENT_TYPES.QUEST_EVENT,
          rewardVnd: 100_000,
          durationHours: 12,
        });
        eventSystem.recordProgress('hero-1', EVENT_TYPES.QUEST_EVENT, 5);
        eventSystem.recordProgress('victim-1', EVENT_TYPES.QUEST_EVENT, 2);

        const beforeStopHero = economySystem.getBalance('hero-1').wallet;
        const stopped = eventSystem.stopAndDistributeRewards({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          eventId: ev.id,
          autoPay: true,
        });
        assert.equal(stopped.winners[0].userId, 'hero-1');
        assert.equal(stopped.winners[0].prize, 100_000);
        assert.equal(economySystem.getBalance('hero-1').wallet, beforeStopHero + 100_000);

        // 7. BACKUP & RESTORE SQLITE: Sao lưu, xóa sạch ví rồi khôi phục nguyên trạng 100%
        const exactHeroWallet = economySystem.getBalance('hero-1').wallet;
        const backup = await db.createBackup();
        assert.ok(backup.sizeBytes > 1000);

        economySystem.adminResetUser({
          actorId: '1243061570247069696',
          actorRole: 'OWNER',
          targetId: 'hero-1',
        });
        assert.equal(economySystem.getBalance('hero-1').wallet, 20_000);

        await db.restoreBackup(backup.filename);
        assert.equal(economySystem.getBalance('hero-1').wallet, exactHeroWallet);
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
