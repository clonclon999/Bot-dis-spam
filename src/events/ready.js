import { ActivityType } from 'discord.js';
import { getSlashCommandsJSON } from '../commands/index.js';
import { warmUpAssetCache } from '../utils/assetRegistry.js';
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

  // 🚀 Làm nóng bộ nhớ đệm ảnh/gif game (bất đồng bộ) để lệnh trò chơi đầu tiên không bị chậm 3 giây.
  warmUpAssetCache()
    .then((count) => {
      logger.info('AssetCache', `Đã nạp sẵn ${count} tệp hình ảnh game vào RAM (loại bỏ độ trễ lần chơi đầu).`);
    })
    .catch((err) => {
      logger.warn('AssetCache', 'Không thể làm nóng bộ nhớ đệm tài nguyên', err);
    });

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
