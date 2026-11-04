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
  });

  activeContext?.logSystem?.attachClient?.(client);

  client.once(Events.ClientReady, (readyClient) =>
    handleClientReady(readyClient, env)
  );

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
