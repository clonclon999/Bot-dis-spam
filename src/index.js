import { createBotClient } from './client.js';
import { SYSTEM_LIMITS } from './config/defaults.js';
import { loadEnv } from './config/env.js';
import { MentionDetector } from './services/mentionDetector.js';
import { PunishmentService } from './services/punishmentService.js';
import { GuildStore } from './storage/guildStore.js';
import { startHealthServer } from './utils/healthServer.js';
import { logger } from './utils/logger.js';

/**
 * Điểm khởi chạy chính của Discord Anti-Spam Bot.
 * Tích hợp cơ chế chống crash toàn cục, thu gom rác bộ nhớ định kỳ và tắt máy an toàn (Graceful Shutdown).
 */
async function bootstrap() {
  const env = loadEnv({ requireToken: true });

  const guildStore = new GuildStore(env.dataDir);
  await guildStore.init();

  const mentionDetector = new MentionDetector();
  const punishmentService = new PunishmentService({
    guildStore,
    mentionDetector,
  });

  const client = createBotClient({
    env,
    guildStore,
    mentionDetector,
    punishmentService,
  });

  // Bộ hẹn giờ dọn dẹp dữ liệu tạm trong RAM định kỳ mỗi 60 giây
  const gcInterval = setInterval(() => {
    mentionDetector.sweepExpired();
    punishmentService.sweepExpiredStrikes();
  }, SYSTEM_LIMITS.TRACKER_SWEEP_INTERVAL_MS);

  if (typeof gcInterval.unref === 'function') {
    gcInterval.unref();
  }

  // Khởi động máy chủ HTTP Healthcheck nếu môi trường Cloud cung cấp biến PORT
  const healthServer = startHealthServer({
    port: env.port,
    getStatus: () => ({
      ready: client.isReady(),
      guilds: client.guilds?.cache?.size ?? 0,
      pingMs: client.ws?.ping ?? -1,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryRssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
    }),
  });

  // Xử lý tín hiệu dừng tiến trình an toàn trên VPS / Docker / Cloud
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Lifecycle', `Nhận tín hiệu ${signal}. Đang lưu dữ liệu và đóng kết nối an toàn...`);

    clearInterval(gcInterval);

    try {
      await guildStore.flush();
      logger.info('Lifecycle', 'Đã lưu toàn bộ cấu hình và lịch sử xuống đĩa.');
    } catch (err) {
      logger.error('Lifecycle', 'Lỗi khi lưu dữ liệu lúc tắt bot', err);
    }

    try {
      client.destroy();
    } catch {
      // Bỏ qua lỗi đóng client
    }

    if (healthServer) {
      healthServer.close();
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Hàng rào bảo vệ chống sập tiến trình (Anti-Crash Guards)
  process.on('unhandledRejection', (reason) => {
    logger.error('ProcessGuard', 'Unhandled Promise Rejection (đã chặn crash)', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('ProcessGuard', 'Uncaught Exception (đã chặn crash)', err);
  });

  try {
    await client.login(env.discordToken);
  } catch (err) {
    if (String(err?.message || '').includes('Used disallowed intents')) {
      logger.error(
        'Bootstrap',
        'LỖI QUYỀN INTENT: Bạn chưa bật "Message Content Intent" trong Discord Developer Portal (mục Bot -> Privileged Gateway Intents). Hãy bật tùy chọn này rồi khởi động lại bot!'
      );
    } else if (String(err?.code || '').includes('TokenInvalid')) {
      logger.error(
        'Bootstrap',
        'DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại tệp .env!'
      );
    } else {
      logger.error('Bootstrap', 'Không thể đăng nhập vào Discord', err);
    }
    await guildStore.flush().catch(() => {});
    process.exitCode = 1;
  }
}

bootstrap();
