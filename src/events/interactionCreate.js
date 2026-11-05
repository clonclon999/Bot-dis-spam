import { MessageFlags } from 'discord.js';
import { COMMAND_MAP, routeComponentInteraction } from '../commands/index.js';
import {
  BOT_ROLES,
  GAME_IDS,
  GAME_LABELS,
  LOG_CATEGORIES,
} from '../config/constants.js';
import { buildFeedbackEmbed, COLORS } from '../utils/embeds.js';
import { globalGuard } from '../utils/locks.js';
import { logger, redactSecrets } from '../utils/logger.js';
import { globalPanelCleaner } from '../utils/panelCleaner.js';
import { canManageAntiSpam, hasBotRole, isHardcodedOwner } from '../utils/permissions.js';

const ALL_GAME_COMMAND_IDS = new Set(Object.values(GAME_IDS));

/**
 * Xác định mã trò chơi từ Slash Command hoặc Component `customId` (nếu có).
 */
function resolveInteractionGameId(interaction) {
  if (interaction.isChatInputCommand?.()) {
    const cmd = interaction.commandName;
    return ALL_GAME_COMMAND_IDS.has(cmd) ? cmd : null;
  }
  const customId = interaction.customId || '';
  const parts = customId.split(':');
  const prefix = parts[0];
  if (ALL_GAME_COMMAND_IDS.has(prefix)) return prefix;
  if ((prefix === 'vgame' || prefix === 'vgame_modal') && ALL_GAME_COMMAND_IDS.has(parts[1])) {
    const action = parts[2];
    if (action === 'back' || action === 'cancel') return null;
    return parts[1];
  }
  return null;
}

/**
 * Bắt buộc 100% các trò chơi (`baucua`, `taixiu`, `coinflip`, `guess`, `race`, `rps`, `noitu`)
 * đều phải cài đặt và chơi đúng kênh chat đã chỉ định trên Server để không gây loạn đoạn chat chung.
 * Trả về chuỗi thông báo lỗi nếu chưa cài kênh / sai kênh, hoặc `null` nếu hợp lệ.
 */
export function checkGameChannelRestriction(interaction, db) {
  if (!interaction?.guildId || !db) return null;

  const gameId = resolveInteractionGameId(interaction);
  if (!gameId) return null;

  const allowedChannels = db.getAllowedGameChannels(interaction.guildId, gameId);
  const label = GAME_LABELS[gameId] ?? gameId;

  if (allowedChannels.length === 0) {
    const isAdmin =
      hasBotRole(db, interaction.user.id, BOT_ROLES.ADMIN) ||
      canManageAntiSpam(interaction.member, false);
    return isAdmin
      ? `📍 Trò chơi **${label}** chưa được cài đặt kênh riêng trên Server này!\n👉 Hãy dùng lệnh \`/admin game setchannel\` để gán kênh chơi cố định tránh làm loạn kênh chat chung.`
      : `📍 Trò chơi **${label}** hiện chưa được Quản trị viên chỉ định kênh chơi riêng trên Server này. Vui lòng nhờ Admin dùng \`/admin game setchannel\` cài kênh trước nhé!`;
  }

  const parentId = interaction.channel?.parentId ?? null;
  const ok = db.isAllowedGameChannel(
    interaction.guildId,
    gameId,
    interaction.channelId,
    parentId
  );

  if (!ok) {
    const mentions = allowedChannels.map((id) => `<#${id}>`).join(', ');
    return `⛔ **Sai kênh trò chơi!** Trò **${label}** chỉ được phép chơi tại kênh ${mentions} để giữ trật tự đoạn chat.\n👉 Hãy chuyển sang ${mentions} để tham gia nhé!`;
  }

  return null;
}

/**
 * Bộ định tuyến tổng cho mọi tương tác Discord (`Slash Command`, `Button`, `Select Menu`, `Modal`):
 * - Kiểm tra chế độ Bảo trì (`maintenanceMode`) & Tài khoản bị khóa (`is_banned`).
 * - Bắt buộc mọi trò chơi đều phải chơi đúng kênh đã cài đặt (`checkGameChannelRestriction`).
 * - Tự động xóa bảng cũ khi mở bảng mới (`globalPanelCleaner`) giữ kênh chat gọn gàng.
 * - Khóa đồng bộ theo từng người dùng (`ConcurrencyGuard`) chống Race Condition / Spam click.
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

  // 3. Bắt buộc 100% các trò chơi (cả lệnh lẫn nút bấm) chỉ hoạt động đúng kênh riêng đã cài đặt
  const channelErr = checkGameChannelRestriction(interaction, db);
  if (channelErr) {
    await safeReply(interaction, {
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.WARNING,
          title: '📍 Yêu Cầu Đúng Kênh Trò Chơi',
          description: channelErr,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 4. Giới hạn tốc độ thao tác chống spam liên thanh (Rate Limit 650ms)
  const rl = globalGuard.checkRateLimit(userId, 650);
  if (!rl.allowed) {
    await safeReply(interaction, {
      content: '⏳ Bạn thao tác hơi nhanh! Vui lòng đợi khoảng **1 giây** giữa các lần bấm nhé.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 5. Khóa Mutex độc quyền trên từng người chơi + Tự động xóa bảng cũ sau khi hiện bảng mới
  const locked = await globalGuard.runExclusive(userId, async () => {
    if (isChatCmd) {
      const command = COMMAND_MAP.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, context);

      // Các bảng phòng đấu 2 người của Nối Từ tự quản lý vòng đời chỉnh sửa tại chỗ riêng
      const isLiveNoituRoomBoard =
        interaction.commandName === GAME_IDS.NOITU &&
        ['create', 'join', 'start', 'surrender'].includes(
          interaction.options?.getSubcommand?.(false)
        );

      if (!isLiveNoituRoomBoard) {
        await globalPanelCleaner.captureInteractionReply(
          interaction,
          interaction.commandName
        );
      }
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
