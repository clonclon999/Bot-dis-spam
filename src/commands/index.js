import { antispamCommand } from './antispam.js';
import { helpCommand } from './help.js';

export const COMMANDS = Object.freeze([antispamCommand, helpCommand]);

export const COMMAND_MAP = new Map(
  COMMANDS.map((cmd) => [cmd.data.name, cmd])
);

/**
 * Xuất danh sách JSON của toàn bộ Slash Commands để đăng ký lên Discord API.
 * @returns {Array<object>}
 */
export function getSlashCommandsJSON() {
  return COMMANDS.map((cmd) => cmd.data.toJSON());
}
