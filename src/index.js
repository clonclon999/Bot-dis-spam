import { createBotClient } from './client.js';
import { sweepPendingConfirmations } from './commands/admin/confirmStore.js';
import { sweepGameSessions } from './commands/games/index.js';
import { SYSTEM_LIMITS } from './config/defaults.js';
import { loadEnv } from './config/env.js';
import { createBotSystems } from './systems/index.js';
import { startHealthServer } from './utils/healthServer.js';
import { logger } from './utils/logger.js';
import { globalPanelCleaner } from './utils/panelCleaner.js';

/**
 * Điểm khởi chạy trung tâm của DISCORD GAME BOT PRO & ANTI-SPAM SYSTEM.
 * Được tối ưu hóa chuyên sâu cho môi trường `botkeep.cloud` FREE (512MB RAM / 50% CPU / 1GB Disk):
 * - Không chạy vòng lặp tính toán ngầm tốn CPU.
 * - Mọi lãi suất ngân hàng & độ đói thú cưng đều tính toán lười (Lazy Evaluation) theo dấu thời gian.
 * - Lưu trữ SQLite nguyên tử (Atomic `.tmp -> rename`) và tự động chốt dữ liệu an toàn khi tắt máy.
 */
async function bootstrap() {
  const env = loadEnv({ requireToken: true });
  const systems = await createBotSystems(env.dataDir);
  const client = createBotClient({ env, systems });

  // Chỉ quét dọn nhẹ các phiên bấm nút hết hạn trong RAM mỗi 5 phút (.unref() không giữ tiến trình)
  const gcInterval = setInterval(() => {
    systems.mentionDetector.sweepExpired();
    systems.punishmentService.sweepExpiredStrikes();
    sweepGameSessions();
    sweepPendingConfirmations();
    globalPanelCleaner.sweepExpired();
  }, Math.max(SYSTEM_LIMITS.TRACKER_SWEEP_INTERVAL_MS * 5, 300_000));

  if (typeof gcInterval.unref === 'function') {
    gcInterval.unref();
  }

  // Khởi động cổng Healthcheck nhẹ nếu nền tảng Cloud cấp biến PORT
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

  // Cơ chế Tắt máy An toàn (Graceful Shutdown) bảo toàn 100% dữ liệu SQLite & JSON
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Lifecycle', `Nhận tín hiệu ${signal}. Đang lưu dữ liệu SQLite an toàn...`);

    clearInterval(gcInterval);
    globalPanelCleaner.clearAllTimers();
    systems.wordChainSystem?.shutdownCleanup?.();
    systems.multiplayerRoundSystem?.shutdown?.();

    try {
      systems.db.pruneOldHistory();
      await systems.db.close();
      await systems.guildStore.flush();
      logger.info('Lifecycle', 'Đã đồng bộ toàn bộ cơ sở dữ liệu xuống ổ cứng an toàn.');
    } catch (err) {
      logger.error('Lifecycle', 'Lỗi khi lưu dữ liệu lúc tắt bot', err);
    }

    try {
      client.destroy();
    } catch {
      // Bỏ qua lỗi đóng kết nối
    }

    if (healthServer) {
      healthServer.close();
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Hàng rào bảo vệ chống sập tiến trình (Anti-Crash Guards) kèm tự lưu khẩn cấp
  process.on('unhandledRejection', (reason) => {
    logger.error('ProcessGuard', 'Unhandled Promise Rejection (đã chặn crash)', reason);
  });

  process.on('uncaughtException', async (err) => {
    logger.error('ProcessGuard', 'Uncaught Exception (đã chặn crash & lưu khẩn cấp)', err);
    await systems.db.flush().catch(() => {});
  });

  try {
    await client.login(env.discordToken);
  } catch (err) {
    if (String(err?.message || '').includes('Used disallowed intents')) {
      logger.error(
        'Bootstrap',
        'LỖI QUYỀN INTENT: Hãy bật "Message Content Intent" trong Discord Developer Portal (Bot -> Privileged Gateway Intents) rồi khởi động lại!'
      );
    } else if (String(err?.code || '').includes('TokenInvalid')) {
      logger.error(
        'Bootstrap',
        'DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại cấu hình biến môi trường!'
      );
    } else {
      logger.error('Bootstrap', 'Không thể đăng nhập vào Discord', err);
    }
    await systems.db.close().catch(() => {});
    await systems.guildStore.flush().catch(() => {});
    process.exitCode = 1;
  }
}

bootstrap();
