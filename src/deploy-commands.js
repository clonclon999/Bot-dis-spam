import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { antispamCommand } from './commands/antispam.js';
import { loadEnv } from './config/env.js';
import { logger } from './utils/logger.js';

/**
 * Đăng ký Slash Commands lên Discord thông qua REST API.
 * Có thể gọi độc lập qua `npm run deploy` hoặc nhập vào module khác.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.clientId
 * @param {string | null} [params.devGuildId]
 */
export async function deploySlashCommands({ token, clientId, devGuildId = null }) {
  const rest = new REST({ version: '10' }).setToken(token);
  const commandsPayload = [antispamCommand.data.toJSON()];

  if (devGuildId) {
    logger.info(
      'DeployCommands',
      `Đang đăng ký Slash Command cho máy chủ thử nghiệm (${devGuildId})...`
    );
    const res = await rest.put(
      Routes.applicationGuildCommands(clientId, devGuildId),
      { body: commandsPayload }
    );
    logger.info(
      'DeployCommands',
      `Thành công! Đã đăng ký ${Array.isArray(res) ? res.length : 1} lệnh cấp máy chủ.`
    );
    return res;
  }

  logger.info('DeployCommands', 'Đang đăng ký Slash Command Toàn cục (Global)...');
  const res = await rest.put(Routes.applicationCommands(clientId), {
    body: commandsPayload,
  });
  logger.info(
    'DeployCommands',
    `Thành công! Đã đăng ký ${Array.isArray(res) ? res.length : 1} lệnh Global.`
  );
  return res;
}

// Chạy trực tiếp khi gọi `node src/deploy-commands.js` (`npm run deploy`)
const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  try {
    const env = loadEnv({ requireToken: true, requireClientId: true });
    await deploySlashCommands({
      token: env.discordToken,
      clientId: env.clientId,
      devGuildId: env.devGuildId,
    });
  } catch (err) {
    logger.error('DeployCommands', 'Không thể đăng ký Slash Commands', err);
    process.exitCode = 1;
  }
}
