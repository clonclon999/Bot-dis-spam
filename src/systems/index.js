import { GameDatabase } from '../database/db.js';
import { MentionDetector } from '../services/mentionDetector.js';
import { PunishmentService } from '../services/punishmentService.js';
import { GuildStore } from '../storage/guildStore.js';
import { BankSystem } from './bankSystem.js';
import { CrimeSystem } from './crimeSystem.js';
import { EconomySystem } from './economySystem.js';
import { EventSystem } from './eventSystem.js';
import { GameSystem } from './gameSystem.js';
import { LevelSystem } from './levelSystem.js';
import { LogSystem } from './logSystem.js';
import { PetSystem } from './petSystem.js';
import { QuestSystem } from './questSystem.js';
import { ShopSystem } from './shopSystem.js';

/**
 * Khởi tạo và liên kết toàn bộ các hệ thống nghiệp vụ của DISCORD GAME BOT PRO
 * (bao gồm cả hệ thống bảo vệ Anti-Spam @Mention) trên cùng một kho dữ liệu gọn nhẹ.
 *
 * @param {string} dataDir
 * @returns {Promise<object>}
 */
export async function createBotSystems(dataDir) {
  const db = new GameDatabase(dataDir);
  await db.init();

  const guildStore = new GuildStore(dataDir);
  await guildStore.init();

  const mentionDetector = new MentionDetector();
  const punishmentService = new PunishmentService({
    guildStore,
    mentionDetector,
  });

  const logSystem = new LogSystem({ db });
  const levelSystem = new LevelSystem({ db });
  const petSystem = new PetSystem({ db });
  const economySystem = new EconomySystem({ db, logSystem });
  const bankSystem = new BankSystem({ db, economySystem });
  const questSystem = new QuestSystem({ db, logSystem });
  const eventSystem = new EventSystem({ db, logSystem });
  const shopSystem = new ShopSystem({
    db,
    economySystem,
    petSystem,
    levelSystem,
  });
  const crimeSystem = new CrimeSystem({ db, economySystem });
  const gameSystem = new GameSystem({
    db,
    economySystem,
    levelSystem,
    questSystem,
    eventSystem,
    logSystem,
  });

  // Liên kết phụ thuộc hai chiều sạch sẽ
  levelSystem.bindSystems({ petSystem, questSystem, eventSystem });
  petSystem.bindSystems({ economySystem, levelSystem });
  economySystem.bindSystems({ levelSystem, petSystem, questSystem, eventSystem });
  bankSystem.bindSystems({ questSystem, levelSystem });
  questSystem.bindSystems({ economySystem, levelSystem, eventSystem });

  return {
    db,
    guildStore,
    mentionDetector,
    punishmentService,
    logSystem,
    levelSystem,
    petSystem,
    economySystem,
    bankSystem,
    questSystem,
    eventSystem,
    shopSystem,
    crimeSystem,
    gameSystem,
  };
}
