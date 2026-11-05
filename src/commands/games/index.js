import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  BAUCUA_MASCOTS,
  GAME_IDS,
  QUICK_BET_AMOUNTS,
  RACE_ANIMALS,
  RPS_CHOICES,
} from '../../config/constants.js';
import { globalAnimationManager } from '../../ui/animationManager.js';
import {
  buildCv2NoticePayload,
  buildCv2Payload,
  createContainer,
  mediaGallery,
  sectionWithButton,
  sectionWithThumbnail,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import {
  safeClosePanel,
  safeDeferUpdate,
  safeReplyV2,
  safeUpdateV2,
  verifyPanelOwner,
} from '../../ui/interactionHelpers.js';
import { renderAttemptHearts, renderNeonBar, THEME } from '../../ui/theme.js';
import {
  ASSET_PATHS,
  buildAssetAttachment,
  buildBauCuaMascotGalleryAssets,
  buildBauCuaRollGalleryAssets,
  buildDiceGalleryAssets,
  buildRaceRosterGalleryAssets,
  buildRpsChoicesGalleryAssets,
  buildRpsDuelGalleryAssets,
} from '../../utils/assetRegistry.js';
import { formatNumber, formatVnd } from '../../utils/format.js';
import {
  buildCustomBetModal,
  buildPostGameRow,
  buildStandardBettingRows,
  clearBettingDraft,
  computeAllInAmount,
  formatBettingSummaryBlock,
  getBettingDraft,
  getLastBauCuaStakes,
  inspectBettingDraft,
  runWithConfirmLock,
  saveLastBauCuaStakes,
  upsertBettingDraft,
} from './bettingPanel.js';
import {
  buildGameCenterHomePayload,
  gamesCommand,
  handleGameCenterInteraction,
} from './gameCenter.js';
import {
  buildNoituLobbyPayload,
  handleNoituInteraction,
  noituCommand,
  registerNoituUiHooks,
} from './noitu.js';

export { registerNoituUiHooks };

// Bộ nhớ thách đấu Oẳn Tù Tì PvP có TTL chống rò rỉ bộ nhớ
const rpsChallenges = new Map();

function sweepRpsChallenges(now = Date.now()) {
  for (const [id, ch] of rpsChallenges.entries()) {
    if (now > ch.expiresAt) rpsChallenges.delete(id);
  }
}

export const sweepGameSessions = sweepRpsChallenges;

function getSys(ctx) {
  return ctx?.systems || ctx;
}

async function sendPanelReply(interaction, ctx, payload) {
  if (typeof ctx?.sendPanel === 'function') {
    await ctx.sendPanel(interaction, payload);
  } else {
    await safeReplyV2(interaction, payload);
  }
}

function getBetBounds(db) {
  return {
    minBet: Number(db.getSetting('minBet') ?? 100),
    maxBet: Number(db.getSetting('maxBet') ?? 5_000_000),
  };
}

function parseCleanAmount(raw) {
  const cleaned = String(raw || '').replace(/[.,_\s₫vndVNĐ]/gi, '');
  if (!/^\d+$/.test(cleaned)) return NaN;
  return Number.parseInt(cleaned, 10);
}

function makeEditAdapter(interaction) {
  return async (payload) => {
    const normalized = {
      ...payload,
      ...(payload.files && payload.files.length > 0 ? {} : { attachments: [] }),
    };
    if (interaction.deferred || interaction.replied) {
      if (typeof interaction.editReply === 'function') {
        return interaction.editReply(normalized);
      }
    }
    if (typeof interaction.update === 'function') {
      const res = await interaction.update(normalized);
      interaction.replied = true;
      return res;
    }
    if (typeof interaction.editReply === 'function') {
      return interaction.editReply(normalized);
    }
    return null;
  };
}

// ============================================================================
// 1. ƯU TIÊN SỐ 1: BẦU CUA PRO MAX (COMPONENTS V2 – LƯỚI 6 LINH VẬT & TỪNG CỬA)
// ============================================================================

function parseMascotCustomInput(rawInput, currentMascotBets) {
  const raw = String(rawInput || '').trim();
  const aliasMap = {
    bau: 'bau', 'bầu': 'bau',
    cua: 'cua',
    tom: 'tom', 'tôm': 'tom',
    ca: 'ca', 'cá': 'ca',
    ga: 'ga', 'gà': 'ga',
    nai: 'nai',
  };

  const singleNum = parseCleanAmount(raw);
  if (Number.isSafeInteger(singleNum) && singleNum > 0) {
    const nextBets = { ...currentMascotBets };
    const selectedKeys = Object.keys(nextBets).filter((k) => nextBets[k] > 0);
    if (selectedKeys.length > 0) {
      for (const k of selectedKeys) nextBets[k] = singleNum;
    }
    return { activeChip: singleNum, mascotBets: nextBets };
  }

  const nextBets = { ...currentMascotBets };
  let matched = 0;
  const segments = raw.split(/[,;\n]+/);
  for (const seg of segments) {
    const m = seg
      .trim()
      .toLowerCase()
      .match(/^([a-záàảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]+)\s*[:=\s]\s*([\d.,_]+)$/i);
    if (!m) continue;
    const mascotId = aliasMap[m[1]];
    const amt = parseCleanAmount(m[2]);
    if (mascotId && Number.isSafeInteger(amt)) {
      if (amt === 0) delete nextBets[mascotId];
      else nextBets[mascotId] = amt;
      matched += 1;
    }
  }
  if (matched === 0) {
    throw new Error('Định dạng chưa hợp lệ! Nhập số tiền (VD: `5000`) hoặc từng cửa (VD: `bau 5000, cua 10000`).');
  }
  return { mascotBets: nextBets };
}

export function buildBauCuaBoardPayload(user, systems, { ephemeral = false } = {}) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.BAUCUA, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.BAUCUA, user.id, {});
  const mascotBets = draft.mascotBets || {};
  const activeChip = draft.activeChip || Math.max(minBet, 1_000);

  const chosenLines = BAUCUA_MASCOTS
    .filter((m) => (mascotBets[m.id] || 0) > 0)
    .map((m) => `• ${m.emoji} **${m.name}:** \`${formatVnd(mascotBets[m.id])}\``);

  const totalBet = Object.values(mascotBets).reduce((sum, v) => sum + (v || 0), 0);
  const projectedBalance = wallet - totalBet;
  const canConfirm = totalBet >= minBet && totalBet <= maxBet && wallet >= totalBet;

  // Bảng 6 linh vật có hình ảnh sắc nét (lưới 3x2 native MediaGallery của Discord Components V2)
  const mascotGallery = buildBauCuaMascotGalleryAssets(mascotBets);

  const stakeLedgerSection = sectionWithButton({
    texts: [
      `📋 **Bảng Tổng Cược Đã Chọn:**\n` +
        (chosenLines.length > 0
          ? chosenLines.join('\n')
          : '*(Chưa chọn cửa — chạm vào các nút linh vật bên dưới để đặt phỉnh)*'),
      `💰 **Ví:** \`${formatVnd(wallet)}\` • 🪙 **Phỉnh đang cầm:** \`${formatVnd(activeChip)}\`\n` +
        `💵 **Tổng tiền cược:** **${formatVnd(totalBet)}** ➔ 🏦 **Sau cược:** \`${projectedBalance >= 0 ? formatVnd(projectedBalance) : 'Vượt số dư!'}\``,
    ],
    button: new ButtonBuilder()
      .setCustomId(`vgame:baucua:clear:${user.id}`)
      .setLabel('Xóa chọn')
      .setEmoji('🧹')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalBet === 0),
  });

  const boardContainer = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      textDisplay(
        `## 🦀 SÒNG BẦU CUA HOÀNG GIA — BẢNG 6 LINH VẬT\n` +
          `-# 👤 <@${user.id}> • Giới hạn \`${formatNumber(minBet)} – ${formatNumber(maxBet)} VNĐ\` • Trả thưởng: **1 nháy = 2x • 2 nháy = 3x • 3 nháy = 4x**`
      ),
      mediaGallery(mascotGallery.items),
      separator(),
      stakeLedgerSection,
    ],
  });

  const makeMascotBtn = (m) => {
    const amt = mascotBets[m.id] || 0;
    return new ButtonBuilder()
      .setCustomId(`vgame:baucua:pick:${user.id}:${m.id}`)
      .setEmoji(m.emoji)
      .setLabel(amt > 0 ? `${m.name} (${formatNumber(amt)} ₫)` : m.name)
      .setStyle(amt > 0 ? ButtonStyle.Success : ButtonStyle.Secondary);
  };

  const mascotRow1 = new ActionRowBuilder().addComponents(...BAUCUA_MASCOTS.slice(0, 3).map(makeMascotBtn));
  const mascotRow2 = new ActionRowBuilder().addComponents(...BAUCUA_MASCOTS.slice(3, 6).map(makeMascotBtn));

  const chipRow = new ActionRowBuilder().addComponents(
    ...QUICK_BET_AMOUNTS.map((amt) =>
      new ButtonBuilder()
        .setCustomId(`vgame:baucua:chip:${user.id}:${amt}`)
        .setLabel(`${formatNumber(amt)} ₫`)
        .setStyle(activeChip === amt ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:chip:${user.id}:all`)
      .setLabel('Tất cả')
      .setEmoji('🔥')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:modal:${user.id}`)
      .setLabel('Nhập từng cửa')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:confirm:${user.id}`)
      .setLabel('Xác nhận Lắc')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:cancel:${user.id}`)
      .setLabel('Hủy')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:back:${user.id}`)
      .setLabel('Quay lại')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  const controlsContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      textDisplay('### 🎯 KHU VỰC CHỌN CỬA • CHỌN PHỈNH & XÁC NHẬN'),
      mascotRow1,
      mascotRow2,
      separator(),
      chipRow,
      confirmRow,
    ],
  });

  return buildCv2Payload({
    containers: [boardContainer, controlsContainer],
    files: mascotGallery.files,
    ephemeral,
  });
}

async function runBauCuaConfirmedRound(editFn, user, betsMap, systems) {
  // AN TOÀN TUYỆT ĐỐI: Lưu kết quả RNG & quyết toán SQLite TRƯỚC khi hiển thị animation
  const res = systems.gameSystem.playBauCua({
    userId: user.id,
    username: user.username,
    bets: betsMap,
  });
  saveLastBauCuaStakes(user.id, res.cleanBets);
  clearBettingDraft(GAME_IDS.BAUCUA, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.BAUCUA, user.id);

  // Khu vực Animation Xúc Xắc Bầu Cua
  const shakeGif = buildAssetAttachment(ASSET_PATHS.BAUCUA_SHAKE_GIF, 'baucua_shake.gif');
  const stagePayload = buildCv2Payload({
    containers: [
      createContainer({
        accentColor: THEME.AMBER_PULSE,
        children: [
          textDisplay(
            `## 🥣 ĐANG XÓC ĐĨA 3 XÚC XẮC BẦU CUA...\n` +
              `👤 <@${user.id}> đã khóa tổng cược **${formatVnd(res.totalBet)}**\n` +
              `⏳ Tiến trình mở bát: \`${renderNeonBar(7, 10, 10)}\` *Đang lắc đều 3 viên xúc xắc linh vật...*`
          ),
          mediaGallery([{ url: shakeGif.url, description: 'Đang lắc 3 viên xúc xắc Bầu Cua' }]),
        ],
      }),
    ],
    files: [shakeGif.attachment],
  });

  // Bảng kết quả 3 hình linh vật + Bảng thanh toán chi tiết
  const rolledObjs = res.rolledMascots.map((m) =>
    typeof m === 'string' ? BAUCUA_MASCOTS.find((x) => x.id === m) : m
  );
  const rolledIds = rolledObjs.map((m) => m.id);
  const isTriple = rolledIds[0] === rolledIds[1] && rolledIds[1] === rolledIds[2];
  const rollGallery = buildBauCuaRollGalleryAssets(rolledObjs);
  const badge = buildAssetAttachment(
    isTriple
      ? ASSET_PATHS.BAUCUA_SPECIAL_TRIPLE
      : res.net >= 0
        ? ASSET_PATHS.BAUCUA_WIN
        : ASSET_PATHS.BAUCUA_LOSE,
    res.net >= 0 ? 'baucua_win.png' : 'baucua_lose.png'
  );

  const payoutRows = Object.entries(res.cleanBets).map(([mId, stake]) => {
    const mascot = BAUCUA_MASCOTS.find((x) => x.id === mId);
    const hits = rolledIds.filter((id) => id === mId).length;
    const winReturn = hits > 0 ? stake * (hits + 1) : 0;
    const multTag =
      hits > 0
        ? `Nhận **${hits + 1}x** (+${formatVnd(winReturn)})`
        : `0x (-${formatVnd(stake)})`;
    return `• ${mascot.emoji} **${mascot.name}** (\`${formatVnd(stake)}\`) — Ra **${hits} nháy** ➔ ${multTag}`;
  });

  const rebetBtn = new ButtonBuilder()
    .setCustomId(`vgame:baucua:rebet:${user.id}`)
    .setLabel('Đặt lại cửa cũ')
    .setEmoji('🔁')
    .setStyle(ButtonStyle.Primary);

  const resultContainer = createContainer({
    accentColor: res.net > 0 ? THEME.CYBER_EMERALD : res.net === 0 ? THEME.NEON_GOLD : THEME.CRIMSON_NEON,
    children: [
      sectionWithThumbnail({
        texts: [
          `## 🦀 KẾT QUẢ MỞ BÁT BẦU CUA`,
          `🎲 **3 Xúc Xắc:** ${rolledObjs.map((m) => `${m.emoji} **${m.name.toUpperCase()}**`).join('  │  ')}`,
        ],
        url: badge.url,
        description: res.net >= 0 ? 'Chiến thắng' : 'Chưa trúng',
      }),
      mediaGallery(rollGallery.items),
      separator(),
      textDisplay(
        `### 📊 Bảng Thanh Toán Chi Tiết\n` +
          `${payoutRows.join('\n')}\n\n` +
          `💵 **Tổng đặt:** \`${formatVnd(res.totalBet)}\` • 🏆 **Nhận về:** \`${formatVnd(res.payout)}\`\n` +
          `${res.net >= 0 ? '📈 **Lãi ròng:**' : '📉 **Biến động:**'} **${res.net >= 0 ? '+' : ''}${formatVnd(res.net)}** • 💰 **Ví mới:** **${formatVnd(res.balanceAfter)}**`
      ),
      separator(),
      buildPostGameRow({
        replayCustomId: `vgame:baucua:open:${user.id}`,
        userId: user.id,
        extraButton: rebetBtn,
      }),
    ],
  });

  const finalPayload = buildCv2Payload({
    containers: [resultContainer],
    files: [...rollGallery.files, badge.attachment],
  });

  await globalAnimationManager.runStagedAnimation({
    scopeKey: `baucua:${user.id}`,
    editFn,
    stages: [{ payload: stagePayload, delayMs: 850 }],
    finalPayload,
  });
}

// ============================================================================
// 2. ƯU TIÊN SỐ 1: TÀI XỈU PRO MAX (COMPONENTS V2 – KHU VỰC TÀI/XỈU & 3 XÚC XẮC)
// ============================================================================

function formatTaiXiuRoad(recentLogs) {
  if (!recentLogs || recentLogs.length === 0) return '*(Chưa có phiên nào)*';
  return recentLogs
    .slice(0, 10)
    .map((l) => {
      if (l.detail.includes('NHÀ CÁI') || l.detail.includes('BÃO')) return '🟡N';
      return l.detail.includes('TÀI') ? '🔴T' : '🔵X';
    })
    .join(' ');
}

function extractLastDiceFromLogs(recentLogs) {
  const first = recentLogs?.[0]?.detail || '';
  const m = first.match(/(\d)\s*[+,-]\s*(\d)\s*[+,-]\s*(\d)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [6, 5, 4];
}

export function buildTaiXiuBoardPayload(user, systems, { ephemeral = false } = {}) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.TAIXIU, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.TAIXIU, user.id, {});
  const choice = draft.choice || 'tai';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const dash = systems.gameSystem.getTaiXiuDashboard(user.id);
  const roadStr = formatTaiXiuRoad(dash.recentLogs);
  const previewDice = extractLastDiceFromLogs(dash.recentLogs);

  const banner = buildAssetAttachment(ASSET_PATHS.GAME_TAIXIU, 'taixiu_casino.png');
  const diceGallery = buildDiceGalleryAssets(previewDice, 'tx_prev');

  const choiceLabel =
    choice === 'tai' ? '🔴 **KHU VỰC TÀI (11 – 17 điểm)**' : '🔵 **KHU VỰC XỈU (4 – 10 điểm)**';
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const casinoContainer = createContainer({
    accentColor: choice === 'tai' ? THEME.CRIMSON_NEON : THEME.CYAN_BRIGHT,
    children: [
      mediaGallery([{ url: banner.url, description: 'Sòng Tài Xỉu Hoàng Gia VIP' }]),
      textDisplay(
        `## 🎲 SÒNG TÀI XỈU HOÀNG GIA — KHU VỰC ĐẶT CƯỢC\n` +
          `🔴 **TÀI: Tổng 11–17**   ━━━⚔️━━━   🔵 **XỈU: Tổng 4–10**\n` +
          `-# ⚠️ Tổng 3 hoặc 18 (Bộ ba đồng nhất): Nhà cái thắng • Thắng cửa nhận **2x**`
      ),
      mediaGallery(diceGallery.items),
      separator(),
      sectionWithButton({
        texts: [
          `🧭 **Lịch sử 10 phiên:** ${roadStr}\n📊 **Tỷ lệ thắng của bạn:** \`${dash.personal.wins}/${dash.personal.total}\` (**${dash.personal.winRate}%**)`,
          formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }),
        ],
        button: new ButtonBuilder()
          .setCustomId(`vgame:taixiu:private:${user.id}`)
          .setLabel('Cược Riêng Tư')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Secondary),
      }),
    ],
  });

  const zoneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:taixiu:pick:${user.id}:tai`)
      .setLabel('ĐẶT KHU VỰC TÀI (11–17)')
      .setEmoji('🔴')
      .setStyle(choice === 'tai' ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:taixiu:pick:${user.id}:xiu`)
      .setLabel('ĐẶT KHU VỰC XỈU (4–10)')
      .setEmoji('🔵')
      .setStyle(choice === 'xiu' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:taixiu',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Tung Xúc Xắc',
  });

  const betContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [zoneRow, separator(), ...bettingRows],
  });

  return buildCv2Payload({
    containers: [casinoContainer, betContainer],
    files: [banner.attachment, ...diceGallery.files],
    ephemeral,
  });
}

async function runTaiXiuConfirmedRound(editFn, user, choice, betAmount, systems) {
  // Chốt kết quả RNG & SQLite an toàn trước khi hiển thị hiệu ứng tung xúc xắc
  const res = systems.gameSystem.playTaiXiu({
    userId: user.id,
    username: user.username,
    choice,
    bet: betAmount,
  });
  clearBettingDraft(GAME_IDS.TAIXIU, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.TAIXIU, user.id);

  const rollGif = buildAssetAttachment(ASSET_PATHS.DICE_ROLL_GIF, 'dice_roll.gif');
  const stagePayload = buildCv2Payload({
    containers: [
      createContainer({
        accentColor: THEME.AMBER_PULSE,
        children: [
          textDisplay(
            `## 🎲 ĐANG TUNG 3 VIÊN XÚC XẮC NGỌC...\n` +
              `👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** vào **${choice === 'tai' ? '🔴 KHU VỰC TÀI (11–17)' : '🔵 KHU VỰC XỈU (4–10)'}**\n` +
              `⏳ Tiến trình lắc đĩa: \`${renderNeonBar(7, 10, 10)}\``
          ),
          mediaGallery([{ url: rollGif.url, description: 'Đang tung 3 viên xúc xắc Tài Xỉu' }]),
        ],
      }),
    ],
    files: [rollGif.attachment],
  });

  // Ba hình xúc xắc thực tế dừng lại + Bảng thanh toán & lịch sử cầu mới nhất
  const diceGallery = buildDiceGalleryAssets(res.dice, 'tx_rolled');
  const isHouseTriple = res.sum === 3 || res.sum === 18;
  const resultBadge = buildAssetAttachment(
    isHouseTriple
      ? ASSET_PATHS.TAIXIU_SPECIAL_TRIPLE
      : res.won
        ? ASSET_PATHS.TAIXIU_WIN
        : ASSET_PATHS.TAIXIU_LOSE,
    res.won ? 'taixiu_win.png' : 'taixiu_lose.png'
  );
  const dash = systems.gameSystem.getTaiXiuDashboard(user.id);

  const resultContainer = createContainer({
    accentColor: res.won ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
    children: [
      sectionWithThumbnail({
        texts: [
          `## 🎲 KẾT QUẢ TÀI XỈU — ${res.outcomeLabel}`,
          `🎯 **Điểm 3 viên:** ${res.diceFaces.join('  ')}  ➔  **\`${res.dice.join(' + ')} = ${res.sum} điểm\`**`,
        ],
        url: resultBadge.url,
        description: res.outcomeLabel,
      }),
      mediaGallery(diceGallery.items),
      separator(),
      textDisplay(
        `### 📊 Bảng Thanh Toán Phiên\n` +
          `• **Cửa đã đặt:** **${choice === 'tai' ? '🔴 TÀI (11–17)' : '🔵 XỈU (4–10)'}** — Tiền cược: \`${formatVnd(res.totalBet)}\`\n` +
          `• **Kết quả thanh toán:** ${
            res.won
              ? `🎉 **THẮNG 2X!** Nhận về **${formatVnd(res.payout)}** *(Lãi ròng +${formatVnd(res.net)})*`
              : `💸 **CHƯA TRÚNG!** Biến động **-${formatVnd(res.totalBet)}**`
          }\n` +
          `• **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**\n` +
          `• **Lịch sử cầu mới nhất:** ${formatTaiXiuRoad(dash.recentLogs)}`
      ),
      separator(),
      buildPostGameRow({
        replayCustomId: `vgame:taixiu:open:${user.id}`,
        userId: user.id,
      }),
    ],
  });

  const finalPayload = buildCv2Payload({
    containers: [resultContainer],
    files: [...diceGallery.files, resultBadge.attachment],
  });

  await globalAnimationManager.runStagedAnimation({
    scopeKey: `taixiu:${user.id}`,
    editFn,
    stages: [{ payload: stagePayload, delayMs: 850 }],
    finalPayload,
  });
}

// ============================================================================
// 3. TUNG ĐỒNG XU PRO MAX (COMPONENTS V2 – ĐỒNG XU LỚN, SẤP/NGỬA & ANIMATION)
// ============================================================================

export function buildCoinflipBoardPayload(user, systems, { ephemeral = false } = {}) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.COINFLIP, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.COINFLIP, user.id, {});
  const side = draft.choice || 'sap';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const sapCoin = buildAssetAttachment(ASSET_PATHS.COIN_SAP, 'coin_sap.png');
  const nguaCoin = buildAssetAttachment(ASSET_PATHS.COIN_NGUA, 'coin_ngua.png');
  const activeCoinUrl = side === 'sap' ? sapCoin.url : nguaCoin.url;

  const choiceLabel = side === 'sap' ? '🪙 **Mặt SẤP (Hoàng Kim Bảo)**' : '🌟 **Mặt NGỬA (Ngôi Sao Đại Cát)**';
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const topContainer = createContainer({
    accentColor: THEME.NEON_GOLD,
    children: [
      sectionWithThumbnail({
        texts: [
          `## 🪙 TUNG ĐỒNG XU HOÀNG KIM (THƯỞNG 2X)`,
          formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }),
        ],
        url: activeCoinUrl,
        description: side === 'sap' ? 'Đồng xu mặt Sấp' : 'Đồng xu mặt Ngửa',
      }),
      mediaGallery([
        { url: sapCoin.url, description: 'Mặt SẤP — Hoàng Kim Bảo' },
        { url: nguaCoin.url, description: 'Mặt NGỬA — Ngôi Sao Đại Cát' },
      ]),
    ],
  });

  const sideRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:coinflip:pick:${user.id}:sap`)
      .setLabel('Chọn Mặt SẤP')
      .setEmoji('🪙')
      .setStyle(side === 'sap' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:coinflip:pick:${user.id}:ngua`)
      .setLabel('Chọn Mặt NGỬA')
      .setEmoji('🌟')
      .setStyle(side === 'ngua' ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:coinflip',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Tung Đồng Xu',
  });

  const controlContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [sideRow, separator(), ...bettingRows],
  });

  return buildCv2Payload({
    containers: [topContainer, controlContainer],
    files: [sapCoin.attachment, nguaCoin.attachment],
    ephemeral,
  });
}

async function runCoinflipConfirmedRound(editFn, user, side, betAmount, systems) {
  const res = systems.gameSystem.playCoinflip({
    userId: user.id,
    username: user.username,
    side,
    bet: betAmount,
  });
  clearBettingDraft(GAME_IDS.COINFLIP, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.COINFLIP, user.id);

  const flipGif = buildAssetAttachment(ASSET_PATHS.COIN_FLIP_GIF, 'coin_flip.gif');
  const spinStage = buildCv2Payload({
    containers: [
      createContainer({
        accentColor: THEME.NEON_GOLD,
        children: [
          textDisplay(
            `## 🪙 ĐỒNG XU ĐANG XOAY TRÊN KHÔNG...\n` +
              `👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** vào cửa **${side === 'sap' ? 'Mặt SẤP' : 'Mặt NGỬA'}** • \`${renderNeonBar(7, 10, 10)}\``
          ),
          mediaGallery([{ url: flipGif.url, description: 'Đồng xu đang xoay' }]),
        ],
      }),
    ],
    files: [flipGif.attachment],
  });

  const coinFace = buildAssetAttachment(
    res.resultSide === 'sap' ? ASSET_PATHS.COIN_SAP : ASSET_PATHS.COIN_NGUA,
    res.resultSide === 'sap' ? 'res_coin_sap.png' : 'res_coin_ngua.png'
  );
  const badge = buildAssetAttachment(
    res.won ? ASSET_PATHS.COIN_WIN : ASSET_PATHS.COIN_LOSE,
    res.won ? 'coin_win.png' : 'coin_lose.png'
  );

  const resultContainer = createContainer({
    accentColor: res.won ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
    children: [
      sectionWithThumbnail({
        texts: [
          `## 🪙 KẾT QUẢ MỞ XU: ${res.resultSide === 'sap' ? 'MẶT SẤP' : 'MẶT NGỬA'}!`,
          `• **Cửa bạn chọn:** ${res.chosenSide === 'sap' ? '🪙 Mặt Sấp' : '🌟 Mặt Ngửa'}\n` +
            `• **Đồng xu dừng tại:** **${res.resultSide === 'sap' ? '🪙 Mặt Sấp' : '🌟 Mặt Ngửa'}**`,
        ],
        url: badge.url,
        description: res.won ? 'Thắng cược' : 'Chưa trúng',
      }),
      mediaGallery([{ url: coinFace.url, description: `Đồng xu dừng ở ${res.resultSide === 'sap' ? 'Mặt Sấp' : 'Mặt Ngửa'}` }]),
      separator(),
      textDisplay(
        `### 📊 Bảng Kết Quả & Thanh Toán\n` +
          (res.won
            ? `🎉 **TRÚNG THƯỞNG 2X:** Nhận **${formatVnd(res.payout)}** *(Lãi ròng +${formatVnd(res.net)})*`
            : `💸 **CHƯA MAY MẮN:** Mất tiền cược **-${formatVnd(res.totalBet)}**`) +
          `\n💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`
      ),
      separator(),
      buildPostGameRow({ replayCustomId: `vgame:coinflip:open:${user.id}`, userId: user.id }),
    ],
  });

  const finalPayload = buildCv2Payload({
    containers: [resultContainer],
    files: [coinFace.attachment, badge.attachment],
  });

  await globalAnimationManager.runStagedAnimation({
    scopeKey: `coinflip:${user.id}`,
    editFn,
    stages: [{ payload: spinStage, delayMs: 820 }],
    finalPayload,
  });
}

// ============================================================================
// 4. OẲN TÙ TÌ PRO MAX (COMPONENTS V2 – 3 LỰA CHỌN HÌNH ẢNH, ĐẾM NGƯỢC & ĐỐI ĐẦU)
// ============================================================================

export function buildRpsBoardPayload(user, systems, { ephemeral = false } = {}) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.RPS, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.RPS, user.id, {});
  const choice = draft.choice || 'rock';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const handGallery = buildRpsChoicesGalleryAssets();
  const move = RPS_CHOICES[choice];
  const choiceLabel = `${move.emoji} **${move.name}** *(Đấu với Bot • Gõ \`/rps doi_thu:@user\` để thách đấu PvP)*`;
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const arenaContainer = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      textDisplay(`## ✂️ ĐẤU TRƯỜNG OẲN TÙ TÌ — BÚA • BAO • KÉO`),
      mediaGallery(handGallery.items),
      separator(),
      textDisplay(formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel })),
    ],
  });

  const handRow = new ActionRowBuilder().addComponents(
    ...Object.values(RPS_CHOICES).map((m) =>
      new ButtonBuilder()
        .setCustomId(`vgame:rps:pick:${user.id}:${m.id}`)
        .setEmoji(m.emoji)
        .setLabel(`Ra ${m.name.toUpperCase()}`)
        .setStyle(choice === m.id ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:rps',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xác nhận Ra Tay',
  });

  const controlContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [handRow, separator(), ...bettingRows],
  });

  return buildCv2Payload({
    containers: [arenaContainer, controlContainer],
    files: handGallery.files,
    ephemeral,
  });
}

async function runRpsBotConfirmedRound(editFn, user, choice, betAmount, systems) {
  const res = systems.gameSystem.playRpsBot({
    userId: user.id,
    username: user.username,
    choice,
    bet: betAmount,
  });
  clearBettingDraft(GAME_IDS.RPS, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.RPS, user.id);

  const cdGif = buildAssetAttachment(ASSET_PATHS.RPS_COUNTDOWN_GIF, 'rps_countdown.gif');
  const cdStage = buildCv2Payload({
    containers: [
      createContainer({
        accentColor: THEME.AMBER_PULSE,
        children: [
          textDisplay(
            `## ⏳ ĐẾM NGƯỢC OẲN TÙ TÌ: 3... 2... 1... MỞ TAY!\n` +
              `👤 <@${user.id}> (Cược **${formatVnd(res.totalBet)}**) ⚔️ **BOT CAO THỦ**`
          ),
          mediaGallery([{ url: cdGif.url, description: 'Đếm ngược Oẳn Tù Tì' }]),
        ],
      }),
    ],
    files: [cdGif.attachment],
  });

  const duelGallery = buildRpsDuelGalleryAssets(res.userMove, res.botMove, user.username, 'Bot');
  const outcomeTitle =
    res.outcome === 'win'
      ? '🏆 BẠN ĐÃ CHIẾN THẮNG!'
      : res.outcome === 'tie'
        ? '🤝 HÒA NHAU — HOÀN TIỀN CƯỢC!'
        : '💥 BOT CHIẾN THẮNG!';

  const badge = buildAssetAttachment(
    res.outcome === 'lose' ? ASSET_PATHS.RPS_LOSE : ASSET_PATHS.RPS_WIN,
    res.outcome === 'lose' ? 'rps_lose.png' : 'rps_win.png'
  );

  const resultContainer = createContainer({
    accentColor: res.outcome === 'win' ? THEME.CYBER_EMERALD : res.outcome === 'tie' ? THEME.NEON_GOLD : THEME.CRIMSON_NEON,
    children: [
      sectionWithThumbnail({
        texts: [
          `## ✂️ ${outcomeTitle}`,
          `👤 **Bạn ra:** ${res.userMove.emoji} **${res.userMove.name}**  ⚔️  🤖 **Bot ra:** ${res.botMove.emoji} **${res.botMove.name}**`,
        ],
        url: badge.url,
        description: outcomeTitle,
      }),
      mediaGallery(duelGallery.items),
      separator(),
      textDisplay(
        `• **Biến động cược:** **${res.net >= 0 ? '+' : ''}${formatVnd(res.net)}**\n` +
          `• **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`
      ),
      separator(),
      buildPostGameRow({ replayCustomId: `vgame:rps:open:${user.id}`, userId: user.id }),
    ],
  });

  const finalPayload = buildCv2Payload({
    containers: [resultContainer],
    files: [...duelGallery.files, badge.attachment],
  });

  await globalAnimationManager.runStagedAnimation({
    scopeKey: `rps:${user.id}`,
    editFn,
    stages: [{ payload: cdStage, delayMs: 850 }],
    finalPayload,
  });
}

// ============================================================================
// 5. ĐOÁN SỐ PRO MAX (COMPONENTS V2 – LƯỢT CÒN LẠI, GỢI Ý, THANH TIẾN TRÌNH & KẾT QUẢ)
// ============================================================================

function computeNarrowedBounds(session) {
  let low = 1;
  let high = session.mode.max;
  for (const h of session.history) {
    if (h.hint === 'higher') low = Math.max(low, h.guess + 1);
    if (h.hint === 'lower') high = Math.min(high, h.guess - 1);
  }
  return { low, high, mid: Math.floor((low + high) / 2) };
}

export function buildGuessBoardPayload(user, systems, { ephemeral = false } = {}) {
  const activeSession = systems.gameSystem.getGuessSession(user.id);
  if (activeSession) {
    return buildActiveGuessTurnPayload(user, activeSession);
  }

  systems.gameSystem.touchActivePlayer(GAME_IDS.GUESS, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.GUESS, user.id, {});
  const difficulty = draft.choice || 'easy';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);
  const modeCfg = systems.gameSystem.getGuessModeConfig(difficulty);

  const banner = buildAssetAttachment(ASSET_PATHS.GAME_GUESS, 'guess_banner.png');
  const choiceLabel = `🔐 **${modeCfg.label}** *(Thưởng cơ bản **${modeCfg.mult}x** + thưởng lượt dư)*`;
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const setupContainer = createContainer({
    accentColor: THEME.CYAN_BRIGHT,
    children: [
      mediaGallery([{ url: banner.url, description: 'Giải Mã Két Số Bí Mật' }]),
      textDisplay(
        `## 🔢 GIẢI MÃ KÉT SỐ BÍ MẬT PRO MAX\n` +
          formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel })
      ),
    ],
  });

  const diffRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:guess:pick:${user.id}:easy`)
      .setLabel('Dễ (1–20 • 4 lượt)')
      .setEmoji('🟢')
      .setStyle(difficulty === 'easy' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:guess:pick:${user.id}:medium`)
      .setLabel('TB (1–50 • 5 lượt)')
      .setEmoji('🟡')
      .setStyle(difficulty === 'medium' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:guess:pick:${user.id}:hard`)
      .setLabel('Khó (1–100 • 6 lượt)')
      .setEmoji('🔴')
      .setStyle(difficulty === 'hard' ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:guess',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Khóa Số Bí Mật',
  });

  const controlContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [diffRow, separator(), ...bettingRows],
  });

  return buildCv2Payload({
    containers: [setupContainer, controlContainer],
    files: [banner.attachment],
    ephemeral,
  });
}

function buildActiveGuessTurnPayload(user, session, lastTurnInfo = null) {
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_GUESS, 'guess_active.png');
  const remaining = session.maxAttempts - session.attemptsUsed;
  const { low, high, mid } = computeNarrowedBounds(session);

  const historyLines = session.history.map((h) => {
    const hintText =
      h.hint === 'higher'
        ? `📈 Số bí mật **LỚN HƠN ${h.guess}**`
        : `📉 Số bí mật **NHỎ HƠN ${h.guess}**`;
    return `• Lượt ${h.attempt}: Đoán \`#${h.guess}\` ➔ ${hintText}`;
  });

  const hintBanner = lastTurnInfo
    ? lastTurnInfo.hint === 'higher'
      ? `### 📈 GỢI Ý TRỰC QUAN: SỐ BÍ MẬT **LỚN HƠN ${lastTurnInfo.pick}**!`
      : `### 📉 GỢI Ý TRỰC QUAN: SỐ BÍ MẬT **NHỎ HƠN ${lastTurnInfo.pick}**!`
    : `### 🔐 KÉT ĐÃ KHÓA 1 CON SỐ TỪ **1** ĐẾN **${session.mode.max}**`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:guess:input:${user.id}`)
      .setLabel(`Nhập Dự Đoán (${low} – ${high})`)
      .setEmoji('🔢')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vgame:guess:quick:${user.id}:${mid}`)
      .setLabel(`Đoán nhanh số giữa: #${mid}`)
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Primary)
  );

  const decoderContainer = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: banner.url, description: 'Bảng giải mã số bí mật' }]),
      textDisplay(
        `## 🔢 BẢNG GIẢI MÃ SỐ — ${session.mode.label.toUpperCase()}\n` +
          `👤 <@${user.id}> • Cược đã khóa: **${formatVnd(session.bet)}**\n` +
          `⏳ **Lượt còn lại:** ${renderAttemptHearts(remaining, session.attemptsUsed)} (\`${remaining}/${session.maxAttempts}\`)\n` +
          `📊 **Thanh tiến trình:** \`${renderNeonBar(remaining, session.maxAttempts, 10)}\` • **Khoảng thu hẹp:** \`[ ${low} ── ? ── ${high} ]\``
      ),
      separator(),
      textDisplay(
        `${hintBanner}\n` +
          (historyLines.length > 0 ? `${historyLines.join('\n')}` : '*(Hãy nhập con số dự đoán đầu tiên của bạn!)*')
      ),
      separator(),
      row,
    ],
  });

  return buildCv2Payload({
    containers: [decoderContainer],
    files: [banner.attachment],
  });
}

async function renderFinishedGuessRound(editFn, user, turnResult) {
  const vaultGif = buildAssetAttachment(ASSET_PATHS.GUESS_VAULT_GIF, 'vault_open.gif');
  const openStage = buildCv2Payload({
    containers: [
      createContainer({
        accentColor: THEME.AMBER_PULSE,
        children: [
          textDisplay(
            `## 🔓 ĐANG MỞ KÉT KIỂM TRA MÃ SỐ #${turnResult.pick}...\n` +
              `⏳ Xác thực khóa mật mã: \`${renderNeonBar(8, 10, 10)}\``
          ),
          mediaGallery([{ url: vaultGif.url, description: 'Đang mở két số bí mật' }]),
        ],
      }),
    ],
    files: [vaultGif.attachment],
  });

  const banner = buildAssetAttachment(
    turnResult.won ? ASSET_PATHS.GUESS_WIN : ASSET_PATHS.GUESS_LOSE,
    turnResult.won ? 'guess_win.png' : 'guess_lose.png'
  );
  const trail = turnResult.history
    .map((h) => `\`#${h.guess}\`${h.hint === 'correct' ? '✅' : h.hint === 'higher' ? '↑' : '↓'}`)
    .join(' ➔ ');

  const resultContainer = createContainer({
    accentColor: turnResult.won ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
    children: [
      mediaGallery([{ url: banner.url, description: turnResult.won ? 'Giải mã thành công' : 'Hết lượt giải mã' }]),
      textDisplay(
        `## ${turnResult.won ? `🎉 GIẢI MÃ THÀNH CÔNG CON SỐ #${turnResult.secret}!` : `💥 HẾT LƯỢT — SỐ BÍ MẬT LÀ #${turnResult.secret}`}\n` +
          `• **Chế độ:** ${turnResult.mode.label}\n` +
          `• **Hành trình đoán (${turnResult.attemptsUsed}/${turnResult.maxAttempts} lượt):** ${trail}\n` +
          `• **Thanh toán:** ${
            turnResult.won
              ? `🏆 Nhận về **${formatVnd(turnResult.payout)}** *(Lãi ròng +${formatVnd(turnResult.net)})*`
              : `💸 Mất tiền cược **-${formatVnd(turnResult.totalBet)}**`
          }\n` +
          `• **Số dư ví mới:** **${formatVnd(turnResult.balanceAfter)}**`
      ),
      separator(),
      buildPostGameRow({ replayCustomId: `vgame:guess:open:${user.id}`, userId: user.id }),
    ],
  });

  const finalPayload = buildCv2Payload({
    containers: [resultContainer],
    files: [banner.attachment],
  });

  await globalAnimationManager.runStagedAnimation({
    scopeKey: `guess:${user.id}`,
    editFn,
    stages: [{ payload: openStage, delayMs: 800 }],
    finalPayload,
  });
}

// ============================================================================
// 6. ĐUA THÚ PRO MAX (COMPONENTS V2 – 5 HÌNH THÚ, ĐƯỜNG ĐUA TIẾN TRÌNH & KẾT QUẢ)
// ============================================================================

export function buildRaceBoardPayload(user, systems, { ephemeral = false } = {}) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.RACE, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.RACE, user.id, {});
  const animalId = draft.choice || 'horse';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const chosen = RACE_ANIMALS.find((a) => a.id === animalId) || RACE_ANIMALS[0];
  const rosterGallery = buildRaceRosterGalleryAssets(chosen.id);
  const choiceLabel = `${chosen.emoji} **${chosen.name}** *(Về Nhất nhận thưởng **4.5x** tiền cược)*`;
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const trackPreview = RACE_ANIMALS.map(
    (a, idx) =>
      `\`Làn ${idx + 1}\` ${a.emoji} **${a.name}** ${a.id === chosen.id ? '⭐ *(Đang chọn)*' : ''} — \`${renderNeonBar(0, 10, 8)}\` 🏁`
  ).join('\n');

  const paddockContainer = createContainer({
    accentColor: THEME.CYBER_EMERALD,
    children: [
      textDisplay(`## 🐎 TRƯỜNG ĐUA THÚ TỐC ĐỘ GRAND PRIX (THƯỞNG 4.5X)`),
      mediaGallery(rosterGallery.items),
      separator(),
      textDisplay(`${trackPreview}\n\n${formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel })}`),
    ],
  });

  const animalRow = new ActionRowBuilder().addComponents(
    ...RACE_ANIMALS.map((a) =>
      new ButtonBuilder()
        .setCustomId(`vgame:race:pick:${user.id}:${a.id}`)
        .setEmoji(a.emoji)
        .setLabel(a.name)
        .setStyle(chosen.id === a.id ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:race',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xuất Phát Đua',
  });

  const controlContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [animalRow, separator(), ...bettingRows],
  });

  return buildCv2Payload({
    containers: [paddockContainer, controlContainer],
    files: rosterGallery.files,
    ephemeral,
  });
}

async function runRaceConfirmedRound(editFn, user, animalId, betAmount, systems) {
  // Chốt kết quả an toàn trước khi chạy diễn biến đường đua nhiều chặng
  const res = systems.gameSystem.playRace({
    userId: user.id,
    username: user.username,
    animalId,
    bet: betAmount,
  });
  clearBettingDraft(GAME_IDS.RACE, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.RACE, user.id);

  const makeStagePayload = (stageIdx, headline, color) => {
    const runGif = buildAssetAttachment(ASSET_PATHS.RACE_RUN_GIF, 'race_run.gif');
    return buildCv2Payload({
      containers: [
        createContainer({
          accentColor: color,
          children: [
            textDisplay(
              `## ${headline}\n` +
                `👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** cho **${res.chosen.emoji} ${res.chosen.name}** ⭐\n` +
                `📊 Tiến trình chặng: \`${renderNeonBar(stageIdx + 1, 3, 9)}\`\n\n` +
                res.frames[stageIdx]
            ),
            mediaGallery([{ url: runGif.url, description: 'Các chiến thú đang bứt tốc trên đường đua' }]),
          ],
        }),
      ],
      files: [runGif.attachment],
    });
  };

  const winnerCard = buildAssetAttachment(
    ASSET_PATHS.RACE_ANIMAL[res.winner.id],
    `winner_${res.winner.id}.png`
  );
  const banner = buildAssetAttachment(
    res.won ? ASSET_PATHS.RACE_WIN : ASSET_PATHS.RACE_LOSE,
    res.won ? 'race_win.png' : 'race_lose.png'
  );
  const medals = ['🥇 Hạng 1', '🥈 Hạng 2', '🥉 Hạng 3', '4️⃣ Hạng 4', '5️⃣ Hạng 5'];
  const podiumLines = res.standings.map(
    (a, idx) => `${medals[idx]}: **${a.emoji} ${a.name}**${a.id === res.chosen.id ? ' ⭐ *(Bạn chọn)*' : ''}`
  );

  const finalContainer = createContainer({
    accentColor: res.won ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
    children: [
      sectionWithThumbnail({
        texts: [
          `## 🏁 CHUNG CUỘC: ${res.winner.emoji} ${res.winner.name.toUpperCase()} VỀ NHẤT!`,
          res.frames[2],
        ],
        url: winnerCard.url,
        description: `Quán quân ${res.winner.name}`,
      }),
      mediaGallery([{ url: banner.url, description: res.won ? 'Chiến thắng Đua Thú' : 'Kết quả Đua Thú' }]),
      separator(),
      textDisplay(
        `### 🏆 Bảng Vị Trí Cán Đích & Thanh Toán\n` +
          `${podiumLines.join('\n')}\n\n` +
          (res.won
            ? `🎉 **THẮNG ĐẬM 4.5X:** Nhận **${formatVnd(res.payout)}** *(Lãi ròng +${formatVnd(res.net)})*`
            : `💸 **CHƯA TRÚNG:** Thú bạn chọn chưa về nhất (-${formatVnd(res.totalBet)})`) +
          `\n💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`
      ),
      separator(),
      buildPostGameRow({ replayCustomId: `vgame:race:open:${user.id}`, userId: user.id }),
    ],
  });

  const finalPayload = buildCv2Payload({
    containers: [finalContainer],
    files: [winnerCard.attachment, banner.attachment],
  });

  await globalAnimationManager.runStagedAnimation({
    scopeKey: `race:${user.id}`,
    editFn,
    stages: [
      { payload: makeStagePayload(0, '🔫 CHẶNG 1/3 — RỜI CỔNG XUẤT PHÁT!', THEME.AMBER_PULSE), delayMs: 850 },
      { payload: makeStagePayload(1, '🔥 CHẶNG 2/3 — BỨT TỐC KHÚC CUA QUYẾT ĐỊNH!', THEME.NEON_GOLD), delayMs: 850 },
    ],
    finalPayload,
  });
}

// ============================================================================
// HÀM MỞ NHANH BÀN CHƠI TỪ GAME CENTER (/games)
// ============================================================================

export function openVisualGameLauncher(gameId, user, guildId, channelId, systems, opts = {}) {
  switch (gameId) {
    case GAME_IDS.BAUCUA:
      return buildBauCuaBoardPayload(user, systems, opts);
    case GAME_IDS.TAIXIU:
      return buildTaiXiuBoardPayload(user, systems, opts);
    case GAME_IDS.NOITU:
      return buildNoituLobbyPayload(systems.wordChainSystem, channelId);
    case GAME_IDS.RPS:
      return buildRpsBoardPayload(user, systems, opts);
    case GAME_IDS.GUESS:
      return buildGuessBoardPayload(user, systems, opts);
    case GAME_IDS.COINFLIP:
      return buildCoinflipBoardPayload(user, systems, opts);
    case GAME_IDS.RACE:
      return buildRaceBoardPayload(user, systems, opts);
    default:
      return buildGameCenterHomePayload(user, guildId, systems, opts);
  }
}

// ============================================================================
// ĐỊNH NGHĨA SLASH COMMAND TRÒ CHƠI (/games, /baucua, /taixiu, /coinflip, /guess, /race, /rps, /noitu)
// ============================================================================

const baucuaCommand = {
  data: new SlashCommandBuilder()
    .setName('baucua')
    .setDescription('Mở bàn cược Components V2 Bầu Cua PRO MAX (lưới 6 linh vật, thưởng 2x/3x/4x)')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) =>
      o.setName('tien_cuoc_moi_cua').setDescription('Tùy chọn: Mức phỉnh khởi tạo ban đầu (VNĐ)').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.BAUCUA);
    const preset = interaction.options?.getInteger?.('tien_cuoc_moi_cua');
    if (preset) {
      upsertBettingDraft(GAME_IDS.BAUCUA, interaction.user.id, { activeChip: preset });
    }
    await sendPanelReply(interaction, ctx, buildBauCuaBoardPayload(interaction.user, systems));
  },
};

const taixiuCommand = {
  data: new SlashCommandBuilder()
    .setName('taixiu')
    .setDescription('Sòng Tài Xỉu Casino Components V2 (Xỉu 4–10, Tài 11–17, Tổng 3/18 Nhà cái thắng)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('cua')
        .setDescription('Tùy chọn: Lắc nhanh Tài hoặc Xỉu (bỏ trống để mở Bàn Casino tương tác)')
        .addChoices(
          { name: '🔴 TÀI (11 - 17)', value: 'tai' },
          { name: '🔵 XỈU (4 - 10)', value: 'xiu' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Tùy chọn: Số tiền cược VNĐ').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.TAIXIU);
    const choice = interaction.options?.getString?.('cua');
    const bet = interaction.options?.getInteger?.('tien_cuoc');

    if (!choice || !bet) {
      if (choice || bet) {
        upsertBettingDraft(GAME_IDS.TAIXIU, interaction.user.id, {
          ...(choice ? { choice } : {}),
          ...(bet ? { betAmount: bet } : {}),
        });
      }
      await sendPanelReply(interaction, ctx, buildTaiXiuBoardPayload(interaction.user, systems));
      return;
    }

    await interaction.deferReply();
    await runTaiXiuConfirmedRound(
      makeEditAdapter(interaction),
      interaction.user,
      choice,
      bet,
      systems
    );
  },
};

const coinflipCommand = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Tung đồng xu Hoàng Kim Sấp / Ngửa giao diện Components V2 & hiệu ứng xoay xu')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('chon')
        .setDescription('Tùy chọn: Mặt Sấp hoặc Ngửa (bỏ trống để mở bảng cược hình ảnh)')
        .addChoices(
          { name: '🪙 Mặt Sấp', value: 'sap' },
          { name: '🌟 Mặt Ngửa', value: 'ngua' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Tùy chọn: Số tiền cược VNĐ').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.COINFLIP);
    const side = interaction.options?.getString?.('chon');
    const bet = interaction.options?.getInteger?.('tien_cuoc');

    if (!side || !bet) {
      if (side || bet) {
        upsertBettingDraft(GAME_IDS.COINFLIP, interaction.user.id, {
          ...(side ? { choice: side } : {}),
          ...(bet ? { betAmount: bet } : {}),
        });
      }
      await sendPanelReply(interaction, ctx, buildCoinflipBoardPayload(interaction.user, systems));
      return;
    }

    await interaction.deferReply();
    await runCoinflipConfirmedRound(
      makeEditAdapter(interaction),
      interaction.user,
      side,
      bet,
      systems
    );
  },
};

const guessCommand = {
  data: new SlashCommandBuilder()
    .setName('guess')
    .setDescription('Giải mã con số bí mật của Bot (Components V2 – gợi ý Lớn Hơn/Nhỏ Hơn & thanh tiến trình)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('do_kho')
        .setDescription('Tùy chọn: Độ khó khởi tạo')
        .addChoices(
          { name: '🟢 Dễ (1 – 20 • 4 lượt)', value: 'easy' },
          { name: '🟡 Trung bình (1 – 50 • 5 lượt)', value: 'medium' },
          { name: '🔴 Khó (1 – 100 • 6 lượt)', value: 'hard' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Tùy chọn: Mức cược VNĐ').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.GUESS);
    const diff = interaction.options?.getString?.('do_kho');
    const bet = interaction.options?.getInteger?.('tien_cuoc');
    if (diff || bet) {
      upsertBettingDraft(GAME_IDS.GUESS, interaction.user.id, {
        ...(diff ? { choice: diff } : {}),
        ...(bet ? { betAmount: bet } : {}),
      });
    }
    await sendPanelReply(interaction, ctx, buildGuessBoardPayload(interaction.user, systems));
  },
};

const raceCommand = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription('Đặt cược Đua Thú Tốc Độ Components V2 với đường đua tiến trình từng chặng (thưởng 4.5x)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('thu_dua')
        .setDescription('Tùy chọn: Chọn chiến thú (bỏ trống để mở bảng chọn thú)')
        .addChoices(...RACE_ANIMALS.map((a) => ({ name: `${a.emoji} ${a.name}`, value: a.id })))
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Tùy chọn: Số tiền cược VNĐ').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.RACE);
    const animalId = interaction.options?.getString?.('thu_dua');
    const bet = interaction.options?.getInteger?.('tien_cuoc');

    if (!animalId || !bet) {
      if (animalId || bet) {
        upsertBettingDraft(GAME_IDS.RACE, interaction.user.id, {
          ...(animalId ? { choice: animalId } : {}),
          ...(bet ? { betAmount: bet } : {}),
        });
      }
      await sendPanelReply(interaction, ctx, buildRaceBoardPayload(interaction.user, systems));
      return;
    }

    await interaction.deferReply();
    await runRaceConfirmedRound(
      makeEditAdapter(interaction),
      interaction.user,
      animalId,
      bet,
      systems
    );
  },
};

const rpsCommand = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Oẳn Tù Tì Components V2 trực quan (Đấu với Bot hoặc Thách đấu Người chơi khác cược VNĐ)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('chon')
        .setDescription('Tùy chọn: Búa, Bao hoặc Kéo (bỏ trống để mở bảng cược hình ảnh)')
        .addChoices(
          { name: '✊ Búa', value: 'rock' },
          { name: '🖐️ Bao', value: 'paper' },
          { name: '✌️ Kéo', value: 'scissors' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Tùy chọn: Tiền cược VNĐ').setMinValue(100)
    )
    .addUserOption((o) =>
      o.setName('doi_thu').setDescription('Tùy chọn: Tag người chơi khác để thách đấu PvP 1v1')
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.RPS);
    const choice = interaction.options?.getString?.('chon');
    const bet = interaction.options?.getInteger?.('tien_cuoc');
    const opponent = interaction.options?.getUser?.('doi_thu');

    if (!opponent) {
      if (!choice || !bet) {
        if (choice || bet) {
          upsertBettingDraft(GAME_IDS.RPS, interaction.user.id, {
            ...(choice ? { choice } : {}),
            ...(bet ? { betAmount: bet } : {}),
          });
        }
        await sendPanelReply(interaction, ctx, buildRpsBoardPayload(interaction.user, systems));
        return;
      }

      await interaction.deferReply();
      await runRpsBotConfirmedRound(
        makeEditAdapter(interaction),
        interaction.user,
        choice,
        bet,
        systems
      );
      return;
    }

    // Chế độ thách đấu Oẳn Tù Tì PvP 1v1 có đặt cược VNĐ (Components V2)
    if (!choice || !bet) {
      throw new Error('Khi thách đấu **PvP** với người chơi khác, vui lòng chọn đủ `chon` (Búa/Bao/Kéo) và `tien_cuoc`!');
    }
    if (opponent.bot || opponent.id === interaction.user.id) {
      throw new Error('Đối thủ thách đấu PvP phải là một thành viên khác (không phải Bot hoặc chính bạn).');
    }

    const cleanBet = systems.gameSystem.validateBetAmount(bet);
    const p1 = systems.economySystem.ensureUser(interaction.user.id, interaction.user.username);
    systems.economySystem.assertCanTransact(p1);
    if (p1.wallet < cleanBet) {
      throw new Error(`Bạn cần có ít nhất **${formatVnd(cleanBet)}** trong ví để gửi lời thách đấu.`);
    }

    sweepRpsChallenges();
    const cid = `${interaction.user.id}-${Date.now()}`;
    rpsChallenges.set(cid, {
      p1Id: interaction.user.id,
      p1Name: interaction.user.username,
      p1Choice: choice,
      p2Id: opponent.id,
      bet: cleanBet,
      expiresAt: Date.now() + 90_000,
    });

    const handGallery = buildRpsChoicesGalleryAssets();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rps:accept:${cid}:rock`).setLabel('Ra Búa').setEmoji('✊').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:accept:${cid}:paper`).setLabel('Ra Bao').setEmoji('🖐️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:accept:${cid}:scissors`).setLabel('Ra Kéo').setEmoji('✌️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:decline:${cid}`).setLabel('Từ chối').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );

    const inviteCard = createContainer({
      accentColor: THEME.NEON_GOLD,
      children: [
        textDisplay(
          `## ⚔️ LỜI THÁCH ĐẤU OẲN TÙ TÌ PvP 1v1\n` +
            `📩 <@${opponent.id}> ơi! <@${interaction.user.id}> vừa gửi lời thách đấu **Oẳn Tù Tì**!\n` +
            `💰 **Mức cược mỗi bên:** **${formatVnd(cleanBet)}**\n` +
            `⏳ *Hiệu lực 90 giây — <@${opponent.id}> hãy bấm chọn 1 nước bên dưới để đếm ngược mở kết quả đồng thời!*`
        ),
        mediaGallery(handGallery.items),
        separator(),
        row,
      ],
    });

    await sendPanelReply(
      interaction,
      ctx,
      buildCv2Payload({
        containers: [inviteCard],
        files: handGallery.files,
        allowedMentions: { users: [opponent.id] },
      })
    );
  },
};

export const GAME_COMMANDS = [
  gamesCommand,
  baucuaCommand,
  taixiuCommand,
  rpsCommand,
  guessCommand,
  coinflipCommand,
  raceCommand,
];

export const gameCommands = [...GAME_COMMANDS, noituCommand];

// ============================================================================
// BỘ ĐỊNH TUYẾN TƯƠNG TÁC COMPONENTS V2 CHO TẤT CẢ 7 TRÒ CHƠI
// ============================================================================

export async function handleGameComponentInteraction(interaction, ctx) {
  const systems = getSys(ctx);

  // 1. Game Center PRO MAX (/games)
  if (await handleGameCenterInteraction(interaction, ctx, openVisualGameLauncher)) {
    return true;
  }

  // 2. Nối Từ Game Show 1v1
  if (await handleNoituInteraction(interaction, ctx)) {
    return true;
  }

  // 3. Xử lý Modal nhập mức cược tùy chỉnh & nhập số dự đoán
  if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('vgame_modal:')) {
    const [, gameId, action, ownerId] = interaction.customId.split(':');
    if (!(await verifyPanelOwner(interaction, ownerId, `/${gameId}`))) return true;

    if (gameId === GAME_IDS.GUESS && action === 'guess_turn') {
      const rawNum = interaction.fields.getTextInputValue('guess_number');
      const pick = parseCleanAmount(rawNum);
      try {
        const turnRes = systems.gameSystem.submitGuessTurn({
          userId: interaction.user.id,
          username: interaction.user.username,
          guessNumber: pick,
        });
        if (turnRes.finished) {
          await safeDeferUpdate(interaction);
          await renderFinishedGuessRound(makeEditAdapter(interaction), interaction.user, turnRes);
        } else {
          const sess = systems.gameSystem.getGuessSession(interaction.user.id);
          await safeUpdateV2(interaction, buildActiveGuessTurnPayload(interaction.user, sess, turnRes));
        }
      } catch (err) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🔢 Dự Đoán Chưa Hợp Lệ',
            body: err.message,
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
      }
      return true;
    }

    if (gameId === GAME_IDS.BAUCUA && action === 'custom_bet') {
      const rawText = interaction.fields.getTextInputValue('baucua_stakes');
      try {
        const draft = getBettingDraft(GAME_IDS.BAUCUA, interaction.user.id) || { mascotBets: {} };
        const patch = parseMascotCustomInput(rawText, draft.mascotBets || {});
        upsertBettingDraft(GAME_IDS.BAUCUA, interaction.user.id, patch);
        await safeUpdateV2(interaction, buildBauCuaBoardPayload(interaction.user, systems));
      } catch (err) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🦀 Nhập Tiền Cửa Bầu Cua Chưa Hợp Lệ',
            body: err.message,
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
      }
      return true;
    }

    const rawBet = interaction.fields.getTextInputValue('bet_amount');
    const parsed = parseCleanAmount(rawBet);
    const { minBet, maxBet } = getBetBounds(systems.db);
    if (!Number.isSafeInteger(parsed) || parsed < minBet || parsed > maxBet) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚠️ Mức Cược Ngoài Giới Hạn',
          body: `Vui lòng nhập số nguyên từ **${formatVnd(minBet)}** đến **${formatVnd(maxBet)}**!`,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    upsertBettingDraft(gameId, interaction.user.id, { betAmount: parsed });
    await safeUpdateV2(
      interaction,
      openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems)
    );
    return true;
  }

  // 4. Các nút tương tác bảng cược `vgame:<gameId>:<action>:<ownerId>...`
  if (interaction.customId?.startsWith('vgame:')) {
    const parts = interaction.customId.split(':');
    const gameId = parts[1];
    const action = parts[2];
    const ownerId = parts[3];
    const arg = parts[4];

    if (!(await verifyPanelOwner(interaction, ownerId, `/${gameId}`))) {
      return true;
    }

    const { minBet, maxBet } = getBetBounds(systems.db);
    const wallet = systems.economySystem.ensureUser(interaction.user.id, interaction.user.username).wallet;

    if (action === 'close') {
      clearBettingDraft(gameId, ownerId);
      systems.gameSystem.releaseActivePlayer(gameId, ownerId);
      await safeClosePanel(interaction, interaction.user.username);
      return true;
    }

    if (action === 'cancel') {
      globalAnimationManager.bumpSession(`${gameId}:${ownerId}`);
      clearBettingDraft(gameId, ownerId);
      systems.gameSystem.releaseActivePlayer(gameId, ownerId);
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '🛑 Đã Hủy Phiên Đặt Cược',
          body: 'Chưa có bất kỳ khoản tiền VNĐ nào bị trừ khỏi ví của bạn.',
          accentColor: THEME.SLATE_DARK,
          clearAttachments: true,
          actionRows: [
            buildPostGameRow({
              replayCustomId: `vgame:${gameId}:open:${ownerId}`,
              userId: ownerId,
            }),
          ],
        })
      );
      return true;
    }

    if (action === 'back') {
      globalAnimationManager.bumpSession(`${gameId}:${ownerId}`);
      clearBettingDraft(gameId, ownerId);
      systems.gameSystem.releaseActivePlayer(gameId, ownerId);
      await safeUpdateV2(
        interaction,
        buildGameCenterHomePayload(interaction.user, interaction.guildId, systems)
      );
      return true;
    }

    if (action === 'open') {
      upsertBettingDraft(gameId, ownerId, { resetSession: true });
      await safeUpdateV2(
        interaction,
        openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems)
      );
      return true;
    }

    if (action === 'private') {
      await safeReplyV2(
        interaction,
        openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems, {
          ephemeral: true,
        })
      );
      return true;
    }

    // Kiểm tra phiên đặt cược hết hạn (TTL 10 phút) khi bấm Xác nhận
    const draftCheck = inspectBettingDraft(gameId, ownerId);
    if (draftCheck.expired && action === 'confirm') {
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '⏰ Phiên Đặt Cược Đã Hết Hạn',
          body: 'Bảng đặt cược này đã quá 10 phút không thao tác nên được khóa bảo vệ số dư. Hãy bấm **Chơi lại** để mở bàn mới!',
          accentColor: THEME.AMBER_PULSE,
          clearAttachments: true,
          actionRows: [
            buildPostGameRow({
              replayCustomId: `vgame:${gameId}:open:${ownerId}`,
              userId: ownerId,
            }),
          ],
        })
      );
      return true;
    }

    // --- Xử lý riêng Bầu Cua đa cửa ---
    if (gameId === GAME_IDS.BAUCUA) {
      const draft = draftCheck.draft || upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, {});

      if (action === 'rebet') {
        const prevStakes = getLastBauCuaStakes(ownerId) || {};
        upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { mascotBets: { ...prevStakes }, resetSession: true });
        await safeUpdateV2(interaction, buildBauCuaBoardPayload(interaction.user, systems));
        return true;
      }

      if (action === 'chip') {
        if (arg === 'all') {
          const allIn = computeAllInAmount(wallet, minBet, maxBet);
          const keys = Object.keys(draft.mascotBets || {}).filter((k) => draft.mascotBets[k] > 0);
          if (keys.length === 1) {
            upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, {
              activeChip: allIn,
              mascotBets: { [keys[0]]: allIn },
            });
          } else {
            upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { activeChip: allIn });
          }
        } else {
          upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { activeChip: Number(arg) });
        }
        await safeUpdateV2(interaction, buildBauCuaBoardPayload(interaction.user, systems));
        return true;
      }

      if (action === 'pick') {
        const mascotBets = { ...(draft.mascotBets || {}) };
        const chip = draft.activeChip || Math.max(minBet, 1_000);
        const nextTotal = Object.values(mascotBets).reduce((s, v) => s + v, 0) + chip;
        if (nextTotal > maxBet) {
          await safeReplyV2(
            interaction,
            buildCv2NoticePayload({
              title: '⚠️ Đạt Trần Tổng Cược Bầu Cua',
              body: `Tổng cược không được vượt quá **${formatVnd(maxBet)}**! Bấm **🧹 Xóa chọn** để đặt lại nhé.`,
              accentColor: THEME.AMBER_PULSE,
              ephemeral: true,
            })
          );
          return true;
        }
        mascotBets[arg] = (mascotBets[arg] || 0) + chip;
        upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { mascotBets });
        await safeUpdateV2(interaction, buildBauCuaBoardPayload(interaction.user, systems));
        return true;
      }

      if (action === 'clear') {
        upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { mascotBets: {} });
        await safeUpdateV2(interaction, buildBauCuaBoardPayload(interaction.user, systems));
        return true;
      }

      if (action === 'modal') {
        const modal = new ModalBuilder()
          .setCustomId(`vgame_modal:baucua:custom_bet:${ownerId}`)
          .setTitle('Đặt Tiền Riêng Từng Cửa – Bầu Cua');
        const input = new TextInputBuilder()
          .setCustomId('baucua_stakes')
          .setLabel('Nhập: bau 5000, cua 10000 (hoặc 1 con số)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('VD: bau 5000, cua 10000, tom 2000')
          .setRequired(true)
          .setMaxLength(100);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'confirm') {
        const lockRes = await runWithConfirmLock(GAME_IDS.BAUCUA, ownerId, async () => {
          const freshDraft = getBettingDraft(GAME_IDS.BAUCUA, ownerId);
          const betsMap = freshDraft?.mascotBets || {};
          if (Object.keys(betsMap).length === 0) {
            throw new Error('Bạn chưa chọn linh vật nào để lắc!');
          }
          await safeDeferUpdate(interaction);
          await runBauCuaConfirmedRound(
            makeEditAdapter(interaction),
            interaction.user,
            betsMap,
            systems
          );
        });
        if (lockRes.locked) {
          await safeReplyV2(
            interaction,
            buildCv2NoticePayload({
              title: '⏳ Đang Lắc Xúc Xắc',
              body: 'Ván Bầu Cua của bạn đang được xử lý, vui lòng chờ giây lát!',
              accentColor: THEME.AMBER_PULSE,
              ephemeral: true,
            })
          );
        }
        return true;
      }
    }

    // --- Xử lý nút Nhập Số / Đoán Nhanh trong phiên Đoán Số nhiều lượt ---
    if (gameId === GAME_IDS.GUESS && action === 'input') {
      const sess = systems.gameSystem.getGuessSession(ownerId);
      if (!sess) {
        await safeUpdateV2(interaction, buildGuessBoardPayload(interaction.user, systems));
        return true;
      }
      const { low, high } = computeNarrowedBounds(sess);
      const modal = new ModalBuilder()
        .setCustomId(`vgame_modal:guess:guess_turn:${ownerId}`)
        .setTitle(`Đoán Số (${low} – ${high})`);
      const input = new TextInputBuilder()
        .setCustomId('guess_number')
        .setLabel(`Nhập dự đoán từ ${low} đến ${high}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Còn ${sess.maxAttempts - sess.attemptsUsed} lượt`)
        .setRequired(true)
        .setMaxLength(5);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (gameId === GAME_IDS.GUESS && action === 'quick') {
      const sess = systems.gameSystem.getGuessSession(ownerId);
      if (!sess) {
        await safeUpdateV2(interaction, buildGuessBoardPayload(interaction.user, systems));
        return true;
      }
      const pick = Number(arg);
      const turnRes = systems.gameSystem.submitGuessTurn({
        userId: ownerId,
        username: interaction.user.username,
        guessNumber: pick,
      });
      if (turnRes.finished) {
        await safeDeferUpdate(interaction);
        await renderFinishedGuessRound(makeEditAdapter(interaction), interaction.user, turnRes);
      } else {
        const updatedSess = systems.gameSystem.getGuessSession(ownerId);
        await safeUpdateV2(interaction, buildActiveGuessTurnPayload(interaction.user, updatedSess, turnRes));
      }
      return true;
    }

    // --- Xử lý chung cho Tài Xỉu, Đồng Xu, Oẳn Tù Tì, Đoán Số, Đua Thú ---
    if (action === 'pick') {
      upsertBettingDraft(gameId, ownerId, { choice: arg });
      await safeUpdateV2(
        interaction,
        openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems)
      );
      return true;
    }

    if (action === 'chip') {
      const nextBet = arg === 'all' ? computeAllInAmount(wallet, minBet, maxBet) : Number(arg);
      upsertBettingDraft(gameId, ownerId, { betAmount: nextBet });
      await safeUpdateV2(
        interaction,
        openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems)
      );
      return true;
    }

    if (action === 'modal') {
      const draft = getBettingDraft(gameId, ownerId) || { betAmount: minBet };
      const modal = buildCustomBetModal({
        customId: `vgame_modal:${gameId}:custom_bet:${ownerId}`,
        gameTitle: gameId.toUpperCase(),
        minBet,
        maxBet,
        currentBet: draft.betAmount,
      });
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'confirm') {
      const lockRes = await runWithConfirmLock(gameId, ownerId, async () => {
        const draft = getBettingDraft(gameId, ownerId) || upsertBettingDraft(gameId, ownerId, {});
        const betAmount = draft.betAmount || Math.max(minBet, 1_000);

        if (gameId === GAME_IDS.GUESS) {
          systems.gameSystem.startGuessSession({
            userId: ownerId,
            username: interaction.user.username,
            difficulty: draft.choice || 'easy',
            bet: betAmount,
          });
          clearBettingDraft(GAME_IDS.GUESS, ownerId);
          const sess = systems.gameSystem.getGuessSession(ownerId);
          await safeUpdateV2(interaction, buildActiveGuessTurnPayload(interaction.user, sess));
          return;
        }

        await safeDeferUpdate(interaction);
        const editFn = makeEditAdapter(interaction);
        if (gameId === GAME_IDS.TAIXIU) {
          await runTaiXiuConfirmedRound(editFn, interaction.user, draft.choice || 'tai', betAmount, systems);
        } else if (gameId === GAME_IDS.COINFLIP) {
          await runCoinflipConfirmedRound(editFn, interaction.user, draft.choice || 'sap', betAmount, systems);
        } else if (gameId === GAME_IDS.RPS) {
          await runRpsBotConfirmedRound(editFn, interaction.user, draft.choice || 'rock', betAmount, systems);
        } else if (gameId === GAME_IDS.RACE) {
          await runRaceConfirmedRound(editFn, interaction.user, draft.choice || 'horse', betAmount, systems);
        }
      });

      if (lockRes.locked) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⏳ Đang Xử Lý Lượt Chơi',
            body: 'Ván cược đang được khóa an toàn để tránh trừ tiền 2 lần, vui lòng chờ!',
            accentColor: THEME.AMBER_PULSE,
            ephemeral: true,
          })
        );
      }
      return true;
    }
  }

  // 5. Xử lý thách đấu Oẳn Tù Tì PvP 1v1 (Components V2 – Đếm ngược & Kết quả 2 người chơi)
  if (interaction.customId?.startsWith('rps:')) {
    sweepRpsChallenges();
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const cid = parts[2];
    const ch = rpsChallenges.get(cid);

    if (!ch) {
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '⏰ Lời Thách Đấu Đã Hết Hạn',
          body: 'Lời thách đấu Oẳn Tù Tì PvP này đã quá 90 giây hiệu lực.',
          accentColor: THEME.SLATE_DARK,
          clearAttachments: true,
        })
      );
      return true;
    }

    if (interaction.user.id !== ch.p2Id) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⛔ Không Đúng Đối Thủ Được Mời',
          body: `Chỉ <@${ch.p2Id}> mới có quyền nhận hoặc từ chối lời thách đấu này!`,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    rpsChallenges.delete(cid);
    if (action === 'decline') {
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '🏳️ Đã Từ Chối Thách Đấu Oẳn Tù Tì',
          body: `<@${ch.p2Id}> đã từ chối lời mời của <@${ch.p1Id}>. Chưa có khoản VNĐ nào bị trừ.`,
          accentColor: THEME.SLATE_DARK,
          clearAttachments: true,
        })
      );
      return true;
    }

    const p2Choice = parts[3];
    const res = systems.gameSystem.settleRpsPvp({
      p1Id: ch.p1Id,
      p1Name: ch.p1Name,
      p1Choice: ch.p1Choice,
      p2Id: interaction.user.id,
      p2Name: interaction.user.username,
      p2Choice,
      bet: ch.bet,
    });

    await safeDeferUpdate(interaction);
    const editFn = makeEditAdapter(interaction);

    const cdGif = buildAssetAttachment(ASSET_PATHS.RPS_COUNTDOWN_GIF, 'rps_pvp_cd.gif');
    const cdStage = buildCv2Payload({
      containers: [
        createContainer({
          accentColor: THEME.AMBER_PULSE,
          children: [
            textDisplay(
              `## ⏳ OẲN TÙ TÌ PvP: 3... 2... 1... MỞ TAY!\n` +
                `<@${ch.p1Id}> ⚔️ <@${ch.p2Id}> • Tiền cược mỗi người: **${formatVnd(res.bet)}**`
            ),
            mediaGallery([{ url: cdGif.url, description: 'Đếm ngược Oẳn Tù Tì PvP' }]),
          ],
        }),
      ],
      files: [cdGif.attachment],
    });

    const duelGallery = buildRpsDuelGalleryAssets(res.move1, res.move2, ch.p1Name, interaction.user.username);
    const badge = buildAssetAttachment(ASSET_PATHS.RPS_WIN, 'pvp_result.png');

    const finalPvp = buildCv2Payload({
      containers: [
        createContainer({
          accentColor: res.outcome === 'tie' ? THEME.NEON_GOLD : THEME.CYBER_EMERALD,
          children: [
            sectionWithThumbnail({
              texts: [
                `## ⚔️ KẾT QUẢ OẲN TÙ TÌ PvP 1v1`,
                `• <@${ch.p1Id}> ra: **${res.move1.emoji} ${res.move1.name}**\n` +
                  `• <@${ch.p2Id}> ra: **${res.move2.emoji} ${res.move2.name}**`,
              ],
              url: badge.url,
              description: 'Kết quả Oẳn Tù Tì PvP',
            }),
            mediaGallery(duelGallery.items),
            separator(),
            textDisplay(
              res.outcome === 'tie'
                ? '🤝 **HÒA NHAU!** Không người chơi nào bị trừ VNĐ.'
                : `🏆 **NGƯỜI CHIẾN THẮNG:** <@${res.winnerId}> nhận **+${formatVnd(res.bet)}** từ <@${res.loserId}>!`
            ),
          ],
        }),
      ],
      files: [...duelGallery.files, badge.attachment],
    });

    await globalAnimationManager.runStagedAnimation({
      scopeKey: `rps_pvp:${cid}`,
      editFn,
      stages: [{ payload: cdStage, delayMs: 850 }],
      finalPayload: finalPvp,
    });
    return true;
  }

  return false;
}

export const handleGameInteraction = handleGameComponentInteraction;
