import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { COLORS } from '../../utils/embeds.js';
import { createNonce } from '../../utils/rng.js';

/**
 * Bộ quản lý xác nhận 2 bước (Two-Step Confirmation) cho mọi thao tác nhạy cảm của ADMIN / OWNER.
 * Ngăn bấm nhầm xóa dữ liệu, khóa nhầm người chơi hoặc phát thưởng sai.
 */
const pendingConfirmations = new Map();

export function sweepPendingConfirmations(now = Date.now()) {
  for (const [token, item] of pendingConfirmations.entries()) {
    if (now > item.expiresAt) {
      pendingConfirmations.delete(token);
    }
  }
}

/**
 * Tạo yêu cầu xác nhận kèm 2 nút `✅ Xác nhận thực thi` và `❌ Hủy bỏ`.
 *
 * @param {object} params
 * @param {string} params.actorId
 * @param {string} params.title
 * @param {string} params.summary
 * @param {() => Promise<string> | string} params.onConfirm - Trả về thông báo kết quả sau khi thực thi
 * @returns {{ token: string, payload: object }}
 */
export function createConfirmationPrompt({ actorId, title, summary, onConfirm }) {
  sweepPendingConfirmations();
  const token = createNonce();
  pendingConfirmations.set(token, {
    actorId: String(actorId),
    title,
    onConfirm,
    expiresAt: Date.now() + 60_000,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(`⚠️ Xác Nhận Thao Tác Quan Trọng: ${title}`)
    .setDescription(
      `${summary}\n\n⏳ *Yêu cầu xác nhận có hiệu lực trong **60 giây**.*`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`adm_cfm:yes:${actorId}:${token}`)
      .setLabel('Xác nhận thực thi')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`adm_cfm:no:${actorId}:${token}`)
      .setLabel('Hủy bỏ')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    token,
    payload: {
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    },
  };
}

/**
 * Thực thi xác nhận bằng mã `token` (phục vụ cả nút bấm Discord lẫn kiểm thử tự động).
 */
export async function executeConfirmationToken(token, callerId) {
  const entry = pendingConfirmations.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingConfirmations.delete(token);
    throw new Error('Yêu cầu xác nhận đã hết hạn (60s) hoặc đã được xử lý.');
  }
  if (String(callerId) !== entry.actorId) {
    throw new Error('Bạn không phải người khởi tạo yêu cầu xác nhận này.');
  }
  pendingConfirmations.delete(token);
  return await entry.onConfirm();
}

export async function handleConfirmationButton(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('adm_cfm:')) return false;

  const [, decision, actorId, token] = id.split(':');
  if (interaction.user.id !== actorId) {
    await interaction.reply({
      content: '⛔ Bạn không có quyền xác nhận thao tác quản trị của người khác!',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (decision === 'no') {
    pendingConfirmations.delete(token);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.MUTED)
          .setTitle('❎ Đã Hủy Thao Tác Quản Trị')
          .setDescription('Không có thay đổi nào được thực hiện.'),
      ],
      components: [],
    });
    return true;
  }

  const outcomeMsg = await executeConfirmationToken(token, interaction.user.id);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('✅ Thực Thi Quản Trị Hoàn Tất')
        .setDescription(outcomeMsg)
        .setTimestamp(),
    ],
    components: [],
  });
  return true;
}
