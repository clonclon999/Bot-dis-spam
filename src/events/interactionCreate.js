import { MessageFlags } from 'discord.js';
import { COMMAND_MAP, routeComponentInteraction } from '../commands/index.js';
import { BOT_ROLES, LOG_CATEGORIES } from '../config/constants.js';
import { buildFeedbackEmbed, COLORS } from '../utils/embeds.js';
import { globalGuard } from '../utils/locks.js';
import { logger, redactSecrets } from '../utils/logger.js';
import { hasBotRole, isHardcodedOwner } from '../utils/permissions.js';

/**
 * Bộ định tuyến tổng cho mọi tương tác Discord (`Slash Command`, `Button`, `Select Menu`, `Modal`):
 * - Tích hợp kiểm tra chế độ Bảo trì (`maintenanceMode`) & Tài khoản bị khóa (`is_banned`).
 * - Khóa đồng bộ theo từng người dùng (`ConcurrencyGuard`) chống Race Condition / Spam click.
 * - Tự động lọc bí mật (`redactSecrets`) và đẩy cảnh báo về kênh Log khi có sự cố.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} context
 */
export async function handleInteractionCreate(interaction, context) {
  if (!interaction?.user || interaction.user.bot) return;

  const isChatCmd = interaction.isChatInputCommand?.() ?? false;
  const isComponentOrModal =
    (interaction.isButton?.() ?? false) ||
    (interaction.isStringSelectMenu?.() ?? false) ||
    (interaction.isModalSubmit?.() ?? false);

  if (!isChatCmd && !isComponentOrModal) return;

  const userId = interaction.user.id;
  const { db, logSystem } = context;

  // 1. Kiểm tra chế độ bảo trì toàn hệ thống (OWNER và ADMIN vẫn được thao tác)
  if (db?.getSetting('maintenanceMode') && !hasBotRole(db, userId, BOT_ROLES.ADMIN)) {
    await safeReply(interaction, {
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.WARNING,
          title: '🛠️ Hệ Thống Đang Bảo Trì Nâng Cấp',
          description:
            'Bot hiện đang tạm dừng bảo trì để bảo vệ an toàn dữ liệu người chơi. Vui lòng quay lại sau ít phút nhé!',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Kiểm tra trạng thái khóa tài khoản khỏi Bot (trừ OWNER)
  if (db && !isHardcodedOwner(userId)) {
    const row = db.get('SELECT is_banned, ban_reason FROM users WHERE user_id = ?', [
      userId,
    ]);
    if (row?.is_banned) {
      await safeReply(interaction, {
        embeds: [
          buildFeedbackEmbed({
            color: COLORS.DANGER,
            title: '⛔ Tài Khoản Đã Bị Khóa Khỏi Hệ Thống',
            description: `Lý do: **${row.ban_reason || 'Vi phạm quy định chống gian lận'}**.`,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  // 3. Giới hạn tốc độ thao tác chống spam liên thanh (Rate Limit 750ms)
  const rl = globalGuard.checkRateLimit(userId, 750);
  if (!rl.allowed) {
    await safeReply(interaction, {
      content: '⏳ Bạn thao tác hơi nhanh! Vui lòng đợi khoảng **1 giây** giữa các lần bấm nhé.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 4. Khóa Mutex độc quyền trên từng người chơi chống Race Condition tuyệt đối
  const locked = await globalGuard.runExclusive(userId, async () => {
    if (isChatCmd) {
      const command = COMMAND_MAP.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, context);
      return;
    }
    await routeComponentInteraction(interaction, context);
  });

  if (!locked.acquired) {
    logSystem?.send(
      LOG_CATEGORIES.ANTICHEAT,
      `Phát hiện xung đột thao tác đồng thời (Concurrent Click) từ <@${userId}> (\`${userId}\`). Hệ thống đã tự động chặn giao dịch trùng.`
    );
    await safeReply(interaction, {
      content: '🔒 Hệ thống đang xử lý thao tác trước đó của bạn, vui lòng chờ hoàn tất!',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Bọc thực thi an toàn không bao giờ làm crash tiến trình Bot.
 */
export async function safeHandleInteraction(interaction, context) {
  try {
    await handleInteractionCreate(interaction, context);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const cleanMsg = redactSecrets(rawMsg);

    // Phân biệt lỗi nghiệp vụ người dùng (thiếu tiền, cooldown...) với lỗi hệ thống bất ngờ
    const isSystemBug =
      err instanceof TypeError ||
      err instanceof ReferenceError ||
      err instanceof SyntaxError ||
      cleanMsg.includes('SQLITE');

    if (isSystemBug) {
      logger.error('InteractionError', 'Lỗi hệ thống khi xử lý tương tác', err);
      context?.logSystem?.send(
        LOG_CATEGORIES.ERROR,
        `Lỗi khi xử lý tương tác của <@${interaction?.user?.id}>: \`${cleanMsg}\``
      );
    }

    await safeReply(interaction, {
      embeds: [
        buildFeedbackEmbed({
          color: isSystemBug ? COLORS.DANGER : COLORS.WARNING,
          title: isSystemBug ? '⚠️ Đã Xảy Ra Sự Cố Hệ Thống' : '💡 Thông Báo Hệ Thống',
          description: isSystemBug
            ? 'Yêu cầu chưa thể thực hiện lúc này. Hệ thống đã ghi nhận để khắc phục.'
            : cleanMsg.slice(0, 1500),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // Bỏ qua nếu token tương tác của Discord đã quá hạn 3 giây
  }
}
