import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { QUICK_BET_AMOUNTS } from '../../config/constants.js';
import { buildGameResultNavRow } from '../../ui/navigation.js';
import { formatNumber, formatVnd } from '../../utils/format.js';

export const PANEL_TTL_MS = 10 * 60 * 1000;

/**
 * Bộ nhớ phiên bảng đặt cược tương tác có giới hạn kích thước, số thế hệ (`gen`) & TTL chống rò rỉ RAM.
 * Khóa: `${gameId}:${userId}`
 * @type {Map<string, object>}
 */
const bettingDrafts = new Map();

/**
 * Bộ nhớ cửa Bầu Cua ván gần nhất để hỗ trợ nút "Đặt lại cửa trước" mà không tự ý trừ tiền.
 * @type {Map<string, Record<string, number>>}
 */
const lastBauCuaStakes = new Map();

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

/**
 * Kiểm tra trạng thái phiên cược bao gồm cả cờ `expired` khi người chơi bấm nút trên bảng đã quá hạn.
 */
export function inspectBettingDraft(gameId, userId, expectedGen = null, now = Date.now()) {
  const key = makeKey(gameId, userId);
  const raw = bettingDrafts.get(key);
  if (!raw) {
    return { draft: null, expired: false, staleGen: false };
  }
  if (raw.expiresAt <= now) {
    bettingDrafts.delete(key);
    return { draft: null, expired: true, staleGen: false };
  }
  if (expectedGen !== null && expectedGen !== undefined && Number(expectedGen) !== raw.gen) {
    return { draft: raw, expired: false, staleGen: true };
  }
  return { draft: raw, expired: false, staleGen: false };
}

export function upsertBettingDraft(gameId, userId, initOrPatch = {}, now = Date.now()) {
  if (bettingDrafts.size > 600) {
    for (const [k, v] of bettingDrafts.entries()) {
      if (v.expiresAt <= now) bettingDrafts.delete(k);
    }
  }
  const key = makeKey(gameId, userId);
  const existing = getBettingDraft(gameId, userId, now);
  const bumpGen = Boolean(initOrPatch.resetSession);
  const base = existing || {
    gameId,
    userId: String(userId),
    betAmount: 1_000,
    choice: null,
    activeChip: 1_000,
    mascotBets: {},
    confirmed: false,
    gen: 1,
  };

  const next = {
    ...base,
    ...initOrPatch,
    gen: bumpGen ? (base.gen + 1) % 100_000 : base.gen,
    confirmed: initOrPatch.confirmed ?? false,
    expiresAt: now + PANEL_TTL_MS,
  };
  delete next.resetSession;
  bettingDrafts.set(key, next);
  return next;
}

export function clearBettingDraft(gameId, userId) {
  bettingDrafts.delete(makeKey(gameId, userId));
}

export function saveLastBauCuaStakes(userId, stakes) {
  if (lastBauCuaStakes.size > 500) {
    const oldest = lastBauCuaStakes.keys().next().value;
    lastBauCuaStakes.delete(oldest);
  }
  lastBauCuaStakes.set(String(userId), { ...stakes });
}

export function getLastBauCuaStakes(userId) {
  return lastBauCuaStakes.get(String(userId)) || null;
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
 * Dựng khối văn bản thông tin đặt cược chuẩn Components V2 (gọn, rõ, chuẩn Mobile & Desktop).
 */
export function formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }) {
  const validRange = betAmount >= minBet && betAmount <= maxBet;
  const enoughBalance = wallet >= betAmount;
  const afterBet = wallet - betAmount;
  const warnBadge = !validRange
    ? ' ⚠️ *(Ngoài giới hạn)*'
    : !enoughBalance
      ? ' ⚠️ *(Vượt số dư ví)*'
      : '';

  return [
    `🎯 **Cửa đang chọn:** ${choiceLabel || '*(Chưa chọn cửa)*'}`,
    `💰 **Ví hiện có:** \`${formatVnd(wallet)}\` • 📏 **Giới hạn:** \`${formatNumber(minBet)} – ${formatNumber(maxBet)} VNĐ\``,
    `💵 **Tiền đặt cược:** **${formatVnd(betAmount)}**${warnBadge} ➔ 🏦 **Sau cược:** \`${enoughBalance ? formatVnd(afterBet) : 'Không đủ số dư'}\``,
    `-# 🔒 An toàn 100%: Chỉ trừ VNĐ sau khi bạn nhấn Xác nhận.`,
  ].join('\n');
}

/**
 * Dựng 2 hàng nút đặt cược gọn gàng chuẩn Mobile & Desktop:
 * - Hàng 1: 100 ₫ • 500 ₫ • 1.000 ₫ • 5.000 ₫ • 10.000 ₫
 * - Hàng 2: Tất cả • Nhập tiền (Modal) • Xác nhận • Hủy • Quay lại
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
        .setLabel(`${formatNumber(amt)} ₫`)
        .setStyle(selectedBet === amt ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:chip:${userId}:all`)
      .setLabel('Tất cả')
      .setEmoji('🔥')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${prefix}:modal:${userId}`)
      .setLabel('Nhập tiền')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${prefix}:confirm:${userId}`)
      .setLabel(confirmLabel.slice(0, 28))
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(`${prefix}:cancel:${userId}`)
      .setLabel('Hủy')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${prefix}:back:${userId}`)
      .setLabel('Quay lại')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  return [chipRow, actionRow];
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
 * Dựng hàng nút sau khi kết thúc ván chơi: Chơi lại • Ví tiền • Nhiệm vụ • Game Center • Đóng.
 */
export function buildPostGameRow({ replayCustomId, userId, extraButton = null }) {
  return buildGameResultNavRow({ replayCustomId, userId, extraButton });
}
