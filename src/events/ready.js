import { ActivityType } from 'discord.js';
import { getSlashCommandsJSON } from '../commands/index.js';
import { logger } from '../utils/logger.js';

/**
 * Sự kiện kích hoạt một lần khi Bot kết nối thành công tới Discord Gateway (`ClientReady`).
 *
 * @param {import('discord.js').Client<true>} readyClient
 * @param {object} env
 */
export async function handleClientReady(readyClient, env) {
  logger.info(
    'ClientReady',
    `Đăng nhập thành công: ${readyClient.user.tag} (${readyClient.user.id}) | Máy chủ: ${readyClient.guilds.cache.size} | RAM RSS: ${(process.memoryUsage().rss / 1048576).toFixed(1)} MB`
  );

  try {
    readyClient.user.setPresence({
      activities: [
        {
          name: '/menu • /help | Game Bot PRO & Anti-Spam',
          type: ActivityType.Playing,
        },
      ],
      status: 'online',
    });
  } catch (err) {
    logger.warn('ClientReady', 'Không thể đặt trạng thái hiển thị (Presence)', err);
  }

  if (env.autoDeployCommands) {
    try {
      const payload = getSlashCommandsJSON();
      if (env.devGuildId) {
        const targetGuild = readyClient.guilds.cache.get(env.devGuildId);
        if (targetGuild) {
          await targetGuild.commands.set(payload);
          logger.info(
            'CommandSync',
            `Đã đồng bộ ${payload.length} Slash Commands tức thì cho máy chủ DEV (${env.devGuildId}).`
          );
          return;
        }
      }

      await readyClient.application.commands.set(payload);
      logger.info(
        'CommandSync',
        `Đã đồng bộ ${payload.length} Slash Commands của GAME BOT PRO ở phạm vi Global.`
      );
    } catch (err) {
      logger.error('CommandSync', 'Lỗi khi tự động đồng bộ Slash Commands', err);
    }
  }
}
