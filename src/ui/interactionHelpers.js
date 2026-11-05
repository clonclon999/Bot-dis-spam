import { MessageFlags } from 'discord.js';
import { buildCv2NoticePayload } from './componentsV2.js';
import { THEME } from './theme.js';

/**
 * Bộ xử lý phản hồi Discord Interaction an toàn tuyệt đối (Mục 4 & Mục 7):
 * - Bắt gọn các lỗi Discord API: Interaction hết hạn 3s (10062), Interaction đã phản hồi (40060),
 *   Tin nhắn gốc đã bị xóa/hết hạn (10008).
 * - Tự động xóa đính kèm cũ khi cập nhật sang màn hình không có file.
 */
function isIgnorableDiscordError(err) {
  const code = Number(err?.code ?? err?.rawError?.code ?? 0);
  return code === 10062 || code === 40060 || code === 10008;
}

export async function safeReplyV2(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied && typeof interaction.editReply === 'function') {
      return await interaction.editReply(payload);
    }
    if (interaction.replied && typeof interaction.followUp === 'function') {
      return await interaction.followUp(payload);
    }
    if (typeof interaction.reply === 'function') {
      return await interaction.reply(payload);
    }
  } catch (err) {
    if (!isIgnorableDiscordError(err)) throw err;
  }
  return null;
}

/**
 * ⚡ CHỐNG LỖI "ỨNG DỤNG KHÔNG PHẢN HỒI" (Discord ack timeout 3 giây):
 * Gắn lớp đệm cho `interaction.reply` để nếu Interaction đã được `deferReply()` hoặc đã trả lời trước đó
 * thì tự động chuyển thành `editReply()` thay vì ném lỗi 40060 (Interaction đã được phản hồi).
 * Nhờ vậy bất kỳ đoạn code cũ nào gọi `interaction.reply()` vẫn chạy đúng dù đã ack sớm.
 */
export function installReplyFallback(interaction) {
  if (!interaction || interaction.__replyFallbackInstalled) return interaction;
  const originalReply = interaction.reply;
  if (typeof originalReply !== 'function') return interaction;

  interaction.reply = async function patchedReply(payload, options) {
    const acked = Boolean(interaction.deferred || interaction.replied);
    if (acked && typeof interaction.editReply === 'function') {
      return interaction.editReply(payload, options);
    }
    try {
      return await originalReply.call(this, payload, options);
    } catch (err) {
      const code = Number(err?.code ?? err?.rawError?.code ?? 0);
      if ((code === 40060 || code === 10062) && typeof interaction.editReply === 'function') {
        return interaction.editReply(payload, options).catch(() => null);
      }
      throw err;
    }
  };

  interaction.__replyFallbackInstalled = true;
  return interaction;
}

/**
 * Xác nhận (ack) tương tác ngay lập tức bằng `deferReply` nếu chưa trả lời.
 * Trả về `true` nếu tương tác đã/đang ở trạng thái đã ack.
 */
export async function ensureAcked(interaction, { ephemeral = false } = {}) {
  if (!interaction) return false;
  if (interaction.deferred || interaction.replied) return true;
  if (typeof interaction.deferReply !== 'function') return false;
  try {
    await interaction.deferReply(
      ephemeral ? { flags: MessageFlags.Ephemeral } : undefined
    );
    return true;
  } catch (err) {
    if (isIgnorableDiscordError(err)) return true;
    return false;
  }
}

/**
 * Gửi phản hồi đầu tiên một cách an toàn tuyệt đối: tự chọn `editReply` (nếu đã defer)
 * hay `reply` (nếu chưa) và trả về đối tượng tin nhắn đã gửi (nếu Discord trả về).
 */
export async function respondPrimary(interaction, payload, { withResponse = true } = {}) {
  const wantsResponse = withResponse ? { withResponse: true } : {};
  try {
    if ((interaction.deferred || interaction.replied) && typeof interaction.editReply === 'function') {
      const res = await interaction.editReply({ ...payload, ...wantsResponse });
      return res?.resource?.message ?? res?.message ?? res ?? null;
    }
    if (typeof interaction.reply === 'function') {
      const res = await interaction.reply({ ...payload, ...wantsResponse });
      return res?.resource?.message ?? res?.message ?? res ?? null;
    }
  } catch (err) {
    if (!isIgnorableDiscordError(err)) throw err;
  }
  return null;
}

export async function safeUpdateV2(interaction, payload) {
  const normalized = {
    ...payload,
    ...(payload.files && payload.files.length > 0
      ? {}
      : payload.attachments !== undefined
        ? {}
        : { attachments: [] }),
  };

  try {
    if (interaction.deferred || interaction.replied) {
      if (typeof interaction.editReply === 'function') {
        return await interaction.editReply(normalized);
      }
    } else if (typeof interaction.update === 'function') {
      return await interaction.update(normalized);
    } else if (typeof interaction.reply === 'function') {
      return await interaction.reply(normalized);
    }
  } catch (err) {
    if (!isIgnorableDiscordError(err)) throw err;
  }
  return null;
}

export async function safeDeferUpdate(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied && typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate();
      return true;
    }
    return true;
  } catch (err) {
    if (isIgnorableDiscordError(err)) return false;
    throw err;
  }
}

/**
 * Đóng gọn giao diện hiện tại: ưu tiên xóa tin nhắn công khai hoặc rút gọn thành thông báo đóng nếu là Ephemeral.
 */
export async function safeClosePanel(interaction, ownerName = '') {
  try {
    if (typeof interaction.message?.delete === 'function') {
      const deleted = await interaction.message.delete().then(() => true).catch(() => false);
      if (deleted) return;
    }
  } catch {
    // Chuyển sang thu gọn Components V2 nếu tin nhắn là Ephemeral không xóa trực tiếp được
  }

  await safeUpdateV2(
    interaction,
    buildCv2NoticePayload({
      title: '✖️ Đã Đóng Giao Diện Game Center',
      body: `${ownerName ? `Phiên của **${ownerName}** đã đóng gọn.` : 'Đã đóng bảng điều khiển.'} Gõ \`/games\` bất cứ lúc nào để mở lại nhé!`,
      accentColor: THEME.SLATE_DARK,
      clearAttachments: true,
    })
  );
}

/**
 * Kiểm tra quyền sở hữu phiên giao diện: chặn người lạ bấm nút trên bàn của người chơi khác.
 */
export async function verifyPanelOwner(interaction, expectedOwnerId, commandHint = '/games') {
  if (!expectedOwnerId || String(interaction.user?.id) === String(expectedOwnerId)) {
    return true;
  }

  await safeReplyV2(
    interaction,
    buildCv2NoticePayload({
      title: '🔒 Phiên Giao Diện Của Người Chơi Khác',
      body: `Bảng tương tác này thuộc quyền điều khiển của <@${expectedOwnerId}>.\n👉 Hãy gõ \`${commandHint}\` để mở phiên riêng của bạn nhé!`,
      accentColor: THEME.CRIMSON_NEON,
      ephemeral: true,
    })
  );
  return false;
}
