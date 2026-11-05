import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { QUICK_BET_AMOUNTS } from '../../config/constants.js';
import { formatNumber, formatVnd } from '../../utils/format.js';

const PANEL_TTL_MS = 10 * 60 * 1000;

/**
 * Bộ nhớ phiên bảng đặt cược tương tác có giới hạn kích thước & TTL chống rò rỉ RAM trên BotKeep FREE.
 * Khóa: `${gameId}:${userId}`
 * @type {Map<string, object>}
 */
const bettingDrafts = new Map();

/**
 * Khóa xác nhận 1 chiều chống nhấn đúp / Race Condition khi người chơi bấm "Xác nhận".
 * @type {Set<string>}
 */
const activeConfirmLocks = new Set();

function makeKey(gameId, userId) {
  return `${gameId}:${userId}`;
}

export function getBettingDraft(gameId, userId, now = Date.now()) {
  const key = makeKey(gameId, userId);
  const draft = bettingDrafts.get(key);
  if (!draft) return null;
  if (draft.expiresAt <= now) {
    bettingDrafts.delete(key);
    return null;
  }
  return draft;
}

export function upsertBettingDraft(gameId, userId, initOrPatch = {}, now = Date.now()) {
  if (bettingDrafts.size > 600) {
    for (const [k, v] of bettingDrafts.entries()) {
      if (v.expiresAt <= now) bettingDrafts.delete(k);
    }
  }
  const key = makeKey(gameId, userId);
  const prev = getBettingDraft(gameId, userId, now) || {
    gameId,
    userId: String(userId),
    betAmount: 1_000,
    choice: null,
    activeChip: 1_000,
    mascotBets: {},
    confirmed: false,
  };
  const next = {
    ...prev,
    ...initOrPatch,
    confirmed: initOrPatch.confirmed ?? false,
    expiresAt: now + PANEL_TTL_MS,
  };
  bettingDrafts.set(key, next);
  return next;
}

export function clearBettingDraft(gameId, userId) {
  bettingDrafts.delete(makeKey(gameId, userId));
}

/**
 * Khóa chống bấm đúp nút "Xác nhận" nhiều lần liên tiếp.
 */
export async function runWithConfirmLock(gameId, userId, taskFn) {
  const lockKey = makeKey(gameId, userId);
  if (activeConfirmLocks.has(lockKey)) {
    return { locked: true };
  }
  activeConfirmLocks.add(lockKey);
  try {
    const value = await taskFn();
    return { locked: false, value };
  } finally {
    activeConfirmLocks.delete(lockKey);
  }
}

/**
 * Tính mức cược "Tất cả" an toàn trong khoảng [minBet, maxBet] dựa trên ví hiện tại.
 */
export function computeAllInAmount(wallet, minBet, maxBet) {
  const capped = Math.min(Math.max(0, Math.trunc(wallet)), maxBet);
  return capped >= minBet ? capped : Math.min(minBet, maxBet);
}

/**
 * Dựng khối văn bản thông tin đặt cược chuẩn Mục 5 (hiển thị trên mọi bảng cược tương tác).
 */
export function formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }) {
  const validRange = betAmount >= minBet && betAmount <= maxBet;
  const enoughBalance = wallet >= betAmount;
  const afterBet = wallet - betAmount;

  return [
    `💰 **Số dư ví hiện tại:** \`${formatVnd(wallet)}\``,
    `📏 **Giới hạn cược:** Tối thiểu \`${formatVnd(minBet)}\` • Tối đa \`${formatVnd(maxBet)}\``,
    `🎯 **Lựa chọn cửa:** ${choiceLabel || '*(Chưa chọn — hãy bấm chọn cửa bên dưới)*'}`,
    `💵 **Số tiền muốn cược:** **${formatVnd(betAmount)}** ${!validRange ? '⚠️ *(Ngoài giới hạn)*' : !enoughBalance ? '⚠️ *(Vượt số dư)*' : ''}`,
    `🏦 **Số dư dự kiến sau cược:** \`${enoughBalance ? formatVnd(afterBet) : 'Không đủ số dư'}\``,
    `*Lưu ý: Hệ thống chỉ trừ VNĐ sau khi bạn bấm **Xác nhận** thành công.*`,
  ].join('\n');
}

/**
 * Dựng 3 hàng nút điều khiển đặt cược chuẩn Mục 5:
 * - Hàng Chip nhanh: 100 VNĐ | 500 VNĐ | 1.000 VNĐ | 5.000 VNĐ | 10.000 VNĐ
 * - Hàng Tất cả + Nhập tùy chỉnh (Modal)
 * - Hàng Hành động: Xác nhận | Hủy | Quay lại
 */
export function buildStandardBettingRows({
  prefix,
  userId,
  selectedBet,
  canConfirm = true,
  confirmLabel = 'Xác nhận',
}) {
  const chipRow = new ActionRowBuilder().addComponents(
    ...QUICK_BET_AMOUNTS.map((amt) =>
      new ButtonBuilder()
        .setCustomId(`${prefix}:chip:${userId}:${amt}`)
        .setLabel(`${formatNumber(amt)} VNĐ`)
        .setStyle(selectedBet === amt ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );

  const flexRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:chip:${userId}:all`)
      .setLabel('🔥 Tất cả')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${prefix}:modal:${userId}`)
      .setLabel('✏️ Nhập mức cược khác')
      .setStyle(ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:confirm:${userId}`)
      .setLabel(`✅ ${confirmLabel}`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(`${prefix}:cancel:${userId}`)
      .setLabel('❌ Hủy')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${prefix}:back:${userId}`)
      .setLabel('⬅️ Quay lại')
      .setStyle(ButtonStyle.Secondary)
  );

  return [chipRow, flexRow, actionRow];
}

/**
 * Tạo Discord Modal cho phép người chơi nhập số tiền cược tùy ý.
 */
export function buildCustomBetModal({ customId, gameTitle, minBet, maxBet, currentBet }) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(`Nhập Cược – ${gameTitle}`.slice(0, 45));

  const input = new TextInputBuilder()
    .setCustomId('bet_amount')
    .setLabel(`Số tiền cược VNĐ (${formatNumber(minBet)} - ${formatNumber(maxBet)})`.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`Ví dụ: ${Math.max(minBet, 2500)}`)
    .setValue(String(Math.max(minBet, currentBet || minBet)))
    .setRequired(true)
    .setMaxLength(12);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/**
 * Dựng hàng nút sau khi kết thúc ván chơi: Chơi lại + Quay về Game Center.
 */
export function buildPostGameRow({ replayCustomId, userId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(replayCustomId)
      .setLabel('🔄 Chơi lại')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`gc:home:${userId}`)
      .setLabel('🎮 Game Center')
      .setStyle(ButtonStyle.Secondary)
  );
}
