import { registerNoituUiHooks } from '../commands/games/noitu.js';
import { buildMultiplayerBoardPayload } from '../commands/games/multiplayerRound.js';
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
import { MultiplayerRoundSystem } from './multiplayerRoundSystem.js';
import { PetSystem } from './petSystem.js';
import { QuestSystem } from './questSystem.js';
import { ShopSystem } from './shopSystem.js';
import { WordChainSystem } from './wordChainSystem.js';

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
  const wordChainSystem = new WordChainSystem({
    db,
    economySystem,
    levelSystem,
    questSystem,
    eventSystem,
  });
  registerNoituUiHooks(wordChainSystem);

  const multiplayerRoundSystem = new MultiplayerRoundSystem({
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

  const systems = {
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
    wordChainSystem,
    multiplayerRoundSystem,
  };

  /**
   * Gửi bảng phiên mới với phương án dự phòng: nếu tải ảnh lên thất bại (AbortError/timeout),
   * tự gửi lại bảng dạng CHỈ CHỮ để kênh không bị trống phiên.
   */
  const sendBoardWithFallback = async (targetChannel, payload, snapshot) => {
    // Giới hạn thời gian cứng: kênh/Discord có treo thì cũng không được giữ pipeline chốt phiên.
    const sent = await multiplayerRoundSystem._sendWithTimeout(targetChannel, payload, 10_000);
    if (sent) return sent;
    const textOnly = buildMultiplayerBoardPayload(snapshot, systems, {
      isEdit: true,
      textOnly: true,
    });
    return multiplayerRoundSystem._sendWithTimeout(targetChannel, textOnly, 6_000);
  };

  multiplayerRoundSystem.setBoardRenderer(async (snapshot, meta = {}) => {
    // 📌 ĐĂNG BẢNG MỚI Ở CUỐI KÊNH sau khi đếm ngược 3-2-1 kết thúc (khóa sổ / công bố kết quả):
    // người chơi không cần lướt lên trên để xem kết quả nữa. Bảng cũ được xoá để kênh gọn.
    if (meta.postNew) {
      const channel = await multiplayerRoundSystem._resolveRoundChannel(snapshot.round.channel_id);
      if (channel && typeof channel.send === 'function') {
        const freshPayload = buildMultiplayerBoardPayload(snapshot, systems, { isEdit: false });
        // Giới hạn 8 giây: nếu Discord/kênh chậm quá thì bỏ qua việc đăng mới và chuyển sang
        // sửa bảng cũ ngay, tuyệt đối không để kết quả bị treo chờ.
        const newMsg = await multiplayerRoundSystem._sendWithTimeout(channel, freshPayload, 8_000);
        if (newMsg) {
          multiplayerRoundSystem.registerMessageRef(snapshot.round.round_id, newMsg);
          if (meta.message && meta.message.id !== newMsg.id && typeof meta.message.delete === 'function') {
            await meta.message.delete().catch(() => {});
          }
          return;
        }
      }
      // Không lấy được kênh / gửi quá chậm -> quay về cách cũ (sửa tại chỗ) để kết quả vẫn hiển thị
    }

    const msg = meta.message;
    if (!msg || typeof msg.edit !== 'function') return;
    const payload = buildMultiplayerBoardPayload(snapshot, systems, {
      ...meta,
      isEdit: true,
    });
    try {
      await msg.edit(payload);
    } catch (err) {
      // 🛟 PHƯƠNG ÁN DỰ PHÒNG: nếu tải ảnh lên Discord thất bại (AbortError/timeout trên VPS yếu),
      // đăng lại bảng dạng CHỈ CHỮ để kết quả phiên LUÔN được công bố, không bao giờ bỏ trắng.
      const retryPayload = buildMultiplayerBoardPayload(snapshot, systems, {
        ...meta,
        isEdit: true,
        textOnly: true,
      });
      await msg.edit(retryPayload).catch(() => {});
    }
  });

  multiplayerRoundSystem.setAutoStartBoardPublisher(async (newSnapshot, prevRound, prevMsg) => {
    const hadPlayers = Number(prevRound?.total_players) > 0;

    // Nếu phiên trước CÓ người đặt cược và có kênh gửi tin nhắn thực:
    // 1) Cập nhật bảng kết quả phiên trước để ghi nhận Round ID tiếp theo vừa tạo
    // 2) Đăng 1 bảng phiên mới duy nhất ở cuối kênh (không spam tin nhắn đếm ngược!)
    if (hadPlayers && prevRound?.round_id) {
      await multiplayerRoundSystem._renderBoardNow(prevRound.round_id, {
        phase: 'AUTO_NEXT_LINKED',
      });
    }

    const client = multiplayerRoundSystem.client;
    const channelId = newSnapshot.round.channel_id;
    let targetChannel = null;
    if (client && channelId) {
      targetChannel =
        client.channels?.cache?.get(channelId) ||
        (await client.channels?.fetch?.(channelId).catch(() => null));
    }

    if (hadPlayers && targetChannel && typeof targetChannel.send === 'function') {
      const freshPayload = buildMultiplayerBoardPayload(newSnapshot, systems, {
        isEdit: false,
      });
      const sentMsg = await sendBoardWithFallback(targetChannel, freshPayload, newSnapshot);
      if (sentMsg) {
        multiplayerRoundSystem.registerMessageRef(newSnapshot.round.round_id, sentMsg);
      }
      // Tự động xóa bảng kết quả của phiên trước ngay khi bảng phiên mới đã đăng (không làm rối mắt kênh!)
      if (prevMsg && prevMsg !== sentMsg && typeof prevMsg.delete === 'function') {
        await prevMsg.delete().catch(() => {});
      }
      if (prevRound?.round_id) {
        multiplayerRoundSystem.clearMessageRef(prevRound.round_id);
      }
      return;
    }

    // Nếu phiên trước 0 người chơi (hoặc môi trường chỉ chỉnh sửa tại chỗ):
    // Tái sử dụng ngay cùng 1 bảng tin nhắn để cập nhật Round ID mới, đồng hồ mới & mở lại nút cược (0 spam tuyệt đối!)
    if (prevMsg && typeof prevMsg.edit === 'function') {
      const editPayload = buildMultiplayerBoardPayload(newSnapshot, systems, {
        isEdit: true,
      });
      await prevMsg.edit(editPayload);
      if (prevRound?.round_id) {
        multiplayerRoundSystem.clearMessageRef(prevRound.round_id);
      }
      multiplayerRoundSystem.registerMessageRef(newSnapshot.round.round_id, prevMsg);
      return;
    }

    if (targetChannel && typeof targetChannel.send === 'function') {
      const freshPayload = buildMultiplayerBoardPayload(newSnapshot, systems, {
        isEdit: false,
      });
      const sentMsg = await sendBoardWithFallback(targetChannel, freshPayload, newSnapshot);
      if (sentMsg) {
        multiplayerRoundSystem.registerMessageRef(newSnapshot.round.round_id, sentMsg);
      }
      if (prevMsg && prevMsg !== sentMsg && typeof prevMsg.delete === 'function') {
        await prevMsg.delete().catch(() => {});
      }
      if (prevRound?.round_id) {
        multiplayerRoundSystem.clearMessageRef(prevRound.round_id);
      }
    }
  });

  return systems;
}
