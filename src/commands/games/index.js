import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
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
import {
  ASSET_PATHS,
  buildAssetAttachment,
  buildBauCuaResultAttachment,
  buildThreeDiceResultAttachment,
} from '../../utils/assetRegistry.js';
import { COLORS, errorEmbed } from '../../utils/embeds.js';
import { formatNumber, formatVnd } from '../../utils/format.js';
import {
  buildCustomBetModal,
  buildPostGameRow,
  buildStandardBettingRows,
  clearBettingDraft,
  computeAllInAmount,
  formatBettingSummaryBlock,
  getBettingDraft,
  runWithConfirmLock,
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await interaction.reply(payload);
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

// ============================================================================
// 1. ƯU TIÊN SỐ 1: BẦU CUA – GIAO DIỆN LƯỚI 6 LINH VẬT & ĐẶT RIÊNG TỪNG CỬA
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

  // Trường hợp người dùng chỉ gõ 1 con số (VD: "5000") -> đổi mệnh giá chip & cập nhật các cửa đã chọn
  const singleNum = parseCleanAmount(raw);
  if (Number.isSafeInteger(singleNum) && singleNum > 0) {
    const nextBets = { ...currentMascotBets };
    const selectedKeys = Object.keys(nextBets).filter((k) => nextBets[k] > 0);
    if (selectedKeys.length > 0) {
      for (const k of selectedKeys) nextBets[k] = singleNum;
    }
    return { activeChip: singleNum, mascotBets: nextBets };
  }

  // Trường hợp gõ từng cửa riêng biệt: "bau 5000, cua 10000, tom=2000"
  const nextBets = { ...currentMascotBets };
  let matched = 0;
  const segments = raw.split(/[,;\n]+/);
  for (const seg of segments) {
    const m = seg.trim().toLowerCase().match(/^([a-záàảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]+)\s*[:=\s]\s*([\d.,_]+)$/i);
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
    throw new Error('Định dạng chưa hợp lệ! Nhập số tiền (VD: `5000`) hoặc đặt riêng từng cửa (VD: `bau 5000, cua 10000`).');
  }
  return { mascotBets: nextBets };
}

export function buildBauCuaBoardPayload(user, systems) {
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

  const gridArt = buildAssetAttachment(ASSET_PATHS.BAUCUA_GRID, 'baucua_grid.png');

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🦀 BẦU CUA TÔM CÁ PRO – BÀN CƯỢC HÌNH ẢNH 6 LINH VẬT')
    .setDescription(
      [
        `👤 **Người chơi:** <@${user.id}>`,
        `💰 **Số dư ví hiện tại:** \`${formatVnd(wallet)}\``,
        `📏 **Giới hạn mỗi cửa / tổng cược:** \`${formatVnd(minBet)}\` → \`${formatVnd(maxBet)}\``,
        `🪙 **Mệnh giá phỉnh đang cầm:** **${formatVnd(activeChip)}** *(Bấm linh vật để cộng phỉnh này vào cửa đó)*`,
        '',
        '📋 **Danh sách linh vật đã chọn:**',
        chosenLines.length > 0 ? chosenLines.join('\n') : '*(Chưa chọn linh vật — hãy bấm vào các ô linh vật bên dưới)*',
        '',
        `💵 **Tổng tiền cược:** **${formatVnd(totalBet)}**`,
        `🏦 **Số dư dự kiến sau cược:** \`${projectedBalance >= 0 ? formatVnd(projectedBalance) : 'Vượt số dư hiện có!'}\``,
        '*Thanh toán: Trúng 1 nháy nhận **2x** • 2 nháy nhận **3x** • 3 nháy nhận **4x** • Trượt mất tiền cược.*',
      ].join('\n')
    )
    .setImage(gridArt.url)
    .setFooter({ text: 'Chỉ trừ VNĐ sau khi bạn bấm "✅ Xác nhận" • Có thể đặt tiền riêng từng linh vật' })
    .setTimestamp();

  const makeMascotBtn = (m) => {
    const amt = mascotBets[m.id] || 0;
    return new ButtonBuilder()
      .setCustomId(`vgame:baucua:pick:${user.id}:${m.id}`)
      .setLabel(amt > 0 ? `${m.emoji} ${m.name} (${formatNumber(amt)} ₫)` : `${m.emoji} ${m.name}`)
      .setStyle(amt > 0 ? ButtonStyle.Success : ButtonStyle.Secondary);
  };

  const row1 = new ActionRowBuilder().addComponents(...BAUCUA_MASCOTS.slice(0, 3).map(makeMascotBtn));
  const row2 = new ActionRowBuilder().addComponents(...BAUCUA_MASCOTS.slice(3, 6).map(makeMascotBtn));

  const row3 = new ActionRowBuilder().addComponents(
    ...QUICK_BET_AMOUNTS.map((amt) =>
      new ButtonBuilder()
        .setCustomId(`vgame:baucua:chip:${user.id}:${amt}`)
        .setLabel(`${formatNumber(amt)} VNĐ`)
        .setStyle(activeChip === amt ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:chip:${user.id}:all`)
      .setLabel('🔥 Tất cả')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:modal:${user.id}`)
      .setLabel('✏️ Đặt riêng từng cửa')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:clear:${user.id}`)
      .setLabel('🧹 Xóa chọn')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalBet === 0)
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:confirm:${user.id}`)
      .setLabel('✅ Xác nhận')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:cancel:${user.id}`)
      .setLabel('❌ Hủy')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`vgame:baucua:back:${user.id}`)
      .setLabel('⬅️ Quay lại')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    files: [gridArt.attachment],
    components: [row1, row2, row3, row4, row5],
  };
}

async function runBauCuaConfirmedRound(editFn, user, betsMap, systems) {
  // BƯỚC AN TOÀN: Lưu kết quả RNG & quyết toán SQLite TRƯỚC khi chạy animation
  const res = systems.gameSystem.playBauCua({
    userId: user.id,
    username: user.username,
    bets: betsMap,
  });
  clearBettingDraft(GAME_IDS.BAUCUA, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.BAUCUA, user.id);

  // Giai đoạn 1–3: Chuẩn bị & Lắc 3 viên xúc xắc linh vật bằng GIF động cục bộ
  const shakeGif = buildAssetAttachment(ASSET_PATHS.BAUCUA_SHAKE_GIF, 'baucua_shake.gif');
  const rollingEmbed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('🎲 ĐANG LẮC 3 VIÊN XÚC XẮC BẦU CUA...')
    .setDescription(
      `👤 <@${user.id}> đã khóa cược **${formatVnd(res.totalBet)}**!\n` +
      `🥣 *Đang chuẩn bị bát và lắc đều 3 viên xúc xắc linh vật...*`
    )
    .setImage(shakeGif.url);

  await editFn({ embeds: [rollingEmbed], files: [shakeGif.attachment], components: [] });
  await sleep(950);

  // Giai đoạn 4–7: Hiển thị 3 xúc xắc thực tế, bảng thanh toán chi tiết (2x / 3x / 4x) & nút Chơi lại
  const rolledObjs = res.rolledMascots.map((m) =>
    typeof m === 'string' ? BAUCUA_MASCOTS.find((x) => x.id === m) : m
  );
  const rolledIds = rolledObjs.map((m) => m.id);
  const diceImg = buildBauCuaResultAttachment(rolledIds, res.net > 0);
  const badgeBanner = buildAssetAttachment(
    res.net >= 0 ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER,
    res.net >= 0 ? 'victory.png' : 'defeat.png'
  );

  const payoutTable = Object.entries(res.cleanBets).map(([mId, stake]) => {
    const mascot = BAUCUA_MASCOTS.find((x) => x.id === mId);
    const hits = rolledIds.filter((id) => id === mId).length;
    const winReturn = hits > 0 ? stake * (hits + 1) : 0;
    const multTag =
      hits > 0
        ? `Nhận ${hits + 1}x (+${formatVnd(winReturn)})`
        : `0x (Mất ${formatVnd(stake)})`;
    return `• ${mascot.emoji} **${mascot.name}** (Đặt \`${formatVnd(stake)}\`) — Ra **${hits} lần** ➔ **${multTag}**`;
  });

  const resultEmbed = new EmbedBuilder()
    .setColor(res.net > 0 ? COLORS.SUCCESS : res.net === 0 ? COLORS.WARNING : COLORS.DANGER)
    .setTitle('🦀 KẾT QUẢ MỞ BÁT BẦU CUA TÔM CÁ')
    .setDescription(
      [
        `🎲 **3 Xúc Xắc Mở Ra:**  ${rolledObjs.map((m) => `${m.emoji} **${m.name.toUpperCase()}**`).join('  │  ')}`,
        '',
        '📊 **Bảng Thanh Toán Chi Tiết:**',
        ...payoutTable,
        '',
        `💵 **Tổng đặt cược:** \`${formatVnd(res.totalBet)}\``,
        `🏆 **Tổng nhận lại:** \`${formatVnd(res.payout)}\``,
        `${res.net >= 0 ? '📈 **Lãi ròng:**' : '📉 **Biến động:**'} **${res.net >= 0 ? '+' : ''}${formatVnd(res.net)}**`,
        `💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`,
      ].join('\n')
    )
    .setImage(diceImg.url)
    .setThumbnail(badgeBanner.url)
    .setTimestamp();

  const replayRow = buildPostGameRow({
    replayCustomId: `vgame:baucua:open:${user.id}`,
    userId: user.id,
  });

  await editFn({
    embeds: [resultEmbed],
    files: [diceImg.attachment, badgeBanner.attachment],
    components: [replayRow],
  });
}

// ============================================================================
// 2. ƯU TIÊN SỐ 1: TÀI XỈU – GIAO DIỆN CASINO (4–10 XỈU, 11–17 TÀI, 3/18 NHÀ CÁI)
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

export function buildTaiXiuBoardPayload(user, systems) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.TAIXIU, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.TAIXIU, user.id, {});
  const choice = draft.choice || 'tai';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const dash = systems.gameSystem.getTaiXiuDashboard(user.id);
  const roadStr = formatTaiXiuRoad(dash.recentLogs);
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_TAIXIU, 'taixiu_casino.png');

  const choiceLabel =
    choice === 'tai' ? '🔴 **KHU VỰC TÀI (11 – 17 điểm)**' : '🔵 **KHU VỰC XỈU (4 – 10 điểm)**';
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const embed = new EmbedBuilder()
    .setColor(choice === 'tai' ? COLORS.DANGER : COLORS.INFO)
    .setTitle('🎲 SÒNG TÀI XỈU HOÀNG GIA – GIAO DIỆN CASINO')
    .setDescription(
      [
        formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }),
        '',
        `🧭 **Cầu 10 phiên gần nhất:** ${roadStr}`,
        `📈 **Thành tích của bạn:** \`${dash.personal.wins}/${dash.personal.total}\` thắng (**${dash.personal.winRate}%**)`,
        '*Quy tắc: Tổng **4–10** = Xỉu • Tổng **11–17** = Tài • Tổng **3 hoặc 18** = Nhà cái thắng • Thắng nhận **2x**.*',
      ].join('\n')
    )
    .setImage(banner.url)
    .setTimestamp();

  const zoneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:taixiu:pick:${user.id}:tai`)
      .setLabel('🔴 KHU VỰC TÀI (11–17)')
      .setStyle(choice === 'tai' ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:taixiu:pick:${user.id}:xiu`)
      .setLabel('🔵 KHU VỰC XỈU (4–10)')
      .setStyle(choice === 'xiu' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:taixiu',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xác nhận Lắc Xúc Xắc',
  });

  return {
    embeds: [embed],
    files: [banner.attachment],
    components: [zoneRow, ...bettingRows],
  };
}

async function runTaiXiuConfirmedRound(editFn, user, choice, betAmount, systems) {
  // Chốt kết quả an toàn trong SQLite trước khi diễn hoạt xúc xắc
  const res = systems.gameSystem.playTaiXiu({
    userId: user.id,
    username: user.username,
    choice,
    bet: betAmount,
  });
  clearBettingDraft(GAME_IDS.TAIXIU, user.id);
  systems.gameSystem.releaseActivePlayer(GAME_IDS.TAIXIU, user.id);

  // Giai đoạn tung xúc xắc động
  const rollGif = buildAssetAttachment(ASSET_PATHS.DICE_ROLL_GIF, 'dice_roll.gif');
  const rollingEmbed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🎲 ĐANG TUNG 3 VIÊN XÚC XẮC TÀI XỈU...')
    .setDescription(
      `👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** vào cửa **${choice === 'tai' ? '🔴 TÀI (11–17)' : '🔵 XỈU (4–10)'}**!\n` +
      `✨ *3 viên xúc xắc đang lăn trong đĩa ngọc...*`
    )
    .setImage(rollGif.url);

  await editFn({ embeds: [rollingEmbed], files: [rollGif.attachment], components: [] });
  await sleep(950);

  // Hiển thị hình 3 mặt xúc xắc thực tế vừa dừng lại + kết quả thanh toán
  const diceImg = buildThreeDiceResultAttachment(res.dice, res.won);
  const resultThumb = buildAssetAttachment(
    res.won ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER,
    res.won ? 'victory.png' : 'defeat.png'
  );
  const dash = systems.gameSystem.getTaiXiuDashboard(user.id);

  const resultEmbed = new EmbedBuilder()
    .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`🎲 KẾT QUẢ TÀI XỈU — ${res.outcomeLabel}`)
    .setDescription(
      [
        `🎯 **3 Viên Xúc Xắc:** ${res.diceFaces.join('  ')}  *(Điểm từng viên: \`${res.dice.join(' + ')} = ${res.sum}\`)*`,
        `🏷️ **Kết quả bàn:** **${res.outcomeLabel}**`,
        `🫵 **Cửa bạn chọn:** **${choice === 'tai' ? '🔴 TÀI (11–17)' : '🔵 XỈU (4–10)'}** • Cược: \`${formatVnd(res.totalBet)}\``,
        res.won
          ? `🎉 **THẮNG LỚN (2x)!** Nhận về **${formatVnd(res.payout)}** *(Lãi ròng: +${formatVnd(res.net)})*`
          : `💸 **CHƯA MAY MẮN!** Bạn mất **${formatVnd(res.totalBet)}**`,
        `💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`,
        `🧭 **Cầu mới nhất:** ${formatTaiXiuRoad(dash.recentLogs)}`,
      ].join('\n')
    )
    .setImage(diceImg.url)
    .setThumbnail(resultThumb.url)
    .setTimestamp();

  const replayRow = buildPostGameRow({
    replayCustomId: `vgame:taixiu:open:${user.id}`,
    userId: user.id,
  });

  await editFn({
    embeds: [resultEmbed],
    files: [diceImg.attachment, resultThumb.attachment],
    components: [replayRow],
  });
}

// ============================================================================
// 3. ĐỒNG BỘ GIAO DIỆN HÌNH ẢNH: TUNG ĐỒNG XU (/coinflip)
// ============================================================================

export function buildCoinflipBoardPayload(user, systems) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.COINFLIP, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.COINFLIP, user.id, {});
  const side = draft.choice || 'sap';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const banner = buildAssetAttachment(ASSET_PATHS.GAME_COINFLIP, 'coinflip_banner.png');
  const choiceLabel = side === 'sap' ? '🪙 **Mặt SẤP (Hoàng Kim Bảo)**' : '🌟 **Mặt NGỬA (Ngôi Sao Đại Cát)**';
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🪙 TUNG ĐỒNG XU HOÀNG KIM – GIAO DIỆN ĐẶT CƯỢC')
    .setDescription(formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }))
    .setImage(banner.url)
    .setTimestamp();

  const sideRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:coinflip:pick:${user.id}:sap`)
      .setLabel('🪙 Chọn Mặt SẤP')
      .setStyle(side === 'sap' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:coinflip:pick:${user.id}:ngua`)
      .setLabel('🌟 Chọn Mặt NGỬA')
      .setStyle(side === 'ngua' ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:coinflip',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xác nhận Tung Xu',
  });

  return {
    embeds: [embed],
    files: [banner.attachment],
    components: [sideRow, ...bettingRows],
  };
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
  const spinEmbed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🪙 ĐỒNG XU ĐANG XOAY TRÊN KHÔNG...')
    .setDescription(
      `👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** vào cửa **${side === 'sap' ? 'Mặt SẤP' : 'Mặt NGỬA'}**!`
    )
    .setImage(flipGif.url);

  await editFn({ embeds: [spinEmbed], files: [flipGif.attachment], components: [] });
  await sleep(900);

  const coinFace = buildAssetAttachment(
    res.resultSide === 'sap' ? ASSET_PATHS.COIN_SAP : ASSET_PATHS.COIN_NGUA,
    res.resultSide === 'sap' ? 'coin_sap.png' : 'coin_ngua.png'
  );
  const banner = buildAssetAttachment(
    res.won ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER,
    res.won ? 'victory.png' : 'defeat.png'
  );

  const doneEmbed = new EmbedBuilder()
    .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`🪙 ĐỒNG XU DỪNG LẠI: ${res.resultSide === 'sap' ? 'MẶT SẤP' : 'MẶT NGỬA'}!`)
    .setDescription(
      [
        `• Bạn chọn: **${res.chosenSide === 'sap' ? 'Mặt Sấp' : 'Mặt Ngửa'}**`,
        `• Kết quả mở xu: **${res.resultSide === 'sap' ? 'Mặt Sấp' : 'Mặt Ngửa'}**`,
        res.won
          ? `🎉 **TRÚNG THƯỞNG (2x):** Nhận **${formatVnd(res.payout)}** *(Lãi +${formatVnd(res.net)})*`
          : `💸 **TRƯỢT:** Mất **${formatVnd(res.totalBet)}**`,
        `💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`,
      ].join('\n')
    )
    .setThumbnail(coinFace.url)
    .setImage(banner.url)
    .setTimestamp();

  await editFn({
    embeds: [doneEmbed],
    files: [coinFace.attachment, banner.attachment],
    components: [buildPostGameRow({ replayCustomId: `vgame:coinflip:open:${user.id}`, userId: user.id })],
  });
}

// ============================================================================
// 4. ĐỒNG BỘ GIAO DIỆN HÌNH ẢNH: OẲN TÙ TÌ (/rps — PvE & PvP)
// ============================================================================

export function buildRpsBoardPayload(user, systems) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.RPS, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.RPS, user.id, {});
  const choice = draft.choice || 'rock';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const banner = buildAssetAttachment(ASSET_PATHS.GAME_RPS, 'rps_banner.png');
  const move = RPS_CHOICES[choice];
  const choiceLabel = `${move.emoji} **${move.name}** *(Đấu trực tiếp với Bot • Gõ \`/rps doi_thu:@user\` để thách đấu PvP)*`;
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('✂️ ĐẤU TRƯỜNG OẲN TÙ TÌ – KÉO • BÚA • BAO')
    .setDescription(formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }))
    .setImage(banner.url)
    .setTimestamp();

  const handRow = new ActionRowBuilder().addComponents(
    ...Object.values(RPS_CHOICES).map((m) =>
      new ButtonBuilder()
        .setCustomId(`vgame:rps:pick:${user.id}:${m.id}`)
        .setLabel(`${m.emoji} Ra ${m.name.toUpperCase()}`)
        .setStyle(choice === m.id ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:rps',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xác nhận Oẳn Tù Tì',
  });

  return {
    embeds: [embed],
    files: [banner.attachment],
    components: [handRow, ...bettingRows],
  };
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
  const cdEmbed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('⏳ ĐẾM NGƯỢC OẲN TÙ TÌ: 3... 2... 1...')
    .setDescription(`👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** — Hai bên chuẩn bị mở tay đồng thời!`)
    .setImage(cdGif.url);

  await editFn({ embeds: [cdEmbed], files: [cdGif.attachment], components: [] });
  await sleep(950);

  const handImg = buildAssetAttachment(
    ASSET_PATHS.RPS_HAND[res.userMove.id],
    `hand_${res.userMove.id}.png`
  );
  const outcomeTitle =
    res.outcome === 'win'
      ? '🏆 BẠN ĐÃ CHIẾN THẮNG!'
      : res.outcome === 'tie'
        ? '🤝 HÒA NHAU — HOÀN TIỀN CƯỢC!'
        : '💥 BOT CHIẾN THẮNG!';

  const files = [handImg.attachment];
  const doneEmbed = new EmbedBuilder()
    .setColor(res.outcome === 'win' ? COLORS.SUCCESS : res.outcome === 'tie' ? COLORS.WARNING : COLORS.DANGER)
    .setTitle(`✂️ KẾT QUẢ OẲN TÙ TÌ — ${outcomeTitle}`)
    .setDescription(
      [
        `• Bạn ra: **${res.userMove.emoji} ${res.userMove.name}**`,
        `• Bot ra: **${res.botMove.emoji} ${res.botMove.name}**`,
        `• Thanh toán: **${res.net >= 0 ? '+' : ''}${formatVnd(res.net)}**`,
        `💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`,
      ].join('\n')
    )
    .setThumbnail(handImg.url)
    .setTimestamp();

  if (res.outcome !== 'tie') {
    const banner = buildAssetAttachment(
      res.outcome === 'win' ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER,
      res.outcome === 'win' ? 'victory.png' : 'defeat.png'
    );
    doneEmbed.setImage(banner.url);
    files.push(banner.attachment);
  }

  await editFn({
    embeds: [doneEmbed],
    files,
    components: [buildPostGameRow({ replayCustomId: `vgame:rps:open:${user.id}`, userId: user.id })],
  });
}

// ============================================================================
// 5. ĐỒNG BỘ GIAO DIỆN HÌNH ẢNH: ĐOÁN SỐ NHIỀU LƯỢT + GỢI Ý LỚN HƠN / NHỎ HƠN
// ============================================================================

export function buildGuessBoardPayload(user, systems) {
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

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🔢 ĐOÁN SỐ BÍ ẨN – GIAO DIỆN CHỌN ĐỘ KHÓ & MỨC CƯỢC')
    .setDescription(formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }))
    .setImage(banner.url)
    .setTimestamp();

  const diffRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:guess:pick:${user.id}:easy`)
      .setLabel('🟢 Dễ (1–20 • 4 lượt)')
      .setStyle(difficulty === 'easy' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:guess:pick:${user.id}:medium`)
      .setLabel('🟡 TB (1–50 • 5 lượt)')
      .setStyle(difficulty === 'medium' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vgame:guess:pick:${user.id}:hard`)
      .setLabel('🔴 Khó (1–100 • 6 lượt)')
      .setStyle(difficulty === 'hard' ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:guess',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xác nhận Khóa Số Bí Mật',
  });

  return {
    embeds: [embed],
    files: [banner.attachment],
    components: [diffRow, ...bettingRows],
  };
}

function buildActiveGuessTurnPayload(user, session, lastTurnInfo = null) {
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_GUESS, 'guess_active.png');
  const remaining = session.maxAttempts - session.attemptsUsed;
  const hearts = `${'❤️'.repeat(remaining)}${'🖤'.repeat(session.attemptsUsed)}`;

  const historyLines = session.history.map((h) => {
    const hintText =
      h.hint === 'higher'
        ? `📈 Số bí mật **LỚN HƠN ${h.guess}**`
        : `📉 Số bí mật **NHỎ HƠN ${h.guess}**`;
    return `• Lượt ${h.attempt}: Đoán \`${h.guess}\` ➔ ${hintText}`;
  });

  const headline = lastTurnInfo
    ? lastTurnInfo.hint === 'higher'
      ? `📈 **GỢI Ý:** Con số bí mật **LỚN HƠN ${lastTurnInfo.pick}**!`
      : `📉 **GỢI Ý:** Con số bí mật **NHỎ HƠN ${lastTurnInfo.pick}**!`
    : `🔐 Bot đã khóa ngẫu nhiên 1 con số từ **1** đến **${session.mode.max}**!`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`🔢 ĐANG GIẢI MÃ CON SỐ BÍ MẬT — ${session.mode.label.toUpperCase()}`)
    .setDescription(
      [
        `👤 **Người chơi:** <@${user.id}> • Tiền cược đã khóa: **${formatVnd(session.bet)}**`,
        `🎯 **Phạm vi số:** Từ **1** đến **${session.mode.max}**`,
        `⏳ **Số lượt còn lại:** ${hearts} (\`${remaining}/${session.maxAttempts} lượt\`)`,
        '',
        headline,
        historyLines.length > 0 ? `\n📜 **Nhật ký dự đoán:**\n${historyLines.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .setImage(banner.url)
    .setFooter({ text: 'Bấm nút "Nhập Số Dự Đoán" bên dưới để đoán lượt tiếp theo!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vgame:guess:input:${user.id}`)
      .setLabel(`🔢 Nhập Số Dự Đoán (1 – ${session.mode.max})`)
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    files: [banner.attachment],
    components: [row],
  };
}

async function renderFinishedGuessRound(editFn, user, turnResult) {
  const vaultGif = buildAssetAttachment(ASSET_PATHS.GUESS_VAULT_GIF, 'vault_open.gif');
  const animEmbed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🔓 ĐANG MỞ KÉT KẾT QUẢ BÍ MẬT...')
    .setDescription(`Đang đối chiếu dự đoán **#${turnResult.pick}** của <@${user.id}> với mã khóa...`)
    .setImage(vaultGif.url);

  await editFn({ embeds: [animEmbed], files: [vaultGif.attachment], components: [] });
  await sleep(850);

  const banner = buildAssetAttachment(
    turnResult.won ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER,
    turnResult.won ? 'victory.png' : 'defeat.png'
  );
  const trail = turnResult.history
    .map((h) => `\`#${h.guess}\`${h.hint === 'correct' ? '✅' : h.hint === 'higher' ? '↑' : '↓'}`)
    .join(' ➔ ');

  const doneEmbed = new EmbedBuilder()
    .setColor(turnResult.won ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(
      turnResult.won
        ? `🎉 GIẢI MÃ THÀNH CÔNG CON SỐ #${turnResult.secret}!`
        : `💥 HẾT LƯỢT DỰ ĐOÁN — SỐ BÍ MẬT LÀ #${turnResult.secret}`
    )
    .setDescription(
      [
        `• **Chế độ:** ${turnResult.mode.label}`,
        `• **Hành trình đoán (${turnResult.attemptsUsed}/${turnResult.maxAttempts} lượt):** ${trail}`,
        `• **Con số bí mật của Bot:** **#${turnResult.secret}**`,
        turnResult.won
          ? `🏆 **Tiền thưởng nhận về:** **${formatVnd(turnResult.payout)}** *(Lãi ròng: +${formatVnd(turnResult.net)})*`
          : `💸 **Kết quả:** Hết lượt đoán, mất tiền cược **${formatVnd(turnResult.totalBet)}**`,
        `💰 **Số dư ví mới:** **${formatVnd(turnResult.balanceAfter)}**`,
      ].join('\n')
    )
    .setImage(banner.url)
    .setTimestamp();

  await editFn({
    embeds: [doneEmbed],
    files: [banner.attachment],
    components: [buildPostGameRow({ replayCustomId: `vgame:guess:open:${user.id}`, userId: user.id })],
  });
}

// ============================================================================
// 6. ĐỒNG BỘ GIAO DIỆN HÌNH ẢNH: ĐUA THÚ TỐC ĐỘ (/race — ĐƯỜNG ĐUA TỪNG CHẶNG)
// ============================================================================

export function buildRaceBoardPayload(user, systems) {
  systems.gameSystem.touchActivePlayer(GAME_IDS.RACE, user.id);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const { minBet, maxBet } = getBetBounds(systems.db);
  const draft = upsertBettingDraft(GAME_IDS.RACE, user.id, {});
  const animalId = draft.choice || 'horse';
  const betAmount = draft.betAmount || Math.max(minBet, 1_000);

  const chosen = RACE_ANIMALS.find((a) => a.id === animalId) || RACE_ANIMALS[0];
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_RACE, 'race_banner.png');
  const animalThumb = buildAssetAttachment(
    ASSET_PATHS.RACE_ANIMAL[chosen.id],
    `racer_${chosen.id}.png`
  );
  const choiceLabel = `${chosen.emoji} **${chosen.name}** *(Về Nhất nhận thưởng **4.5x** tiền cược)*`;
  const canConfirm = betAmount >= minBet && betAmount <= maxBet && wallet >= betAmount;

  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('🐎 TRƯỜNG ĐUA THÚ TỐC ĐỘ PRO – CHỌN CHIẾN THÚ & ĐẶT CƯỢC')
    .setDescription(formatBettingSummaryBlock({ wallet, minBet, maxBet, betAmount, choiceLabel }))
    .setThumbnail(animalThumb.url)
    .setImage(banner.url)
    .setTimestamp();

  const animalRow = new ActionRowBuilder().addComponents(
    ...RACE_ANIMALS.map((a) =>
      new ButtonBuilder()
        .setCustomId(`vgame:race:pick:${user.id}:${a.id}`)
        .setLabel(`${a.emoji} ${a.name}`)
        .setStyle(chosen.id === a.id ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );

  const bettingRows = buildStandardBettingRows({
    prefix: 'vgame:race',
    userId: user.id,
    selectedBet: betAmount,
    canConfirm,
    confirmLabel: 'Xác nhận Xuất Phát',
  });

  return {
    embeds: [embed],
    files: [banner.attachment, animalThumb.attachment],
    components: [animalRow, ...bettingRows],
  };
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

  // Chặng 1 & Chặng 2: Diễn biến đường đua trực tiếp (TUYỆT ĐỐI KHÔNG HIỆN KẾT QUẢ NGAY)
  const runGif = buildAssetAttachment(ASSET_PATHS.RACE_RUN_GIF, 'race_run.gif');
  const stage1Embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('🔫 PHÁO HIỆU NỔ! CHẶNG 1/3 — XUẤT PHÁT RỜI CỔNG!')
    .setDescription(
      `👤 <@${user.id}> đặt **${formatVnd(res.totalBet)}** cho **${res.chosen.emoji} ${res.chosen.name}** ⭐\n\n` +
      res.frames[0]
    )
    .setImage(runGif.url);

  await editFn({ embeds: [stage1Embed], files: [runGif.attachment], components: [] });
  await sleep(950);

  const stage2Embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🔥 CHẶNG 2/3 — TĂNG TỐC KHÚC CUA QUYẾT ĐỊNH!')
    .setDescription(
      `👤 <@${user.id}> đang cổ vũ **${res.chosen.emoji} ${res.chosen.name}** ⭐ (Tổng cược: **${formatVnd(res.totalBet)}**)\n\n` +
      res.frames[1]
    )
    .setImage(runGif.url);

  await editFn({ embeds: [stage2Embed] });
  await sleep(950);

  // Chặng cuối: Cán đích & Bảng xếp hạng chung cuộc #1..#5
  const winnerCard = buildAssetAttachment(
    ASSET_PATHS.RACE_ANIMAL[res.winner.id],
    `winner_${res.winner.id}.png`
  );
  const banner = buildAssetAttachment(
    res.won ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER,
    res.won ? 'victory.png' : 'defeat.png'
  );
  const medals = ['🥇 Hạng 1', '🥈 Hạng 2', '🥉 Hạng 3', '4️⃣ Hạng 4', '5️⃣ Hạng 5'];
  const podiumLines = res.standings.map(
    (a, idx) => `${medals[idx]}: **${a.emoji} ${a.name}**${a.id === res.chosen.id ? ' *(Bạn chọn)*' : ''}`
  );

  const finalEmbed = new EmbedBuilder()
    .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`🏁 KẾT QUẢ CHUNG CUỘC — ${res.winner.emoji} ${res.winner.name.toUpperCase()} VÔ ĐỊCH!`)
    .setDescription(
      [
        res.frames[2],
        '',
        '🏆 **Bảng Thứ Hạng Cán Đích:**',
        ...podiumLines,
        '',
        res.won
          ? `🎉 **THẮNG ĐẬM (4.5x):** Nhận về **${formatVnd(res.payout)}** *(Lãi ròng +${formatVnd(res.net)})*`
          : `💸 **CHƯA TRÚNG:** Chiến thú bạn chọn chưa về nhất (-${formatVnd(res.totalBet)})`,
        `💰 **Số dư ví mới:** **${formatVnd(res.balanceAfter)}**`,
      ].join('\n')
    )
    .setThumbnail(winnerCard.url)
    .setImage(banner.url)
    .setTimestamp();

  await editFn({
    embeds: [finalEmbed],
    files: [winnerCard.attachment, banner.attachment],
    components: [buildPostGameRow({ replayCustomId: `vgame:race:open:${user.id}`, userId: user.id })],
  });
}

// ============================================================================
// HÀM MỞ NHANH BÀN CHƠI TỪ GAME CENTER (/games)
// ============================================================================

export function openVisualGameLauncher(gameId, user, guildId, channelId, systems) {
  switch (gameId) {
    case GAME_IDS.BAUCUA:
      return buildBauCuaBoardPayload(user, systems);
    case GAME_IDS.TAIXIU:
      return buildTaiXiuBoardPayload(user, systems);
    case GAME_IDS.NOITU:
      return buildNoituLobbyPayload(systems.wordChainSystem, channelId);
    case GAME_IDS.RPS:
      return buildRpsBoardPayload(user, systems);
    case GAME_IDS.GUESS:
      return buildGuessBoardPayload(user, systems);
    case GAME_IDS.COINFLIP:
      return buildCoinflipBoardPayload(user, systems);
    case GAME_IDS.RACE:
      return buildRaceBoardPayload(user, systems);
    default:
      return buildGameCenterHomePayload(user, guildId, systems);
  }
}

// ============================================================================
// ĐỊNH NGHĨA CÁC SLASH COMMAND TRÒ CHƠI (/games, /baucua, /taixiu, /coinflip, /guess, /race, /rps, /noitu)
// ============================================================================

const baucuaCommand = {
  data: new SlashCommandBuilder()
    .setName('baucua')
    .setDescription('Mở bàn cược hình ảnh Bầu Cua Tôm Cá PRO (chọn nhiều linh vật, nhận thưởng 2x/3x/4x)')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) =>
      o.setName('tien_cuoc_moi_cua').setDescription('Tùy chọn: Mức phỉnh khởi tạo ban đầu (VNĐ)').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.BAUCUA);
    const preset = interaction.options.getInteger('tien_cuoc_moi_cua');
    if (preset) {
      upsertBettingDraft(GAME_IDS.BAUCUA, interaction.user.id, { activeChip: preset });
    }
    await sendPanelReply(interaction, ctx, buildBauCuaBoardPayload(interaction.user, systems));
  },
};

const taixiuCommand = {
  data: new SlashCommandBuilder()
    .setName('taixiu')
    .setDescription('Sòng Tài Xỉu Casino trực quan (Xỉu 4–10, Tài 11–17, Tổng 3/18 Nhà cái thắng)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('cua')
        .setDescription('Tùy chọn: Lắc nhanh Tài hoặc Xỉu (bỏ trống để mở Bàn Cược Casino trực quan)')
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
    const choice = interaction.options.getString('cua');
    const bet = interaction.options.getInteger('tien_cuoc');

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
      (payload) => interaction.editReply(payload),
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
    .setDescription('Tung đồng xu Hoàng Kim Sấp / Ngửa với bảng cược tương tác & hiệu ứng xoay xu')
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
    const side = interaction.options.getString('chon');
    const bet = interaction.options.getInteger('tien_cuoc');

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
      (payload) => interaction.editReply(payload),
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
    .setDescription('Giải mã con số bí mật của Bot với giới hạn lượt đoán & gợi ý Lớn Hơn / Nhỏ Hơn')
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
    const diff = interaction.options.getString('do_kho');
    const bet = interaction.options.getInteger('tien_cuoc');
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
    .setDescription('Đặt cược Đua Thú Tốc Độ với diễn biến đường đua trực tiếp từng chặng (thưởng 4.5x)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('thu_dua')
        .setDescription('Tùy chọn: Chọn chiến thú (bỏ trống để mở bảng cược hình ảnh)')
        .addChoices(...RACE_ANIMALS.map((a) => ({ name: `${a.emoji} ${a.name}`, value: a.id })))
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Tùy chọn: Số tiền cược VNĐ').setMinValue(100)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    systems.gameSystem.assertGameAllowed(GAME_IDS.RACE);
    const animalId = interaction.options.getString('thu_dua');
    const bet = interaction.options.getInteger('tien_cuoc');

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
      (payload) => interaction.editReply(payload),
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
    .setDescription('Oẳn Tù Tì hình ảnh trực quan (Đấu với Bot hoặc Thách đấu Người chơi khác cược VNĐ)')
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
    const choice = interaction.options.getString('chon');
    const bet = interaction.options.getInteger('tien_cuoc');
    const opponent = interaction.options.getUser('doi_thu');

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
        (payload) => interaction.editReply(payload),
        interaction.user,
        choice,
        bet,
        systems
      );
      return;
    }

    // Chế độ thách đấu Oẳn Tù Tì PvP 1v1 có đặt cược VNĐ
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

    const banner = buildAssetAttachment(ASSET_PATHS.GAME_RPS, 'rps_pvp.png');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rps:accept:${cid}:rock`).setLabel('✊ Ra Búa').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:accept:${cid}:paper`).setLabel('🖐️ Ra Bao').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:accept:${cid}:scissors`).setLabel('✌️ Ra Kéo').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:decline:${cid}`).setLabel('❌ Từ chối').setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle('⚔️ LỜI THÁCH ĐẤU OẲN TÙ TÌ PvP')
      .setDescription(
        `<@${interaction.user.id}> thách đấu <@${opponent.id}> một ván **Oẳn Tù Tì**!\n` +
        `💰 **Mức cược:** **${formatVnd(cleanBet)}**\n` +
        `⏳ *Lời mời có hiệu lực trong 90 giây. <@${opponent.id}> hãy chọn nước đi bên dưới để mở kết quả đồng thời!*`
      )
      .setImage(banner.url);

    await sendPanelReply(interaction, ctx, { embeds: [embed], files: [banner.attachment], components: [row] });
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
// BỘ ĐỊNH TUYẾN TƯƠNG TÁC TRỰC QUAN CHO TẤT CẢ 7 TRÒ CHƠI
// ============================================================================

export async function handleGameComponentInteraction(interaction, ctx) {
  const systems = getSys(ctx);

  // 1. Game Center (/games)
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
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: '❌ Hộp nhập này không phải của bạn.', flags: MessageFlags.Ephemeral });
      return true;
    }

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
          await interaction.deferUpdate();
          await renderFinishedGuessRound((p) => interaction.editReply(p), interaction.user, turnRes);
        } else {
          const sess = systems.gameSystem.getGuessSession(interaction.user.id);
          await interaction.update(buildActiveGuessTurnPayload(interaction.user, sess, turnRes));
        }
      } catch (err) {
        await interaction.reply({ embeds: [errorEmbed('Đoán Số', err.message)], flags: MessageFlags.Ephemeral });
      }
      return true;
    }

    if (gameId === GAME_IDS.BAUCUA && action === 'custom_bet') {
      const rawText = interaction.fields.getTextInputValue('baucua_stakes');
      try {
        const draft = getBettingDraft(GAME_IDS.BAUCUA, interaction.user.id) || { mascotBets: {} };
        const patch = parseMascotCustomInput(rawText, draft.mascotBets || {});
        upsertBettingDraft(GAME_IDS.BAUCUA, interaction.user.id, patch);
        await interaction.update(buildBauCuaBoardPayload(interaction.user, systems));
      } catch (err) {
        await interaction.reply({ embeds: [errorEmbed('Bầu Cua', err.message)], flags: MessageFlags.Ephemeral });
      }
      return true;
    }

    // Modal mức cược chung cho Tài Xỉu, Đồng Xu, Oẳn Tù Tì, Đoán Số, Đua Thú
    const rawBet = interaction.fields.getTextInputValue('bet_amount');
    const parsed = parseCleanAmount(rawBet);
    const { minBet, maxBet } = getBetBounds(systems.db);
    if (!Number.isSafeInteger(parsed) || parsed < minBet || parsed > maxBet) {
      await interaction.reply({
        embeds: [errorEmbed('Mức cược không hợp lệ', `Vui lòng nhập số nguyên từ **${formatVnd(minBet)}** đến **${formatVnd(maxBet)}**!`)],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    upsertBettingDraft(gameId, interaction.user.id, { betAmount: parsed });
    await interaction.update(
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

    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: '❌ Bàn cược này thuộc về người chơi khác! Hãy gõ lệnh để mở bàn riêng của bạn.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const { minBet, maxBet } = getBetBounds(systems.db);
    const wallet = systems.economySystem.ensureUser(interaction.user.id, interaction.user.username).wallet;

    if (action === 'cancel') {
      clearBettingDraft(gameId, interaction.user.id);
      systems.gameSystem.releaseActivePlayer(gameId, interaction.user.id);
      const cancelledEmbed = new EmbedBuilder()
        .setColor(COLORS.MUTED)
        .setTitle('🛑 ĐÃ HỦY PHIÊN ĐẶT CƯỢC')
        .setDescription('Chưa có khoản tiền VNĐ nào bị trừ khỏi ví của bạn.');
      await interaction.update({
        embeds: [cancelledEmbed],
        files: [],
        components: [buildPostGameRow({ replayCustomId: `vgame:${gameId}:open:${ownerId}`, userId: ownerId })],
      });
      return true;
    }

    if (action === 'back') {
      clearBettingDraft(gameId, interaction.user.id);
      systems.gameSystem.releaseActivePlayer(gameId, interaction.user.id);
      await interaction.update(
        buildGameCenterHomePayload(interaction.user, interaction.guildId, systems)
      );
      return true;
    }

    if (action === 'open') {
      await interaction.update(
        openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems)
      );
      return true;
    }

    // --- Xử lý riêng Bầu Cua đa cửa ---
    if (gameId === GAME_IDS.BAUCUA) {
      const draft = getBettingDraft(GAME_IDS.BAUCUA, ownerId) || upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, {});

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
        await interaction.update(buildBauCuaBoardPayload(interaction.user, systems));
        return true;
      }

      if (action === 'pick') {
        const mascotBets = { ...(draft.mascotBets || {}) };
        const chip = draft.activeChip || Math.max(minBet, 1_000);
        const nextTotal = Object.values(mascotBets).reduce((s, v) => s + v, 0) + chip;
        if (nextTotal > maxBet) {
          await interaction.reply({
            content: `⚠️ Tổng cược không được vượt quá **${formatVnd(maxBet)}**! Bấm **🧹 Xóa chọn** để đặt lại.`,
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }
        mascotBets[arg] = (mascotBets[arg] || 0) + chip;
        upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { mascotBets });
        await interaction.update(buildBauCuaBoardPayload(interaction.user, systems));
        return true;
      }

      if (action === 'clear') {
        upsertBettingDraft(GAME_IDS.BAUCUA, ownerId, { mascotBets: {} });
        await interaction.update(buildBauCuaBoardPayload(interaction.user, systems));
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
          await interaction.deferUpdate();
          await runBauCuaConfirmedRound(
            (p) => interaction.editReply(p),
            interaction.user,
            betsMap,
            systems
          );
        });
        if (lockRes.locked) {
          await interaction.reply({ content: '⏳ Đang xử lý xác nhận cược, vui lòng chờ...', flags: MessageFlags.Ephemeral });
        }
        return true;
      }
    }

    // --- Xử lý nút Nhập Số Dự Đoán trong phiên Đoán Số nhiều lượt ---
    if (gameId === GAME_IDS.GUESS && action === 'input') {
      const sess = systems.gameSystem.getGuessSession(ownerId);
      if (!sess) {
        await interaction.update(buildGuessBoardPayload(interaction.user, systems));
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`vgame_modal:guess:guess_turn:${ownerId}`)
        .setTitle(`Đoán Số (1 – ${sess.mode.max})`);
      const input = new TextInputBuilder()
        .setCustomId('guess_number')
        .setLabel(`Nhập dự đoán từ 1 đến ${sess.mode.max}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Còn ${sess.maxAttempts - sess.attemptsUsed} lượt`)
        .setRequired(true)
        .setMaxLength(5);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // --- Xử lý chung cho Tài Xỉu, Đồng Xu, Oẳn Tù Tì, Đoán Số, Đua Thú ---
    if (action === 'pick') {
      upsertBettingDraft(gameId, ownerId, { choice: arg });
      await interaction.update(
        openVisualGameLauncher(gameId, interaction.user, interaction.guildId, interaction.channelId, systems)
      );
      return true;
    }

    if (action === 'chip') {
      const nextBet = arg === 'all' ? computeAllInAmount(wallet, minBet, maxBet) : Number(arg);
      upsertBettingDraft(gameId, ownerId, { betAmount: nextBet });
      await interaction.update(
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
          await interaction.update(buildActiveGuessTurnPayload(interaction.user, sess));
          return;
        }

        await interaction.deferUpdate();
        const editFn = (p) => interaction.editReply(p);
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
        await interaction.reply({ content: '⏳ Ván cược đang được khóa xử lý, vui lòng chờ...', flags: MessageFlags.Ephemeral });
      }
      return true;
    }
  }

  // 5. Xử lý thách đấu Oẳn Tù Tì PvP có hiệu ứng đếm ngược & hình ảnh
  if (interaction.customId?.startsWith('rps:')) {
    sweepRpsChallenges();
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const cid = parts[2];
    const ch = rpsChallenges.get(cid);

    if (!ch) {
      await interaction.update({
        embeds: [errorEmbed('Hết hạn thách đấu', 'Lời thách đấu Oẳn Tù Tì này đã hết hạn 90 giây.')],
        files: [],
        components: [],
      });
      return true;
    }

    if (interaction.user.id !== ch.p2Id) {
      await interaction.reply({ content: '❌ Chỉ người được thách đấu mới có thể bấm nút này!', flags: MessageFlags.Ephemeral });
      return true;
    }

    rpsChallenges.delete(cid);
    if (action === 'decline') {
      const decEmbed = new EmbedBuilder()
        .setColor(COLORS.MUTED)
        .setTitle('🏳️ ĐÃ TỪ CHỐI THÁCH ĐẤU OẲN TÙ TÌ')
        .setDescription(`<@${ch.p2Id}> đã từ chối lời mời của <@${ch.p1Id}>.`);
      await interaction.update({ embeds: [decEmbed], files: [], components: [] });
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

    await interaction.deferUpdate();
    const cdGif = buildAssetAttachment(ASSET_PATHS.RPS_COUNTDOWN_GIF, 'rps_pvp_cd.gif');
    const cdEmbed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle('⏳ OẲN TÙ TÌ PvP: 3... 2... 1... MỞ TAY!')
      .setDescription(`<@${ch.p1Id}> ⚔️ <@${ch.p2Id}> • Mức cược: **${formatVnd(res.bet)}**`)
      .setImage(cdGif.url);

    await interaction.editReply({ embeds: [cdEmbed], files: [cdGif.attachment], components: [] });
    await sleep(900);

    const banner = buildAssetAttachment(ASSET_PATHS.VICTORY_BANNER, 'pvp_result.png');
    const resEmbed = new EmbedBuilder()
      .setColor(res.outcome === 'tie' ? COLORS.WARNING : COLORS.SUCCESS)
      .setTitle('⚔️ KẾT QUẢ OẲN TÙ TÌ PvP 1v1')
      .setDescription(
        [
          `• <@${ch.p1Id}> ra: **${res.move1.emoji} ${res.move1.name}**`,
          `• <@${ch.p2Id}> ra: **${res.move2.emoji} ${res.move2.name}**`,
          res.outcome === 'tie'
            ? '🤝 **HÒA NHAU!** Không ai bị trừ tiền.'
            : `🏆 **NGƯỜI CHIẾN THẮNG:** <@${res.winnerId}> nhận **+${formatVnd(res.bet)}** từ <@${res.loserId}>!`,
        ].join('\n')
      )
      .setImage(banner.url)
      .setTimestamp();

    await interaction.editReply({ embeds: [resEmbed], files: [banner.attachment], components: [] });
    return true;
  }

  return false;
}

export const handleGameInteraction = handleGameComponentInteraction;
