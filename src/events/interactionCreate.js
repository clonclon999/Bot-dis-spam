import { COMMAND_MAP, routeComponentInteraction } from '../commands/index.js';
import {
  BOT_ROLES,
  GAME_IDS,
  GAME_LABELS,
  LOG_CATEGORIES,
} from '../config/constants.js';
import { buildCv2NoticePayload } from '../ui/componentsV2.js';
import {
  ensureAcked,
  installReplyFallback,
  safeReplyV2,
} from '../ui/interactionHelpers.js';
import { THEME } from '../ui/theme.js';
import { globalGuard } from '../utils/locks.js';
import { logger, redactSecrets } from '../utils/logger.js';
import { globalPanelCleaner } from '../utils/panelCleaner.js';
import { canManageAntiSpam, hasBotRole, isHardcodedOwner } from '../utils/permissions.js';

const ALL_GAME_COMMAND_IDS = new Set(Object.values(GAME_IDS));

// Các lệnh trò chơi nặng (dựng bảng Components V2 + đính kèm nhiều ảnh + giao dịch SQLite):
// phải ack NGAY để không bao giờ vượt hạn 3 giây của Discord.
const HEAVY_ACK_COMMAND_IDS = new Set([...ALL_GAME_COMMAND_IDS, 'game']);

// Hạn chót ack an toàn: Discord chỉ cho 3 giây, ta tự ack trước mốc đó ~0.8 giây.
const ACK_WATCHDOG_MS = 2_200;

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
    if (action === 'back' || action === 'cancel' || action === 'close') return null;
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
 * - Phản hồi bằng Discord Components V2 hiện đại, đồng bộ trên Android/iOS & Desktop.
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
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🛠️ Hệ Thống Đang Bảo Trì Nâng Cấp',
        body: 'Bot hiện đang tạm dừng bảo trì để bảo vệ an toàn dữ liệu người chơi. Vui lòng quay lại sau ít phút nhé!',
        accentColor: THEME.AMBER_PULSE,
        ephemeral: true,
      })
    );
    return;
  }

  // 2. Kiểm tra trạng thái khóa tài khoản khỏi Bot (trừ OWNER)
  if (db && !isHardcodedOwner(userId)) {
    const row = db.get('SELECT is_banned, ban_reason FROM users WHERE user_id = ?', [
      userId,
    ]);
    if (row?.is_banned) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⛔ Tài Khoản Đã Bị Khóa Khỏi Hệ Thống',
          body: `Lý do: **${row.ban_reason || 'Vi phạm quy định chống gian lận'}**.`,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return;
    }
  }

  // 3. Bắt buộc 100% các trò chơi (cả lệnh lẫn nút bấm) chỉ hoạt động đúng kênh riêng đã cài đặt
  const channelErr = checkGameChannelRestriction(interaction, db);
  if (channelErr) {
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '📍 Yêu Cầu Đúng Kênh Trò Chơi',
        body: channelErr,
        accentColor: THEME.AMBER_PULSE,
        ephemeral: true,
      })
    );
    return;
  }

  // 4. Giới hạn tốc độ thao tác chống spam liên thanh (Rate Limit 650ms)
  const rl = globalGuard.checkRateLimit(userId, 650);
  if (!rl.allowed) {
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '⏳ Thao Tác Quá Nhanh',
        body: 'Vui lòng đợi khoảng **1 giây** giữa các lần bấm nút nhé!',
        accentColor: THEME.AMBER_PULSE,
        ephemeral: true,
      })
    );
    return;
  }

  // 5. ⚡ ACK SỚM CHO CÁC LỆNH TRÒ CHƠI NẶNG (Bầu Cua, Tài Xỉu, Đua Thú, /game, Nối Từ, Đoán Số...):
  // Dựng bảng Components V2 + đính kèm ảnh + mở phiên SQLite có thể vượt 3 giây trên VPS yếu,
  // nên xác nhận tương tác ngay để Discord không hiện "Ứng dụng không phản hồi".
  // Mọi phản hồi phía sau đều đi qua `safeReplyV2`/`respondPrimary` nên vẫn hiển thị đúng.
  if (isChatCmd && HEAVY_ACK_COMMAND_IDS.has(interaction.commandName)) {
    await ensureAcked(interaction);
  }

  // 6. Khóa Mutex độc quyền trên từng người chơi + Tự động xóa bảng cũ sau khi hiện bảng mới
  const locked = await globalGuard.runExclusive(userId, async () => {
    if (isChatCmd) {
      const command = COMMAND_MAP.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, context);

      const isSharedMpSlash =
        (interaction.commandName === GAME_IDS.BAUCUA ||
          interaction.commandName === GAME_IDS.TAIXIU ||
          interaction.commandName === GAME_IDS.RACE) &&
        interaction.options?.getString?.('che_do') !== 'ca_nhan';

      const isLiveSharedBoard =
        interaction.commandName === 'game' ||
        isSharedMpSlash ||
        (interaction.commandName === GAME_IDS.NOITU &&
          ['create', 'join', 'start', 'stop', 'surrender'].includes(
            interaction.options?.getSubcommand?.(false)
          ));

      if (!isLiveSharedBoard) {
        await globalPanelCleaner.captureInteractionReply(
          interaction,
          interaction.commandName
        );
      }
      return;
    }
    if (interaction.message) {
      globalPanelCleaner.touchMessage(interaction.message);
    }
    await routeComponentInteraction(interaction, context);
  });

  if (!locked.acquired) {
    logSystem?.send(
      LOG_CATEGORIES.ANTICHEAT,
      `Phát hiện xung đột thao tác đồng thời (Concurrent Click) từ <@${userId}> (\`${userId}\`). Hệ thống đã tự động chặn giao dịch trùng.`
    );
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🔒 Đang Xử Lý Giao Dịch Trước Đó',
        body: 'Hệ thống đang hoàn tất thao tác liền trước của bạn, vui lòng chờ giây lát!',
        accentColor: THEME.AMBER_PULSE,
        ephemeral: true,
      })
    );
  }
}

/**
 * Bọc thực thi an toàn không bao giờ làm crash tiến trình Bot.
 */
export async function safeHandleInteraction(interaction, context) {
  // Lớp đệm an toàn: nếu tương tác đã được ack/defer trước đó thì `reply` tự chuyển thành `editReply`.
  installReplyFallback(interaction);

  // 🛡️ ĐỒNG HỒ ACK TỰ ĐỘNG: Discord chỉ cho 3 giây để phản hồi lần đầu.
  // Nếu vì bất kỳ lý do gì (SQLite bận, mạng chậm, dựng bảng nặng, restart...) mà chưa kịp trả lời,
  // Bot tự `deferReply()` trước mốc 2.2 giây => KHÔNG BAO GIỜ còn hiện "Ứng dụng không phản hồi".
  const startedAt = Date.now();
  let ackedByWatchdog = false;
  const ackTimer = setTimeout(() => {
    if (interaction?.deferred || interaction?.replied) return;
    ackedByWatchdog = true;
    ensureAcked(interaction).catch(() => {});
  }, ACK_WATCHDOG_MS);
  ackTimer.unref?.();

  try {
    await handleInteractionCreate(interaction, context);

    // 🧯 Lưới an toàn: handler không trả lời gì (nút cũ/hết hạn/không khớp customId)
    // => luôn gửi thông báo thay vì để Discord hiện "Ứng dụng không phản hồi".
    if (
      interaction &&
      !interaction.replied &&
      !interaction.deferred &&
      typeof interaction.isRepliable === 'function' &&
      interaction.isRepliable()
    ) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⌛ Tương Tác Đã Cũ Hoặc Không Còn Hiệu Lực',
          body: 'Bảng/nút này đã hết hạn hoặc đã được thay thế bởi phiên mới hơn.\n👉 Hãy gõ lại lệnh trò chơi (ví dụ `/baucua`) để mở bảng mới nhất nhé!',
          accentColor: THEME.AMBER_PULSE,
          ephemeral: true,
        })
      );
    }
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: isSystemBug ? '⚠️ Đã Xảy Ra Sự Cố Hệ Thống' : '💡 Thông Báo Hệ Thống',
        body: isSystemBug
          ? 'Yêu cầu chưa thể thực hiện lúc này. Hệ thống đã ghi nhận để khắc phục.'
          : cleanMsg.slice(0, 1500),
        accentColor: isSystemBug ? THEME.CRIMSON_NEON : THEME.AMBER_PULSE,
        ephemeral: true,
      })
    );
  } finally {
    clearTimeout(ackTimer);

    const elapsedMs = Date.now() - startedAt;
    if (ackedByWatchdog || elapsedMs >= 1_500) {
      logger.warn(
        'InteractionLatency',
        `Tương tác chậm ${elapsedMs}ms (${interaction?.commandName || interaction?.customId || 'unknown'})` +
          `${ackedByWatchdog ? ' — đã tự động ack bằng deferReply để tránh lỗi "Ứng dụng không phản hồi"' : ''}`
      );
    }
  }
}
