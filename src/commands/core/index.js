import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { BOT_ROLES, TITLES } from '../../config/constants.js';
import { expRequiredForLevel } from '../../systems/levelSystem.js';
import {
  buildCv2Payload,
  createContainer,
  mediaGallery,
  sectionWithThumbnail,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import {
  safeClosePanel,
  safeReplyV2,
  safeUpdateV2,
  verifyPanelOwner,
} from '../../ui/interactionHelpers.js';
import { renderNeonBar, resolveUserAvatarUrl, THEME } from '../../ui/theme.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { formatVnd } from '../../utils/format.js';
import { hasBotRole, resolveBotRole } from '../../utils/permissions.js';
import { buildAdminDashboardPayload } from '../admin/index.js';

const HELP_CATEGORIES = {
  overview: {
    label: 'Tổng Quan Hệ Thống',
    emoji: '🏠',
    title: '🎮 DISCORD GAME BOT PRO MAX — TRUNG TÂM HƯỚNG DẪN',
    body: [
      'Chào mừng bạn đến với ứng dụng **GAME CENTER PRO MAX (Discord Components V2)** — tích hợp **Kinh Tế VNĐ, 7 Trò Chơi Trực Quan, Nối Từ 1v1, Thú Cưng, Nhiệm Vụ & Chống Spam @Mention**!',
      '',
      '📌 **Các phân khu chính (Chọn nhanh ở Menu bên dưới):**',
      '• 💰 **Economy:** Tiền tệ VNĐ, điểm danh, đi làm, chuyển khoản & Ngân hàng sinh lãi.',
      '• 🎲 **Games:** `/games` Game Center PRO MAX + 7 trò chơi chính thức (Bầu Cua, Tài Xỉu, Nối Từ, Oẳn Tù Tì, Đoán Số, Đồng Xu, Đua Thú).',
      '• 📜 **Quest & Event:** 9 Nhiệm vụ Ngày, 4 Nhiệm vụ Tuần & Sự kiện đua Top Server.',
      '• 🛒 **Shop & Pets:** Cửa hàng vật phẩm, Trứng Thú Cưng & Nuôi Linh Thú.',
      '• 👤 **Profile & Crime:** Hồ sơ cấp độ, Danh hiệu, Cướp tiền & Truy Nã.',
      '• 🛡️ **Admin & Anti-Spam:** Quản trị ADMIN PRO, Cài kênh Game, OWNER & Chống Spam Tag.',
    ].join('\n'),
  },
  economy: {
    label: 'Economy — Kinh tế & Ngân hàng',
    emoji: '💰',
    title: '💰 Danh Mục ECONOMY — Tiền Tệ VNĐ & Ngân Hàng',
    body: [
      '• `/balance [user]` — Xem số dư Ví, Ngân hàng, Tiết kiệm & tài sản ròng.',
      '• `/daily` • `/weekly` • `/monthly` — Nhận thưởng định kỳ (tích chuỗi ngày).',
      '• `/work` • `/beg` — Đi làm kiếm lương hoặc ăn xin may rủi.',
      '• `/pay <user> <amount>` — Chuyển khoản VNĐ an toàn giữa người chơi.',
      '• `/deposit <amount>` • `/withdraw <amount>` — Gửi/Rút Ngân hàng & Sổ tiết kiệm.',
      '• `/interest` — Xem lãi suất & chốt lời tiền gửi tự động.',
      '• `/top` • `/history` — Bảng xếp hạng Đại Gia & Sao kê giao dịch gần nhất.',
    ].join('\n'),
  },
  games: {
    label: 'Games — Game Center & 7 Trò Chơi',
    emoji: '🎲',
    title: '🎲 Danh Mục GAMES — Game Center PRO MAX & Phiên Cược Chung 3D',
    body: [
      '• `/game start <tro_choi>` — **Mở Phiên Cược Chung Toàn Server (Public Start — Mọi thành viên đều mở được!)** cho Bầu Cua (`60s`), Tài Xỉu (`60s`) & Đua Thú (`90s`).',
      '• `/game status` • `/game history` — Xem phiên đang chạy & lịch sử kết quả phiên chung.',
      '• `/game auto status | on | off | delay` — Tự động mở phiên tiếp theo sau 10s nghỉ *(ADMIN/OWNER cấu hình)*.',
      '• `/game stop` • `/game extend` • `/game settings` — *(ADMIN/OWNER)* Dừng phiên hoàn tiền 100%, gia hạn đếm ngược & chỉnh cấu hình.',
      '• `/games` — **Mở ứng dụng Game Center PRO MAX** (7 khu vực: Trang chủ, Danh sách game, Ví tiền, Nhiệm vụ, Cửa hàng, Hồ sơ & Bảng xếp hạng).',
      '• `/baucua` — **Bầu Cua 3D PRO MAX** (lưới MediaGallery 6 linh vật 3D, đặt riêng từng cửa, thưởng **2x / 3x / 4x**).',
      '• `/taixiu` — **Tài Xỉu Casino 3D** (TÀI 11–17 & XỈU 4–10, tổng 3/18 Nhà cái thắng, bộ 3 xúc xắc 3D).',
      '• `/noitu` — **Nối Từ Tiếng Việt Đông Người** (`nsetnoitu | start! | stop!`, không giới hạn người chơi, tự ghim từ hiện tại ở đáy kênh chống trôi).',
      '• `/rps` — **Oẳn Tù Tì 3D Kéo • Búa • Bao** (hình ảnh đối đầu 2 bên, đếm ngược đồng thời, Bot & PvP).',
      '• `/guess` — **Két Sắt Đoán Số 3D** (tối đa **5 lượt đoán**, gợi ý **Lớn Hơn / Nhỏ Hơn**, mở két thưởng tới 3.5x).',
      '• `/coinflip` — **Tung Đồng Xu 3D Hoàng Gia** (đồng xu Kim Long / Hoàng Liên 3D, xoay xu nhận 2x).',
      '• `/race` — **Trường Đua Thú 3D** (5 chiến thú tranh tài: **Hạng 1 nhận 2.4x • Top 2 nhận 1.4x • Top 3 nhận 1.1x**).',
    ].join('\n'),
  },
  quest: {
    label: 'Quest — Nhiệm vụ & Sự kiện',
    emoji: '📜',
    title: '📜 Danh Mục QUEST & EVENT — Nhiệm Vụ & Đua Top',
    body: [
      '• `/quest daily` — **9 nhiệm vụ hằng ngày** (Đăng nhập, Đi làm & đủ cả 7 trò chơi chính thức).',
      '• `/quest weekly` — **4 nhiệm vụ lớn hằng tuần** (Tổng trận, Thắng trận, Tích lũy VNĐ & Chuỗi nhiệm vụ).',
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
      '• `/shop` • `/buy` • `/inventory` • `/use` • `/sell` — Mua & dùng Vé May Mắn, Thẻ x2 EXP, Bảo Hiểm, Trứng Thú Cưng, Khung Hồ Sơ, Danh Hiệu & Hộp Quà Bí Ẩn.',
      '• `/pet shop` • `/pet buy` — Nhận nuôi Chó, Mèo, Cáo, Phượng Hoàng, Kỳ Lân & Rồng.',
      '• `/pet info` • `/pet feed` • `/pet upgrade` • `/pet rename` • `/pet equip` • `/pet collection` — Chăm sóc thú cưng nhận Bonus EXP & Nhiệm vụ.',
    ].join('\n'),
  },
  profile: {
    label: 'Profile — Hồ sơ & Truy nã',
    emoji: '👤',
    title: '👤 Danh Mục PROFILE & CRIME — Hồ Sơ & Giang Hồ',
    body: [
      '• `/profile [user] [equip_title]` — Xem Cấp độ, Huy hiệu, Khung viền & đổi Danh hiệu.',
      '• `/rob <target>` — Lẻn cướp ví tiền mặt của người khác (chống farm lặp mục tiêu).',
      '• `/protect [days]` — Mua Bảo Hiểm Chống Cướp bảo vệ ví tiền an toàn.',
      '• `/bounty <target> <amount>` — Treo thưởng Truy Nã lên mục tiêu.',
      '• `/wanted` — Xem Bảng Vàng Truy Nã toàn Server.',
    ].join('\n'),
  },
  admin: {
    label: 'Admin — Quản trị, Kênh Game & Anti-Spam',
    emoji: '🛡️',
    title: '🛡️ Danh Mục ADMIN PRO, KÊNH GAME, OWNER & ANTI-SPAM',
    body: [
      '• `/admin game setchannel <game> <ch>` — **Chỉ định kênh chat bắt buộc cho từng trò chơi**.',
      '• `/admin game channels` • `/admin game clearchannel` — Xem hoặc gỡ kênh trò chơi.',
      '• `/admin noitu reward|cooldown|timeout|enable|disable|addword` — Điều chỉnh thưởng VNĐ, thời gian & từ điển Nối Từ PRO.',
      '• `/admin system dashboard` — Bảng điều khiển tương tác toàn diện.',
      '• `/admin user|economy|quest|event|system ...` — Quản lý người chơi, tiền tệ, sao lưu SQLite.',
      '• `/owner ...` — Đặc quyền tối cao chỉ dành cho OWNER (`1243061570247069696`).',
      '• `/antispam ...` — Hệ thống tự động phát hiện & xử phạt Spam `@Mention` trên Server.',
    ].join('\n'),
  },
};

function buildHelpPayload(userId, catKey = 'overview', fromMenu = false) {
  const cat = HELP_CATEGORIES[catKey] ?? HELP_CATEGORIES.overview;

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`core:help_cat:${userId}:${fromMenu ? '1' : '0'}`)
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

  const navBtns = [
    new ButtonBuilder()
      .setCustomId(`gc:home:${userId}`)
      .setLabel('Mở Game Center')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Success),
  ];
  if (fromMenu) {
    navBtns.push(
      new ButtonBuilder()
        .setCustomId(`core:menu_back:${userId}`)
        .setLabel('Quay lại Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Primary)
    );
  }
  navBtns.push(
    new ButtonBuilder()
      .setCustomId(`core:close:${userId}`)
      .setLabel('Đóng')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
  );

  const card = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      textDisplay(`## ${cat.title}\n${cat.body}`),
      separator(),
      selectRow,
      new ActionRowBuilder().addComponents(...navBtns),
    ],
  });

  return buildCv2Payload({ containers: [card], clearAttachments: true });
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
          { name: '🎲 Games (Game Center & 7 Trò chơi)', value: 'games' },
          { name: '📜 Quest (Nhiệm vụ & Sự kiện)', value: 'quest' },
          { name: '🛒 Shop (Cửa hàng & Thú cưng)', value: 'shop' },
          { name: '👤 Profile (Hồ sơ & Truy nã)', value: 'profile' },
          { name: '🛡️ Admin (Quản trị, Kênh Game & Anti-Spam)', value: 'admin' }
        )
    ),
  async execute(interaction) {
    const cat = interaction.options?.getString?.('category') ?? 'overview';
    await safeReplyV2(interaction, buildHelpPayload(interaction.user.id, cat, false));
  },
};

// 2. /menu — Bảng điều khiển tương tác trung tâm Components V2
function buildUserMenuPayload(user, ctx, flashNote = null) {
  const { db, economySystem, petSystem, bankSystem } = ctx;
  bankSystem.settleInterest(user.id, user.username);
  const u = economySystem.ensureUser(user.id, user.username);
  const reqExp = expRequiredForLevel(u.level);
  const role = resolveBotRole(db, user.id);
  const titleName = TITLES[u.active_title]?.name ?? '🌱 Tân Thủ';
  const pet = petSystem.getActivePetBonuses(user.id);

  const banner = buildAssetAttachment(ASSET_PATHS.GAME_CENTER_BANNER, 'menu_banner.png');
  const fallbackThumb = buildAssetAttachment(ASSET_PATHS.COIN_SAP, 'menu_avatar.png');
  const avatarUrl = resolveUserAvatarUrl(user, fallbackThumb.url);
  const files = avatarUrl === fallbackThumb.url ? [banner.attachment, fallbackThumb.attachment] : [banner.attachment];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:home:${user.id}`)
      .setLabel('Game Center')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`core:menu_daily:${user.id}`)
      .setLabel('Điểm danh')
      .setEmoji('📅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`core:menu_work:${user.id}`)
      .setLabel('Đi làm')
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

  const row2Btns = [
    new ButtonBuilder()
      .setCustomId(`gc:nav:${user.id}:wallet`)
      .setLabel('Ví tiền')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${user.id}:shop`)
      .setLabel('Cửa hàng')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${user.id}:profile`)
      .setLabel('Hồ sơ')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary),
  ];

  if (hasBotRole(db, user.id, BOT_ROLES.ADMIN)) {
    row2Btns.push(
      new ButtonBuilder()
        .setCustomId(`core:menu_admin:${user.id}`)
        .setLabel('ADMIN PRO')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Danger)
    );
  }
  row2Btns.push(
    new ButtonBuilder()
      .setCustomId(`core:close:${user.id}`)
      .setLabel('Đóng')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
  );

  const card = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      mediaGallery([{ url: banner.url, description: 'Trung Tâm Điều Khiển Nhanh' }]),
      sectionWithThumbnail({
        texts: [
          `## ⚡ Trung Tâm Điều Khiển Nhanh — ${user.username}\n` +
            (flashNote ? `✅ **${flashNote}**\n` : '') +
            `🏅 **${titleName}** • Vai trò: \`${role}\` • ⭐ **Cấp ${u.level}** \`${renderNeonBar(u.exp, reqExp, 8)}\``,
          `💵 **Ví Tiền Mặt:** \`${formatVnd(u.wallet)}\` • 🏦 **Bank + TK:** \`${formatVnd(u.bank + u.savings)}\`\n` +
            `🐾 **Thú cưng:** ${pet.pet ? `${pet.species.emoji} **${pet.pet.nickname}** (Lv.${pet.pet.level})` : '*Chưa có*'} • 🔥 Daily: \`${u.login_streak} ngày\``,
        ],
        url: avatarUrl,
        description: `Menu ${user.username}`,
      }),
      separator(),
      row1,
      new ActionRowBuilder().addComponents(...row2Btns.slice(0, 5)),
    ],
  });

  return buildCv2Payload({ containers: [card], files });
}

export const menuCommand = {
  data: new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Mở bảng điều khiển tương tác trung tâm Components V2 (Game Center, Điểm danh, Đi làm & Quản trị)'),
  async execute(interaction, ctx) {
    await safeReplyV2(interaction, buildUserMenuPayload(interaction.user, ctx));
  },
};

export async function handleCoreInteraction(interaction, ctx) {
  const id = interaction.customId || '';
  if (!id.startsWith('core:')) return false;

  const parts = id.split(':');
  const [, action, ownerId, extra] = parts;

  if (!(await verifyPanelOwner(interaction, ownerId, '/menu'))) {
    return true;
  }

  if (action === 'close') {
    await safeClosePanel(interaction, interaction.user.username);
    return true;
  }

  if (action === 'menu_back') {
    await safeUpdateV2(interaction, buildUserMenuPayload(interaction.user, ctx));
    return true;
  }

  if (action === 'help_cat' && interaction.isStringSelectMenu?.()) {
    const fromMenu = extra === '1';
    await safeUpdateV2(interaction, buildHelpPayload(interaction.user.id, interaction.values[0], fromMenu));
    return true;
  }

  if (action === 'menu_help') {
    await safeUpdateV2(interaction, buildHelpPayload(interaction.user.id, 'overview', true));
    return true;
  }

  if (action === 'menu_daily') {
    const res = ctx.economySystem.claimPeriodicReward(
      interaction.user.id,
      interaction.user.username,
      'daily'
    );
    await safeUpdateV2(
      interaction,
      buildUserMenuPayload(
        interaction.user,
        ctx,
        `Điểm danh thành công! Nhận +${formatVnd(res.reward)} (Chuỗi ${res.streak} ngày)`
      )
    );
    return true;
  }

  if (action === 'menu_work') {
    const res = ctx.economySystem.work(interaction.user.id, interaction.user.username);
    await safeUpdateV2(
      interaction,
      buildUserMenuPayload(
        interaction.user,
        ctx,
        `Hoàn thành ca làm việc (${res.jobName}): +${formatVnd(res.earned)}`
      )
    );
    return true;
  }

  if (action === 'menu_quests') {
    const quests = ctx.questSystem.getUserQuests(
      interaction.user.id,
      interaction.user.username,
      'daily'
    );
    const anyClaimable = quests.some((q) => q.claimable);
    const lines = quests.map(
      (q) =>
        `${q.claimed ? '✅' : q.claimable ? '🎁' : '⏳'} **${q.name}**: \`${renderNeonBar(q.progress, q.target, 7)}\` (**${q.progress}/${q.target}** • +${formatVnd(q.rewardVnd)})`
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`core:menu_claim_quests:${interaction.user.id}`)
        .setLabel('Nhận Thưởng Ngay')
        .setEmoji('🎁')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!anyClaimable),
      new ButtonBuilder()
        .setCustomId(`core:menu_back:${interaction.user.id}`)
        .setLabel('Quay lại Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`core:close:${interaction.user.id}`)
        .setLabel('Đóng')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Danger)
    );

    const card = createContainer({
      accentColor: THEME.NEON_CYAN,
      children: [
        textDisplay(`## ☀️ Nhiệm Vụ Hằng Ngày Của Bạn\n${lines.join('\n')}`),
        separator(),
        row,
      ],
    });
    await safeUpdateV2(interaction, buildCv2Payload({ containers: [card], clearAttachments: true }));
    return true;
  }

  if (action === 'menu_claim_quests') {
    const res = ctx.questSystem.claimRewards(
      interaction.user.id,
      interaction.user.username,
      null
    );
    await safeUpdateV2(
      interaction,
      buildUserMenuPayload(
        interaction.user,
        ctx,
        `Đã nhận thưởng +${formatVnd(res.totalVnd)} & +${res.expResult?.addedExp ?? 0} EXP (${res.claimedQuests.length} nhiệm vụ)!`
      )
    );
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
