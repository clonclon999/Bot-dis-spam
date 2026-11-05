import { ADMIN_COMMANDS, handleAdminInteraction } from './admin/index.js';
import { sweepPendingConfirmations } from './admin/confirmStore.js';
import { antispamCommand } from './antispam.js';
import { CORE_COMMANDS, handleCoreInteraction } from './core/index.js';
import { ECONOMY_COMMANDS } from './economy/index.js';
import { EVENT_COMMANDS } from './events/index.js';
import {
  GAME_COMMANDS,
  handleGameInteraction,
  sweepGameSessions,
} from './games/index.js';
import { handleNoituInteraction, noituCommand } from './games/noitu.js';
import { PET_COMMANDS } from './pets/index.js';
import { PROFILE_AND_CRIME_COMMANDS } from './profile/index.js';
import { handleQuestInteraction, QUEST_COMMANDS } from './quests/index.js';
import { handleShopInteraction, SHOP_COMMANDS } from './shop/index.js';

export const commands = [
  ...CORE_COMMANDS,
  ...ECONOMY_COMMANDS,
  ...GAME_COMMANDS,
  noituCommand,
  ...QUEST_COMMANDS,
  ...SHOP_COMMANDS,
  ...PET_COMMANDS,
  ...PROFILE_AND_CRIME_COMMANDS,
  ...EVENT_COMMANDS,
  ...ADMIN_COMMANDS,
  antispamCommand,
];

export const commandMap = new Map(commands.map((cmd) => [cmd.data.name, cmd]));
export const COMMAND_MAP = commandMap;

/**
 * Chuyển đổi toàn bộ danh sách Slash Commands sang JSON payload gửi lên Discord API v10.
 */
export function getSlashCommandsJSON() {
  return commands.map((cmd) => cmd.data.toJSON());
}

/**
 * Định tuyến toàn bộ tương tác Nút bấm (Button), Menu chọn (Select Menu) và Biểu mẫu (Modal).
 */
export async function routeComponentInteraction(interaction, context) {
  sweepGameSessions();
  sweepPendingConfirmations();

  if (await handleGameInteraction(interaction, context)) return true;
  if (await handleNoituInteraction(interaction, context)) return true;
  if (await handleQuestInteraction(interaction, context)) return true;
  if (await handleShopInteraction(interaction, context)) return true;
  if (await handleCoreInteraction(interaction, context)) return true;
  if (await handleAdminInteraction(interaction, context)) return true;
  return false;
}
