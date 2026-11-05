import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';

export function capitalizeVi(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTurnBar(room, activeUserId) {
  const p1Active = String(activeUserId) === String(room.hostId);
  const left = p1Active ? `🟢 **[ĐANG ĐẤU]** <@${room.hostId}>` : `⚪ <@${room.hostId}>`;
  const right = !p1Active ? `🟢 **[ĐANG ĐẤU]** <@${room.guestId}>` : `⚪ <@${room.guestId}>`;
  return `${left}  ━━⚔️━━  ${right}`;
}

function getActiveAvatarUrl(room, activeUserId) {
  if (!room) return null;
  return String(activeUserId) === String(room.hostId)
    ? room.hostAvatarUrl || null
    : room.guestAvatarUrl || null;
}

// ============================================================================
// Các hàm tạo Embed Game Show Nối Từ (Chỉnh sửa tại chỗ chống spam tin nhắn)
// ============================================================================

export function buildNoituHubPayload(wordChainSystem) {
  const cfg = wordChainSystem.getConfig();
  const activeCount = wordChainSystem.rooms.size;
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_NOITU, 'noitu_gameshow.png');

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🔤 GAME SHOW NỐI TỪ TIẾNG VIỆT PRO (1v1)')
    .setDescription(
      'Chào mừng đến với hệ thống **Game Show Nối Từ Đối Kháng 2 Người Chơi**!\n' +
        'Sử dụng các nút bên dưới hoặc lệnh `/noitu` để tạo phòng, mời bạn bè thi tài từ vựng và săn thưởng **VNĐ**.\n\n' +
        `• 📚 Kho từ điển cục bộ: **${wordChainSystem.dictionary.size.toLocaleString('vi-VN')} từ ghép**\n` +
        `• ⏱️ Thời gian mỗi lượt: **${cfg.timeoutSec} giây** *(Cảnh báo khi còn 10s)*\n` +
        `• 💰 Thưởng thắng trận: **+${formatVnd(cfg.baseReward)}**\n` +
        `• 🔥 Thưởng chuỗi thắng: **3 trận (+${formatVnd(cfg.streak3Bonus)}) • 5 trận (+${formatVnd(cfg.streak5Bonus)}) • 10 trận (+${formatVnd(cfg.streak10Bonus)})**\n` +
        `• 🏟️ Phòng đang hoạt động: **${activeCount} phòng**`
    )
    .setImage(banner.url)
    .setFooter({ text: 'Gõ /noitu create để mở phòng mới hoặc bấm nút bên dưới' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('noitu:hub_create')
      .setLabel('Tạo Phòng')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('noitu:hub_join')
      .setLabel('Tham Gia Nhanh')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('noitu:hub_stats')
      .setLabel('Thống Kê')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('noitu:hub_lb')
      .setLabel('Bảng Xếp Hạng')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('noitu:hub_rules')
      .setLabel('Luật Chơi')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], files: [banner.attachment], components: [row1] };
}

export const buildNoituLobbyPayload = buildNoituHubPayload;

export function buildRoomLobbyPayload(room, cfg) {
  const isFull = Boolean(room.guestId);
  const guestSlot = room.guestId
    ? `<@${room.guestId}> ✅`
    : room.invitedUserId
      ? `⏳ Đang chờ lời mời: <@${room.invitedUserId}>`
      : '⏳ *Đang chờ người chơi thứ 2 tham gia...*';

  const embed = new EmbedBuilder()
    .setColor(isFull ? COLORS.SUCCESS : COLORS.INFO)
    .setTitle(`🏠 PHÒNG CHỜ NỐI TỪ — #${room.roomId}`)
    .setDescription(
      `👑 **Chủ phòng (Người chơi 1):** <@${room.hostId}>\n` +
        `⚔️ **Đối thủ (Người chơi 2):** ${guestSlot}\n\n` +
        `⏱️ **Thời gian suy nghĩ:** ${room.turnTimeoutSec} giây/lượt\n` +
        `💰 **Phần thưởng chiến thắng:** +${formatVnd(cfg.baseReward)} *(cộng thêm thưởng chuỗi thắng)*\n\n` +
        (isFull
          ? `✅ **Đã đủ 2/2 người chơi!** Chủ phòng <@${room.hostId}> hãy bấm **Bắt Đầu** hoặc gõ \`/noitu start\`!`
          : `👉 Nhấn nút **Tham Gia Phòng** hoặc gõ \`/noitu join ma_phong:${room.roomId}\` để vào bàn!`)
    )
    .setFooter({ text: `Mã phòng: ${room.roomId} • Chỉ chủ phòng có quyền Bắt đầu hoặc Hủy phòng` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noitu:join:${room.roomId}`)
      .setLabel(isFull ? 'Đã Đủ 2/2 Người' : 'Tham Gia Phòng')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isFull),
    new ButtonBuilder()
      .setCustomId(`noitu:start:${room.roomId}`)
      .setLabel('Bắt Đầu')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isFull),
    new ButtonBuilder()
      .setCustomId(`noitu:cancel:${room.roomId}`)
      .setLabel('Hủy Phòng')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

export function buildMatchStartPayload(room, rewardVnd = 1_000) {
  const deadlineUnix = Math.floor((room.turnDeadlineAt || Date.now() + 30_000) / 1000);
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_NOITU, 'noitu_stage.png');
  const activeAvatar = getActiveAvatarUrl(room, room.currentTurnUserId);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🎮 NỐI TỪ TIẾNG VIỆT – BẮT ĐẦU! [#${room.roomId}]`)
    .setDescription(
      `📺 **Thanh Lượt Chơi:** ${buildTurnBar(room, room.currentTurnUserId)}\n\n` +
        `💰 **Giải thưởng trận:** **+${formatVnd(rewardVnd)}** *(+ thưởng chuỗi thắng)*\n\n` +
        `🔗 **Lượt mở màn:** Nhập bất kỳ từ ghép **2 tiếng tiếng Việt** hợp lệ trong từ điển *(ví dụ: Học sinh)*\n\n` +
        `⏳ **Lượt hiện tại:** <@${room.currentTurnUserId}>\n\n` +
        `Thời gian còn lại: **${room.turnTimeoutSec} giây** (<t:${deadlineUnix}:R>)`
    )
    .setImage(banner.url)
    .setFooter({ text: `Phòng ${room.roomId} • Gõ trực tiếp từ ghép 2 tiếng vào kênh chat` })
    .setTimestamp();

  if (activeAvatar) embed.setThumbnail(activeAvatar);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noitu:surrender:${room.roomId}`)
      .setLabel('Đầu Hàng')
      .setEmoji('🏳️')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], files: [banner.attachment], components: [row] };
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
  const timeText = tenSecWarning
    ? `⚠️ **Chỉ còn 10 giây!** (<t:${deadlineUnix}:R>)`
    : `**${timeoutSec} giây.** (<t:${deadlineUnix}:R>)`;
  const activeAvatar = getActiveAvatarUrl(room, nextTurnUserId);

  const recentTrail = Array.isArray(room.wordHistory) && room.wordHistory.length > 0
    ? room.wordHistory
        .slice(-6)
        .map((h) => `\`${capitalizeVi(h.word)}\``)
        .join(' ➔ ')
    : `\`${capitalizeVi(acceptedWord)}\``;

  const embed = new EmbedBuilder()
    .setColor(tenSecWarning ? COLORS.WARNING : 0x2ecc71)
    .setTitle('🟢 NỐI TỪ – HỢP LỆ!')
    .setDescription(
      `📺 **Thanh Lượt Chơi:** ${buildTurnBar(room, nextTurnUserId)}\n\n` +
        `👤 Người chơi vừa nối: <@${playerUserId}>\n` +
        `📝 Từ hiện tại: **${capitalizeVi(acceptedWord)}**\n` +
        `🔗 Tiếng cần nối tiếp: **${capitalizeVi(nextPrefix)}**\n` +
        `📜 Lịch sử từ gần đây: ${recentTrail}\n\n` +
        `⏳ Lượt tiếp theo: <@${nextTurnUserId}> • Thời gian còn lại: ${timeText}`
    )
    .setFooter({ text: `Phòng ${room.roomId} • Lượt nối thứ ${room.turnCount}` })
    .setTimestamp();

  if (activeAvatar) embed.setThumbnail(activeAvatar);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noitu:surrender:${room.roomId}`)
      .setLabel('Đầu Hàng')
      .setEmoji('🏳️')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

export function buildInvalidWordEmbed({ code, word, requiredPrefix, remainingSec, currentTurnUserId }) {
  if (code === 'WRONG_TURN') {
    return new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle('⛔ CHƯA ĐẾN LƯỢT CỦA BẠN!')
      .setDescription(
        `Không được tự nối từ của chính mình hoặc trả lời khi chưa đến lượt.\n\n` +
          `⏳ Lượt hiện tại đang thuộc về: <@${currentTurnUserId}>`
      );
  }

  if (code === 'ALREADY_USED') {
    const reqLine = requiredPrefix
      ? `\n🔗 Yêu cầu: Từ phải bắt đầu bằng **${capitalizeVi(requiredPrefix)}**.`
      : '';
    return new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ TỪ ĐÃ ĐƯỢC SỬ DỤNG!')
      .setDescription(
        `Từ **${capitalizeVi(word)}** đã xuất hiện trong ván hiện tại.\n\n` +
          `Vui lòng chọn một từ khác.${reqLine}\n\n` +
          `⏳ Bạn vẫn còn lượt chơi (**${remainingSec} giây**). Hãy thử lại!`
      );
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

  return new EmbedBuilder()
    .setColor(COLORS.DANGER)
    .setTitle('🔴 TỪ KHÔNG HỢP LỆ!')
    .setDescription(
      `${reasonDetail}\n\n` +
        `${reqText}\n\n` +
        `⏳ Bạn vẫn còn lượt chơi (**${remainingSec} giây**). Hãy thử lại!`
    );
}

export function buildVictoryPayload(outcome) {
  const reasonMap = {
    NO_MORE_WORDS: `Từ **${capitalizeVi(outcome.lastWord)}** không còn từ hợp lệ nào trong từ điển có thể nối tiếp!`,
    TIMEOUT: `Đối thủ <@${outcome.loserId}> không trả lời trong thời gian quy định.`,
    SURRENDER: `Đối thủ <@${outcome.loserId}> đã chấp nhận đầu hàng.`,
  };

  const streakLine =
    outcome.streakBonusVnd > 0
      ? ` *(Gồm +${formatVnd(outcome.baseRewardVnd)} thắng trận & +${formatVnd(outcome.streakBonusVnd)} thưởng chuỗi ${outcome.newStreak} trận liên tiếp!)*`
      : outcome.newStreak >= 2
        ? ` *(Chuỗi thắng hiện tại: **${outcome.newStreak}** trận)*`
        : '';

  const victoryBanner = buildAssetAttachment(ASSET_PATHS.VICTORY_BANNER, 'noitu_victory.png');

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏆 CHÚC MỪNG! BẠN ĐÃ CHIẾN THẮNG!')
    .setDescription(
      `👑 Người chiến thắng: <@${outcome.winnerId}>\n\n` +
        `💰 Phần thưởng: **+${formatVnd(outcome.totalRewardVnd)}**${streakLine}\n\n` +
        `📊 Tổng số lượt nối: **${outcome.totalTurns}**\n\n` +
        `📌 Kết quả: ${reasonMap[outcome.reason] || outcome.reason}\n\n` +
        `🎮 Cảm ơn mọi người đã tham gia!`
    )
    .setImage(victoryBanner.url)
    .setFooter({ text: `Phòng ${outcome.roomId} • Gõ /noitu create để mở ván mới` })
    .setTimestamp();

  return { embeds: [embed], files: [victoryBanner.attachment], components: [] };
}

export function buildRulesEmbed(cfg) {
  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('📖 LUẬT CHƠI NỐI TỪ TIẾNG VIỆT PRO (2 NGƯỜI)')
    .setDescription(
      '**1. Luật nối từ cốt lõi:**\n' +
        '• Dành cho **2 người chơi** thi đấu đối kháng theo lượt (Ví dụ: *Học sinh* ➔ *Sinh viên* ➔ *Viên chức* ➔ *Chức năng*).\n' +
        '• Tiếng đầu tiên của từ sau phải **trùng chính xác** với tiếng cuối cùng của từ trước.\n' +
        '• Chỉ chấp nhận từ ghép 2 tiếng có trong từ điển tiếng Việt hợp lệ, không phân biệt hoa/thường.\n' +
        '• Không được lặp lại từ đã dùng trong ván, không gửi nhiều đáp án cùng lúc, không nối khi chưa tới lượt.\n\n' +
        '**2. Điều kiện chiến thắng:**\n' +
        `• **Đối thủ hết giờ:** Mỗi lượt có **${cfg.timeoutSec} giây** (cảnh báo khi còn 10s). Quá giờ không trả lời sẽ tự động thua.\n` +
        '• **Đối thủ đầu hàng:** Bấm nút `🏳️ Đầu Hàng` hoặc gõ `/noitu surrender`.\n' +
        '• **Khóa từ kết thúc đặc biệt:** Khi từ hợp lệ bạn vừa đưa ra khiến tiếng cuối **không còn bất kỳ từ hợp lệ nào trong từ điển** nối tiếp được, **bạn lập tức chiến thắng**!\n\n' +
        '**3. Cơ cấu phần thưởng VNĐ:**\n' +
        `• Thắng 1 trận: **+${formatVnd(cfg.baseReward)}**\n` +
        `• Chuỗi thắng **3 trận** liên tiếp: thưởng thêm **+${formatVnd(cfg.streak3Bonus)}**\n` +
        `• Chuỗi thắng **5 trận** liên tiếp: thưởng thêm **+${formatVnd(cfg.streak5Bonus)}**\n` +
        `• Chuỗi thắng **10 trận** liên tiếp: thưởng thêm **+${formatVnd(cfg.streak10Bonus)}**`
    )
    .setFooter({ text: 'Chính sách bảo vệ: Nếu Bot bảo trì/restart giữa trận, chuỗi thắng được bảo toàn an toàn 100%.' });
}

export function buildStatsEmbed(targetUser, stats) {
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`📊 THỐNG KÊ NỐI TỪ — ${targetUser.username}`)
    .addFields(
      { name: '🎮 Tổng số trận', value: `**${stats.totalMatches}**`, inline: true },
      { name: '🏆 Tổng trận thắng', value: `**${stats.wins}**`, inline: true },
      { name: '💔 Tổng trận thua', value: `**${stats.losses}**`, inline: true },
      { name: '📈 Tỷ lệ chiến thắng', value: `**${stats.winRate}%**`, inline: true },
      { name: '🔥 Chuỗi thắng hiện tại', value: `**${stats.currentStreak}**`, inline: true },
      { name: '👑 Chuỗi thắng cao nhất', value: `**${stats.bestStreak}**`, inline: true },
      { name: '💰 Tổng VNĐ kiếm được', value: `**${formatVnd(stats.totalVndEarned)}**`, inline: false }
    )
    .setTimestamp();
}

export function buildLeaderboardEmbed(boards, category = 'all') {
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

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏆 BẢNG XẾP HẠNG NỐI TỪ TIẾNG VIỆT PRO')
    .setTimestamp();

  if (category === 'wins') {
    embed.setDescription(`### 👑 Top Người Thắng Nhiều Nhất\n${fmtWins(boards.topWins)}`);
  } else if (category === 'streak') {
    embed.setDescription(`### 🔥 Top Chuỗi Thắng Dài Nhất\n${fmtStreaks(boards.topStreaks)}`);
  } else if (category === 'active') {
    embed.setDescription(`### ⚡ Top Người Chơi Tích Cực Nhất\n${fmtActive(boards.topActive)}`);
  } else {
    embed.addFields(
      { name: '👑 Top Thắng Nhiều Nhất', value: fmtWins(boards.topWins.slice(0, 5)), inline: false },
      { name: '🔥 Top Chuỗi Thắng Dài Nhất', value: fmtStreaks(boards.topStreaks.slice(0, 5)), inline: false },
      { name: '⚡ Top Người Chơi Tích Cực Nhất', value: fmtActive(boards.topActive.slice(0, 5)), inline: false }
    );
  }

  return embed;
}

// ============================================================================
// Slash Command /noitu (8 Subcommands chuẩn đặc tả)
// ============================================================================

export const noituCommand = {
  data: new SlashCommandBuilder()
    .setName('noitu')
    .setDescription('Trò chơi Nối Từ Tiếng Việt PRO đối kháng 2 người chơi thưởng VNĐ')
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
      await interaction.reply(buildNoituHubPayload(wordChainSystem));
      return;
    }

    if (sub === 'rules') {
      await interaction.reply({
        embeds: [buildRulesEmbed(wordChainSystem.getConfig())],
      });
      return;
    }

    if (sub === 'stats') {
      const target = interaction.options?.getUser?.('user') ?? interaction.user;
      const stats = wordChainSystem.getPlayerStats(target.id, target.username);
      await interaction.reply({
        embeds: [buildStatsEmbed(target, stats)],
      });
      return;
    }

    if (sub === 'leaderboard') {
      const type = interaction.options?.getString?.('type') ?? 'all';
      const boards = wordChainSystem.getLeaderboards(10);
      await interaction.reply({
        embeds: [buildLeaderboardEmbed(boards, type)],
      });
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
      room.hostAvatarUrl = interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;

      const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
      if (invited) {
        payload.content = `📩 <@${invited.id}> ơi, <@${uid}> vừa mời bạn vào phòng đấu **Nối Từ #${room.roomId}**!`;
        payload.allowedMentions = { users: [invited.id] };
      }

      const replyRes = await interaction.reply(payload);
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
      room.guestAvatarUrl = interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;
      room.channelRef = interaction.channel ?? room.channelRef ?? null;

      const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await room.boardMessage.edit({ content: null, ...payload }).catch(() => {});
        await interaction.reply({
          content: `✅ Bạn đã tham gia phòng **#${room.roomId}** thành công! Đang chờ chủ phòng <@${room.hostId}> bắt đầu.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        const replyRes = await interaction.reply(payload);
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

      const startPayload = buildMatchStartPayload(room);
      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await room.boardMessage.edit({ content: null, ...startPayload }).catch(() => {});
        await interaction.reply({
          content: `🚀 Trận đấu phòng **#${room.roomId}** đã bắt đầu! Lượt đầu tiên thuộc về bạn.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        const replyRes = await interaction.reply(startPayload);
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
        await interaction.reply({
          content: 'ℹ️ Trận đấu này đã kết thúc trước đó.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await cleanupRoomFeedbackMessage(room);
      const victoryPayload = buildVictoryPayload(outcome);

      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await room.boardMessage.edit({ content: null, ...victoryPayload }).catch(() => {});
      }
      await interaction.reply(victoryPayload);
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
 * Gắn bộ xử lý giao diện tự động khi còn 10 giây hoặc khi hết giờ xử thua AFK.
 */
export function registerNoituUiHooks(wordChainSystem) {
  wordChainSystem.setUiHooks({
    onTenSecWarning: async (room) => {
      if (room.status !== 'playing') return;

      const warnEmbed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⏰ CẢNH BÁO: CÒN 10 GIÂY!')
        .setDescription(
          `<@${room.currentTurnUserId}> chỉ còn **10 giây** để nhập từ hợp lệ` +
            (room.requiredPrefix ? ` bắt đầu bằng **${capitalizeVi(room.requiredPrefix)}**!` : '!')
        );

      const channel = room.channelRef ?? room.boardMessage?.channel ?? null;
      if (room.feedbackMessage && typeof room.feedbackMessage.edit === 'function') {
        await room.feedbackMessage
          .edit({
            content: `<@${room.currentTurnUserId}>`,
            embeds: [warnEmbed],
            allowedMentions: { users: [room.currentTurnUserId] },
          })
          .catch(() => {});
      } else if (channel && typeof channel.send === 'function') {
        room.feedbackMessage = await channel
          .send({
            content: `<@${room.currentTurnUserId}>`,
            embeds: [warnEmbed],
            allowedMentions: { users: [room.currentTurnUserId] },
          })
          .catch(() => null);
      }
    },

    onMatchEnded: async (room, outcome) => {
      await cleanupRoomFeedbackMessage(room);
      const victoryPayload = buildVictoryPayload(outcome);

      if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
        await room.boardMessage.edit({ content: null, ...victoryPayload }).catch(() => {});
        return;
      }

      const channel = room.channelRef ?? null;
      if (channel && typeof channel.send === 'function') {
        await channel.send(victoryPayload).catch(() => {});
      }
    },
  });
}

// ============================================================================
// Xử lý Nút bấm tương tác trên Phòng chờ, Hub & Trận đấu
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
    await interaction.reply({
      embeds: [buildRulesEmbed(wordChainSystem.getConfig())],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'hub_stats') {
    const stats = wordChainSystem.getPlayerStats(uid, uname);
    await interaction.reply({
      embeds: [buildStatsEmbed(interaction.user, stats)],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'hub_lb') {
    const boards = wordChainSystem.getLeaderboards(10);
    await interaction.reply({
      embeds: [buildLeaderboardEmbed(boards, 'all')],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'hub_create') {
    const room = wordChainSystem.createRoom({
      guildId: interaction.guildId ?? 'dm',
      channelId: interaction.channelId,
      hostId: uid,
      hostName: uname,
    });
    room.hostAvatarUrl = interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;
    const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
    const replyRes = await interaction.reply(payload);
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
    room.guestAvatarUrl = interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;
    const payload = buildRoomLobbyPayload(room, wordChainSystem.getConfig());
    if (room.boardMessage && typeof room.boardMessage.edit === 'function') {
      await room.boardMessage.edit({ content: null, ...payload }).catch(() => {});
    }
    await interaction.reply({
      content: `✅ Đã vào phòng **#${room.roomId}**! Chờ chủ phòng <@${room.hostId}> bấm **Bắt Đầu**.`,
      flags: MessageFlags.Ephemeral,
    });
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
    room.guestAvatarUrl = interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null;
    wordChainSystem.attachBoardMessage(room.roomId, interaction.message);
    await interaction.update({
      content: null,
      ...buildRoomLobbyPayload(room, wordChainSystem.getConfig()),
    });
    return true;
  }

  if (action === 'cancel') {
    const room = wordChainSystem.cancelRoom({ roomId, actorId: uid });
    await interaction.update({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle(`❌ ĐÃ HỦY PHÒNG #${room.roomId}`)
          .setDescription(`Chủ phòng <@${uid}> đã hủy phòng chờ trước khi bắt đầu trận đấu.`),
      ],
      components: [],
    });
    return true;
  }

  if (action === 'start') {
    const room = wordChainSystem.startMatch({
      roomId,
      channelId: interaction.channelId,
      actorId: uid,
    });
    wordChainSystem.attachBoardMessage(room.roomId, interaction.message);
    await interaction.update({
      content: null,
      ...buildMatchStartPayload(room),
    });
    return true;
  }

  if (action === 'surrender') {
    const { room, outcome } = wordChainSystem.surrender({ userId: uid, roomId });
    if (!outcome) {
      await interaction.reply({
        content: 'ℹ️ Trận đấu này đã kết thúc trước đó.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    await cleanupRoomFeedbackMessage(room);
    await interaction.update({
      content: null,
      ...buildVictoryPayload(outcome),
    });
    return true;
  }

  return false;
}
