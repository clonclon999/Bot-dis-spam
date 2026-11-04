import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  Partials,
} from 'discord.js';
import {
  handleMessageCreate,
  handleMessageUpdate,
} from './events/messageCreate.js';
import { handleInteractionCreate } from './events/interactionCreate.js';
import { handleClientReady } from './events/ready.js';
import { logger } from './utils/logger.js';

/**
 * Khởi tạo Discord Client được tối ưu hóa bộ nhớ RAM cho môi trường Cloud:
 * - Chỉ bật đúng các Gateway Intents cần thiết (`Guilds`, `GuildMessages`, `MessageContent`).
 * - Tắt bộ đệm (cache) của các thành phần không dùng đến (Presence, Reaction, Voice, Invite...)
 *   và giới hạn số lượng tin nhắn lưu tạm mỗi kênh nhằm giữ mức tiêu thụ RAM cực thấp.
 *
 * @param {object} deps
 * @param {object} deps.env
 * @param {import('./storage/guildStore.js').GuildStore} deps.guildStore
 * @param {import('./services/mentionDetector.js').MentionDetector} deps.mentionDetector
 * @param {import('./services/punishmentService.js').PunishmentService} deps.punishmentService
 * @returns {import('discord.js').Client}
 */
export function createBotClient({
  env,
  guildStore,
  mentionDetector,
  punishmentService,
}) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 30, // Chỉ giữ tối đa 30 tin nhắn gần nhất mỗi kênh (hỗ trợ messageUpdate)
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
        interval: 300, // Quét dọn mỗi 5 phút
        lifetime: 600, // Xóa khỏi bộ đệm các tin nhắn cũ hơn 10 phút
      },
    },
  });

  const sharedContext = {
    guildStore,
    mentionDetector,
    punishmentService,
  };

  client.once(Events.ClientReady, (readyClient) =>
    handleClientReady(readyClient, env)
  );

  client.on(Events.MessageCreate, (message) =>
    handleMessageCreate(message, sharedContext)
  );

  client.on(Events.MessageUpdate, (oldMsg, newMsg) =>
    handleMessageUpdate(oldMsg, newMsg, sharedContext)
  );

  client.on(Events.InteractionCreate, (interaction) =>
    handleInteractionCreate(interaction, sharedContext)
  );

  client.on(Events.Error, (err) => {
    logger.error('DiscordClient', 'Lỗi kết nối Discord WebSocket', err);
  });

  client.on(Events.Warn, (warning) => {
    logger.warn('DiscordClient', warning);
  });

  return client;
}
