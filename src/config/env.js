import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Đọc và kiểm tra tính hợp lệ của các biến môi trường.
 * Không bao giờ in giá trị nhạy cảm (DISCORD_TOKEN) ra log.
 *
 * @param {object} [options]
 * @param {boolean} [options.requireToken=true] - Bắt buộc phải có DISCORD_TOKEN hợp lệ
 * @param {boolean} [options.requireClientId=false] - Bắt buộc phải có CLIENT_ID
 * @returns {object}
 */
export function loadEnv({ requireToken = true, requireClientId = false } = {}) {
  const discordToken = (process.env.DISCORD_TOKEN ?? '').trim();
  const clientId = (process.env.CLIENT_ID ?? '').trim();
  const devGuildId = (process.env.DEV_GUILD_ID ?? '').trim() || null;
  const autoDeployCommands =
    (process.env.AUTO_DEPLOY_COMMANDS ?? 'true').trim().toLowerCase() !== 'false';
  const dataDir = path.resolve(process.cwd(), (process.env.DATA_DIR ?? './data').trim());
  const logLevel = (process.env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  const rawPort = (process.env.PORT ?? '').trim();
  const port = rawPort ? Number.parseInt(rawPort, 10) : null;

  if (requireToken) {
    if (!discordToken || discordToken === 'your_discord_bot_token_here') {
      throw new Error(
        'Thiếu biến môi trường DISCORD_TOKEN hợp lệ. Vui lòng tạo tệp .env từ .env.example và điền token của bot.'
      );
    }
  }

  if (requireClientId) {
    if (!clientId || clientId === 'your_discord_application_client_id_here' || !/^\d{17,21}$/.test(clientId)) {
      throw new Error(
        'Thiếu hoặc sai định dạng biến môi trường CLIENT_ID (Snowflake ID gồm 17-21 chữ số).'
      );
    }
  }

  if (devGuildId && !/^\d{17,21}$/.test(devGuildId)) {
    throw new Error(
      'Biến môi trường DEV_GUILD_ID không hợp lệ (phải là Discord Guild ID gồm 17-21 chữ số hoặc để trống).'
    );
  }

  if (port !== null && (Number.isNaN(port) || port < 1 || port > 65535)) {
    throw new Error('Biến môi trường PORT phải là số nguyên từ 1 đến 65535.');
  }

  return Object.freeze({
    discordToken,
    clientId: clientId && /^\d{17,21}$/.test(clientId) ? clientId : null,
    devGuildId,
    autoDeployCommands,
    dataDir,
    logLevel,
    port,
  });
}
