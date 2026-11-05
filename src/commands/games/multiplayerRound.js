import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  BAUCUA_MASCOT_MAP,
  BAUCUA_MASCOTS,
  BOT_ROLES,
  GAME_CATALOG,
  GAME_IDS,
  MP_QUICK_CHIPS,
  MP_ROUND_STATUS,
  RACE_ANIMAL_MAP,
  RACE_ANIMALS,
} from '../../config/constants.js';
import {
  buildCv2NoticePayload,
  buildCv2Payload,
  createContainer,
  mediaGallery,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import { safeReplyV2, safeUpdateV2 } from '../../ui/interactionHelpers.js';
import { THEME } from '../../ui/theme.js';
import {
  ASSET_PATHS,
  buildAssetAttachment,
  buildBauCua3dDiceRollGallery,
  buildDiceGalleryAssets,
  buildMultiplayerBauCuaDoorsGallery,
  buildMultiplayerRaceDoorsGallery,
  buildMultiplayerTaiXiuDoorsGallery,
  getDedicatedOutcomeBannerRelPath,
} from '../../utils/assetRegistry.js';
import { formatVnd, parseAmountInput } from '../../utils/format.js';
import { hasBotRole } from '../../utils/permissions.js';

const MP_GAME_META = Object.freeze({
  [GAME_IDS.BAUCUA]: Object.freeze({
    id: GAME_IDS.BAUCUA,
    title: 'BẦU CUA TÔM CÁ 3D',
    shortName: 'Bầu Cua 3D',
    emoji: '🦀',
    bannerPath: ASSET_PATHS.BAUCUA_BANNER_3D,
    animPath: ASSET_PATHS.BAUCUA_SHAKE_GIF,
    animName: 'mp_baucua_shake.gif',
    compactRules:
      '📖 **Luật chuẩn Bầu Cua:** Chọn **1 hoặc nhiều cửa** (`Bầu, Cua, Tôm, Cá, Gà, Nai`). Lắc **3 viên xúc xắc chung** toàn phiên: Xuất hiện **1 lần = nhận 2x** hoàn trả • **2 lần = nhận 3x** • **3 lần = nhận 4x** • **0 lần = mất tiền cược**.',
  }),
  [GAME_IDS.TAIXIU]: Object.freeze({
    id: GAME_IDS.TAIXIU,
    title: 'TÀI XỈU CASINO 3D',
    shortName: 'Tài Xỉu 3D',
    emoji: '🎲',
    bannerPath: ASSET_PATHS.TAIXIU_BANNER_3D,
    animPath: ASSET_PATHS.DICE_ROLL_GIF,
    animName: 'mp_taixiu_roll.gif',
    compactRules:
      '📖 **Luật chuẩn Tài Xỉu (công bố trước phiên):** Tung **3 viên xúc xắc chung** (1–6 nút): Tổng **4–10 = XỈU** • Tổng **11–17 = TÀI** • Thắng nhận lại **2x tiền cược**. **Tổng 3 hoặc 18 (Bộ ba 1-1-1 / 6-6-6): Nhà cái thắng**.',
  }),
  [GAME_IDS.RACE]: Object.freeze({
    id: GAME_IDS.RACE,
    title: 'TRƯỜNG ĐUA THÚ 3D',
    shortName: 'Đua Thú 3D',
    emoji: '🏇',
    bannerPath: ASSET_PATHS.RACE_BANNER_3D,
    animPath: ASSET_PATHS.RACE_RUN_GIF,
    animName: 'mp_race_run.gif',
    compactRules:
      '📖 **Luật chuẩn Đua Thú:** Chọn **1 hoặc nhiều chiến thú** trên 5 làn đua. Cả phiên cùng xem chung 1 cuộc đua công bằng: Chiến thú cán đích **Hạng #1** trả thưởng **4.5x tiền cược**!',
  }),
});

export function formatChoiceLabel(gameId, choice) {
  if (gameId === GAME_IDS.BAUCUA) {
    const m = BAUCUA_MASCOT_MAP[choice];
    return m ? `${m.emoji} ${m.name}` : String(choice).toUpperCase();
  }
  if (gameId === GAME_IDS.TAIXIU) {
    return choice === 'tai' ? '🔴 CỬA TÀI (11–17)' : '🔵 CỬA XỈU (4–10)';
  }
  if (gameId === GAME_IDS.RACE) {
    const a = RACE_ANIMAL_MAP[choice];
    return a ? `${a.emoji} ${a.name}` : String(choice).toUpperCase();
  }
  return String(choice).toUpperCase();
}

function buildDoorSummaryLines(gameId, doorStats) {
  if (gameId === GAME_IDS.BAUCUA) {
    return BAUCUA_MASCOTS.map((m) => {
      const st = doorStats[m.id] || { count: 0, total: 0 };
      return `• ${m.emoji} **${m.name}:** \`${st.count} người\` — **${formatVnd(st.total)}**`;
    }).join('\n');
  }
  if (gameId === GAME_IDS.TAIXIU) {
    const tai = doorStats.tai || { count: 0, total: 0 };
    const xiu = doorStats.xiu || { count: 0, total: 0 };
    return [
      `• 🔴 **CỬA TÀI (11–17):** \`${tai.count} người\` — **${formatVnd(tai.total)}**`,
      `• 🔵 **CỬA XỈU (4–10):** \`${xiu.count} người\` — **${formatVnd(xiu.total)}**`,
    ].join('\n');
  }
  return RACE_ANIMALS.map((a, idx) => {
    const st = doorStats[a.id] || { count: 0, total: 0 };
    return `• **Làn ${idx + 1}** ${a.emoji} **${a.name}:** \`${st.count} người\` — **${formatVnd(st.total)}**`;
  }).join('\n');
}

function buildDoorActionRows(roundId, gameId, disabled = false) {
  if (gameId === GAME_IDS.BAUCUA) {
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();
    BAUCUA_MASCOTS.forEach((m, idx) => {
      const btn = new ButtonBuilder()
        .setCustomId(`mp:door:${roundId}:${m.id}`)
        .setEmoji(m.emoji)
        .setLabel(`Cửa ${m.name}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled);
      if (idx < 3) row1.addComponents(btn);
      else row2.addComponents(btn);
    });
    return [row1, row2];
  }

  if (gameId === GAME_IDS.TAIXIU) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mp:door:${roundId}:tai`)
          .setEmoji('🔴')
          .setLabel('ĐẶT CỬA TÀI (11–17)')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId(`mp:door:${roundId}:xiu`)
          .setEmoji('🔵')
          .setLabel('ĐẶT CỬA XỈU (4–10)')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled)
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      ...RACE_ANIMALS.map((a) =>
        new ButtonBuilder()
          .setCustomId(`mp:door:${roundId}:${a.id}`)
          .setEmoji(a.emoji)
          .setLabel(a.name.split(' ').slice(0, 2).join(' '))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled)
      )
    ),
  ];
}

function buildQuickChipSelectRow(roundId, disabled = false) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`mp:chip:${roundId}`)
    .setPlaceholder('🎯 Chế độ đặt cược: Mở khung nhập tiền hoặc chọn Phỉnh nhanh 1 chạm')
    .setDisabled(disabled)
    .addOptions([
      {
        label: 'Nhập số tiền tùy ý bằng khung Modal (Mặc định)',
        value: 'modal',
        emoji: '⌨️',
        description: 'Bấm vào cửa bất kỳ sẽ hiện khung nhập số tiền chính xác',
      },
      ...MP_QUICK_CHIPS.map((amt) => ({
        label: `Phỉnh nhanh 1 chạm: ${formatVnd(amt)}`,
        value: String(amt),
        emoji: amt >= 50_000 ? '💎' : '🪙',
        description: `Chạm vào cửa bất kỳ để đặt ngay ${formatVnd(amt)}`,
      })),
      {
        label: 'Tất tay (All-in tối đa theo ví & trần cược)',
        value: 'all',
        emoji: '🔥',
        description: 'Chạm vào cửa bất kỳ để đặt toàn bộ số dư khả dụng',
      },
    ]);

  return new ActionRowBuilder().addComponents(select);
}

function formatStarterDisplay(round) {
  if (!round?.started_by || round.started_by === 'SYSTEM_AUTO') {
    return '🤖 **Hệ Thống Tự Động (Auto Next)**';
  }
  const tag = `<@${round.started_by}>`;
  return round.started_by_name && round.started_by_name !== round.started_by
    ? `${tag} (\`${round.started_by_name}\`)`
    : tag;
}

function buildAutoNextStatusLines(round, gameMeta = null) {
  if (round.auto_next_state === 'AUTO_STOPPED_NO_PLAYERS') {
    const gTitle = gameMeta ? `${gameMeta.emoji} **${gameMeta.title}**` : `\`${round.game_id}\``;
    return [
      '',
      '⏸️ PHÒNG CHƠI TẠM NGỪNG',
      '',
      'Không có người tham gia trong 2 phiên liên tiếp.',
      'Hệ thống đã tạm dừng tự động mở phiên mới.',
      '',
      'Thành viên có thể nhấn START bất cứ lúc nào để mở lại phòng chơi.',
      '',
      `• 🎮 **Tên trò chơi:** ${gTitle}`,
      `• 🆔 **Round ID cuối cùng:** \`#${round.round_id}\``,
    ].join('\n');
  }

  if (round.auto_next_state === 'PENDING' && round.next_round_at) {
    const nextUnix = Math.floor(Number(round.next_round_at) / 1000);
    const remSec = Math.max(0, Math.ceil((Number(round.next_round_at) - Date.now()) / 1000));
    const lines = [
      '',
      '⏳ **PHIÊN TIẾP THEO SẮP BẮT ĐẦU**',
      `• 🕒 **Thời gian còn lại trước khi mở phiên mới:** <t:${nextUnix}:R> *(~${remSec} giây)*`,
    ];
    if (round.next_round_id) {
      lines.push(`• 🆔 **Round ID tiếp theo:** \`#${round.next_round_id}\``);
    }
    return lines.join('\n');
  }

  if (round.next_round_id) {
    return [
      '',
      '🚀 **PHIÊN TIẾP THEO ĐÃ ĐƯỢC MỞ:**',
      `• 🆔 **Round ID tiếp theo:** \`#${round.next_round_id}\` — *Đang nhận đặt cược!*`,
    ].join('\n');
  }

  return '';
}

/**
 * Kết xuất Bảng Phiên Chung Discord Components V2 (tự động thích ứng theo trạng thái vòng đời):
 * - `WAITING` / `BETTING`: Bảng 11 phần tử tối ưu Mobile (Mục 12) + mốc cảnh báo 30s / 10s / 5s.
 * - `LOCKED` / `DRAWING` / `SETTLING`: Khóa nút cược + Animation 3D Casino chung toàn kênh.
 * - `COMPLETED`: Bảng Kết Quả Chính Thức (Mục 8) + 4 nút chức năng (Chi tiết, Lịch sử, BXH, Mở phiên tiếp theo).
 * - `CANCELLED`: Bảng thông báo hủy phiên & hoàn tiền 100% + nút Mở phiên tiếp theo.
 */
export function buildMultiplayerBoardPayload(snapshot, systems, meta = {}) {
  const { round, doorStats, winners, breakEven, losers, remainingSec } = snapshot;
  const gameMeta = MP_GAME_META[round.game_id] || MP_GAME_META[GAME_IDS.BAUCUA];
  const { minBet, maxBet } = systems.multiplayerRoundSystem.getBetLimits();
  const ephemeral = Boolean(meta.ephemeral);
  const clearAttachments = Boolean(meta.isEdit);

  // ==========================================================================
  // TRẠNG THÁI 1: ĐANG MỞ CƯỢC (`WAITING` / `BETTING`) — Đúng thứ tự 1..11 Mục 12
  // ==========================================================================
  if (round.status === MP_ROUND_STATUS.BETTING || round.status === MP_ROUND_STATUS.WAITING) {
    const endsUnix = Math.floor(Number(round.ends_at) / 1000);
    const cdSec =
      typeof meta.forcedCountdownSec === 'number' ? meta.forcedCountdownSec : remainingSec;
    let accent = THEME.NEON_CYAN;
    let countdownHeadline = `🟢 **TRẠNG THÁI PHIÊN:** \`${round.status}\` — Đang mở nhận cược công khai!`;

    if (cdSec === 1) {
      accent = THEME.CRIMSON_NEON;
      countdownHeadline =
        '🚨 **ĐẾM NGƯỢC CUỐI PHIÊN:** `3` ➔ `2` ➔ **`[ 1 GIÂY CUỐI! ]`** — **SẮP HẾT THỜI GIAN!**';
    } else if (cdSec === 2) {
      accent = THEME.CRIMSON_NEON;
      countdownHeadline =
        '🚨 **ĐẾM NGƯỢC CUỐI PHIÊN:** `3` ➔ **`[ 2 GIÂY ]`** ➔ `1` — **KHẨN TRƯƠNG CHỐT CỬA!**';
    } else if (cdSec === 3) {
      accent = THEME.CRIMSON_NEON;
      countdownHeadline =
        '🚨 **ĐẾM NGƯỢC CUỐI PHIÊN:** **`[ 3 GIÂY ]`** ➔ `2` ➔ `1` — **CHUẨN BỊ KHÓA SỔ!**';
    } else if (cdSec <= 5 || round.notified_5s) {
      accent = THEME.CRIMSON_NEON;
      countdownHeadline =
        '🔥 **ĐẾM NGƯỢC 5 GIÂY CUỐI:** `5 • 4 • 3 • 2 • 1` — **CHUẨN BỊ KHÓA SỔ & MỞ BÁT!**';
    } else if (cdSec <= 10 || round.notified_10s) {
      accent = THEME.AMBER_PULSE;
      countdownHeadline =
        '⚠️ **CẢNH BÁO SẮP KHÓA CƯỢC:** Chỉ còn dưới **10 giây** cuối cùng!';
    } else if (cdSec <= 30 || round.notified_30s) {
      accent = THEME.NEON_GOLD;
      countdownHeadline =
        '⏰ **THÔNG BÁO 30 GIÂY:** Còn nửa chặng cuối — Nhanh tay chọn cửa may mắn!';
    }

    const bannerAtt = buildAssetAttachment(gameMeta.bannerPath, `mp_banner_${round.game_id}.png`);
    const doorsGallery =
      round.game_id === GAME_IDS.BAUCUA
        ? buildMultiplayerBauCuaDoorsGallery(doorStats)
        : round.game_id === GAME_IDS.TAIXIU
          ? buildMultiplayerTaiXiuDoorsGallery(doorStats)
          : buildMultiplayerRaceDoorsGallery(doorStats);

    // Container 1: (1) Banner -> (2) Tên phiên & Round ID -> (3) Người khởi tạo -> (4) Đồng hồ -> (5) Trạng thái -> (6) Hình cửa cược -> (7) Tổng người chơi -> (8) Tổng tiền cược
    const topContainer = createContainer({
      accentColor: accent,
      children: [
        mediaGallery([{ url: bannerAtt.url, description: gameMeta.title }]),
        textDisplay(
          [
            `## ${gameMeta.emoji} PHIÊN ${gameMeta.title} — \`#${round.round_id}\``,
            `👤 **Người khởi tạo phiên:** ${formatStarterDisplay(round)}${round.prev_round_id ? `  •  ⏮️ **Phiên trước:** \`#${round.prev_round_id}\`` : ''}`,
            `⏱️ **ĐỒNG HỒ ĐẾM NGƯỢC:** **<t:${endsUnix}:R>** *(Khóa sổ lúc <t:${endsUnix}:T> • Tổng ${round.duration_sec}s)*`,
            countdownHeadline,
          ].join('\n')
        ),
        separator({ divider: true }),
        mediaGallery(doorsGallery.items),
        textDisplay(
          [
            `👥 **Tổng số người tham gia:** **${round.total_players} người**  •  💰 **Tổng tiền cược:** **${formatVnd(round.total_bet_vnd)}**`,
            `📊 **Tình hình đặt cược trực tiếp trên các cửa:**`,
            buildDoorSummaryLines(round.game_id, doorStats),
          ].join('\n')
        ),
      ],
    });

    // Container 2: (9) Nút chọn cửa -> Phỉnh nhanh -> (10) Nút đặt cược & quản lý cá nhân -> (11) Hướng dẫn luật chơi
    const controlContainer = createContainer({
      accentColor: THEME.NEON_PURPLE,
      children: [
        ...buildDoorActionRows(round.round_id, round.game_id, false),
        buildQuickChipSelectRow(round.round_id, false),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`mp:bet_open:${round.round_id}`)
            .setEmoji('💰')
            .setLabel('Đặt Cược (Nhập Tiền)')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`mp:my_bets:${round.round_id}`)
            .setEmoji('🧾')
            .setLabel('Cược Của Tôi')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`mp:manage:${round.round_id}`)
            .setEmoji('✏️')
            .setLabel('Sửa / Hủy Cược')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`mp:rules:${round.game_id}`)
            .setEmoji('📖')
            .setLabel('Chi Tiết Luật')
            .setStyle(ButtonStyle.Secondary)
        ),
        separator({ divider: false }),
        textDisplay(
          [
            gameMeta.compactRules,
            `-# 💵 Giới hạn cược: ${formatVnd(minBet)} – ${formatVnd(maxBet)} • Chạm trực tiếp vào cửa bên trên để đặt cược nhanh!`,
          ].join('\n')
        ),
      ],
    });

    return buildCv2Payload({
      containers: [topContainer, controlContainer],
      files: [bannerAtt.attachment, ...doorsGallery.files],
      ephemeral,
      clearAttachments,
      allowedMentions: { parse: [] },
    });
  }

  // ==========================================================================
  // TRẠNG THÁI 2: ĐÃ KHÓA SỔ / ĐANG QUAY KẾT QUẢ (`LOCKED` / `DRAWING` / `SETTLING`)
  // ==========================================================================
  if (
    round.status === MP_ROUND_STATUS.LOCKED ||
    round.status === MP_ROUND_STATUS.DRAWING ||
    round.status === MP_ROUND_STATUS.SETTLING
  ) {
    const animAtt = buildAssetAttachment(gameMeta.animPath, gameMeta.animName);
    const drawContainer = createContainer({
      accentColor: THEME.CRIMSON_NEON,
      children: [
        mediaGallery([{ url: animAtt.url, description: `${gameMeta.title} — Đang mở kết quả` }]),
        textDisplay(
          [
            `## 🛑 3 ➔ 2 ➔ 1 ➔ HẾT THỜI GIAN! — \`#${round.round_id}\``,
            `🔒 **TRẠNG THÁI:** \`${round.status}\` — **ĐÃ KHÓA SỔ NHẬN CƯỢC & ĐANG LẮC BÁT MỞ KẾT QUẢ CHUNG!**`,
            `👤 **Người mở phiên:** ${formatStarterDisplay(round)}  •  👥 **Tham gia:** **${round.total_players} người**  •  💰 **Tổng quỹ cược:** **${formatVnd(round.total_bet_vnd)}**`,
            '',
            buildDoorSummaryLines(round.game_id, doorStats),
            '',
            '-# ⏳ Toàn bộ người chơi trong phiên sẽ nhận CÙNG MỘT kết quả ngẫu nhiên công bằng trong giây lát...',
          ].join('\n')
        ),
        ...buildDoorActionRows(round.round_id, round.game_id, true),
      ],
    });

    return buildCv2Payload({
      containers: [drawContainer],
      files: [animAtt.attachment],
      ephemeral,
      clearAttachments,
      allowedMentions: { parse: [] },
    });
  }

  // ==========================================================================
  // TRẠNG THÁI 3: PHIÊN BỊ HỦY & HOÀN TIỀN 100% (`CANCELLED`)
  // ==========================================================================
  if (round.status === MP_ROUND_STATUS.CANCELLED) {
    const cancelBanner = buildAssetAttachment(gameMeta.bannerPath, `mp_cancel_${round.game_id}.png`);
    const endedUnix = Math.floor(Number(round.completed_at || Date.now()) / 1000);
    const box = createContainer({
      accentColor: THEME.CRIMSON_NEON,
      children: [
        mediaGallery([{ url: cancelBanner.url, description: 'Phiên đã dừng & hoàn tiền 100%' }]),
        textDisplay(
          [
            `## 🛑 PHIÊN ĐÃ DỪNG & HOÀN TIỀN 100% — \`#${round.round_id}\``,
            `🎮 **Trò chơi:** ${gameMeta.emoji} **${gameMeta.title}**`,
            `👮 **Dừng bởi Quản trị viên:** ${round.cancelled_by ? `<@${round.cancelled_by}>` : 'Hệ thống'}`,
            `📝 **Lý do:** ${round.cancel_reason || 'Quản trị viên dừng phiên'}`,
            `💸 **Hoàn trả tự động:** Đã hoàn **100%** tiền cược về ví cho toàn bộ người tham gia (**${round.total_players} người** • **${formatVnd(round.total_bet_vnd)}**).`,
            `🕒 **Thời điểm hủy:** <t:${endedUnix}:F> (<t:${endedUnix}:R>)`,
            buildAutoNextStatusLines(round, gameMeta),
          ]
            .filter(Boolean)
            .join('\n')
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`mp:history:${round.game_id}`)
            .setEmoji('📜')
            .setLabel('Xem lịch sử phiên')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`mp:start_next:${round.game_id}`)
            .setEmoji('🚀')
            .setLabel('Mở phiên tiếp theo')
            .setStyle(ButtonStyle.Success)
        ),
      ],
    });

    return buildCv2Payload({
      containers: [box],
      files: [cancelBanner.attachment],
      ephemeral,
      clearAttachments,
      allowedMentions: { parse: [] },
    });
  }

  // ==========================================================================
  // TRẠNG THÁI 4: KẾT THÚC HOÀN TẤT — BẢNG KẾT QUẢ CHÍNH THỨC CHUNG (Mục 8)
  // ==========================================================================
  const result = round.result || {};
  const completedUnix = Math.floor(Number(round.completed_at || Date.now()) / 1000);

  const isSpecial =
    (round.game_id === GAME_IDS.BAUCUA && result.isTriple) ||
    (round.game_id === GAME_IDS.TAIXIU && result.houseWins);

  const topBannerRel =
    round.game_id === GAME_IDS.TAIXIU && !isSpecial
      ? ASSET_PATHS.TAIXIU_RESULT_BOARD
      : getDedicatedOutcomeBannerRelPath(round.game_id, {
          won: !result.houseWins,
          special: isSpecial,
        });
  const topBannerAtt = buildAssetAttachment(topBannerRel, `mp_res_banner_${round.game_id}.png`);

  let resultHeadline = '';
  let rollGallery = { files: [], items: [] };

  if (round.game_id === GAME_IDS.BAUCUA) {
    const rolledIds = result.rolledIds || ['bau', 'cua', 'tom'];
    rollGallery = buildBauCua3dDiceRollGallery(rolledIds);
    const facesStr = rolledIds
      .map((id) => {
        const m = BAUCUA_MASCOT_MAP[id];
        return m ? `${m.emoji} **${m.name}**` : id;
      })
      .join('  •  ');
    resultHeadline = [
      `🎯 **Kết quả chính thức (3 xúc xắc chung):** ${facesStr}`,
      result.isTriple
        ? '🌟 **ĐẠI BÃO ĐỒNG NHẤT 3 XÚC XẮC!** Cửa trúng nổ **4x tổng tiền hoàn trả**!'
        : '✨ **Tỷ lệ trả thưởng:** 1 mặt trùng = **2x** • 2 mặt trùng = **3x** • 3 mặt trùng = **4x**',
    ].join('\n');
  } else if (round.game_id === GAME_IDS.TAIXIU) {
    const dice = result.dice || [1, 2, 3];
    rollGallery = buildDiceGalleryAssets(dice, 'mp_tx_final');
    const outcomeBadge = result.houseWins
      ? `👑 **BỘ BA ĐỒNG NHẤT (TỔNG ${result.sum}) — NHÀ CÁI THẮNG!**`
      : result.outcome === 'tai'
        ? `🔴 **NỔ CỬA TÀI (${result.sum} ĐIỂM)** — Trả thưởng **2x**!`
        : `🔵 **NỔ CỬA XỈU (${result.sum} ĐIỂM)** — Trả thưởng **2x**!`;
    resultHeadline = [
      `🎯 **Kết quả 3 viên xúc xắc:** \`[ ${dice[0]} ]\` + \`[ ${dice[1]} ]\` + \`[ ${dice[2]} ]\` = **${result.sum} nút**`,
      outcomeBadge,
    ].join('\n');
  } else {
    const rankIds = result.rankingIds || RACE_ANIMALS.map((a) => a.id);
    const podiumFiles = [];
    const podiumItems = [];
    rankIds.slice(0, 3).forEach((id, idx) => {
      const a = RACE_ANIMAL_MAP[id] || RACE_ANIMALS[0];
      const att = buildAssetAttachment(ASSET_PATHS.RACE_ANIMAL[id], `mp_podium_${idx + 1}_${id}.png`);
      podiumFiles.push(att.attachment);
      podiumItems.push({ url: att.url, description: `Hạng #${idx + 1}: ${a.name}` });
    });
    rollGallery = { files: podiumFiles, items: podiumItems };
    const podiumStr = rankIds
      .map((id, idx) => {
        const a = RACE_ANIMAL_MAP[id];
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        return `${medal} ${a ? `${a.emoji} **${a.name}**` : id}`;
      })
      .join('  •  ');
    resultHeadline = [
      `🎯 **Quán quân về đích Hạng #1:** ${formatChoiceLabel(GAME_IDS.RACE, result.winnerId)} *(Nhận **4.5x** tiền cược)*`,
      `🏁 **Thứ hạng chung cuộc:** ${podiumStr}`,
    ].join('\n');
  }

  const winnersText =
    winners.length > 0
      ? winners
          .slice(0, 10)
          .map(
            (w, idx) =>
              `${idx + 1}. <@${w.userId}> — Nhận **${formatVnd(w.totalPayout)}** *(Lãi ròng: **+${formatVnd(w.totalNet)}**)*`
          )
          .join('\n') +
        (winners.length > 10 ? `\n*...và ${winners.length - 10} người thắng khác*` : '')
      : '_Không có người chơi thắng ròng ở phiên này._';

  const losersLines = [];
  for (const l of losers.slice(0, 10)) {
    losersLines.push(
      `• <@${l.userId}> — **-${formatVnd(Math.abs(l.totalNet))}** *(Cược: ${formatVnd(l.totalBet)})*`
    );
  }
  if (losers.length > 10) {
    losersLines.push(`*...và ${losers.length - 10} người chơi khác*`);
  }
  for (const b of breakEven.slice(0, 5)) {
    losersLines.push(`• <@${b.userId}> — **Hòa vốn 0 ₫** *(Hoàn ${formatVnd(b.totalPayout)})*`);
  }
  const losersText =
    round.total_players === 0
      ? '_Phiên kết thúc không có người đặt cược — Không phát sinh giao dịch._'
      : losersLines.length > 0
        ? losersLines.join('\n')
        : '_Không có người chơi thua ở phiên này!_';

  const resChildren = [
    mediaGallery([{ url: topBannerAtt.url, description: `Kết quả phiên #${round.round_id}` }]),
    textDisplay(
      [
        `## 🏆 KẾT QUẢ PHIÊN ${gameMeta.title} — \`#${round.round_id}\``,
        `👤 **Người mở phiên:** ${formatStarterDisplay(round)}  •  🕒 **Kết thúc:** <t:${completedUnix}:F> (<t:${completedUnix}:R>)`,
        resultHeadline,
      ].join('\n')
    ),
  ];

  if (rollGallery.items.length > 0) {
    resChildren.push(mediaGallery(rollGallery.items));
  }

  const wonDisplay =
    Number(round.total_won_vnd) > 0 ? `+${formatVnd(round.total_won_vnd)}` : '0 VNĐ';
  const lostDisplay =
    Number(round.total_lost_vnd) > 0 ? `-${formatVnd(round.total_lost_vnd)}` : '0 VNĐ';
  const isAutoStoppedRoom = round.auto_next_state === 'AUTO_STOPPED_NO_PLAYERS';
  const autoNextBlock = buildAutoNextStatusLines(round, gameMeta);
  resChildren.push(
    separator({ divider: true }),
    textDisplay(
      [
        `📊 **THỐNG KÊ TỔNG KẾT PHIÊN \`#${round.round_id}\`:**`,
        `• 👥 **Tổng số người chơi:** **${round.total_players} người**`,
        `• 💰 **Tổng tiền cược:** **${formatVnd(round.total_bet_vnd)}**`,
        `• 💳 **Tổng tiền thanh toán:** **${formatVnd(round.total_payout_vnd)}**`,
        `• 🟢 **Tổng tiền thắng (lãi ròng):** **${wonDisplay}**  •  🔴 **Tổng tiền thua:** **${lostDisplay}**`,
        '',
        `🏅 **DANH SÁCH NGƯỜI THẮNG (${winners.length}):**`,
        winnersText,
        '',
        `📉 **DANH SÁCH NGƯỜI THUA / HÒA (${losers.length + breakEven.length}):**`,
        losersText,
        ...(autoNextBlock ? [autoNextBlock] : []),
      ].join('\n')
    ),
    separator({ divider: false }),
    // 4 nút bắt buộc tại Mục 8 — Nút `START` / `Mở phiên tiếp theo` CÔNG KHAI CHO TẤT CẢ THÀNH VIÊN!
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mp:detail:${round.round_id}`)
        .setEmoji('🧾')
        .setLabel('Xem chi tiết cược')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`mp:history:${round.game_id}`)
        .setEmoji('📜')
        .setLabel('Xem lịch sử phiên')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mp:leaderboard:${round.game_id}`)
        .setEmoji('🏆')
        .setLabel('Xem bảng xếp hạng')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mp:start_next:${round.game_id}`)
        .setEmoji(isAutoStoppedRoom ? '▶️' : '🚀')
        .setLabel(isAutoStoppedRoom ? 'START — Mở lại phòng chơi' : 'Mở phiên tiếp theo')
        .setStyle(ButtonStyle.Success)
    )
  );

  const resContainer = createContainer({
    accentColor: isAutoStoppedRoom
      ? THEME.AMBER_PULSE
      : isSpecial
        ? THEME.NEON_GOLD
        : THEME.NEON_CYAN,
    children: resChildren,
  });

  return buildCv2Payload({
    containers: [resContainer],
    files: [topBannerAtt.attachment, ...rollGallery.files],
    ephemeral,
    clearAttachments,
    allowedMentions: { parse: [] },
  });
}

// ============================================================================
// Các Bảng Riêng Tư (Ephemeral) cho Từng Người Chơi (Biên lai, Sửa/Hủy, Lịch sử, BXH)
// ============================================================================

function buildUserRoundReceiptPayload(
  snapshot,
  userId,
  systems,
  notice = null,
  { ephemeral = true, clearAttachments = false } = {}
) {
  const { round } = snapshot;
  const userBets = systems.multiplayerRoundSystem.getUserRoundBets(round.round_id, userId);
  const userProfile = systems.economySystem.ensureUser(userId);
  const canModify =
    round.status === MP_ROUND_STATUS.BETTING &&
    Date.now() < Number(round.ends_at) &&
    systems.multiplayerRoundSystem.canUserModifyOwnBet(userId);

  const totalUserBet = userBets
    .filter((b) => b.status !== 'CANCELLED')
    .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

  const slipLines =
    userBets.length > 0
      ? userBets
          .map((b, i) => {
            const extra =
              b.status === 'SETTLED'
                ? ` ➔ Hoàn trả: **${formatVnd(b.payout)}** (${b.net >= 0 ? `+${formatVnd(b.net)}` : formatVnd(b.net)})`
                : b.status === 'REFUNDED'
                  ? ` ➔ **Đã hoàn 100% (${formatVnd(b.amount)})**`
                  : '';
            return `${i + 1}. \`#${b.bet_id}\` • ${formatChoiceLabel(round.game_id, b.choice)} — **${formatVnd(b.amount)}** (\`${b.status}\`)${extra}`;
          })
          .join('\n')
      : '_Bạn chưa có vé cược nào trong phiên này._';

  const children = [
    textDisplay(
      [
        `### 🧾 VÉ CƯỢC CÁ NHÂN CỦA BẠN — PHIÊN \`#${round.round_id}\``,
        notice ? `> ${notice}\n` : '',
        `💼 **Số dư ví khả dụng:** **${formatVnd(userProfile.wallet)}**  •  🎯 **Tổng bạn đã đặt:** **${formatVnd(totalUserBet)}**`,
        `📡 **Trạng thái phiên:** \`${round.status}\``,
        '',
        slipLines,
      ]
        .filter(Boolean)
        .join('\n')
    ),
  ];

  const activeBets = userBets.filter((b) => b.status === 'ACTIVE');
  if (canModify && activeBets.length > 0) {
    children.push(separator({ divider: false }));

    const editSelect = new StringSelectMenuBuilder()
      .setCustomId(`mp:edit_pick:${round.round_id}`)
      .setPlaceholder('✏️ Chọn 1 vé cược bên dưới để SỬA SỐ TIỀN...')
      .addOptions(
        activeBets.slice(0, 10).map((b) => ({
          label: `Sửa ${formatChoiceLabel(round.game_id, b.choice).replace(/^[^\s]+\s/, '')}: ${formatVnd(b.amount)}`,
          value: b.bet_id,
          emoji: '✏️',
          description: `Mã vé: ${b.bet_id}`,
        }))
      );
    children.push(new ActionRowBuilder().addComponents(editSelect));

    const cancelSelect = new StringSelectMenuBuilder()
      .setCustomId(`mp:cancel_pick:${round.round_id}`)
      .setPlaceholder('🗑️ Chọn 1 vé cược bên dưới để HỦY & HOÀN TIỀN 100%...')
      .addOptions(
        activeBets.slice(0, 10).map((b) => ({
          label: `Hủy ${formatChoiceLabel(round.game_id, b.choice).replace(/^[^\s]+\s/, '')}: Hoàn ${formatVnd(b.amount)}`,
          value: b.bet_id,
          emoji: '🗑️',
          description: `Mã vé: ${b.bet_id}`,
        }))
      );
    children.push(new ActionRowBuilder().addComponents(cancelSelect));

    children.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mp:cancel_all:${round.round_id}`)
          .setEmoji('♻️')
          .setLabel('Hủy Toàn Bộ Cược Của Tôi')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  const box = createContainer({ accentColor: THEME.NEON_CYAN, children });
  return buildCv2Payload({
    containers: [box],
    ephemeral,
    clearAttachments,
    allowedMentions: { parse: [] },
  });
}

function buildRoundHistoryPayload(guildId, gameId, systems, { ephemeral = true } = {}) {
  const rows = systems.multiplayerRoundSystem.getRecentRounds(guildId, gameId, 10);
  const title = gameId && MP_GAME_META[gameId] ? MP_GAME_META[gameId].title : 'TẤT CẢ TRÒ CHƠI';

  const lines =
    rows.length > 0
      ? rows
          .map((r, idx) => {
            const res = r.result || {};
            let resShort = r.status === 'CANCELLED' ? '🛑 Đã hủy & hoàn tiền' : '';
            if (r.status === 'COMPLETED') {
              if (r.game_id === GAME_IDS.BAUCUA) {
                resShort = (res.rolledIds || [])
                  .map((id) => BAUCUA_MASCOT_MAP[id]?.emoji || id)
                  .join(' ');
              } else if (r.game_id === GAME_IDS.TAIXIU) {
                const d = res.dice || [];
                const lbl = res.houseWins ? 'BÃO 3/18 (Nhà cái)' : (res.outcome || '').toUpperCase();
                resShort = `[${d.join('-')}] = ${res.sum} (${lbl})`;
              } else if (r.game_id === GAME_IDS.RACE) {
                const winA = RACE_ANIMAL_MAP[res.winnerId];
                resShort = winA ? `🥇 ${winA.emoji} ${winA.name}` : res.winnerId;
              }
            }
            const tUnix = Math.floor(Number(r.completed_at || r.created_at) / 1000);
            return `${idx + 1}. \`#${r.round_id}\` (${r.game_id.toUpperCase()}) • ${resShort} • 👥 ${r.total_players} • 💰 ${formatVnd(r.total_bet_vnd)} • <t:${tUnix}:R>`;
          })
          .join('\n')
      : '_Chưa có phiên nào kết thúc trên máy chủ này._';

  const box = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [textDisplay([`### 📜 LỊCH SỬ 10 PHIÊN GẦN NHẤT — ${title}`, '', lines].join('\n'))],
  });
  return buildCv2Payload({
    containers: [box],
    ephemeral,
    allowedMentions: { parse: [] },
  });
}

function buildMultiplayerLeaderboardPayload(guildId, gameId, systems, { ephemeral = true } = {}) {
  const rows = systems.multiplayerRoundSystem.getMultiplayerLeaderboard(guildId, gameId, 10);
  const title = gameId && MP_GAME_META[gameId] ? MP_GAME_META[gameId].title : 'TOÀN SERVER';
  const lines =
    rows.length > 0
      ? rows
          .map((r, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
            const net = Number(r.net_profit) || 0;
            const sign = net >= 0 ? `+${formatVnd(net)}` : formatVnd(net);
            return `${medal} <@${r.user_id}> — Lãi ròng: **${sign}** *(Cược ${r.rounds_played} phiên: ${formatVnd(r.total_wagered)})*`;
          })
          .join('\n')
      : '_Chưa có dữ liệu xếp hạng phiên cược chung trên máy chủ này._';

  const box = createContainer({
    accentColor: THEME.NEON_GOLD,
    children: [
      textDisplay([`### 🏆 BẢNG XẾP HẠNG CAO THỦ PHIÊN CHUNG — ${title}`, '', lines].join('\n')),
    ],
  });
  return buildCv2Payload({
    containers: [box],
    ephemeral,
    allowedMentions: { parse: [] },
  });
}

// ============================================================================
// Hàm Dùng Chung Mở Phiên Cho Cả `/game start` Lẫn Nút `Mở phiên tiếp theo` (PUBLIC 100%)
// ============================================================================

export async function handlePublicStartRoundInteraction(
  interaction,
  systems,
  gameId,
  { initialChoice = null, initialBet = null } = {}
) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '❌ Yêu Cầu Trong Máy Chủ',
        body: 'Phiên cược chung nhiều người chơi chỉ hoạt động bên trong kênh máy chủ Discord.',
        accentColor: THEME.CRIMSON_NEON,
        ephemeral: true,
      })
    );
    return;
  }

  // Nếu người chơi truyền mức phỉnh nhanh qua lệnh (VD: /baucua tien_cuoc_moi_cua:10000), lưu phỉnh 1 chạm cho họ!
  if (Number.isFinite(initialBet) && initialBet > 0 && !initialChoice) {
    systems.multiplayerRoundSystem.setUserChipPreference(interaction.user.id, initialBet);
  }

  // Kiểm tra kênh trò chơi đã cấu hình (nếu Admin có thiết lập kênh riêng cho game này)
  const allowedChannels = systems.db.getAllowedGameChannels(guildId, gameId) || [];
  const parentId = interaction.channel?.parentId ?? null;
  const inAllowedChannel =
    allowedChannels.length === 0 ||
    systems.db.isAllowedGameChannel(guildId, gameId, interaction.channelId, parentId);
  const targetChannelId = inAllowedChannel ? interaction.channelId : allowedChannels[0];

  const startRes = await systems.multiplayerRoundSystem.startRound({
    guildId,
    channelId: targetChannelId,
    gameId,
    userId: interaction.user.id,
    username: interaction.user.username,
  });

  if (!startRes.ok) {
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '⚠️ Không Thể Mở Phiên',
        body: startRes.error,
        accentColor: THEME.CRIMSON_NEON,
        ephemeral: true,
      })
    );
    return;
  }

  const activeRoundId = startRes.round?.round_id || startRes.snapshot?.round?.round_id;
  let autoBetResult = null;
  if (initialChoice && Number.isFinite(initialBet) && initialBet > 0 && activeRoundId) {
    autoBetResult = await systems.multiplayerRoundSystem.placeBet({
      roundId: activeRoundId,
      userId: interaction.user.id,
      username: interaction.user.username,
      choice: initialChoice,
      amount: initialBet,
    });
  }

  // Nếu đã có phiên đang chạy -> KHÔNG tạo phiên trùng: đặt cược thẳng (nếu có truyền cửa + tiền) hoặc hiển thị phiên hiện tại!
  if (!startRes.created) {
    if (autoBetResult) {
      if (!autoBetResult.ok) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⚠️ Không Thể Đặt Cược Vào Phiên Chung',
            body: autoBetResult.error,
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
        return;
      }
      const freshSnap = systems.multiplayerRoundSystem.getRoundSnapshot(activeRoundId);
      await safeReplyV2(
        interaction,
        buildUserRoundReceiptPayload(
          freshSnap,
          interaction.user.id,
          systems,
          `✅ Đã đặt cược **${formatVnd(initialBet)}** vào cửa **${String(initialChoice).toUpperCase()}** của phiên chung \`#${activeRoundId}\`!`
        )
      );
      return;
    }

    const snap = systems.multiplayerRoundSystem.getRoundSnapshot(activeRoundId) || startRes.snapshot;
    const activePayload = buildMultiplayerBoardPayload(snap, systems, {
      isEdit: false,
      ephemeral: true,
    });
    const infoBox = createContainer({
      accentColor: THEME.NEON_CYAN,
      children: [
        textDisplay(
          `🟢 **Đang có phiên \`#${snap.round.round_id}\` hoạt động tại <#${snap.round.channel_id}>!** Bạn có thể đặt cược trực tiếp ngay bên dưới hoặc tại bảng chung của kênh:`
        ),
      ],
    });
    await safeReplyV2(
      interaction,
      buildCv2Payload({
        containers: [infoBox, ...activePayload.components].slice(0, 10),
        files: activePayload.files,
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
    );
    return;
  }

  const latestSnapshot =
    systems.multiplayerRoundSystem.getRoundSnapshot(activeRoundId) || startRes.snapshot;
  const boardPayload = buildMultiplayerBoardPayload(latestSnapshot, systems, { isEdit: false });

  // Trường hợp người chơi mở phiên ngay tại kênh trò chơi (VD: gõ /baucua ngay trong #bau_cua)
  if (targetChannelId === interaction.channelId) {
    const replyRes = await interaction.reply({
      ...boardPayload,
      withResponse: true,
    });
    const sentMsg = replyRes?.resource?.message ?? replyRes ?? null;
    if (sentMsg) {
      systems.multiplayerRoundSystem.registerMessageRef(startRes.round.round_id, sentMsg);
    }
    if (autoBetResult && !autoBetResult.ok && typeof interaction.followUp === 'function') {
      await interaction
        .followUp(
          buildCv2NoticePayload({
            title: '⚠️ Đã Mở Phiên Chung Nhưng Chưa Thể Đặt Cược Tự Động',
            body: autoBetResult.error,
            accentColor: THEME.AMBER_PULSE,
            ephemeral: true,
          })
        )
        .catch(() => {});
    }
    return;
  }

  // Trường hợp người chơi gõ `/game start` ở kênh khác -> tự động đăng bảng phiên vào đúng kênh trò chơi đã cấu hình!
  let targetChannel =
    interaction.guild?.channels?.cache?.get(targetChannelId) ||
    interaction.client?.channels?.cache?.get(targetChannelId) ||
    null;
  if (!targetChannel && interaction.client?.channels?.fetch) {
    targetChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
  }

  if (targetChannel && typeof targetChannel.send === 'function') {
    const sentMsg = await targetChannel.send(boardPayload);
    systems.multiplayerRoundSystem.registerMessageRef(startRes.round.round_id, sentMsg);

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🚀 Đã Mở Phiên Cược Chung Mới!',
        body: `✅ Đã đăng bảng phiên \`#${startRes.round.round_id}\` vào kênh trò chơi <#${targetChannelId}>!\n👉 Mời bạn và mọi người qua <#${targetChannelId}> để đặt cược ngay!`,
        accentColor: THEME.CYBER_EMERALD,
        ephemeral: true,
      })
    );
    return;
  }

  const fallbackRes = await interaction.reply({
    ...boardPayload,
    withResponse: true,
  });
  const fallbackMsg = fallbackRes?.resource?.message ?? fallbackRes ?? null;
  if (fallbackMsg) {
    systems.multiplayerRoundSystem.registerMessageRef(startRes.round.round_id, fallbackMsg);
  }
}

// ============================================================================
// Định Nghĩa Slash Command `/game` (KHÔNG setDefaultMemberPermissions — 100% PUBLIC START)
// ============================================================================

export const gameMultiplayerCommand = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('Hệ thống Phiên Đặt Cược Chung Nhiều Người Chơi (Mọi thành viên đều mở được phiên!)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Mở phiên đặt cược chung mới cho toàn server (Mọi thành viên đều dùng được)')
        .addStringOption((opt) =>
          opt
            .setName('tro_choi')
            .setDescription('Chọn trò chơi mở phiên chung')
            .setRequired(true)
            .addChoices(
              { name: '🦀 Bầu Cua 3D (60 giây)', value: GAME_IDS.BAUCUA },
              { name: '🎲 Tài Xỉu 3D (60 giây)', value: GAME_IDS.TAIXIU },
              { name: '🏇 Đua Thú 3D (90 giây)', value: GAME_IDS.RACE }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Xem trạng thái các phiên cược đang hoạt động trong server')
        .addStringOption((opt) =>
          opt
            .setName('tro_choi')
            .setDescription('Lọc theo trò chơi')
            .addChoices(
              { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
              { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
              { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Xem lịch sử kết quả các phiên cược chung gần nhất')
        .addStringOption((opt) =>
          opt
            .setName('tro_choi')
            .setDescription('Lọc theo trò chơi')
            .addChoices(
              { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
              { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
              { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('stop')
        .setDescription('[ADMIN/OWNER] Dừng phiên đang chạy và hoàn 100% tiền cược tự động')
        .addStringOption((opt) =>
          opt
            .setName('tro_choi')
            .setDescription('Trò chơi cần dừng phiên')
            .addChoices(
              { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
              { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
              { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
            )
        )
        .addStringOption((opt) =>
          opt.setName('round_id').setDescription('Mã Round ID cụ thể (tùy chọn)')
        )
        .addStringOption((opt) =>
          opt.setName('ly_do').setDescription('Lý do dừng phiên')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('extend')
        .setDescription('[ADMIN/OWNER] Gia hạn thêm thời gian đặt cược khi phiên đang BETTING')
        .addIntegerOption((opt) =>
          opt
            .setName('so_giay')
            .setDescription('Số giây cộng thêm (5 – 300 giây)')
            .setRequired(true)
            .setMinValue(5)
            .setMaxValue(300)
        )
        .addStringOption((opt) =>
          opt
            .setName('tro_choi')
            .setDescription('Trò chơi cần gia hạn')
            .addChoices(
              { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
              { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
              { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
            )
        )
        .addStringOption((opt) =>
          opt.setName('round_id').setDescription('Mã Round ID cụ thể (tùy chọn)')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('[ADMIN/OWNER] Xem hoặc chỉnh thời gian đếm ngược, giới hạn cược & nhiều bàn')
        .addStringOption((opt) =>
          opt
            .setName('tro_choi')
            .setDescription('Trò chơi cần chỉnh thời gian đếm ngược')
            .addChoices(
              { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
              { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
              { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
            )
        )
        .addIntegerOption((opt) =>
          opt
            .setName('thoi_gian_giay')
            .setDescription('Thời gian đặt cược mỗi phiên (10 – 600 giây)')
            .setMinValue(10)
            .setMaxValue(600)
        )
        .addIntegerOption((opt) =>
          opt.setName('min_bet').setDescription('Mức cược tối thiểu VNĐ').setMinValue(10)
        )
        .addIntegerOption((opt) =>
          opt.setName('max_bet').setDescription('Mức cược tối đa VNĐ').setMinValue(100)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('cho_sua_huy')
            .setDescription('Cho phép người chơi sửa/hủy cược khi phiên còn mở')
        )
        .addBooleanOption((opt) =>
          opt
            .setName('multi_table')
            .setDescription('[CHỈ OWNER] Bật/tắt chế độ mở nhiều bàn cược cùng lúc')
        )
    )
    .addSubcommandGroup((grp) =>
      grp
        .setName('auto')
        .setDescription('Quản lý tự động mở phiên tiếp theo (Auto Next Round)')
        .addSubcommand((sub) =>
          sub.setName('status').setDescription('Xem trạng thái Auto Next Round hiện tại')
        )
        .addSubcommand((sub) =>
          sub
            .setName('on')
            .setDescription('[ADMIN/OWNER] Bật tự động mở phiên tiếp theo')
            .addStringOption((opt) =>
              opt
                .setName('tro_choi')
                .setDescription('Áp dụng cho trò cụ thể (bỏ trống = bật chung)')
                .addChoices(
                  { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
                  { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
                  { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
                )
            )
            .addBooleanOption((opt) =>
              opt
                .setName('khi_huy_phien')
                .setDescription('Cho phép tự mở phiên mới sau khi phiên trước bị CANCELLED')
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('off')
            .setDescription('[ADMIN/OWNER] Tắt tự động mở phiên tiếp theo')
            .addStringOption((opt) =>
              opt
                .setName('tro_choi')
                .setDescription('Tắt riêng cho trò cụ thể (bỏ trống = tắt chung)')
                .addChoices(
                  { name: '🦀 Bầu Cua 3D', value: GAME_IDS.BAUCUA },
                  { name: '🎲 Tài Xỉu 3D', value: GAME_IDS.TAIXIU },
                  { name: '🏇 Đua Thú 3D', value: GAME_IDS.RACE }
                )
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('delay')
            .setDescription('[ADMIN/OWNER] Đổi thời gian nghỉ giữa hai phiên')
            .addIntegerOption((opt) =>
              opt
                .setName('so_giay')
                .setDescription('Số giây nghỉ trước khi mở phiên mới (1 – 600 giây)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(600)
            )
        )
    ),

  async execute(interaction, systems) {
    const group = interaction.options?.getSubcommandGroup?.(false) ?? null;
    const sub = interaction.options.getSubcommand();

    // NHÓM LỆNH `/game auto status | on | off | delay`
    if (group === 'auto') {
      if (sub === 'status') {
        const cfg = systems.multiplayerRoundSystem.getAutoNextConfig(interaction.guildId);
        const durations = systems.multiplayerRoundSystem.getSettingsSummary(interaction.guildId).durations;
        const pending = systems.multiplayerRoundSystem.getPendingAutoNextRounds(interaction.guildId);
        const pendingLines =
          pending.length > 0
            ? pending.map((r) => {
                const nextUnix = Math.floor(Number(r.next_round_at) / 1000);
                return `• Phiên vừa xong \`#${r.round_id}\` (${r.game_id.toUpperCase()}) ➡️ Mở phiên kế tiếp <t:${nextUnix}:R>`;
              })
            : ['_Hiện không có phiên nào đang trong thời gian nghỉ chờ mở vòng mới._'];

        const threshold = systems.multiplayerRoundSystem.getAutoStopThreshold();
        const fmtGameAutoLine = (emoji, label, dur, gmId) => {
          const idle = cfg.idleStates?.[gmId] || { emptyStreak: 0, autoPaused: false };
          if (idle.autoPaused) {
            const lastTag = idle.lastRoundId ? ` • Cuối: \`#${idle.lastRoundId}\`` : '';
            return `• ${emoji} **${label} (${dur}s cược):** \`⏸️ TẠM NGỪNG (Vắng ${idle.emptyStreak}/${threshold} phiên)\`${lastTag}`;
          }
          return `• ${emoji} **${label} (${dur}s cược):** \`${cfg.games[gmId] ? 'BẬT' : 'TẮT'}\` *(Chuỗi vắng: \`${idle.emptyStreak}/${threshold}\`)*`;
        };

        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🔄 Trạng Thái Auto Next Round & Auto Stop',
            body: [
              `• ⚡ **Tự động mở phiên tiếp theo:** **${cfg.enabled ? '🟢 ĐANG BẬT' : '🔴 ĐANG TẮT'}**`,
              `• ⏳ **Thời gian nghỉ giữa hai phiên:** **${cfg.delaySec} giây**  •  ⏸️ **Tự ngắt khi vắng:** **${threshold} phiên liên tiếp**`,
              fmtGameAutoLine('🦀', 'Bầu Cua', durations.baucua, GAME_IDS.BAUCUA),
              fmtGameAutoLine('🎲', 'Tài Xỉu', durations.taixiu, GAME_IDS.TAIXIU),
              fmtGameAutoLine('🏇', 'Đua Thú', durations.race, GAME_IDS.RACE),
              `• 🛑 **Tự mở lại sau khi hủy phiên (CANCELLED):** \`${cfg.allowOnCancelled ? 'CHO PHÉP' : 'KHÔNG'}\``,
              '',
              '📡 **Lịch chờ mở phiên tiếp theo:**',
              ...pendingLines,
            ].join('\n'),
            accentColor: cfg.enabled ? THEME.CYBER_EMERALD : THEME.AMBER_PULSE,
            ephemeral: true,
          })
        );
        return;
      }

      // Các lệnh cấu hình `/game auto on | off | delay`: CHỈ OWNER / ADMIN!
      if (!hasBotRole(systems.db, interaction.user.id, BOT_ROLES.ADMIN)) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⛔ Không Đủ Quyền Cấu Hình',
            body: 'Chỉ **ADMIN** hoặc **OWNER** mới được sử dụng các lệnh cấu hình Auto Next Round (`/game auto on | off | delay`)!',
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
        return;
      }

      if (sub === 'on') {
        const gameId = interaction.options?.getString?.('tro_choi') || null;
        const onCancelled = interaction.options?.getBoolean?.('khi_huy_phien') ?? null;
        const res = await systems.multiplayerRoundSystem.updateAutoNextSettings({
          guildId: interaction.guildId,
          actorId: interaction.user.id,
          enabled: gameId ? null : true,
          gameId,
          gameEnabled: gameId ? true : null,
          allowOnCancelled: onCancelled,
        });
        if (!res.ok) {
          await safeReplyV2(
            interaction,
            buildCv2NoticePayload({
              title: '⚠️ Không Thể Bật Auto Next',
              body: res.error,
              accentColor: THEME.CRIMSON_NEON,
              ephemeral: true,
            })
          );
          return;
        }
        const cfg = res.config;
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🟢 Đã Bật Auto Next Round',
            body: [
              `✅ **Đã cập nhật:** ${res.changes.join(' • ')}`,
              `• ⚡ **Trạng thái chung:** \`${cfg.enabled ? 'BẬT' : 'TẮT'}\`  •  ⏳ **Thời gian nghỉ:** \`${cfg.delaySec}s\``,
              `• 🎮 **Trò áp dụng:** Bầu Cua \`${cfg.games.baucua ? 'BẬT' : 'TẮT'}\` • Tài Xỉu \`${cfg.games.taixiu ? 'BẬT' : 'TẮT'}\` • Đua Thú \`${cfg.games.race ? 'BẬT' : 'TẮT'}\``,
            ].join('\n'),
            accentColor: THEME.CYBER_EMERALD,
            ephemeral: true,
          })
        );
        return;
      }

      if (sub === 'off') {
        const gameId = interaction.options?.getString?.('tro_choi') || null;
        const res = await systems.multiplayerRoundSystem.updateAutoNextSettings({
          guildId: interaction.guildId,
          actorId: interaction.user.id,
          enabled: gameId ? null : false,
          gameId,
          gameEnabled: gameId ? false : null,
        });
        if (!res.ok) {
          await safeReplyV2(
            interaction,
            buildCv2NoticePayload({
              title: '⚠️ Không Thể Tắt Auto Next',
              body: res.error,
              accentColor: THEME.CRIMSON_NEON,
              ephemeral: true,
            })
          );
          return;
        }
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🔴 Đã Tắt Auto Next Round',
            body: [
              `✅ **Đã cập nhật:** ${res.changes.join(' • ')}`,
              res.cancelledPendingIds.length > 0
                ? `⏹️ Đã hủy lịch chờ mở phiên tiếp theo của: ${res.cancelledPendingIds.map((id) => `\`#${id}\``).join(', ')}.`
                : 'ℹ️ Các phiên đang nhận cược (`BETTING`) vẫn tiếp tục hoạt động bình thường.',
              '👉 Thành viên vẫn có thể dùng `/game start` để mở phiên mới thủ công bất kỳ lúc nào!',
            ].join('\n'),
            accentColor: THEME.AMBER_PULSE,
            ephemeral: true,
          })
        );
        return;
      }

      if (sub === 'delay') {
        const sec = interaction.options.getInteger('so_giay', true);
        const res = await systems.multiplayerRoundSystem.updateAutoNextSettings({
          guildId: interaction.guildId,
          actorId: interaction.user.id,
          delaySec: sec,
        });
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: res.ok ? '⏳ Đã Cập Nhật Thời Gian Nghỉ Giữa Hai Phiên' : '⛔ Lỗi Cấu Hình',
            body: res.ok
              ? `✅ Thời gian nghỉ chờ trước khi tự động mở phiên mới hiện là **${res.config.delaySec} giây**!`
              : res.error,
            accentColor: res.ok ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
        return;
      }
    }

    // 1. PUBLIC START — TẤT CẢ THÀNH VIÊN ĐỀU SỬ DỤNG ĐƯỢC!
    if (sub === 'start') {
      const gameId = interaction.options.getString('tro_choi', true);
      await handlePublicStartRoundInteraction(interaction, systems, gameId);
      return;
    }

    // 2. PUBLIC STATUS — TẤT CẢ THÀNH VIÊN ĐỀU SỬ DỤNG ĐƯỢC!
    if (sub === 'status') {
      const gameFilter = interaction.options.getString('tro_choi') || null;
      const actives = systems.multiplayerRoundSystem.getActiveRounds(
        interaction.guildId,
        gameFilter
      );
      const summary = systems.multiplayerRoundSystem.getSettingsSummary();

      if (actives.length === 0) {
        const box = createContainer({
          accentColor: THEME.NEON_CYAN,
          children: [
            textDisplay(
              [
                '### 📡 TRẠNG THÁI PHIÊN CƯỢC CHUNG TRÊN SERVER',
                'Hiện tại **chưa có phiên cược nào đang chạy**.',
                '👉 **Bất kỳ thành viên nào** cũng có thể bấm nút bên dưới hoặc gõ `/game start` để mở phiên mới ngay!',
                '',
                `⚙️ **Cấu hình hiện hành:** Bầu Cua \`${summary.durations.baucua}s\` • Tài Xỉu \`${summary.durations.taixiu}s\` • Đua Thú \`${summary.durations.race}s\` • Giới hạn \`${formatVnd(summary.minBet)} – ${formatVnd(summary.maxBet)}\``,
              ].join('\n')
            ),
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`mp:start_next:${GAME_IDS.BAUCUA}`)
                .setEmoji('🦀')
                .setLabel('Mở Phiên Bầu Cua (60s)')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`mp:start_next:${GAME_IDS.TAIXIU}`)
                .setEmoji('🎲')
                .setLabel('Mở Phiên Tài Xỉu (60s)')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`mp:start_next:${GAME_IDS.RACE}`)
                .setEmoji('🏇')
                .setLabel('Mở Phiên Đua Thú (90s)')
                .setStyle(ButtonStyle.Secondary)
            ),
          ],
        });
        await safeReplyV2(interaction, buildCv2Payload({ containers: [box], ephemeral: true }));
        return;
      }

      const lines = actives.map((r, i) => {
        const endsUnix = Math.floor(Number(r.ends_at) / 1000);
        return `${i + 1}. \`#${r.round_id}\` — **${MP_GAME_META[r.game_id]?.shortName || r.game_id}** • Trạng thái: \`${r.status}\` • Khóa sổ: <t:${endsUnix}:R> • Kênh: <#${r.channel_id}> • Người mở: <@${r.started_by}> • 👥 **${r.total_players}** (${formatVnd(r.total_bet_vnd)})`;
      });

      const firstSnap = systems.multiplayerRoundSystem.getRoundSnapshot(actives[0].round_id);
      const statusBox = createContainer({
        accentColor: THEME.NEON_CYAN,
        children: [
          textDisplay([`### 🟢 ĐANG CÓ ${actives.length} PHIÊN CƯỢC HOẠT ĐỘNG`, ...lines].join('\n')),
        ],
      });

      if (firstSnap) {
        const board = buildMultiplayerBoardPayload(firstSnap, systems, {
          isEdit: false,
          ephemeral: true,
        });
        await safeReplyV2(
          interaction,
          buildCv2Payload({
            containers: [statusBox, ...board.components].slice(0, 10),
            files: board.files,
            ephemeral: true,
            allowedMentions: { parse: [] },
          })
        );
      } else {
        await safeReplyV2(
          interaction,
          buildCv2Payload({ containers: [statusBox], ephemeral: true })
        );
      }
      return;
    }

    // 3. PUBLIC HISTORY — TẤT CẢ THÀNH VIÊN ĐỀU SỬ DỤNG ĐƯỢC!
    if (sub === 'history') {
      const gameFilter = interaction.options.getString('tro_choi') || null;
      await safeReplyV2(
        interaction,
        buildRoundHistoryPayload(interaction.guildId, gameFilter, systems, { ephemeral: true })
      );
      return;
    }

    // 4. ADMIN / OWNER ONLY: STOP (Hủy phiên & Hoàn tiền 100%)
    if (sub === 'stop') {
      const gameId = interaction.options?.getString?.('tro_choi') || null;
      const roundId = interaction.options?.getString?.('round_id') || null;
      const reason =
        interaction.options?.getString?.('ly_do') ||
        `Quản trị viên ${interaction.user.username || interaction.user.id} dừng phiên`;

      const res = await systems.multiplayerRoundSystem.stopRound({
        guildId: interaction.guildId,
        gameId,
        roundId,
        actorId: interaction.user.id,
        reason,
      });

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: res.ok ? '🛑 Đã Dừng Phiên & Hoàn Tiền 100%' : '⛔ Từ Chối Thao Tác',
          body: res.ok
            ? `✅ Đã dừng phiên \`#${res.roundId}\` thành công!\n💸 Hoàn trả tự động **100%** tiền cược (**${formatVnd(res.totalRefundedVnd)}**) cho **${res.refundedUsersCount} người chơi** và lưu nhật ký kiểm toán.`
            : res.error,
          accentColor: res.ok ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return;
    }

    // 5. ADMIN / OWNER ONLY: EXTEND (Gia hạn thời gian đặt cược)
    if (sub === 'extend') {
      const addSeconds = interaction.options.getInteger('so_giay', true);
      const gameId = interaction.options?.getString?.('tro_choi') || null;
      const roundId = interaction.options?.getString?.('round_id') || null;

      const res = await systems.multiplayerRoundSystem.extendRound({
        guildId: interaction.guildId,
        gameId,
        roundId,
        addSeconds,
        actorId: interaction.user.id,
      });

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: res.ok ? '⏱️ Đã Gia Hạn Phiên Cược' : '⛔ Từ Chối Gia Hạn',
          body: res.ok
            ? `✅ Đã gia hạn phiên \`#${res.roundId}\` thêm **+${res.extraSec} giây**!\nKhóa sổ mới: <t:${Math.floor(res.newEndsAt / 1000)}:R> (<t:${Math.floor(res.newEndsAt / 1000)}:T>).`
            : res.error,
          accentColor: res.ok ? THEME.CYBER_EMERALD : THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return;
    }

    // 6. ADMIN / OWNER ONLY: SETTINGS
    if (sub === 'settings') {
      if (!hasBotRole(systems.db, interaction.user.id, BOT_ROLES.ADMIN)) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⛔ Không Đủ Quyền Quản Trị',
            body: 'Chỉ **ADMIN** hoặc **OWNER** mới có quyền truy cập `/game settings`!',
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
        return;
      }

      const gameId = interaction.options?.getString?.('tro_choi') ?? null;
      const durationSec = interaction.options?.getInteger?.('thoi_gian_giay') ?? null;
      const minBet = interaction.options?.getInteger?.('min_bet') ?? null;
      const maxBet = interaction.options?.getInteger?.('max_bet') ?? null;
      const allowEdit = interaction.options?.getBoolean?.('cho_sua_huy') ?? null;
      const multiTable = interaction.options?.getBoolean?.('multi_table') ?? null;

      if (durationSec !== null && !gameId) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⚠️ Thiếu Trò Chơi',
            body: 'Vui lòng chọn thêm tùy chọn `tro_choi` khi muốn đổi `thoi_gian_giay`.',
            accentColor: THEME.AMBER_PULSE,
            ephemeral: true,
          })
        );
        return;
      }

      const res = systems.multiplayerRoundSystem.updateSettings({
        actorId: interaction.user.id,
        gameId,
        durationSec,
        minBet,
        maxBet,
        allowEditCancelBet: allowEdit,
        multiTableEnabled: multiTable,
      });

      if (!res.ok) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⛔ Không Thể Cập Nhật Cấu Hình',
            body: res.error,
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
        return;
      }

      const s = res.settings;
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚙️ Cấu Hình Hệ Thống Phiên Cược Chung (Multiplayer)',
          body: [
            res.changes.length > 0 ? `✅ **Đã cập nhật:** ${res.changes.join(' • ')}\n` : '',
            `• 🦀 **Thời gian Bầu Cua:** \`${s.durations.baucua} giây\``,
            `• 🎲 **Thời gian Tài Xỉu:** \`${s.durations.taixiu} giây\``,
            `• 🏇 **Thời gian Đua Thú:** \`${s.durations.race} giây\``,
            `• 💵 **Giới hạn cược:** \`${formatVnd(s.minBet)}\` – \`${formatVnd(s.maxBet)}\``,
            `• ✏️ **Cho phép thành viên sửa/hủy cược khi mở:** \`${s.allowEditCancelBet ? 'BẬT' : 'TẮT'}\``,
            `• 👑 **Chế độ nhiều bàn song song (Chỉ OWNER):** \`${s.multiTableEnabled ? `BẬT (Tối đa ${s.maxTablesPerGame} bàn)` : 'TẮT (1 phiên/trò)'}\``,
            `• 🎯 **Luật Bộ Ba 3/18 Tài Xỉu:** \`Nhà cái thắng (công bố trước phiên)\``,
          ]
            .filter(Boolean)
            .join('\n'),
          accentColor: THEME.NEON_CYAN,
          ephemeral: true,
        })
      );
    }
  },
};

// ============================================================================
// Bộ Định Tuyến Tương Tác Nút Bấm, Select Menu & Modal (`mp:*` & `mp_modal:*`)
// ============================================================================

export async function handleMultiplayerComponent(interaction, systems) {
  const customId = interaction.customId || '';
  if (customId.startsWith('mp_modal:')) {
    return handleMultiplayerModal(interaction, systems);
  }
  if (!customId.startsWith('mp:')) return false;

  const parts = customId.split(':');
  const action = parts[1];

  // 1. MỞ PHIÊN TIẾP THEO / MỞ PHIÊN CHUNG — PUBLIC CHO TẤT CẢ THÀNH VIÊN!
  if (action === 'start_next' || action === 'start') {
    const gameId = parts[2] || GAME_IDS.BAUCUA;
    await handlePublicStartRoundInteraction(interaction, systems, gameId);
    return true;
  }

  // 2. XEM CHI TIẾT LUẬT CHƠI
  if (action === 'rules') {
    const gameId = parts[2] || GAME_IDS.BAUCUA;
    const cat = GAME_CATALOG[gameId];
    const meta = MP_GAME_META[gameId] || MP_GAME_META[GAME_IDS.BAUCUA];
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `📖 Luật Chơi & Cơ Chế Phiên Chung — ${meta.title}`,
        body: [
          meta.compactRules,
          '',
          cat?.rules || '',
          '',
          '• **Mở phiên công khai (Public Start):** Mọi thành viên trong server đều có thể mở phiên khi chưa có phiên đang chạy.',
          '• **Công bằng tuyệt đối:** Hệ thống khóa sổ tự động tại 0 giây, quay **1 kết quả ngẫu nhiên duy nhất** (`crypto.randomInt`), lưu CSDL trước khi hiển thị và trả thưởng đồng loạt!',
        ].join('\n'),
        accentColor: THEME.NEON_CYAN,
        ephemeral: true,
      })
    );
    return true;
  }

  // 3. CHỌN MỨC PHỈNH NHANH CÁ NHÂN
  if (action === 'chip' && interaction.isStringSelectMenu?.()) {
    const roundId = parts[2];
    const val = interaction.values[0];
    const pref = val === 'modal' || val === 'all' ? val : Number(val);
    systems.multiplayerRoundSystem.setUserChipPreference(interaction.user.id, pref);

    const desc =
      pref === 'modal'
        ? 'Mở khung nhập số tiền tùy ý khi bấm vào cửa'
        : pref === 'all'
          ? 'Đặt Tất tay (All-in) ngay khi bấm vào cửa'
          : `Đặt nhanh **${formatVnd(pref)}** chỉ với 1 chạm vào cửa`;

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🎯 Đã Lưu Chế Độ Phỉnh Cược Của Bạn',
        body: `Phiên \`#${roundId}\`: ${desc}.\n👉 Giờ hãy chạm trực tiếp vào nút cửa muốn đặt trên bảng phiên!`,
        accentColor: THEME.NEON_CYAN,
        ephemeral: true,
      })
    );
    return true;
  }

  // 4. BẤM VÀO CỬA ĐẶT CƯỢC (`mp:door:<roundId>:<choice>`)
  if (action === 'door') {
    const roundId = parts[2];
    const choice = parts[3];
    const snap = systems.multiplayerRoundSystem.getRoundSnapshot(roundId);
    if (
      !snap ||
      snap.round.status !== MP_ROUND_STATUS.BETTING ||
      Date.now() >= Number(snap.round.ends_at)
    ) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⛔ Đã Khóa Sổ Cược',
          body: 'Phiên cược này đã hết thời gian nhận cược!',
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    const chipPref = systems.multiplayerRoundSystem.getUserChipPreference(interaction.user.id);
    if (chipPref !== 'modal') {
      const profile = systems.economySystem.ensureUser(
        interaction.user.id,
        interaction.user.username
      );
      const { maxBet } = systems.multiplayerRoundSystem.getBetLimits();
      const existingTotal = systems.multiplayerRoundSystem
        .getUserRoundBets(roundId, interaction.user.id)
        .filter((b) => b.status === 'ACTIVE')
        .reduce((s, b) => s + (Number(b.amount) || 0), 0);

      const quickAmt =
        chipPref === 'all'
          ? Math.max(0, Math.min(profile.wallet, maxBet - existingTotal))
          : Number(chipPref);

      const betRes = await systems.multiplayerRoundSystem.placeBet({
        roundId,
        userId: interaction.user.id,
        username: interaction.user.username,
        choice,
        amount: quickAmt,
      });

      if (!betRes.ok) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⚠️ Không Thể Đặt Cược',
            body: betRes.error,
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
        return true;
      }

      await safeReplyV2(
        interaction,
        buildUserRoundReceiptPayload(
          betRes.snapshot,
          interaction.user.id,
          systems,
          `✅ Đã đặt **${formatVnd(betRes.addedAmount)}** vào **${formatChoiceLabel(betRes.gameId, choice)}**! (Mã vé: \`#${betRes.betId}\`)`,
          { ephemeral: true }
        )
      );
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`mp_modal:bet:${roundId}:${choice}`)
      .setTitle(`Đặt ${formatChoiceLabel(snap.round.game_id, choice)} (#${roundId})`.slice(0, 45));

    const amountInput = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel('Số tiền cược VNĐ (VD: 10000, 50k, 1m, all)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Nhập số tiền VNĐ muốn đặt...')
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
    await interaction.showModal(modal);
    return true;
  }

  // 5. NÚT ĐẶT CƯỢC NHANH BẰNG MODAL (`mp:bet_open:<roundId>`)
  if (action === 'bet_open') {
    const roundId = parts[2];
    const snap = systems.multiplayerRoundSystem.getRoundSnapshot(roundId);
    if (
      !snap ||
      snap.round.status !== MP_ROUND_STATUS.BETTING ||
      Date.now() >= Number(snap.round.ends_at)
    ) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⛔ Đã Khóa Sổ Cược',
          body: 'Phiên cược này đã hết thời gian nhận cược!',
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    const doorHint =
      snap.round.game_id === GAME_IDS.BAUCUA
        ? 'bau / cua / tom / ca / ga / nai'
        : snap.round.game_id === GAME_IDS.TAIXIU
          ? 'tai / xiu'
          : 'horse / cheetah / eagle / wolf / tiger';

    const modal = new ModalBuilder()
      .setCustomId(`mp_modal:bet_any:${roundId}`)
      .setTitle(`Đặt Cược Phiên #${roundId}`.slice(0, 45));

    const choiceInput = new TextInputBuilder()
      .setCustomId('choice')
      .setLabel(`Cửa muốn đặt (${doorHint})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(doorHint)
      .setRequired(true)
      .setMaxLength(20);

    const amountInput = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel('Số tiền cược VNĐ (VD: 10000, 50k, all)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('10000')
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(
      new ActionRowBuilder().addComponents(choiceInput),
      new ActionRowBuilder().addComponents(amountInput)
    );
    await interaction.showModal(modal);
    return true;
  }

  // 6. XEM CƯỢC CỦA TÔI / QUẢN LÝ SỬA HỦY / CHI TIẾT CƯỢC SAU KHI ĐÓNG PHIÊN
  if (action === 'my_bets' || action === 'manage' || action === 'detail' || action === 'receipt') {
    const roundId = parts[2];
    const snap = systems.multiplayerRoundSystem.getRoundSnapshot(roundId);
    if (!snap) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '❌ Không Tìm Thấy Phiên',
          body: 'Không tìm thấy dữ liệu phiên cược này.',
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    await safeReplyV2(
      interaction,
      buildUserRoundReceiptPayload(snap, interaction.user.id, systems, null, {
        ephemeral: true,
      })
    );
    return true;
  }

  // 7. CHỌN VÉ ĐỂ SỬA SỐ TIỀN (`mp:edit_pick:<roundId>`)
  if (action === 'edit_pick' && interaction.isStringSelectMenu?.()) {
    const roundId = parts[2];
    const betId = interaction.values[0];
    const userBets = systems.multiplayerRoundSystem.getUserRoundBets(roundId, interaction.user.id);
    const targetBet = userBets.find((b) => b.bet_id === betId && b.status === 'ACTIVE');

    if (!targetBet) {
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚠️ Vé Không Còn Hiệu Lực',
          body: 'Vé cược này không còn ở trạng thái hoạt động để chỉnh sửa.',
          accentColor: THEME.CRIMSON_NEON,
          clearAttachments: true,
        })
      );
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`mp_modal:edit:${roundId}:${betId}`)
      .setTitle(`Sửa vé cược #${betId.slice(-6)}`.slice(0, 45));

    const amountInput = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel('Số tiền cược mới VNĐ')
      .setStyle(TextInputStyle.Short)
      .setValue(String(targetBet.amount))
      .setRequired(true)
      .setMaxLength(20);

    const choiceInput = new TextInputBuilder()
      .setCustomId('choice')
      .setLabel('Cửa cược (Giữ nguyên hoặc nhập cửa mới)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(targetBet.choice))
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(
      new ActionRowBuilder().addComponents(amountInput),
      new ActionRowBuilder().addComponents(choiceInput)
    );
    await interaction.showModal(modal);
    return true;
  }

  // 8. CHỌN VÉ ĐỂ HỦY LẺ (`mp:cancel_pick:<roundId>`)
  if (action === 'cancel_pick' && interaction.isStringSelectMenu?.()) {
    const roundId = parts[2];
    const betId = interaction.values[0];
    const res = await systems.multiplayerRoundSystem.cancelBet({
      roundId,
      betId,
      userId: interaction.user.id,
    });

    if (!res.ok) {
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚠️ Không Thể Hủy Vé',
          body: res.error,
          accentColor: THEME.CRIMSON_NEON,
          clearAttachments: true,
        })
      );
      return true;
    }

    await safeUpdateV2(
      interaction,
      buildUserRoundReceiptPayload(
        res.snapshot,
        interaction.user.id,
        systems,
        `♻️ Đã hủy vé \`#${betId}\` và hoàn **${formatVnd(res.refundedAmount)}** về ví của bạn!`,
        { ephemeral: true, clearAttachments: true }
      )
    );
    return true;
  }

  // 9. HỦY TOÀN BỘ CƯỢC CỦA TÔI (`mp:cancel_all:<roundId>`)
  if (action === 'cancel_all') {
    const roundId = parts[2];
    const res = await systems.multiplayerRoundSystem.cancelAllUserBets({
      roundId,
      userId: interaction.user.id,
    });

    if (!res.ok) {
      await safeUpdateV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚠️ Không Thể Hủy Cược',
          body: res.error,
          accentColor: THEME.CRIMSON_NEON,
          clearAttachments: true,
        })
      );
      return true;
    }

    await safeUpdateV2(
      interaction,
      buildUserRoundReceiptPayload(
        res.snapshot,
        interaction.user.id,
        systems,
        `♻️ Đã hủy **${res.cancelledCount} vé cược** và hoàn **${formatVnd(res.refundedAmount)}** về ví!`,
        { ephemeral: true, clearAttachments: true }
      )
    );
    return true;
  }

  // 10. LỊCH SỬ PHIÊN & BẢNG XẾP HẠNG CAO THỦ
  if (action === 'history') {
    const gameId = parts[2] || null;
    await safeReplyV2(
      interaction,
      buildRoundHistoryPayload(interaction.guildId, gameId, systems, { ephemeral: true })
    );
    return true;
  }

  if (action === 'leaderboard') {
    const gameId = parts[2] || null;
    await safeReplyV2(
      interaction,
      buildMultiplayerLeaderboardPayload(interaction.guildId, gameId, systems, {
        ephemeral: true,
      })
    );
    return true;
  }

  return false;
}

export async function handleMultiplayerModal(interaction, systems) {
  const parts = interaction.customId.split(':');
  const mode = parts[1];
  const roundId = parts[2];

  const profile = systems.economySystem.ensureUser(
    interaction.user.id,
    interaction.user.username
  );
  const { maxBet } = systems.multiplayerRoundSystem.getBetLimits();
  const rawAmt = interaction.fields.getTextInputValue('amount');
  const parsedAmt = parseAmountInput(rawAmt, Math.min(profile.wallet, maxBet));

  if (!parsedAmt || parsedAmt <= 0) {
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '❌ Số Tiền Không Hợp Lệ',
        body: 'Hãy nhập số dương hợp lệ như `10000`, `50k`, `1m` hoặc `all`.',
        accentColor: THEME.CRIMSON_NEON,
        ephemeral: true,
      })
    );
    return true;
  }

  if (mode === 'bet' || mode === 'bet_any') {
    const rawChoice =
      mode === 'bet' ? parts[3] : interaction.fields.getTextInputValue('choice');
    const normChoice = normalizeVietnameseChoice(rawChoice);

    const res = await systems.multiplayerRoundSystem.placeBet({
      roundId,
      userId: interaction.user.id,
      username: interaction.user.username,
      choice: normChoice,
      amount: parsedAmt,
    });

    if (!res.ok) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚠️ Không Thể Đặt Cược',
          body: res.error,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    await safeReplyV2(
      interaction,
      buildUserRoundReceiptPayload(
        res.snapshot,
        interaction.user.id,
        systems,
        `✅ Đặt cược thành công **${formatVnd(res.addedAmount)}** vào **${formatChoiceLabel(res.gameId, res.choice)}**! (Mã vé: \`#${res.betId}\`)`,
        { ephemeral: true }
      )
    );
    return true;
  }

  if (mode === 'edit') {
    const betId = parts[3];
    const rawChoice = interaction.fields.getTextInputValue('choice');
    const normChoice = normalizeVietnameseChoice(rawChoice);

    const res = await systems.multiplayerRoundSystem.editBet({
      roundId,
      betId,
      userId: interaction.user.id,
      newAmount: parsedAmt,
      newChoice: normChoice,
    });

    if (!res.ok) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⚠️ Không Thể Sửa Vé Cược',
          body: res.error,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
      return true;
    }

    await safeReplyV2(
      interaction,
      buildUserRoundReceiptPayload(
        res.snapshot,
        interaction.user.id,
        systems,
        `✏️ Đã cập nhật vé \`#${res.betId}\` thành **${formatVnd(res.newAmount)}** (${formatChoiceLabel(res.snapshot.round.game_id, res.choice)})!`,
        { ephemeral: true }
      )
    );
    return true;
  }

  return false;
}

function normalizeVietnameseChoice(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

  const aliases = {
    bau: 'bau',
    cua: 'cua',
    tom: 'tom',
    ca: 'ca',
    ga: 'ga',
    nai: 'nai',
    tai: 'tai',
    xiu: 'xiu',
    ngua: 'horse',
    'chien ma': 'horse',
    horse: 'horse',
    bao: 'cheetah',
    'bao dom': 'cheetah',
    cheetah: 'cheetah',
    'dai bang': 'eagle',
    ung: 'eagle',
    eagle: 'eagle',
    soi: 'wolf',
    'soi bac': 'wolf',
    wolf: 'wolf',
    ho: 'tiger',
    'ho trang': 'tiger',
    tiger: 'tiger',
  };
  return aliases[s] || s;
}
