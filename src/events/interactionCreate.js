import { MessageFlags } from 'discord.js';
import { COMMAND_MAP } from '../commands/index.js';
import { buildFeedbackEmbed, COLORS } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

/**
 * Bộ định tuyến xử lý các Slash Command (`interactionCreate`) với hàng rào chống lỗi toàn diện.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} context
 */
export async function handleInteractionCreate(interaction, context) {
  if (!interaction?.isChatInputCommand?.()) return;

  const command = COMMAND_MAP.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, context);
  } catch (err) {
    logger.error(
      'InteractionCreate',
      `Lỗi khi thực thi lệnh /${interaction.commandName}`,
      err
    );

    const errorPayload = {
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.DANGER,
          title: '⚠️ Đã xảy ra lỗi xử lý lệnh',
          description:
            'Không thể hoàn tất yêu cầu lúc này. Vui lòng thử lại sau giây lát hoặc kiểm tra quyền của Bot.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorPayload);
      } else {
        await interaction.reply(errorPayload);
      }
    } catch {
      // Bỏ qua nếu interaction đã quá hạn 3 giây của Discord
    }
  }
}
