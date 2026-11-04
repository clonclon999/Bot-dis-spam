import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { BOT_ROLES, TITLES } from '../../config/constants.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';
import { hasBotRole, resolveBotRole } from '../../utils/permissions.js';
import { buildAdminDashboardPayload } from '../admin/index.js';

const HELP_CATEGORIES = {
  overview: {
    label: '🏠 Tổng Quan Hệ Thống',
    emoji: '🏠',
    title: '🎮 DISCORD GAME BOT PRO — TRUNG TÂM HƯỚNG DẪN',
    body: [
      'Chào mừng bạn đến với hệ sinh thái **Kinh Tế VNĐ, Trò Chơi Dân Gian, Thú Cưng, Nhiệm Vụ & Chống Spam @Mention**!',
      '',
      '📌 **Các phân khu chính (Chọn ở Menu bên dưới để xem chi tiết):**',
      '• 💰 **Economy:** Tiền tệ VNĐ, điểm danh, đi làm, chuyển khoản & Ngân hàng sinh lãi.',
      '• 🎲 **Games:** Bầu Cua, Tài Xỉu, Tung Đồng Xu, Đoán Số, Đua Thú & Oẳn Tù Tì PvP.',
      '• 📜 **Quest & Event:** Nhiệm vụ Ngày/Tuần/Đặc biệt & Sự kiện đua Top máy chủ.',
      '• 🛒 **Shop & Pets:** Cửa hàng vật phẩm, Hộp quà bí ẩn & Hệ thống nuôi Thú cưng.',
      '• 👤 **Profile & Crime:** Hồ sơ cấp độ, Danh hiệu, Cướp tiền & Săn thưởng Truy Nã.',
      '• 🛡️ **Admin & Anti-Spam:** Quản trị ADMIN PRO, Đặc quyền OWNER & Chống Spam Tag.',
    ].join('\n'),
  },
  economy: {
    label: 'Economy — Kinh tế & Ngân hàng',
    emoji: '💰',
    title: '💰 Danh Mục ECONOMY — Tiền Tệ VNĐ & Ngân Hàng',
    body: [
      '• `/balance [user]` — Xem số dư Ví, Ngân hàng, Tiết kiệm & xếp hạng.',
      '• `/daily` • `/weekly` • `/monthly` — Nhận thưởng định kỳ (tích chuỗi ngày).',
      '• `/work` • `/beg` — Đi làm kiếm lương hoặc ăn xin may rủi.',
      '• `/pay <user> <amount>` — Chuyển khoản VNĐ an toàn giữa người chơi.',
      '• `/deposit <amount>` • `/withdraw <amount>` — Gửi/Rút Ngân hàng & Sổ tiết kiệm.',
      '• `/interest` — Xem lãi suất & chốt lời tiền gửi tự động.',
      '• `/top` • `/history` — Bảng xếp hạng Đại Gia & Sao kê giao dịch gần nhất.',
    ].join('\n'),
  },
  games: {
    label: 'Games — Trò chơi giải trí',
    emoji: '🎲',
    title: '🎲 Danh Mục GAMES — Sòng Giải Trí Công Bằng (Crypto RNG)',
    body: [
      '• `/baucua [bet] [mascot]` — Bầu Cua 6 linh vật (hỗ trợ cược nhiều cửa bằng Menu & Modal!).',
      '• `/taixiu [bet] [choice]` — Tài Xỉu 3 xúc xắc truyền thống + Thống kê cầu gần nhất.',
      '• `/coinflip <bet> <side>` — Tung đồng xu Sấp / Ngửa nhân đôi tiền thưởng.',
      '• `/guess <bet> [difficulty]` — Đoán số bí mật 3 cấp độ (Dễ x3 • Vừa x5 • Khó x10).',
      '• `/race <bet> <racer>` — Đua thú trực tiếp cập nhật đường đua thời gian thực (x4.5).',
      '• `/rps <bet> [choice] [opponent]` — Oẳn Tù Tì đấu với Bot hoặc thách đấu PvP ăn tiền!',
    ].join('\n'),
  },
  quest: {
    label: 'Quest — Nhiệm vụ & Sự kiện',
    emoji: '📜',
    title: '📜 Danh Mục QUEST & EVENT — Nhiệm Vụ & Đua Top',
    body: [
      '• `/quest daily` — 6 nhiệm vụ hằng ngày kèm thanh tiến độ trực quan.',
      '• `/quest weekly` — 4 nhiệm vụ lớn hằng tuần thưởng đậm.',
      '• `/quest special` — Nhiệm vụ Tân Thủ, Cao Thủ & Sự kiện giới hạn.',
      '• `/quest claim [quest_id]` — Nhận thưởng nhiệm vụ (hoặc bấm nút **Nhận Thưởng Ngay**).',
      '• `/event list` • `/event leaderboard <id>` — Theo dõi các giải đua Top Server.',
    ].join('\n'),
  },
  shop: {
    label: 'Shop — Cửa hàng & Thú cưng',
    emoji: '🛒',
    title: '🛒 Danh Mục SHOP & PETS — Mua Sắm & Nuôi Thú',
    body: [
      '• `/shop` • `/buy` • `/inventory` • `/use` • `/sell` — Mua & dùng Vé May Mắn, Thẻ x2 EXP, Bảo Hiểm, Khung Hồ Sơ, Danh Hiệu & **Hộp Quà Bí Ẩn**.',
      '• `/pet shop` • `/pet buy` — Nhận nuôi Chó, Mèo, Cáo, Phượng Hoàng, Kỳ Lân & Rồng Thần.',
      '• `/pet info` • `/pet feed` • `/pet upgrade` • `/pet rename` • `/pet equip` • `/pet collection` — Chăm sóc thú cưng nhận Bonus EXP & thưởng Nhiệm vụ.',
    ].join('\n'),
  },
  profile: {
    label: 'Profile — Hồ sơ & Truy nã',
    emoji: '👤',
    title: '👤 Danh Mục PROFILE & CRIME — Hồ Sơ & Giang Hồ',
    body: [
      '• `/profile [user] [equip_title]` — Xem Cấp độ, Huy hiệu, Khung viền & đổi Danh hiệu.',
      '• `/rob <target>` — Lẻn cướp ví tiền mặt của người khác (thất bại bị phạt & tăng Truy Nã!).',
      '• `/protect [days]` — Mua Bảo Hiểm Chống Cướp bảo vệ ví tiền an toàn.',
      '• `/bounty <target> <amount>` — Treo thưởng Truy Nã lên mục tiêu.',
      '• `/wanted` — Xem Bảng Vàng Truy Nã (cướp trúng người bị truy nã ẵm trọn tiền thưởng!).',
    ].join('\n'),
  },
  admin: {
    label: 'Admin — Quản trị & Chống Spam',
    emoji: '🛡️',
    title: '🛡️ Danh Mục ADMIN PRO, OWNER & ANTI-SPAM',
    body: [
      '• `/admin system dashboard` — Bảng điều khiển tương tác toàn diện (Button + Select + Modal).',
      '• `/admin user ...` — Xem hồ sơ, cộng/trừ/đặt tiền, đặt cấp, reset, ban/unban, warn.',
      '• `/admin economy ...` — Chỉnh thưởng Daily/Weekly, lãi suất, giới hạn cược & xem lạm phát.',
      '• `/admin game ...` • `/admin quest ...` • `/admin event ...` — Điều hành Game, Quest, Event.',
      '• `/admin system backup|restore|maintenance|health|logs|config|announce` — Vận hành hệ thống.',
      '• `/owner ...` — Đặc quyền tối cao chỉ dành cho OWNER (`1243061570247069696`).',
      '• `/antispam ...` — Hệ thống tự động phát hiện & xử phạt Spam `@Mention` trên Server.',
    ].join('\n'),
  },
};

function buildHelpPayload(userId, catKey = 'overview') {
  const cat = HELP_CATEGORIES[catKey] ?? HELP_CATEGORIES.overview;
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(cat.title)
    .setDescription(cat.body)
    .setFooter({ text: 'Gõ /menu để mở Bảng điều khiển cá nhân thao tác nhanh bằng nút bấm!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`core:help_cat:${userId}`)
      .setPlaceholder('📂 Chọn danh mục lệnh muốn tra cứu...')
      .addOptions(
        Object.entries(HELP_CATEGORIES).map(([key, item]) => ({
          label: item.label,
          value: key,
          emoji: item.emoji,
          default: key === catKey,
        }))
      )
  );

  return { embeds: [embed], components: [row] };
}

// 1. /help
export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Xem hướng dẫn chi tiết theo từng danh mục Economy, Games, Quest, Shop, Profile & Admin')
    .addStringOption((o) =>
      o
        .setName('category')
        .setDescription('Chọn nhanh danh mục cần xem')
        .setRequired(false)
        .addChoices(
          { name: '💰 Economy (Kinh tế & Ngân hàng)', value: 'economy' },
          { name: '🎲 Games (Trò chơi dân gian & giải trí)', value: 'games' },
          { name: '📜 Quest (Nhiệm vụ & Sự kiện)', value: 'quest' },
          { name: '🛒 Shop (Cửa hàng & Thú cưng)', value: 'shop' },
          { name: '👤 Profile (Hồ sơ & Truy nã)', value: 'profile' },
          { name: '🛡️ Admin (Quản trị & Anti-Spam)', value: 'admin' }
        )
    ),
  async execute(interaction) {
    const cat = interaction.options.getString('category') ?? 'overview';
    await interaction.reply(buildHelpPayload(interaction.user.id, cat));
  },
};

// 2. /menu — Bảng điều khiển tương tác trung tâm thân thiện điện thoại & máy tính
function buildUserMenuPayload(user, ctx) {
  const { db, economySystem, petSystem, bankSystem } = ctx;
  bankSystem.settleInterest(user.id, user.username);
  const u = economySystem.ensureUser(user.id, user.username);
  const role = resolveBotRole(db, user.id);
  const titleName = TITLES[u.active_title]?.name ?? '🌱 Tân Thủ';
  const pet = petSystem.getActivePetBonuses(user.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `Trung Tâm Điều Khiển Nhanh — ${user.username}`, iconURL: user.displayAvatarURL() })
    .setDescription(
      `🏅 **${titleName}** • Vai trò: \`${role}\` • ⭐ **Cấp ${u.level}**\n` +
        `🐾 Đồng hành: ${pet.pet ? `${pet.species.emoji} **${pet.pet.nickname}** (Lv.${pet.pet.level})` : '*Chưa có*'}`
    )
    .addFields(
      { name: '💵 Ví Tiền Mặt', value: `**${formatVnd(u.wallet)}**`, inline: true },
      { name: '🏦 Ngân Hàng + TK', value: `**${formatVnd(u.bank + u.savings)}**`, inline: true },
      { name: '🔥 Chuỗi Điểm Danh', value: `**${u.login_streak} ngày**`, inline: true }
    )
    .setFooter({ text: 'Chạm các nút bên dưới để thao tác tức thì không cần gõ lại lệnh!' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`core:menu_daily:${user.id}`)
      .setLabel('Nhận /daily')
      .setEmoji('📅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`core:menu_work:${user.id}`)
      .setLabel('Đi làm /work')
      .setEmoji('💼')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`core:menu_quests:${user.id}`)
      .setLabel('Nhiệm vụ')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`core:menu_help:${user.id}`)
      .setLabel('Hướng dẫn')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary)
  );

  const rows = [row1];
  if (hasBotRole(db, user.id, BOT_ROLES.ADMIN)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`core:menu_admin:${user.id}`)
          .setLabel('Mở Bảng Điều Khiển ADMIN PRO')
          .setEmoji('🛡️')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return { embeds: [embed], components: rows };
}

export const menuCommand = {
  data: new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Mở bảng điều khiển tương tác trung tâm (Điểm danh, Đi làm, Nhiệm vụ & Quản trị nhanh)'),
  async execute(interaction, ctx) {
    await interaction.reply(buildUserMenuPayload(interaction.user, ctx));
  },
};

export async function handleCoreInteraction(interaction, ctx) {
  const id = interaction.customId || '';
  if (!id.startsWith('core:')) return false;

  const [, action, ownerId] = id.split(':');
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '⛔ Đây là bảng điều khiển của người chơi khác! Hãy gõ `/menu` hoặc `/help` cho riêng bạn.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'help_cat' && interaction.isStringSelectMenu()) {
    await interaction.update(buildHelpPayload(interaction.user.id, interaction.values[0]));
    return true;
  }

  if (action === 'menu_help') {
    await interaction.reply({ ...buildHelpPayload(interaction.user.id, 'overview'), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'menu_daily') {
    const res = ctx.economySystem.claimPeriodicReward(interaction.user.id, interaction.user.username, 'daily');
    const updated = buildUserMenuPayload(interaction.user, ctx);
    updated.embeds[0].spliceFields(0, 0, {
      name: '🎉 Điểm Danh Thành Công!',
      value: `Nhận **+${formatVnd(res.reward)}** (Chuỗi ${res.streak} ngày)!`,
    });
    await interaction.update(updated);
    return true;
  }

  if (action === 'menu_work') {
    const res = ctx.economySystem.work(interaction.user.id, interaction.user.username);
    const updated = buildUserMenuPayload(interaction.user, ctx);
    updated.embeds[0].spliceFields(0, 0, {
      name: '💼 Hoàn Thành Ca Làm Việc!',
      value: `${res.jobName}: **+${formatVnd(res.earned)}**!`,
    });
    await interaction.update(updated);
    return true;
  }

  if (action === 'menu_quests') {
    const quests = ctx.questSystem.getUserQuests(interaction.user.id, interaction.user.username, 'daily');
    const lines = quests.map((q) => `${q.claimed ? '✅' : q.claimable ? '🎁' : '⏳'} **${q.name}**: ${q.progress}/${q.target} (${formatVnd(q.rewardVnd)})`);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.PRIMARY)
          .setTitle('☀️ Nhiệm Vụ Hằng Ngày Của Bạn')
          .setDescription(lines.join('\n') + '\n\n💡 Gõ `/quest daily` để mở bảng nhận thưởng nhanh!'),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'menu_admin') {
    const role = resolveBotRole(ctx.db, interaction.user.id);
    await interaction.reply(buildAdminDashboardPayload(interaction.user.id, role, ctx));
    return true;
  }

  return false;
}

export const CORE_COMMANDS = [helpCommand, menuCommand];
