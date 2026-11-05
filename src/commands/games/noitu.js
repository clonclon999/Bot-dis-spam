import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from 'discord.js';
import {
  buildCv2NoticePayload,
  buildCv2Payload,
  createContainer,
  mediaGallery,
  sectionWithThumbnail,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import { safeReplyV2, safeUpdateV2 } from '../../ui/interactionHelpers.js';
import { renderNeonBar, resolveUserAvatarUrl, THEME } from '../../ui/theme.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { formatVnd } from '../../utils/format.js';
import { DEFAULT_RESULT_TTL_MS, globalPanelCleaner } from '../../utils/panelCleaner.js';

export function capitalizeVi(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTurnBar(room, activeUserId) {
  const p1Active = String(activeUserId) === String(room.hostId);
  const left = p1Active ? `🟢 **[LƯỢT P1]** <@${room.hostId}>` : `⚪ <@${room.hostId}>`;
  const right = !p1Active ? `🟢 **[LƯỢT P2]** <@${room.guestId}>` : `⚪ <@${room.guestId}>`;
  return `${left}  ━━━⚔️━━━  ${right}`;
}

function resolveTwoPlayerAvatars(room) {
  const files = [];
  let p1Url = room.hostAvatarUrl || null;
  let p2Url = room.guestAvatarUrl || null;

  if (!p1Url || !p1Url.startsWith('http')) {
    const fb1 = buildAssetAttachment(ASSET_PATHS.COIN_SAP, 'noitu_p1_avatar.png');
    p1Url = fb1.url;
    files.push(fb1.attachment);
  }
  if (!p2Url || !p2Url.startsWith('http')) {
    const fb2 = buildAssetAttachment(ASSET_PATHS.COIN_NGUA, 'noitu_p2_avatar.png');
    p2Url = fb2.url;
    files.push(fb2.attachment);
  }
  return { p1Url, p2Url, files };
}

async function editNoituBoardMessage(msg, payload) {
  if (!msg || typeof msg.edit !== 'function') return null;
  const normalized = {
    ...payload,
    ...(payload.files && payload.files.length > 0 ? {} : { attachments: [] }),
  };
  return msg.edit(normalized).catch(() => null);
}

// ============================================================================
// GIAO DIỆN NỐI TỪ PRO MAX — DISCORD COMPONENTS V2
// ============================================================================

export function buildNoituHubPayload(wordChainSystem) {
  const cfg = wordChainSystem.getConfig();
  const activeCount = wordChainSystem.rooms.size;
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_NOITU, 'noitu_gameshow.png');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('noitu:hub_create')
      .setLabel('Tạo Phòng')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('noitu:hub_join')
      .setLabel('Vào Nhanh')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('noitu:hub_stats')
      .setLabel('Thống Kê')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('noitu:hub_lb')
      .setLabel('Xếp Hạng')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('noitu:hub_rules')
      .setLabel('Luật Chơi')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary)
  );

  const hubContainer = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: banner.url, description: 'Game Show Nối Từ Tiếng Việt PRO (1v1)' }]),
      textDisplay(
        `## 🔤 GAME SHOW NỐI TỪ TIẾNG VIỆT PRO (1v1)\n` +
          `Đấu trường từ vựng đối kháng **2 người chơi** theo thời gian thực!\n\n` +
          `• 📚 **Kho từ điển cục bộ:** **${wordChainSystem.dictionary.size.toLocaleString('vi-VN')} từ ghép 2 tiếng**\n` +
          `• ⏱️ **Đồng hồ mỗi lượt:** **${cfg.timeoutSec} giây** *(Nhắc nhở khi còn 10s)*\n` +
          `• 💰 **Thưởng thắng trận:** **+${formatVnd(cfg.baseReward)}**\n` +
          `• 🔥 **Thưởng chuỗi thắng:** \`3 trận (+${formatVnd(cfg.streak3Bonus)})\` • \`5 trận (+${formatVnd(cfg.streak5Bonus)})\` • \`10 trận (+${formatVnd(cfg.streak10Bonus)})\`\n` +
          `• 🏟️ **Phòng đang mở:** \`${activeCount} phòng\``
      ),
      separator(),
      row1,
    ],
  });

  return buildCv2Payload({
    containers: [hubContainer],
    files: [banner.attachment],
  });
}

export const buildNoituLobbyPayload = buildNoituHubPayload;

export function buildRoomLobbyPayload(room, cfg, invitedUserId = null) {
  const isFull = Boolean(room.guestId);
  const { p1Url, p2Url, files } = resolveTwoPlayerAvatars(room);

  const inviteNotice = invitedUserId
    ? `📩 <@${invitedUserId}> ơi! <@${room.hostId}> vừa mời bạn vào phòng đấu **Nối Từ #${room.roomId}**!\n\n`
    : '';

  const p1Section = sectionWithThumbnail({
    texts: [
      `### 👑 Khu Vực Người Chơi 1 (Chủ Phòng)\n<@${room.hostId}> — ✅ **Sẵn sàng**`,
    ],
    url: p1Url,
    description: 'Avatar Người chơi 1',
  });

  const p2Section = sectionWithThumbnail({
    texts: [
      `### ⚔️ Khu Vực Người Chơi 2 (Đối Thủ)\n` +
        (room.guestId
          ? `<@${room.guestId}> — ✅ **Đã vào bàn!**`
          : room.invitedUserId
            ? `⏳ Đang chờ lời mời của <@${room.invitedUserId}>...`
            : '⏳ *Đang mở cửa chờ đối thủ bấm Tham Gia...*'),
    ],
    url: p2Url,
    description: 'Avatar Người chơi 2',
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noitu:join:${room.roomId}`)
      .setLabel(isFull ? 'Đã Đủ 2/2 Người' : 'Tham Gia Phòng')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isFull),
    new ButtonBuilder()
      .setCustomId(`noitu:start:${room.roomId}`)
      .setLabel('Bắt Đầu Đấu')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isFull),
    new ButtonBuilder()
      .setCustomId(`noitu:cancel:${room.roomId}`)
      .setLabel('Hủy Phòng')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  const card = createContainer({
    accentColor: isFull ? THEME.CYBER_EMERALD : THEME.CYAN_BRIGHT,
    children: [
      textDisplay(
        `## 🏠 PHÒNG CHỜ NỐI TỪ — #${room.roomId}\n` +
          `${inviteNotice}` +
          `⏱️ **Đồng hồ mỗi lượt:** \`${room.turnTimeoutSec} giây\` • 💰 **Giải thưởng:** \`+${formatVnd(cfg.baseReward)}\` *(+ chuỗi thắng)*`
      ),
      separator(),
      p1Section,
      p2Section,
      separator(),
      textDisplay(
        isFull
          ? `✅ **Đã đủ 2/2 tuyển thủ!** Chủ phòng <@${room.hostId}> hãy nhấn **Bắt Đầu Đấu**!`
          : `👉 Nhấn nút **Tham Gia Phòng** bên dưới hoặc gõ \`/noitu join room:${room.roomId}\` để nhận ghế số 2!`
      ),
      row,
    ],
  });

  return buildCv2Payload({
    containers: [card],
    files,
    ...(invitedUserId ? { allowedMentions: { users: [invitedUserId] } } : {}),
  });
}

export function buildMatchStartPayload(room, rewardVnd = 1_000) {
  const deadlineUnix = Math.floor((room.turnDeadlineAt || Date.now() + 30_000) / 1000);
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_NOITU, 'noitu_stage.png');
  const { p1Url, p2Url, files } = resolveTwoPlayerAvatars(room);
  const p1Active = String(room.currentTurnUserId) === String(room.hostId);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noitu:surrender:${room.roomId}`)
      .setLabel('Đầu Hàng')
      .setEmoji('🏳️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('noitu:hub_rules')
      .setLabel('Luật Ngắn')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary)
  );

  const stageContainer = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: banner.url, description: `Sân khấu Nối Từ #${room.roomId}` }]),
      sectionWithThumbnail({
        texts: [
          `### 👑 Tuyển Thủ 1: <@${room.hostId}>\n${p1Active ? '🟢 **ĐANG GIỮ LƯỢT MỞ MÀN**' : '⚪ *Chờ lượt tiếp theo*'}`,
        ],
        url: p1Url,
        description: 'Avatar Tuyển thủ 1',
      }),
      sectionWithThumbnail({
        texts: [
          `### ⚔️ Tuyển Thủ 2: <@${room.guestId}>\n${!p1Active ? '🟢 **ĐANG GIỮ LƯỢT MỞ MÀN**' : '⚪ *Chờ lượt tiếp theo*'}`,
        ],
        url: p2Url,
        description: 'Avatar Tuyển thủ 2',
      }),
      separator(),
      textDisplay(
        `## 🎮 NỐI TỪ TIẾNG VIỆT – BẮT ĐẦU! [#${room.roomId}]\n` +
          `📺 **Thanh Lượt:** ${buildTurnBar(room, room.currentTurnUserId)}\n` +
          `🔗 **Yêu cầu mở màn:** Gõ trực tiếp **1 từ ghép 2 tiếng tiếng Việt** hợp lệ vào kênh chat *(VD: Học sinh)*\n` +
          `⏱️ **Đồng hồ đếm ngược:** **${room.turnTimeoutSec} giây** (<t:${deadlineUnix}:R>) • \`${renderNeonBar(10, 10, 10)}\`\n` +
          `💰 **Giải thưởng trận:** **+${formatVnd(rewardVnd)}**`
      ),
      separator(),
      row,
    ],
  });

  return buildCv2Payload({
    containers: [stageContainer],
    files: [banner.attachment, ...files],
  });
}

export function buildValidTurnPayload({
  room,
  playerUserId,
  acceptedWord,
  nextPrefix,
  nextTurnUserId,
  timeoutSec,
  tenSecWarning = false,
}) {
  const deadlineUnix = Math.floor((room.turnDeadlineAt || Date.now() + timeoutSec * 1000) / 1000);
  const { p1Url, p2Url, files } = resolveTwoPlayerAvatars(room);
  const p1Active = String(nextTurnUserId) === String(room.hostId);

  const timeBar = tenSecWarning ? renderNeonBar(3, 10, 10) : renderNeonBar(10, 10, 10);
  const timeText = tenSecWarning
    ? `⚠️ **CÒN 10 GIÂY!** (<t:${deadlineUnix}:R>) \`${timeBar}\``
    : `**${timeoutSec} giây** (<t:${deadlineUnix}:R>) \`${timeBar}\``;

  const recentTrail =
    Array.isArray(room.wordHistory) && room.wordHistory.length > 0
      ? room.wordHistory
          .slice(-7)
          .map((h) => `\`${capitalizeVi(h.word)}\``)
          .join(' ➔ ')
      : `\`${capitalizeVi(acceptedWord)}\``;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noitu:surrender:${room.roomId}`)
      .setLabel('Đầu Hàng')
      .setEmoji('🏳️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('noitu:hub_rules')
      .setLabel('Luật Ngắn')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary)
  );

  const arenaCard = createContainer({
    accentColor: tenSecWarning ? THEME.AMBER_PULSE : THEME.CYBER_EMERALD,
    children: [
      textDisplay(
        `## 🟢 NỐI TỪ – HỢP LỆ! (Lượt #${room.turnCount})\n` +
          `📺 **Thanh Lượt:** ${buildTurnBar(room, nextTurnUserId)}`
      ),
      sectionWithThumbnail({
        texts: [
          `👑 **Tuyển Thủ 1:** <@${room.hostId}> — ${p1Active ? '🟢 **TỚI LƯỢT BẠN!**' : '✅ *Vừa nối xong*'}`,
        ],
        url: p1Url,
        description: 'Avatar Tuyển thủ 1',
      }),
      sectionWithThumbnail({
        texts: [
          `⚔️ **Tuyển Thủ 2:** <@${room.guestId}> — ${!p1Active ? '🟢 **TỚI LƯỢT BẠN!**' : '✅ *Vừa nối xong*'}`,
        ],
        url: p2Url,
        description: 'Avatar Tuyển thủ 2',
      }),
      separator(),
      textDisplay(
        `📝 **Từ vừa nối (<@${playerUserId}>):** **${capitalizeVi(acceptedWord)}**\n` +
          `### 🔗 TỪ CẦN NỐI TIẾP BẮT ĐẦU BẰNG: **\`${capitalizeVi(nextPrefix)} ...\`**\n` +
          `⏱️ **Đồng hồ đếm ngược (<@${nextTurnUserId}>):** ${timeText}\n` +
          `📜 **Lịch sử từ:** ${recentTrail}`
      ),
      separator(),
      row,
    ],
  });

  return buildCv2Payload({
    containers: [arenaCard],
    files,
  });
}

export function buildInvalidWordPayload({
  authorId,
  code,
  word,
  requiredPrefix,
  remainingSec,
  currentTurnUserId,
}) {
  if (code === 'WRONG_TURN') {
    return buildCv2NoticePayload({
      title: '⛔ CHƯA ĐẾN LƯỢT CỦA BẠN!',
      body:
        `<@${authorId}> không được tự nối từ của chính mình hoặc trả lời khi chưa đến lượt.\n` +
        `⏳ Lượt hiện tại đang thuộc về: <@${currentTurnUserId}>`,
      accentColor: THEME.CRIMSON_NEON,
      clearAttachments: true,
      allowedMentions: { users: [authorId] },
    });
  }

  if (code === 'ALREADY_USED') {
    const reqLine = requiredPrefix
      ? `\n🔗 Yêu cầu: Từ phải bắt đầu bằng **${capitalizeVi(requiredPrefix)}**.`
      : '';
    return buildCv2NoticePayload({
      title: '⚠️ TỪ ĐÃ ĐƯỢC SỬ DỤNG!',
      body:
        `<@${authorId}> — Từ **${capitalizeVi(word)}** đã xuất hiện trong ván này.\n` +
        `Vui lòng chọn một từ khác.${reqLine}\n` +
        `⏳ Bạn vẫn còn lượt chơi (**${remainingSec} giây**). Hãy thử lại!`,
      accentColor: THEME.AMBER_PULSE,
      clearAttachments: true,
      allowedMentions: { users: [authorId] },
    });
  }

  let reasonDetail = 'Từ bạn nhập không có trong từ điển tiếng Việt hợp lệ.';
  if (code === 'WRONG_PREFIX') {
    reasonDetail = 'Từ bạn nhập không thể nối tiếp từ trước đó.';
  } else if (code === 'MULTIPLE_ANSWERS') {
    reasonDetail = 'Không được gửi nhiều đáp án trong một lượt.';
  } else if (code === 'SINGLE_TOKEN' || code === 'TOO_LONG' || code === 'INVALID_CHARS') {
    reasonDetail = 'Chỉ chấp nhận một từ ghép tiếng Việt gồm đúng 2 tiếng, không chứa số hoặc ký tự lạ.';
  }

  const reqText = requiredPrefix
    ? `🔗 Yêu cầu: Từ phải bắt đầu bằng **${capitalizeVi(requiredPrefix)}**.`
    : '🔗 Yêu cầu: Nhập một từ ghép tiếng Việt gồm 2 tiếng hợp lệ.';

  return buildCv2NoticePayload({
    title: '🔴 TỪ KHÔNG HỢP LỆ!',
    body:
      `<@${authorId}> — ${reasonDetail}\n` +
      `${reqText}\n` +
      `⏳ Bạn vẫn còn lượt chơi (**${remainingSec} giây**). Hãy thử lại!`,
    accentColor: THEME.CRIMSON_NEON,
    clearAttachments: true,
    allowedMentions: { users: [authorId] },
  });
}

export function buildVictoryPayload(outcome) {
  const reasonMap = {
    NO_MORE_WORDS: `Từ **${capitalizeVi(outcome.lastWord)}** không còn từ hợp lệ nào trong từ điển có thể nối tiếp!`,
    TIMEOUT: `Đối thủ <@${outcome.loserId}> đã hết thời gian đếm ngược không trả lời.`,
    SURRENDER: `Đối thủ <@${outcome.loserId}> đã bấm đầu hàng.`,
  };

  const streakLine =
    outcome.streakBonusVnd > 0
      ? `\n🔥 **Thưởng chuỗi ${outcome.newStreak} trận thắng:** +**${formatVnd(outcome.streakBonusVnd)}**`
      : outcome.newStreak >= 2
        ? `\n🔥 **Chuỗi thắng hiện tại:** **${outcome.newStreak} trận liên tiếp**`
        : '';

  const victoryBanner = buildAssetAttachment(ASSET_PATHS.NOITU_WIN, 'noitu_victory.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('noitu:hub_create')
      .setLabel('Tạo Phòng Ván Mới')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('noitu:hub_lb')
      .setLabel('Bảng Xếp Hạng')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary)
  );

  const card = createContainer({
    accentColor: THEME.NEON_GOLD,
    children: [
      mediaGallery([{ url: victoryBanner.url, description: 'Bảng thông báo người chiến thắng Nối Từ' }]),
      textDisplay(
        `## 🏆 BẢNG VINH DANH NGƯỜI THẮNG CUỘC [#${outcome.roomId}]\n` +
          `👑 **Quán quân:** <@${outcome.winnerId}>\n` +
          `💰 **Tổng thưởng nhận về:** **+${formatVnd(outcome.totalRewardVnd)}**${streakLine}\n` +
          `📊 **Tổng số lượt nối:** \`${outcome.totalTurns} lượt\`\n` +
          `📌 **Lý do phân định:** ${reasonMap[outcome.reason] || outcome.reason}`
      ),
      separator(),
      row,
    ],
  });

  return buildCv2Payload({
    containers: [card],
    files: [victoryBanner.attachment],
  });
}

export function buildRulesPayload(cfg, ephemeral = false) {
  return buildCv2NoticePayload({
    title: '📖 LUẬT CHƠI NỐI TỪ TIẾNG VIỆT PRO (1v1)',
    body:
      '**1. Quy tắc nối từ:**\n' +
      '• Thi đấu đối kháng **2 người chơi** theo lượt *(VD: Học sinh ➔ Sinh viên ➔ Viên chức)*.\n' +
      '• Tiếng đầu tiên của từ sau phải trùng chính xác tiếng cuối cùng của từ trước.\n' +
      '• Chỉ chấp nhận từ ghép **2 tiếng** có trong từ điển tiếng Việt hợp lệ, không lặp lại từ đã dùng.\n\n' +
      '**2. Điều kiện chiến thắng:**\n' +
      `• **Đối thủ hết giờ:** Quá **${cfg.timeoutSec} giây** (có cảnh báo khi còn 10s).\n` +
      '• **Đối thủ đầu hàng:** Bấm `🏳️ Đầu Hàng` hoặc `/noitu surrender`.\n' +
      '• **Khóa từ đặc biệt:** Từ hợp lệ bạn đưa ra khiến tiếng cuối **hết sạch từ nối tiếp** trong từ điển ➔ **Thắng ngay lập tức!**\n\n' +
      '**3. Phần thưởng VNĐ:**\n' +
      `• Thắng trận: **+${formatVnd(cfg.baseReward)}** • Chuỗi **3/5/10 trận**: **+${formatVnd(cfg.streak3Bonus)} / +${formatVnd(cfg.streak5Bonus)} / +${formatVnd(cfg.streak10Bonus)}**`,
    accentColor: THEME.NEON_CYAN,
    ephemeral,
  });
}

export function buildStatsPayload(targetUser, stats, ephemeral = false) {
  return buildCv2NoticePayload({
    title: `📊 THỐNG KÊ NỐI TỪ — ${targetUser.username}`,
    body:
      `• 🎮 **Tổng số trận:** \`${stats.totalMatches}\`  │  🏆 **Thắng:** \`${stats.wins}\`  │  💔 **Thua:** \`${stats.losses}\`\n` +
      `• 📈 **Tỷ lệ thắng:** **${stats.winRate}%** (\`${renderNeonBar(stats.wins, Math.max(1, stats.totalMatches), 8)}\`)\n` +
      `• 🔥 **Chuỗi thắng hiện tại:** \`${stats.currentStreak}\` • 👑 **Chuỗi đỉnh cao:** \`${stats.bestStreak}\`\n` +
      `• 💰 **Tổng VNĐ kiếm được từ Nối Từ:** **${formatVnd(stats.totalVndEarned)}**`,
    accentColor: THEME.NEON_PURPLE,
    ephemeral,
  });
}

export function buildLeaderboardPayload(boards, category = 'all', ephemeral = false) {
  const medals = ['🥇', '🥈', '🥉'];
  const fmtWins = (rows) =>
    rows.length > 0
      ? rows
          .map(
            (r, i) =>
              `${medals[i] ?? `\`#${i + 1}\``} <@${r.user_id}> — **${r.wins} thắng** / ${r.total_matches} trận (${formatVnd(r.total_vnd_earned)})`
          )
          .join('\n')
      : '*Chưa có dữ liệu*';

  const fmtStreaks = (rows) =>
    rows.length > 0
      ? rows
          .map(
            (r, i) =>
              `${medals[i] ?? `\`#${i + 1}\``} <@${r.user_id}> — Chuỗi đỉnh: **${r.best_streak}** *(Hiện tại: ${r.current_streak})*`
          )
          .join('\n')
      : '*Chưa có dữ liệu*';

  const fmtActive = (rows) =>
    rows.length > 0
      ? rows
          .map(
            (r, i) =>
              `${medals[i] ?? `\`#${i + 1}\``} <@${r.user_id}> — **${r.total_matches} trận** • ${r.total_turns_played} từ đã nối`
          )
          .join('\n')
      : '*Chưa có dữ liệu*';

  let body = '';
  if (category === 'wins') {
    body = `### 👑 Top Người Thắng Nhiều Nhất\n${fmtWins(boards.topWins)}`;
  } else if (category === 'streak') {
    body = `### 🔥 Top Chuỗi Thắng Dài Nhất\n${fmtStreaks(boards.topStreaks)}`;
  } else if (category === 'active') {
    body = `### ⚡ Top Người Chơi Tích Cực Nhất\n${fmtActive(boards.topActive)}`;
  } else {
    body = [
      `### 👑 Top Thắng Nhiều Nhất\n${fmtWins(boards.topWins.slice(0, 5))}`,
      `### 🔥 Top Chuỗi Thắng Dài Nhất\n${fmtStreaks(boards.topStreaks.slice(0, 5))}`,
      `### ⚡ Top Người Chơi Tích Cực Nhất\n${fmtActive(boards.topActive.slice(0, 5))}`,
    ].join('\n\n');
  }

  return buildCv2NoticePayload({
    title: '🏆 BẢNG XẾP HẠNG NỐI TỪ TIẾNG VIỆT PRO',
    body,
    accentColor: THEME.NEON_GOLD,
    ephemeral,
  });
}

// ============================================================================
// Slash Command /noitu (8 Subcommands chuẩn đặc tả)
// ============================================================================

export const noituCommand = {
  data: new SlashCommandBuilder()
    .setName('noitu')
    .setDescription('Trò chơi Nối Từ Tiếng Việt PRO (Components V2 – đối kháng 2 người chơi thưởng VNĐ)')
    .addSubcommand((s) =>
      s.setName('lobby').setDescription('Mở giao diện trung tâm trò chơi Nối Từ Tiếng Việt PRO')
    )
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Tạo phòng Nối Từ mới cho 2 người chơi (có thể mời bạn bè)')
        .addUserOption((o) =>
          o.setName('invite').setDescription('Mời đích danh một người bạn cùng đấu (tùy chọn)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription('Tham gia một phòng Nối Từ đang chờ người chơi thứ 2')
        .addStringOption((o) =>
          o.setName('room').setDescription('Mã phòng (ví dụ: NT-1234, bỏ trống để vào nhanh)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Bắt đầu trận đấu Nối Từ (chỉ dành cho Chủ phòng khi đủ 2 người)')
        .addStringOption((o) =>
          o.setName('room').setDescription('Mã phòng của bạn (tùy chọn)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s.setName('surrender').setDescription('Chấp nhận đầu hàng trong trận đấu Nối Từ đang diễn ra')
    )
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Xem thống kê thành tích, tỷ lệ thắng & chuỗi thắng Nối Từ')
        .addUserOption((o) =>
          o.setName('user').setDescription('Người chơi muốn xem (bỏ trống để xem của bạn)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Xem Bảng xếp hạng Top Thắng, Top Chuỗi Thắng & Top Tích Cực')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Chọn hạng mục xếp hạng')
            .setRequired(false)
            .addChoices(
              { name: '🌟 Tổng hợp cả 3 bảng', value: 'all' },
              { name: '👑 Top thắng nhiều nhất', value: 'wins' },
              { name: '🔥 Top chuỗi thắng dài nhất', value: 'streak' },
              { name: '⚡ Top người chơi tích cực nhất', value: 'active' }
            )
        )
    )
    .addSubcommand((s) =>
      s.setName('rules').setDescription('Xem chi tiết luật chơi, điều kiện thắng & phần thưởng VNĐ')
    ),

  async execute(interaction, { wordChainSystem }) {
    const sub = interaction.options?.getSubcommand?.(false) ?? 'lobby';
    const uid = interaction.user.id;
    const uname = interaction.user.username;

    if (sub === 'lobby') {
      await safeReplyV2(interaction, buildNoituHubPayload(wordChainSystem));
      return;
    }

    if (sub === 'rules') {
      await safeReplyV2(interaction, buildRulesPayload(wordChainSystem.getConfig(), false));
      return;
    }

    if (sub === 'stats') {
      const target = interaction.options?.getUser?.('user') ?? interaction.user;
      const stats = wordChainSystem.getPlayerStats(target.id, target.username);
      await safeReplyV2(interaction, buildStatsPayload(target, stats, false));
      return;
    }

    if (sub === 'leaderboard') {
      const type = interaction.options?.getString?.('type') ?? 'all';
      const boards = wordChainSystem.getLeaderboards(10);
      await safeReplyV2(interaction, buildLeaderboardPayload(boards, type, false));
      return;
    }

    if (sub === 'create') {
      const invited = interaction.options?.getUser?.('invite') ?? null;
      const room = wordChainSystem.createRoom({
        guildId: interaction.guildId ?? 'dm',
        channelId: interaction.channelId,
        hostId: uid,
        hostName: uname,
        invitedUserId: invited?.id ?? null,
        invitedIsBot: Boolean(invited?.bot),
      });
      room.hostAvatarUrl = resolveUserAvatarUrl(interaction.user, null);

      const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig(), invited?.id ?? null);
      const replyRes = await safeReplyV2(interaction, payload);
      room.channelRef = interaction.channel ?? null;
      let msg = replyRes && typeof replyRes.edit === 'function' ? replyRes : null;
      if (!msg && typeof interaction.fetchReply === 'function') {
        msg = await interaction.fetchReply().catch(() => null);
      }
      if (msg) {
        wordChainSystem.attachBoardMessage(room.roomId, msg);
      }
      return;
    }

    if (sub === 'join') {
      const code = interaction.options?.getString?.('room') ?? null;
      const room = wordChainSystem.joinRoom({
        guildId: interaction.guildId ?? 'dm',
        channelId: interaction.channelId,
        userId: uid,
        username: uname,
        roomId: code,
      });
      room.guestAvatarUrl = resolveUserAvatarUrl(interaction.user, null);
      room.channelRef = interaction.channel ?? room.channelRef ?? null;

      const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await editNoituBoardMessage(room.boardMessage, payload);
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: `✅ Đã Vào Phòng #${room.roomId}`,
            body: `Bạn đã ngồi vào ghế Tuyển Thủ 2! Chờ chủ phòng <@${room.hostId}> bấm **Bắt Đầu Đấu**.`,
            accentColor: THEME.CYBER_EMERALD,
            ephemeral: true,
          })
        );
      } else {
        const replyRes = await safeReplyV2(interaction, payload);
        const msg =
          replyRes && typeof replyRes.edit === 'function'
            ? replyRes
            : await interaction.fetchReply?.().catch(() => null);
        if (msg) wordChainSystem.attachBoardMessage(room.roomId, msg);
      }
      return;
    }

    if (sub === 'start') {
      const code = interaction.options?.getString?.('room') ?? null;
      const room = wordChainSystem.startMatch({
        roomId: code,
        channelId: interaction.channelId,
        actorId: uid,
      });
      room.channelRef = interaction.channel ?? room.channelRef ?? null;

      const startPayload = buildMatchStartPayload(room, wordChainSystem.getConfig().baseReward);
      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await editNoituBoardMessage(room.boardMessage, startPayload);
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: `🚀 Trận Đấu #${room.roomId} Đã Khởi Tranh!`,
            body: 'Lượt mở màn thuộc về bạn — hãy nhập từ ghép 2 tiếng đầu tiên vào kênh chat!',
            accentColor: THEME.NEON_CYAN,
            ephemeral: true,
          })
        );
      } else {
        const replyRes = await safeReplyV2(interaction, startPayload);
        const msg =
          replyRes && typeof replyRes.edit === 'function'
            ? replyRes
            : await interaction.fetchReply?.().catch(() => null);
        if (msg) wordChainSystem.attachBoardMessage(room.roomId, msg);
      }
      return;
    }

    if (sub === 'surrender') {
      const { room, outcome } = wordChainSystem.surrender({ userId: uid });
      if (!outcome) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: 'ℹ️ Trận Đấu Đã Kết Thúc',
            body: 'Trận đấu này đã phân định thắng thua trước đó.',
            accentColor: THEME.SLATE_DARK,
            ephemeral: true,
          })
        );
        return;
      }

      await cleanupRoomFeedbackMessage(room);
      const victoryPayload = buildVictoryPayload(outcome);

      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await editNoituBoardMessage(room.boardMessage, victoryPayload);
      }
      await safeReplyV2(interaction, victoryPayload);
    }
  },
};

export async function cleanupRoomFeedbackMessage(room) {
  if (room?.feedbackMessage && typeof room.feedbackMessage.delete === 'function') {
    const old = room.feedbackMessage;
    room.feedbackMessage = null;
    await old.delete().catch(() => {});
  }
}

/**
 * Gắn bộ xử lý giao diện Components V2 tự động khi còn 10 giây hoặc khi hết giờ xử thua AFK.
 */
export function registerNoituUiHooks(wordChainSystem) {
  wordChainSystem.setUiHooks({
    onTenSecWarning: async (room) => {
      if (room.status !== 'playing') return;

      const warnPayload = buildCv2NoticePayload({
        title: '⏰ CẢNH BÁO ĐỒNG HỒ: CHỈ CÒN 10 GIÂY!',
        body:
          `<@${room.currentTurnUserId}> chỉ còn **10 giây** (\`${renderNeonBar(3, 10, 10)}\`) để nhập từ hợp lệ` +
          (room.requiredPrefix ? ` bắt đầu bằng **${capitalizeVi(room.requiredPrefix)}**!` : '!'),
        accentColor: THEME.AMBER_PULSE,
        clearAttachments: true,
        allowedMentions: { users: [room.currentTurnUserId] },
      });

      const channel = room.channelRef ?? room.boardMessage?.channel ?? null;
      if (room.feedbackMessage && typeof room.feedbackMessage.edit === 'function') {
        await editNoituBoardMessage(room.feedbackMessage, warnPayload);
      } else if (channel && typeof channel.send === 'function') {
        room.feedbackMessage = await channel.send(warnPayload).catch(() => null);
      }
    },

    onMatchEnded: async (room, outcome) => {
      await cleanupRoomFeedbackMessage(room);
      const victoryPayload = buildVictoryPayload(outcome);

      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await editNoituBoardMessage(room.boardMessage, victoryPayload);
        globalPanelCleaner.scheduleAutoDelete(room.boardMessage, DEFAULT_RESULT_TTL_MS);
        return;
      }

      const channel = room.channelRef ?? null;
      if (channel && typeof channel.send === 'function') {
        const sent = await channel.send(victoryPayload).catch(() => null);
        if (sent) {
          globalPanelCleaner.scheduleAutoDelete(sent, DEFAULT_RESULT_TTL_MS);
        }
      }
    },
  });
}

// ============================================================================
// Xử lý Nút bấm tương tác trên Phòng chờ, Hub & Trận đấu (Components V2)
// ============================================================================

export async function handleNoituInteraction(interaction, ctxOrDeps) {
  const wordChainSystem = ctxOrDeps?.wordChainSystem || ctxOrDeps?.systems?.wordChainSystem;
  const id = interaction.customId || '';
  if (!id.startsWith('noitu:') || !wordChainSystem) return false;

  const parts = id.split(':');
  const action = parts[1];
  const roomId = parts[2] || null;
  const uid = interaction.user.id;
  const uname = interaction.user.username;

  if (action === 'hub_rules') {
    await safeReplyV2(interaction, buildRulesPayload(wordChainSystem.getConfig(), true));
    return true;
  }

  if (action === 'hub_stats') {
    const stats = wordChainSystem.getPlayerStats(uid, uname);
    await safeReplyV2(interaction, buildStatsPayload(interaction.user, stats, true));
    return true;
  }

  if (action === 'hub_lb') {
    const boards = wordChainSystem.getLeaderboards(10);
    await safeReplyV2(interaction, buildLeaderboardPayload(boards, 'all', true));
    return true;
  }

  if (action === 'hub_create') {
    const room = wordChainSystem.createRoom({
      guildId: interaction.guildId ?? 'dm',
      channelId: interaction.channelId,
      hostId: uid,
      hostName: uname,
    });
    room.hostAvatarUrl = resolveUserAvatarUrl(interaction.user, null);
    const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
    const replyRes = await safeReplyV2(interaction, payload);
    const msg =
      replyRes && typeof replyRes.edit === 'function'
        ? replyRes
        : await interaction.fetchReply?.().catch(() => null);
    if (msg) wordChainSystem.attachBoardMessage(room.roomId, msg);
    return true;
  }

  if (action === 'hub_join') {
    const room = wordChainSystem.joinRoom({
      guildId: interaction.guildId ?? 'dm',
      channelId: interaction.channelId,
      userId: uid,
      username: uname,
    });
    room.guestAvatarUrl = resolveUserAvatarUrl(interaction.user, null);
    const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
    if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
      await editNoituBoardMessage(room.boardMessage, payload);
    }
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `✅ Đã Vào Phòng #${room.roomId}`,
        body: `Chờ chủ phòng <@${room.hostId}> nhấn **Bắt Đầu Đấu** nhé!`,
        accentColor: THEME.CYBER_EMERALD,
        ephemeral: true,
      })
    );
    return true;
  }

  if (action === 'join') {
    const room = wordChainSystem.joinRoom({
      guildId: interaction.guildId ?? 'dm',
      channelId: interaction.channelId,
      userId: uid,
      username: uname,
      roomId,
    });
    room.guestAvatarUrl = resolveUserAvatarUrl(interaction.user, null);
    wordChainSystem.attachBoardMessage(room.roomId, interaction.message);
    await safeUpdateV2(interaction, buildRoomLobbyPayload(room, wordChainSystem.getConfig()));
    return true;
  }

  if (action === 'cancel') {
    const room = wordChainSystem.cancelRoom({ roomId, actorId: uid });
    await safeUpdateV2(
      interaction,
      buildCv2NoticePayload({
        title: `❌ ĐÃ HỦY PHÒNG #${room.roomId}`,
        body: `Chủ phòng <@${uid}> đã đóng phòng chờ trước khi bắt đầu trận đấu.`,
        accentColor: THEME.SLATE_DARK,
        clearAttachments: true,
      })
    );
    globalPanelCleaner.scheduleAutoDelete(interaction.message, DEFAULT_RESULT_TTL_MS);
    return true;
  }

  if (action === 'start') {
    const room = wordChainSystem.startMatch({
      roomId,
      channelId: interaction.channelId,
      actorId: uid,
    });
    wordChainSystem.attachBoardMessage(room.roomId, interaction.message);
    await safeUpdateV2(
      interaction,
      buildMatchStartPayload(room, wordChainSystem.getConfig().baseReward)
    );
    return true;
  }

  if (action === 'surrender') {
    const { room, outcome } = wordChainSystem.surrender({ userId: uid, roomId });
    if (!outcome) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: 'ℹ️ Trận Đấu Đã Kết Thúc',
          body: 'Trận đấu này đã khép lại trước đó.',
          accentColor: THEME.SLATE_DARK,
          ephemeral: true,
        })
      );
      return true;
    }
    await cleanupRoomFeedbackMessage(room);
    await safeUpdateV2(interaction, buildVictoryPayload(outcome));
    globalPanelCleaner.scheduleAutoDelete(interaction.message, DEFAULT_RESULT_TTL_MS);
    return true;
  }

  return false;
}

export { editNoituBoardMessage };
