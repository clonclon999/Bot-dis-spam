import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  Partials,
} from 'discord.js';
import { safeHandleInteraction } from './events/interactionCreate.js';
import {
  handleMessageCreate,
  handleMessageUpdate,
} from './events/messageCreate.js';
import { handleClientReady } from './events/ready.js';
import { logger } from './utils/logger.js';

/**
 * Khởi tạo Discord Client tối ưu hóa bộ nhớ RAM cực thấp cho gói `botkeep.cloud` FREE (512 MB RAM):
 * - Chỉ bật các Gateway Intents thực sự cần thiết.
 * - Giới hạn chặt bộ đệm tin nhắn và vô hiệu hóa toàn bộ các bộ đệm dư thừa (Presence, Voice, Reaction...).
 *
 * @param {object} deps
 * @param {object} deps.env
 * @param {object} deps.systems - Tổ hợp hệ thống tạo bởi `createBotSystems`
 * @returns {import('discord.js').Client}
 */
export function createBotClient({ env, systems, ...legacyDeps }) {
  const activeContext = systems ?? legacyDeps;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 25,
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0,
      GuildBanManager: 0,
      GuildInviteManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      AutoModerationRuleManager: 0,
      ThreadMemberManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 300,
        lifetime: 600,
      },
    },
    // 🌐 @discordjs/rest: nới hạn chờ lên 30 giây (mặc định 15s). Trên VPS gói FREE,
    // tải ảnh bảng + tin nhắn đôi khi vượt 15 giây => AbortError "This operation was aborted"
    // và bảng kết quả không bao giờ được công bố. Số lần thử lại giữ thấp (2) để không dồn hàng.
    rest: {
      timeout: 30_000,
      retries: 2,
    },
  });

  activeContext?.logSystem?.attachClient?.(client);
  activeContext?.multiplayerRoundSystem?.attachClient?.(client);

  client.once(Events.ClientReady, async (readyClient) => {
    await handleClientReady(readyClient, env);
    try {
      await activeContext?.multiplayerRoundSystem?.recoverActiveRounds?.();
    } catch (err) {
      logger.error('MultiplayerRecovery', 'Lỗi khôi phục phiên cược chung sau khởi động', err);
    }
    // 🚑 Bộ quét an toàn: mỗi 15 giây tự chốt lại các phiên quá hạn bị kẹt (mất timer/restart/treo mạng)
    try {
      activeContext?.multiplayerRoundSystem?.startSafetySweeper?.(15_000);
    } catch (err) {
      logger.warn('MultiplayerRecovery', 'Không khởi động được bộ quét an toàn phiên quá hạn', err);
    }
  });

  client.on(Events.MessageCreate, (message) =>
    handleMessageCreate(message, activeContext)
  );

  client.on(Events.MessageUpdate, (oldMsg, newMsg) =>
    handleMessageUpdate(oldMsg, newMsg, activeContext)
  );

  client.on(Events.InteractionCreate, (interaction) =>
    safeHandleInteraction(interaction, activeContext)
  );

  client.on(Events.Error, (err) => {
    logger.error('DiscordClient', 'Lỗi kết nối Discord WebSocket', err);
  });

  client.on(Events.Warn, (warning) => {
    logger.warn('DiscordClient', warning);
  });

  return client;
}
