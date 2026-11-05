import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  BOT_ROLES,
  EVENT_TYPES,
  GAME_IDS,
  GAME_LABELS,
  HARDCODED_OWNER_ID,
  LOG_CATEGORIES,
} from '../../config/constants.js';
import { COLORS, formatDurationVi } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';
import {
  canManageAntiSpam,
  hasBotRole,
  isHardcodedOwner,
  resolveBotRole,
} from '../../utils/permissions.js';
import {
  createConfirmationPrompt,
  handleConfirmationButton,
} from './confirmStore.js';

const GAME_CHOICES = Object.entries(GAME_LABELS).map(([val, name]) => ({
  name,
  value: val,
}));

const EVENT_CHOICES = [
  { name: '💰 Đua Top Người Giàu', value: EVENT_TYPES.RICH_RACE },
  { name: '⭐ Đua Top Cấp Độ', value: EVENT_TYPES.LEVEL_RACE },
  { name: '🦀 Sự Kiện Bầu Cua', value: EVENT_TYPES.BAUCUA_EVENT },
  { name: '🎲 Sự Kiện Tài Xỉu', value: EVENT_TYPES.TAIXIU_EVENT },
  { name: '📜 Sự Kiện Nhiệm Vụ', value: EVENT_TYPES.QUEST_EVENT },
  { name: '📅 Đăng Nhập Liên Tục', value: EVENT_TYPES.LOGIN_STREAK },
  { name: '🎉 Phát Thưởng Server', value: EVENT_TYPES.GLOBAL_AIRDROP },
];

// ============================================================================
// Bảng điều khiển tương tác ADMIN PRO (Embed + Button + Select Menu + Modal)
// ============================================================================

export function buildAdminDashboardPayload(actorId, role, { db, economySystem }) {
  const macro = economySystem.getMacroEconomyStats();
  const maint = Boolean(db.getSetting('maintenanceMode'));
  const frozen = Boolean(db.getSetting('freezeAllTransactions'));
  const gamesEnabled = db.getSetting('gamesEnabled') || {};
  const memMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

  const gameBadges = Object.entries(GAME_LABELS)
    .map(([id, label]) => `${gamesEnabled[id] !== false ? '🟢' : '🔴'} ${label}`)
    .join('  •  ');

  const embed = new EmbedBuilder()
    .setColor(maint ? COLORS.WARNING : 0x5865f2)
    .setTitle(`🛡️ BẢNG ĐIỀU KHIỂN ADMIN PRO [${role}]`)
    .setDescription(
      `• Bảo trì hệ thống: **${maint ? '🟠 ĐANG BẬT' : '🟢 Đang tắt'}**\n` +
        `• Khóa giao dịch toàn cục: **${frozen ? '❄️ ĐANG ĐÓNG BĂNG' : '🟢 Hoạt động bình thường'}**\n` +
        `• RAM tiến trình: **${memMb} MB / 512 MB** | Uptime: **${formatDurationVi(Math.floor(process.uptime()))}**`
    )
    .addFields(
      {
        name: '💰 Tổng Quan Kinh Tế VNĐ',
        value: [
          `• Người chơi: **${macro.totalUsers}**`,
          `• Tổng cung VNĐ: **${formatVnd(macro.totalSupply)}**`,
          `• Chỉ số lạm phát: **x${macro.inflationRatio}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '⚙️ Thông Số Hiện Hành',
        value: [
          `• Daily: **${formatVnd(db.getSetting('dailyReward'))}**`,
          `• Lãi NH: **${(Number(db.getSetting('bankInterestRate')) * 100).toFixed(2)}%**`,
          `• Cược: **${formatVnd(db.getSetting('minBet'))}** → **${formatVnd(db.getSetting('maxBet'))}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🎮 Trạng Thái Các Trò Chơi',
        value: gameBadges,
        inline: false,
      }
    )
    .setFooter({ text: 'Sử dụng Nút bấm & Select Menu bên dưới để điều hành nhanh' })
    .setTimestamp();

  const gameSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admdash:toggle_game:${actorId}`)
      .setPlaceholder('🎮 Bật / Tắt nhanh một trò chơi...')
      .addOptions(
        Object.entries(GAME_LABELS).map(([id, label]) => ({
          label: `${gamesEnabled[id] !== false ? '[Đang Bật]' : '[Đang Tắt]'} ${label}`,
          value: id,
          description: 'Nhấn để đảo trạng thái Bật/Tắt trò chơi này',
        }))
      )
  );

  const btnRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admdash:money_modal:${actorId}`)
      .setLabel('Cộng/Trừ Tiền (Modal)')
      .setEmoji('💸')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`admdash:announce_modal:${actorId}`)
      .setLabel('Thông Báo (Modal)')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`admdash:backup:${actorId}`)
      .setLabel('Tạo Sao Lưu')
      .setEmoji('💾')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`admdash:refresh:${actorId}`)
      .setLabel('Làm Mới')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  const rows = [gameSelectRow, btnRow1];

  // Dòng điều khiển đặc quyền chỉ hiển thị khi người mở là OWNER
  if (isHardcodedOwner(actorId)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`admdash:toggle_maint:${actorId}`)
          .setLabel(maint ? 'Tắt Bảo Trì' : 'Bật Bảo Trì')
          .setEmoji('🛠️')
          .setStyle(maint ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`admdash:toggle_freeze:${actorId}`)
          .setLabel(frozen ? 'Mở Băng Giao Dịch' : 'Đóng Băng Giao Dịch')
          .setEmoji('❄️')
          .setStyle(frozen ? ButtonStyle.Success : ButtonStyle.Danger)
      )
    );
  }

  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

// ============================================================================
// 1. Lệnh /admin (6 nhóm quản trị chuyên sâu, cô đọng chuẩn giới hạn Discord API)
// ============================================================================

export const adminCommand = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Hệ thống quản trị ADMIN PRO toàn diện')

    // Nhóm 1: Quản lý người chơi (11 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('user')
        .setDescription('Quản lý hồ sơ, tiền tệ và kỷ luật người chơi')
        .addSubcommand((s) =>
          s.setName('userinfo').setDescription('Xem chi tiết người chơi').addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('addmoney')
            .setDescription('Cộng VNĐ vào ví người chơi')
            .addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(1).setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('removemoney')
            .setDescription('Trừ VNĐ khỏi ví người chơi')
            .addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(1).setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('setmoney')
            .setDescription('Đặt số dư ví cố định (có xác nhận)')
            .addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ mới').setMinValue(0).setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('resetuser').setDescription('Xóa & đặt lại dữ liệu người chơi').addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('inventory').setDescription('Kiểm tra túi đồ người chơi').addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('setlevel')
            .setDescription('Đặt cấp độ cho người chơi')
            .addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
            .addIntegerOption((o) => o.setName('level').setDescription('Cấp mới').setMinValue(1).setMaxValue(999).setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('ban')
            .setDescription('Khóa tài khoản khỏi Bot')
            .addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Lý do khóa').setRequired(false))
        )
        .addSubcommand((s) =>
          s.setName('unban').setDescription('Mở khóa tài khoản người chơi').addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('warn')
            .setDescription('Ghi cảnh cáo vi phạm')
            .addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Lý do cảnh cáo').setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('warnings').setDescription('Xem lịch sử cảnh cáo').addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
        )
    )

    // Nhóm 2: Quản lý kinh tế (7 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('economy')
        .setDescription('Điều hành tiền tệ, lãi suất và hạn mức')
        .addSubcommand((s) => s.setName('overview').setDescription('Tổng quan kinh tế hệ thống'))
        .addSubcommand((s) =>
          s.setName('setdaily').setDescription('Đặt thưởng /daily').addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(0).setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('setweekly').setDescription('Đặt thưởng /weekly').addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(0).setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('setinterest').setDescription('Đặt % lãi ngân hàng (vd: 2.5)').addNumberOption((o) => o.setName('rate').setDescription('Phần trăm lãi').setMinValue(0).setMaxValue(50).setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('setmaxbet').setDescription('Đặt mức cược tối đa').addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(1000).setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('setminbet').setDescription('Đặt mức cược tối thiểu').addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(100).setRequired(true))
        )
        .addSubcommand((s) => s.setName('inflation').setDescription('Phân tích cung tiền & lạm phát'))
    )

    // Nhóm 3: Quản lý trò chơi & kênh riêng từng game (8 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('game')
        .setDescription('Quản lý trạng thái và kênh riêng từng trò chơi')
        .addSubcommand((s) =>
          s.setName('enable').setDescription('Mở trò chơi').addStringOption((o) => o.setName('game').setDescription('Trò chơi').setRequired(true).addChoices(...GAME_CHOICES))
        )
        .addSubcommand((s) =>
          s.setName('disable').setDescription('Khóa trò chơi').addStringOption((o) => o.setName('game').setDescription('Trò chơi').setRequired(true).addChoices(...GAME_CHOICES))
        )
        .addSubcommand((s) =>
          s
            .setName('settings')
            .setDescription('Xem/chỉnh hệ số thưởng')
            .addNumberOption((o) => o.setName('payout_mult').setDescription('Hệ số (0.5-3.0)').setMinValue(0.5).setMaxValue(3.0).setRequired(false))
        )
        .addSubcommand((s) =>
          s.setName('resetstats').setDescription('Xóa thống kê thắng thua').addUserOption((o) => o.setName('u').setDescription('Người chơi').setRequired(true))
        )
        .addSubcommand((s) => s.setName('leaderboard').setDescription('Top thắng trận nhiều nhất'))
        .addSubcommand((s) =>
          s
            .setName('setchannel')
            .setDescription('Gán kênh bắt buộc cho từng trò chơi')
            .addStringOption((o) => o.setName('game').setDescription('Trò chơi').setRequired(true).addChoices(...GAME_CHOICES))
            .addChannelOption((o) => o.setName('ch').setDescription('Kênh chat').addChannelTypes(ChannelType.GuildText).setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('clearchannel')
            .setDescription('Gỡ kênh của trò chơi')
            .addStringOption((o) => o.setName('game').setDescription('Trò chơi').setRequired(true).addChoices(...GAME_CHOICES))
        )
        .addSubcommand((s) => s.setName('channels').setDescription('Xem kênh riêng của từng trò chơi'))
    )

    // Nhóm 4: Quản lý chuyên biệt Nối Từ Tiếng Việt PRO (6 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('noitu')
        .setDescription('Cấu hình thưởng, thời gian và trạng thái Nối Từ PRO')
        .addSubcommand((s) =>
          s
            .setName('reward')
            .setDescription('Chỉnh thưởng thắng Nối Từ VNĐ')
            .addIntegerOption((o) => o.setName('amount').setDescription('VNĐ thắng 1 trận').setMinValue(0).setRequired(true))
            .addIntegerOption((o) => o.setName('s3').setDescription('Thưởng thêm chuỗi 3').setMinValue(0).setRequired(false))
            .addIntegerOption((o) => o.setName('s5').setDescription('Thưởng thêm chuỗi 5').setMinValue(0).setRequired(false))
            .addIntegerOption((o) => o.setName('s10').setDescription('Thưởng thêm chuỗi 10').setMinValue(0).setRequired(false))
        )
        .addSubcommand((s) =>
          s
            .setName('cooldown')
            .setDescription('Đặt thời gian chờ giữa các trận (giây)')
            .addIntegerOption((o) => o.setName('seconds').setDescription('Số giây (0-3600)').setMinValue(0).setMaxValue(3600).setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('timeout')
            .setDescription('[OWNER] Chỉnh thời gian mỗi lượt nối từ')
            .addIntegerOption((o) => o.setName('seconds').setDescription('Số giây (10-300)').setMinValue(10).setMaxValue(300).setRequired(true))
        )
        .addSubcommand((s) => s.setName('enable').setDescription('Bật trò chơi Nối Từ'))
        .addSubcommand((s) => s.setName('disable').setDescription('Tạm tắt trò chơi Nối Từ'))
        .addSubcommand((s) =>
          s
            .setName('addword')
            .setDescription('Thêm từ ghép 2 tiếng mới vào từ điển')
            .addStringOption((o) => o.setName('word').setDescription('Từ ghép 2 tiếng').setRequired(true))
        )
    )

    // Nhóm 4: Quản lý nhiệm vụ (4 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('quest')
        .setDescription('Tạo, sửa, xóa và chỉnh thưởng nhiệm vụ')
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('Tạo nhiệm vụ mới')
            .addStringOption((o) => o.setName('id').setDescription('Mã nhiệm vụ').setRequired(true))
            .addStringOption((o) =>
              o.setName('scope').setDescription('Loại').setRequired(true).addChoices(
                { name: 'Daily', value: 'daily' },
                { name: 'Weekly', value: 'weekly' },
                { name: 'Special', value: 'special' }
              )
            )
            .addStringOption((o) => o.setName('name').setDescription('Tên nhiệm vụ').setRequired(true))
            .addStringOption((o) => o.setName('metric').setDescription('Chỉ số (work_count, games_played, game_wins)').setRequired(true))
            .addIntegerOption((o) => o.setName('target').setDescription('Mốc yêu cầu').setMinValue(1).setRequired(true))
            .addIntegerOption((o) => o.setName('reward').setDescription('Thưởng VNĐ').setMinValue(0).setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('edit')
            .setDescription('Sửa nhiệm vụ tùy chỉnh')
            .addStringOption((o) => o.setName('id').setDescription('Mã nhiệm vụ').setRequired(true))
            .addIntegerOption((o) => o.setName('target').setDescription('Mốc mới').setMinValue(1).setRequired(false))
            .addIntegerOption((o) => o.setName('reward').setDescription('Thưởng VNĐ mới').setMinValue(0).setRequired(false))
        )
        .addSubcommand((s) =>
          s.setName('delete').setDescription('Xóa nhiệm vụ tùy chỉnh').addStringOption((o) => o.setName('id').setDescription('Mã nhiệm vụ').setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('reward').setDescription('Đặt hệ số thưởng nhiệm vụ chung').addNumberOption((o) => o.setName('mult').setDescription('Hệ số (0.5 - 5.0)').setMinValue(0.5).setMaxValue(5.0).setRequired(true))
        )
    )

    // Nhóm 5: Quản lý sự kiện (4 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('event')
        .setDescription('Tạo, điều chỉnh và trao thưởng sự kiện')
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('Khởi tạo sự kiện mới')
            .addStringOption((o) => o.setName('type').setDescription('Loại sự kiện').setRequired(true).addChoices(...EVENT_CHOICES))
            .addIntegerOption((o) => o.setName('reward').setDescription('Quỹ thưởng Top 1').setMinValue(1000).setRequired(true))
            .addIntegerOption((o) => o.setName('hours').setDescription('Thời lượng (giờ)').setMinValue(1).setMaxValue(720).setRequired(false))
            .addStringOption((o) => o.setName('name').setDescription('Tên sự kiện').setRequired(false))
        )
        .addSubcommand((s) =>
          s
            .setName('edit')
            .setDescription('Chỉnh thưởng hoặc gia hạn sự kiện')
            .addIntegerOption((o) => o.setName('id').setDescription('Mã ID sự kiện').setRequired(true))
            .addIntegerOption((o) => o.setName('reward').setDescription('Mức thưởng mới').setMinValue(1000).setRequired(false))
            .addIntegerOption((o) => o.setName('add_hours').setDescription('Cộng thêm giờ').setRequired(false))
        )
        .addSubcommand((s) =>
          s.setName('stop').setDescription('Kết thúc & phát thưởng sự kiện').addIntegerOption((o) => o.setName('id').setDescription('Mã ID sự kiện').setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName('reward').setDescription('Phát thưởng sự kiện cho người chơi').addUserOption((o) => o.setName('u').setDescription('Người nhận').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ').setMinValue(1000).setRequired(true))
        )
    )

    // Nhóm 6: Công cụ hệ thống (11 lệnh)
    .addSubcommandGroup((g) =>
      g
        .setName('system')
        .setDescription('Dashboard, sao lưu, bảo trì và giám sát hệ thống')
        .addSubcommand((s) => s.setName('dashboard').setDescription('Mở bảng điều khiển tương tác ADMIN PRO'))
        .addSubcommand((s) => s.setName('stats').setDescription('Xem thống kê toàn hệ thống'))
        .addSubcommand((s) => s.setName('health').setDescription('Kiểm tra RAM, CPU & sức khỏe SQLite'))
        .addSubcommand((s) =>
          s.setName('maintenance').setDescription('Bật hoặc tắt chế độ bảo trì').addBooleanOption((o) => o.setName('on').setDescription('Bật bảo trì?').setRequired(true))
        )
        .addSubcommand((s) => s.setName('backup').setDescription('Tạo bản sao lưu cơ sở dữ liệu ngay'))
        .addSubcommand((s) =>
          s.setName('restore').setDescription('Khôi phục dữ liệu từ bản sao lưu').addStringOption((o) => o.setName('file').setDescription('Tên file backup (bỏ trống để xem danh sách)').setRequired(false))
        )
        .addSubcommand((s) => s.setName('logs').setDescription('Xem nhật ký hoạt động quản trị'))
        .addSubcommand((s) => s.setName('config').setDescription('Xem toàn bộ thông số cấu hình'))
        .addSubcommand((s) =>
          s.setName('announce').setDescription('Gửi thông báo Embed trang trọng').addStringOption((o) => o.setName('msg').setDescription('Nội dung thông báo').setRequired(true))
        )
        .addSubcommand((s) => s.setName('ping').setDescription('Kiểm tra độ trễ kết nối Discord'))
        .addSubcommand((s) => s.setName('uptime').setDescription('Xem thời gian hoạt động liên tục'))
    ),

  async execute(interaction, ctx) {
    const { db, economySystem, shopSystem, questSystem, eventSystem, wordChainSystem } = ctx;
    const actorId = interaction.user.id;
    const actorRole = resolveBotRole(db, actorId);

    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    // Các lệnh cho phép MODERATOR xem/cảnh cáo
    const modAllowed =
      (group === 'user' && ['userinfo', 'inventory', 'warn', 'warnings'].includes(sub)) ||
      (group === 'game' && ['leaderboard', 'channels'].includes(sub)) ||
      (group === 'system' && ['stats', 'health', 'ping', 'uptime'].includes(sub));

    const isGuildChanSetup =
      group === 'game' &&
      ['setchannel', 'clearchannel', 'channels'].includes(sub) &&
      canManageAntiSpam(interaction.member, false);

    const requiredRole = modAllowed ? BOT_ROLES.MODERATOR : BOT_ROLES.ADMIN;
    if (!isGuildChanSetup && !hasBotRole(db, actorId, requiredRole)) {
      await interaction.reply({
        content: `⛔ Bạn cần tối thiểu quyền **${requiredRole}** trong hệ thống Bot để thực thi lệnh này.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Bảo vệ các lệnh chỉ dành riêng cho OWNER trong /admin
    const ownerOnlyInAdmin =
      (group === 'system' && ['maintenance', 'restore'].includes(sub)) ||
      (group === 'economy' && ['setinterest'].includes(sub)) ||
      (group === 'noitu' && ['timeout'].includes(sub));

    if (ownerOnlyInAdmin && !isHardcodedOwner(actorId)) {
      await interaction.reply({
        content: '👑 Thao tác nhạy cảm này chỉ dành riêng cho **OWNER tối cao**.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // --- Xử lý nhóm USER ---
    if (group === 'user') {
      const target = interaction.options.getUser('u', true);
      if (
        ['ban', 'resetuser', 'setmoney', 'removemoney'].includes(sub) &&
        isHardcodedOwner(target.id) &&
        !isHardcodedOwner(actorId)
      ) {
        throw new Error('Không thể thực hiện thao tác chế tài lên tài khoản OWNER!');
      }

      if (sub === 'userinfo') {
        const u = economySystem.ensureUser(target.id, target.username);
        const tRole = resolveBotRole(db, target.id);
        const warnCount = db.get('SELECT count(*) AS c FROM warnings WHERE user_id = ?', [target.id])?.c ?? 0;

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.INFO)
              .setTitle(`🔍 Hồ Sơ Quản Trị — ${target.username}`)
              .addFields(
                { name: '🆔 ID & Quyền', value: `\`${target.id}\` • **${tRole}**`, inline: true },
                { name: '⚖️ Trạng thái', value: `Ban: **${u.is_banned ? 'Có' : 'Không'}** | Freeze: **${u.is_frozen ? 'Có' : 'Không'}** | Warn: **${warnCount}**`, inline: true },
                { name: '💰 Tài sản', value: `Ví: **${formatVnd(u.wallet)}** | NH: **${formatVnd(u.bank)}** | TK: **${formatVnd(u.savings)}**`, inline: false },
                { name: '📊 Cấp độ & Game', value: `Cấp **${u.level}** (${u.exp} EXP) • Đã chơi **${u.games_played}** ván (Thắng ${u.games_won})`, inline: false }
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'addmoney' || sub === 'removemoney') {
        const amt = interaction.options.getInteger('amount', true);
        const mode = sub === 'addmoney' ? 'add' : 'remove';
        const res = economySystem.adminAdjustWallet({
          actorId,
          actorRole,
          targetId: target.id,
          targetName: target.username,
          mode,
          amount: amt,
        });
        await interaction.reply({
          content: `✅ Đã **${mode === 'add' ? 'cộng' : 'trừ'} ${formatVnd(amt)}** đối với <@${target.id}>. Số dư ví mới: **${formatVnd(res.after)}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'setmoney') {
        const amt = interaction.options.getInteger('amount', true);
        const cfm = createConfirmationPrompt({
          actorId,
          title: 'Đặt Số Dư Ví Cố Định',
          summary: `Bạn sắp đặt lại số dư ví của <@${target.id}> thành **${formatVnd(amt)}**.`,
          onConfirm: () => {
            const res = economySystem.adminAdjustWallet({
              actorId,
              actorRole,
              targetId: target.id,
              targetName: target.username,
              mode: 'set',
              amount: amt,
            });
            return `Đã đặt số dư ví của <@${target.id}> từ \`${formatVnd(res.before)}\` thành **${formatVnd(res.after)}**.`;
          },
        });
        await interaction.reply(cfm.payload);
        return;
      }

      if (sub === 'resetuser') {
        const cfm = createConfirmationPrompt({
          actorId,
          title: 'Reset Toàn Bộ Dữ Liệu Người Chơi',
          summary: `Xóa túi đồ, thú cưng, tiến độ nhiệm vụ và đưa tài khoản <@${target.id}> về mặc định ban đầu?`,
          onConfirm: () => {
            economySystem.adminResetUser({ actorId, actorRole, targetId: target.id });
            return `Đã đặt lại hoàn toàn tài khoản của <@${target.id}> về trạng thái mặc định.`;
          },
        });
        await interaction.reply(cfm.payload);
        return;
      }

      if (sub === 'inventory') {
        const bag = shopSystem.getInventory(target.id);
        const text =
          bag.length > 0
            ? bag.map((b) => `• ${b.item.emoji} **${b.item.name}**: x${b.quantity}`).join('\n')
            : '*Túi đồ trống.*';
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle(`🎒 Túi đồ của ${target.username}`).setDescription(text)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'setlevel') {
        const lv = interaction.options.getInteger('level', true);
        economySystem.ensureUser(target.id, target.username);
        db.run('UPDATE users SET level = ?, exp = 0 WHERE user_id = ?', [lv, target.id]);
        db.recordAudit({ actorId, actorRole, action: 'set_level', targetId: target.id, details: `level=${lv}` });
        await interaction.reply({
          content: `✅ Đã đặt cấp độ của <@${target.id}> thành **Cấp ${lv}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'ban') {
        const reason = interaction.options.getString('reason') ?? 'Vi phạm quy tắc hệ thống';
        const cfm = createConfirmationPrompt({
          actorId,
          title: 'Khóa Tài Khoản Khỏi Hệ Thống Bot',
          summary: `Khóa tài khoản <@${target.id}> với lý do: **${reason}**?`,
          onConfirm: () => {
            economySystem.ensureUser(target.id, target.username);
            db.run('UPDATE users SET is_banned = 1, ban_reason = ? WHERE user_id = ?', [reason, target.id]);
            db.recordAudit({ actorId, actorRole, action: 'ban_user', targetId: target.id, details: reason });
            return `Đã khóa <@${target.id}> khỏi hệ thống Bot. Lý do: *${reason}*.`;
          },
        });
        await interaction.reply(cfm.payload);
        return;
      }

      if (sub === 'unban') {
        db.run('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE user_id = ?', [target.id]);
        db.recordAudit({ actorId, actorRole, action: 'unban_user', targetId: target.id });
        await interaction.reply({
          content: `✅ Đã mở khóa tài khoản cho <@${target.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'warn') {
        const reason = interaction.options.getString('reason', true);
        db.run('INSERT INTO warnings (user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?)', [
          target.id,
          actorId,
          reason,
          Date.now(),
        ]);
        db.recordAudit({ actorId, actorRole, action: 'warn_user', targetId: target.id, details: reason });
        await interaction.reply({
          content: `⚠️ Đã ghi nhận cảnh cáo cho <@${target.id}>: *${reason}*.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'warnings') {
        const rows = db.all('SELECT * FROM warnings WHERE user_id = ? ORDER BY id DESC LIMIT 10', [target.id]);
        const lines =
          rows.length > 0
            ? rows.map((w, i) => `\`#${i + 1}\` <t:${Math.floor(w.created_at / 1000)}:R> bởi <@${w.moderator_id}>: *${w.reason}*`)
            : ['*Không có cảnh cáo nào.*'];
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(COLORS.WARNING).setTitle(`⚠️ Cảnh cáo của ${target.username}`).setDescription(lines.join('\n'))],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // --- Xử lý nhóm ECONOMY ---
    if (group === 'economy') {
      if (sub === 'overview' || sub === 'inflation') {
        const m = economySystem.getMacroEconomyStats();
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle('📊 Báo Cáo Cung Tiền VNĐ & Chỉ Số Lạm Phát')
              .addFields(
                { name: '👥 Tổng tài khoản', value: `**${m.totalUsers}**`, inline: true },
                { name: '💵 Tổng tiền mặt (Ví)', value: `**${formatVnd(m.totalWallet)}**`, inline: true },
                { name: '🏦 Tổng tiền gửi NH + TK', value: `**${formatVnd(m.totalBank + m.totalSavings)}**`, inline: true },
                { name: '🌐 Tổng cung lưu hành (M2)', value: `**${formatVnd(m.totalSupply)}**`, inline: true },
                { name: '📈 Tài sản bình quân', value: `**${formatVnd(m.avgWealth)}**`, inline: true },
                { name: '🔥 Hệ số lạm phát', value: `**x${m.inflationRatio}** so với vốn gốc`, inline: true }
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const settingMap = {
        setdaily: ['dailyReward', 'amount', 'Thưởng /daily'],
        setweekly: ['weeklyReward', 'amount', 'Thưởng /weekly'],
        setmaxbet: ['maxBet', 'amount', 'Mức cược tối đa'],
        setminbet: ['minBet', 'amount', 'Mức cược tối thiểu'],
      };

      if (settingMap[sub]) {
        const [key, optName, label] = settingMap[sub];
        const val = interaction.options.getInteger(optName, true);
        db.setSetting(key, val);
        db.recordAudit({ actorId, actorRole, action: sub, details: `${key}=${val}` });
        await interaction.reply({
          content: `✅ Đã cập nhật **${label}** thành **${formatVnd(val)}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'setinterest') {
        const pct = interaction.options.getNumber('rate', true);
        const decimalRate = Number((pct / 100).toFixed(4));
        db.setSetting('bankInterestRate', decimalRate);
        db.recordAudit({ actorId, actorRole, action: 'setinterest', details: `rate=${decimalRate}` });
        await interaction.reply({
          content: `✅ Đã cập nhật lãi suất ngân hàng cơ bản thành **${pct}% / chu kỳ**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // --- Xử lý nhóm GAME ---
    if (group === 'game') {
      if (sub === 'enable' || sub === 'disable') {
        const game = interaction.options.getString('game', true);
        const current = { ...(db.getSetting('gamesEnabled') || {}) };
        current[game] = sub === 'enable';
        db.setSetting('gamesEnabled', current);
        db.recordAudit({ actorId, actorRole, action: `game_${sub}`, details: game });
        await interaction.reply({
          content: `✅ Đã **${sub === 'enable' ? 'MỞ LẠI' : 'TẠM KHÓA'}** trò chơi **${GAME_LABELS[game]}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'settings') {
        const mult = interaction.options.getNumber('payout_mult');
        if (mult !== null) {
          if (!isHardcodedOwner(actorId)) {
            throw new Error('Chỉ OWNER mới có quyền điều chỉnh hệ số trả thưởng trò chơi.');
          }
          db.setSetting('gamePayoutMultiplier', mult);
          db.recordAudit({ actorId, actorRole, action: 'game_payout_mult', details: String(mult) });
        }
        const curMult = db.getSetting('gamePayoutMultiplier');
        const enabled = db.getSetting('gamesEnabled') || {};
        const desc = Object.entries(GAME_LABELS)
          .map(([k, v]) => `• ${v}: **${enabled[k] !== false ? '🟢 Bật' : '🔴 Tắt'}**`)
          .join('\n');
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.INFO)
              .setTitle('🎮 Cấu Hình Hệ Thống Trò Chơi')
              .setDescription(`Hệ số trả thưởng hiện tại: **x${curMult}**\n\n${desc}`),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'resetstats') {
        const target = interaction.options.getUser('u', true);
        db.run('UPDATE users SET games_played = 0, games_won = 0, total_wagered = 0 WHERE user_id = ?', [target.id]);
        db.run('DELETE FROM game_logs WHERE user_id = ?', [target.id]);
        db.recordAudit({ actorId, actorRole, action: 'reset_game_stats', targetId: target.id });
        await interaction.reply({
          content: `✅ Đã đặt lại thống kê trò chơi cho <@${target.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'leaderboard') {
        const top = db.all(
          'SELECT user_id, games_won, games_played FROM users WHERE games_played > 0 ORDER BY games_won DESC LIMIT 10'
        );
        const lines =
          top.length > 0
            ? top.map((r, i) => `\`#${i + 1}\` <@${r.user_id}> — **${r.games_won}** trận thắng / ${r.games_played} ván`)
            : ['*Chưa có dữ liệu.*'];
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle('🏆 Top Cao Thủ Thắng Trận').setDescription(lines.join('\n'))],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'setchannel') {
        if (!interaction.guildId) {
          throw new Error('Lệnh gán kênh trò chơi chỉ sử dụng bên trong Máy chủ (Server).');
        }
        const gameOpt = interaction.options.getString('game', true);
        const targetCh = interaction.options.getChannel('ch', true);

        db.setGameChannel(interaction.guildId, gameOpt, targetCh.id, actorId);
        db.recordAudit({
          actorId,
          actorRole,
          action: 'set_game_channel',
          details: `${gameOpt}=${targetCh.id}`,
        });

        await interaction.reply({
          content: `✅ Đã chỉ định kênh riêng <#${targetCh.id}> cho trò chơi **${GAME_LABELS[gameOpt]}**! Người chơi bắt buộc vào đúng <#${targetCh.id}> mới được mở bàn chơi.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'clearchannel') {
        if (!interaction.guildId) {
          throw new Error('Lệnh này chỉ dùng bên trong Máy chủ (Server).');
        }
        const gameOpt = interaction.options.getString('game', true);
        db.clearGameChannel(interaction.guildId, gameOpt);
        db.recordAudit({
          actorId,
          actorRole,
          action: 'clear_game_channel',
          details: gameOpt,
        });
        await interaction.reply({
          content: `🗑️ Đã gỡ cấu hình kênh của **${GAME_LABELS[gameOpt]}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'channels') {
        if (!interaction.guildId) {
          throw new Error('Lệnh này chỉ dùng bên trong Máy chủ (Server).');
        }
        const lines = Object.entries(GAME_LABELS).map(([gId, gLabel]) => {
          const allowed = db.getAllowedGameChannels(interaction.guildId, gId);
          return `• ${gLabel}: ${
            allowed.length > 0
              ? allowed.map((id) => `<#${id}>`).join(', ')
              : '*⚠️ Chưa gán kênh (Đang khóa)*'
          }`;
        });
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.INFO)
              .setTitle('📍 Danh Sách Kênh Riêng Cho Từng Trò Chơi')
              .setDescription(
                lines.join('\n') +
                  '\n\n💡 *Mọi trò chơi đều bắt buộc gán kênh riêng bằng `/admin game setchannel` để tránh gây loạn kênh chat chung.*'
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // --- Xử lý nhóm NOITU (Mục 8) ---
    if (group === 'noitu') {
      if (sub === 'reward') {
        const amount = interaction.options.getInteger('amount', true);
        const s3 = interaction.options.getInteger('s3');
        const s5 = interaction.options.getInteger('s5');
        const s10 = interaction.options.getInteger('s10');

        db.setSetting('noituReward', amount);
        if (s3 !== null) db.setSetting('noituStreak3Bonus', s3);
        if (s5 !== null) db.setSetting('noituStreak5Bonus', s5);
        if (s10 !== null) db.setSetting('noituStreak10Bonus', s10);

        const cfg = wordChainSystem.getConfig();
        db.recordAudit({
          actorId,
          actorRole,
          action: 'noitu_reward',
          details: `base=${cfg.baseReward},s3=${cfg.streak3Bonus},s5=${cfg.streak5Bonus},s10=${cfg.streak10Bonus}`,
        });

        await interaction.reply({
          content:
            `✅ Đã cập nhật mức thưởng **Nối Từ Tiếng Việt PRO**:\n` +
            `• Thắng 1 trận: **+${formatVnd(cfg.baseReward)}**\n` +
            `• Chuỗi 3 trận: **+${formatVnd(cfg.streak3Bonus)}** | Chuỗi 5 trận: **+${formatVnd(cfg.streak5Bonus)}** | Chuỗi 10 trận: **+${formatVnd(cfg.streak10Bonus)}**`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'cooldown') {
        const seconds = interaction.options.getInteger('seconds', true);
        db.setSetting('noituCooldownSec', seconds);
        db.recordAudit({ actorId, actorRole, action: 'noitu_cooldown', details: String(seconds) });
        await interaction.reply({
          content: `✅ Đã đặt thời gian chờ giữa các trận Nối Từ thành **${seconds} giây**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'timeout') {
        const seconds = interaction.options.getInteger('seconds', true);
        db.setSetting('noituTimeoutSec', seconds);
        db.recordAudit({ actorId, actorRole, action: 'noitu_timeout', details: String(seconds) });
        await interaction.reply({
          content: `👑 Đã đặt thời gian suy nghĩ mỗi lượt Nối Từ thành **${seconds} giây**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'enable' || sub === 'disable') {
        const on = sub === 'enable';
        const cur = { ...(db.getSetting('gamesEnabled') || {}) };
        cur[GAME_IDS.NOITU] = on;
        db.setSetting('gamesEnabled', cur);
        db.recordAudit({ actorId, actorRole, action: `noitu_${sub}` });
        await interaction.reply({
          content: `✅ Đã **${on ? 'BẬT' : 'TẠM TẮT'}** trò chơi **🔤 Nối Từ Tiếng Việt PRO**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'addword') {
        const raw = interaction.options.getString('word', true);
        const added = wordChainSystem.addCustomWord(raw, actorId);
        db.recordAudit({ actorId, actorRole, action: 'noitu_addword', details: added });
        await interaction.reply({
          content: `✅ Đã bổ sung từ ghép **"${added}"** vào từ điển Nối Từ Tiếng Việt!`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // --- Xử lý nhóm QUEST ---
    if (group === 'quest') {
      if (sub === 'create') {
        const qId = questSystem.createCustomQuest({
          id: interaction.options.getString('id', true),
          scope: interaction.options.getString('scope', true),
          name: interaction.options.getString('name', true),
          description: `Hoàn thành chỉ tiêu ${interaction.options.getString('metric', true)}`,
          metric: interaction.options.getString('metric', true),
          target: interaction.options.getInteger('target', true),
          rewardVnd: interaction.options.getInteger('reward', true),
          rewardExp: 100,
        });
        db.recordAudit({ actorId, actorRole, action: 'quest_create', targetId: qId });
        await interaction.reply({ content: `✅ Đã tạo nhiệm vụ mới mã \`${qId}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'edit') {
        const id = interaction.options.getString('id', true);
        questSystem.editCustomQuest(id, {
          target: interaction.options.getInteger('target') ?? undefined,
          rewardVnd: interaction.options.getInteger('reward') ?? undefined,
        });
        db.recordAudit({ actorId, actorRole, action: 'quest_edit', targetId: id });
        await interaction.reply({ content: `✅ Đã cập nhật nhiệm vụ \`${id}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id', true);
        questSystem.deleteCustomQuest(id);
        db.recordAudit({ actorId, actorRole, action: 'quest_delete', targetId: id });
        await interaction.reply({ content: `🗑️ Đã xóa nhiệm vụ \`${id}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'reward') {
        if (!isHardcodedOwner(actorId)) {
          throw new Error('Chỉ OWNER mới được đổi hệ số thưởng nhiệm vụ toàn cục.');
        }
        const mult = interaction.options.getNumber('mult', true);
        db.setSetting('questRewardMultiplier', mult);
        db.recordAudit({ actorId, actorRole, action: 'quest_reward_mult', details: String(mult) });
        await interaction.reply({ content: `✅ Đã đặt hệ số thưởng nhiệm vụ thành **x${mult}**.`, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    // --- Xử lý nhóm EVENT ---
    if (group === 'event') {
      if (sub === 'create') {
        const created = eventSystem.createEvent({
          actorId,
          actorRole,
          type: interaction.options.getString('type', true),
          rewardVnd: interaction.options.getInteger('reward', true),
          durationHours: interaction.options.getInteger('hours') ?? 24,
          name: interaction.options.getString('name'),
        });
        await interaction.reply({
          content: `🎉 Đã tạo sự kiện **#${created.id} — ${created.name}** (Quỹ thưởng Top 1: **${formatVnd(created.reward_vnd)}**)!`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'edit') {
        const updated = eventSystem.editEvent({
          actorId,
          actorRole,
          eventId: interaction.options.getInteger('id', true),
          rewardVnd: interaction.options.getInteger('reward'),
          extendHours: interaction.options.getInteger('add_hours'),
        });
        await interaction.reply({
          content: `✅ Đã cập nhật sự kiện **#${updated.id}** — Thưởng Top 1: **${formatVnd(updated.reward_vnd)}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'stop') {
        const eventId = interaction.options.getInteger('id', true);
        const cfm = createConfirmationPrompt({
          actorId,
          title: `Kết Thúc & Phát Thưởng Sự Kiện #${eventId}`,
          summary: `Kết thúc sự kiện **#${eventId}** ngay bây giờ và tự động phát thưởng VNĐ cho Top 3 người dẫn đầu?`,
          onConfirm: () => {
            const res = eventSystem.stopAndDistributeRewards({ actorId, actorRole, eventId, autoPay: true });
            const winText =
              res.winners.length > 0
                ? res.winners.map((w) => `Top ${w.rank}: <@${w.userId}> (+${formatVnd(w.prize)})`).join(', ')
                : 'Không có người tham gia';
            return `Đã đóng sự kiện **#${eventId}** (${res.event.name}). Kết quả trao giải: ${winText}.`;
          },
        });
        await interaction.reply(cfm.payload);
        return;
      }

      if (sub === 'reward') {
        const target = interaction.options.getUser('u', true);
        const amt = interaction.options.getInteger('amount', true);
        const res = economySystem.adminAdjustWallet({
          actorId,
          actorRole,
          targetId: target.id,
          targetName: target.username,
          mode: 'add',
          amount: amt,
          reason: 'Thưởng sự kiện đặc biệt',
        });
        await interaction.reply({
          content: `🎁 Đã trao thưởng sự kiện **+${formatVnd(amt)}** cho <@${target.id}> (Ví mới: ${formatVnd(res.after)}).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // --- Xử lý nhóm SYSTEM ---
    if (group === 'system') {
      if (sub === 'dashboard') {
        await interaction.reply(buildAdminDashboardPayload(actorId, actorRole, ctx));
        return;
      }

      if (sub === 'stats' || sub === 'health') {
        const mem = process.memoryUsage();
        const macro = economySystem.getMacroEconomyStats();
        const txCount = db.get('SELECT count(*) AS c FROM transactions')?.c ?? 0;
        const gameCount = db.get('SELECT count(*) AS c FROM game_logs')?.c ?? 0;

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.SUCCESS)
              .setTitle('🩺 Báo Cáo Sức Khỏe & Tài Nguyên BotKeep FREE')
              .addFields(
                { name: '🧠 Bộ nhớ RAM', value: `RSS: **${(mem.rss / 1048576).toFixed(1)} MB** / 512 MB\nHeap: **${(mem.heapUsed / 1048576).toFixed(1)} MB**`, inline: true },
                { name: '⚡ Kết nối & Uptime', value: `Ping: **${Math.max(0, Math.round(interaction.client.ws?.ping ?? 0))} ms**\nUptime: **${formatDurationVi(Math.floor(process.uptime()))}**`, inline: true },
                { name: '🗄️ Cơ sở dữ liệu SQLite', value: `Người chơi: **${macro.totalUsers}**\nBản ghi GD: **${txCount}** | Ván chơi: **${gameCount}**`, inline: false }
              )
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'maintenance') {
        const on = interaction.options.getBoolean('on', true);
        const cfm = createConfirmationPrompt({
          actorId,
          title: on ? 'Bật Chế Độ Bảo Trì Toàn Hệ Thống' : 'Tắt Chế Độ Bảo Trì',
          summary: on
            ? 'Khi bật bảo trì, chỉ OWNER và ADMIN có thể sử dụng lệnh. Xác nhận bật?'
            : 'Mở lại toàn bộ hoạt động bình thường cho người chơi?',
          onConfirm: () => {
            db.setSetting('maintenanceMode', on);
            db.recordAudit({ actorId, actorRole, action: 'maintenance', details: String(on) });
            return `Chế độ bảo trì hiện tại: **${on ? '🟠 ĐÃ BẬT' : '🟢 ĐÃ TẮT'}**.`;
          },
        });
        await interaction.reply(cfm.payload);
        return;
      }

      if (sub === 'backup') {
        const bk = await db.createBackup();
        db.recordAudit({ actorId, actorRole, action: 'db_backup', details: bk.filename });
        await interaction.reply({
          content: `💾 Đã tạo bản sao lưu SQLite thành công: \`${bk.filename}\` (${(bk.sizeBytes / 1024).toFixed(1)} KB).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'restore') {
        const file = interaction.options.getString('file');
        if (!file) {
          const list = await db.listBackups();
          await interaction.reply({
            content:
              list.length > 0
                ? `📂 **Các bản sao lưu hiện có (gõ \`/admin system restore file:<tên>\`):**\n${list.map((f) => `• \`${f}\``).join('\n')}`
                : '📂 Chưa có bản sao lưu nào. Hãy chạy `/admin system backup` trước.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const cfm = createConfirmationPrompt({
          actorId,
          title: 'Khôi Phục Cơ Sở Dữ Liệu Từ Bản Sao Lưu',
          summary: `Khôi phục toàn bộ dữ liệu hệ thống từ tệp \`${file}\`? Dữ liệu phát sinh sau thời điểm sao lưu sẽ bị ghi đè.`,
          onConfirm: async () => {
            const restored = await db.restoreBackup(file);
            db.recordAudit({ actorId, actorRole, action: 'db_restore', details: restored });
            return `Đã khôi phục thành công cơ sở dữ liệu từ \`${restored}\`!`;
          },
        });
        await interaction.reply(cfm.payload);
        return;
      }

      if (sub === 'logs') {
        const logs = db.getAuditLogs(12, false);
        const lines =
          logs.length > 0
            ? logs.map((l) => `• <t:${Math.floor(l.created_at / 1000)}:R> **[${l.actor_role}]** <@${l.actor_id}> → \`${l.action}\` ${l.details ? `*(${l.details.slice(0, 60)})*` : ''}`)
            : ['*Chưa có nhật ký thao tác.*'];
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('📋 Nhật Ký Hoạt Động Quản Trị').setDescription(lines.join('\n'))],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'config') {
        const s = db.getAllSettings();
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.PRIMARY)
              .setTitle('⚙️ Cấu Hình Hệ Thống Hiện Hành')
              .setDescription(
                `• Vốn Tân Thủ: **${formatVnd(s.startingBalance)}**\n` +
                  `• Daily / Weekly / Monthly: **${formatVnd(s.dailyReward)}** / **${formatVnd(s.weeklyReward)}** / **${formatVnd(s.monthlyReward)}**\n` +
                  `• Giới hạn cược: **${formatVnd(s.minBet)}** → **${formatVnd(s.maxBet)}**\n` +
                  `• Lãi suất NH: **${(s.bankInterestRate * 100).toFixed(2)}%** mỗi **${s.interestIntervalHours}h**\n` +
                  `• Bảo vệ Staff khỏi /rob: **${s.protectStaffFromRob ? 'Bật' : 'Tắt'}**`
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'announce') {
        const msg = interaction.options.getString('msg', true);
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle('📢 THÔNG BÁO TỪ BAN QUẢN TRỊ')
              .setDescription(msg)
              .setFooter({ text: `Đăng bởi ${interaction.user.username}` })
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
        await interaction.reply({ content: '✅ Đã đăng thông báo ra kênh hiện tại.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'ping') {
        await interaction.reply({
          content: `🏓 **Pong!** Độ trễ WebSocket: **${Math.max(0, Math.round(interaction.client.ws?.ping ?? 0))} ms**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'uptime') {
        await interaction.reply({
          content: `⏱️ Thời gian hoạt động liên tục: **${formatDurationVi(Math.floor(process.uptime()))}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  },
};

// ============================================================================
// 2. Lệnh /owner (Đặc quyền Tối Cao dành riêng cho HARDCODED_OWNER_ID)
// ============================================================================

export const ownerCommand = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Bảng quyền năng tối cao dành riêng cho OWNER hệ thống (1243061570247069696)')
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Cấp hoặc thu hồi quyền ADMIN / MODERATOR (chỉ OWNER thực thi)')
        .addUserOption((o) => o.setName('user').setDescription('Tài khoản mục tiêu').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('set_role')
            .setDescription('Vai trò muốn gán')
            .setRequired(true)
            .addChoices(
              { name: '🛡️ Cấp quyền ADMIN', value: 'ADMIN' },
              { name: '⚔️ Cấp quyền MODERATOR', value: 'MODERATOR' },
              { name: '👤 Thu hồi về MEMBER thường', value: 'MEMBER' }
            )
        )
    )
    .addSubcommand((s) =>
      s.setName('revokeall').setDescription('Thu hồi toàn bộ quyền ADMIN trên hệ thống (có xác nhận)')
    )
    .addSubcommand((s) =>
      s
        .setName('freezeuser')
        .setDescription('Đóng băng hoặc mở băng giao dịch của một tài khoản')
        .addUserOption((o) => o.setName('user').setDescription('Người chơi').setRequired(true))
        .addBooleanOption((o) => o.setName('freeze').setDescription('Đóng băng?').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('freezeall')
        .setDescription('Đóng băng hoặc mở khóa toàn bộ giao dịch VNĐ toàn hệ thống')
        .addBooleanOption((o) => o.setName('freeze').setDescription('Đóng băng toàn bộ?').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('airdrop')
        .setDescription('Phát thưởng VNĐ toàn server cho mọi người chơi hợp lệ')
        .addIntegerOption((o) => o.setName('amount').setDescription('Số VNĐ mỗi người nhận').setMinValue(1000).setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Nội dung sự kiện phát thưởng').setRequired(false))
    )
    .addSubcommand((s) =>
      s.setName('audit').setDescription('Xem nhật ký mọi thao tác của tất cả ADMIN')
    )
    .addSubcommand((s) =>
      s
        .setName('logchannel')
        .setDescription('Cấu hình 7 kênh nhận Log chuyên biệt của hệ thống')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Loại kênh Log')
            .setRequired(true)
            .addChoices(
              { name: '💰 Log Giao dịch VNĐ', value: LOG_CATEGORIES.ECONOMY },
              { name: '🎲 Log Thắng thua Game', value: LOG_CATEGORIES.GAME },
              { name: '🛡️ Log Quản trị Admin', value: LOG_CATEGORIES.ADMIN },
              { name: '🚨 Log Cảnh báo Gian lận', value: LOG_CATEGORIES.ANTICHEAT },
              { name: '📜 Log Nhiệm vụ', value: LOG_CATEGORIES.QUEST },
              { name: '🎉 Log Sự kiện', value: LOG_CATEGORIES.EVENT },
              { name: '⚠️ Log Lỗi hệ thống', value: LOG_CATEGORIES.ERROR }
            )
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Kênh văn bản nhận Log (bỏ trống để tắt)').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('servers')
        .setDescription('Quản lý danh sách các máy chủ Discord đang chạy Bot')
        .addStringOption((o) => o.setName('leave_guild_id').setDescription('Nhập ID máy chủ nếu muốn cho Bot rời khỏi').setRequired(false))
    ),

  async execute(interaction, { db, economySystem, eventSystem, logSystem }) {
    // KIỂM TRA CỨNG TRỰC TIẾP TRONG CODE THEO YÊU CẦU MỤC 2
    if (interaction.user.id !== HARDCODED_OWNER_ID) {
      await interaction.reply({
        content: `⛔ **TRUY CẬP BỊ TỪ CHỐI:** Chỉ tài khoản OWNER mặc định (\`${HARDCODED_OWNER_ID}\`) mới có quyền sử dụng lệnh \`/owner\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const actorId = interaction.user.id;

    if (sub === 'role') {
      const target = interaction.options.getUser('user', true);
      const role = interaction.options.getString('set_role', true);
      if (target.id === HARDCODED_OWNER_ID) {
        await interaction.reply({ content: '👑 Tài khoản OWNER là vĩnh viễn, không thể thay đổi.', flags: MessageFlags.Ephemeral });
        return;
      }
      db.setStaffRole(target.id, role, actorId);
      db.recordAudit({ actorId, actorRole: 'OWNER', action: 'set_staff_role', targetId: target.id, details: role });
      await interaction.reply({
        content: `👑 Đã cập nhật phân quyền của <@${target.id}> thành **${role}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'revokeall') {
      const cfm = createConfirmationPrompt({
        actorId,
        title: 'Thu Hồi Mọi Quyền ADMIN',
        summary: 'Bạn có chắc chắn muốn tước quyền toàn bộ các ADMIN hiện tại về MEMBER thường?',
        onConfirm: () => {
          db.revokeAllAdmins();
          db.recordAudit({ actorId, actorRole: 'OWNER', action: 'revoke_all_admins' });
          return 'Đã thu hồi toàn bộ quyền ADMIN trên hệ thống.';
        },
      });
      await interaction.reply(cfm.payload);
      return;
    }

    if (sub === 'freezeuser') {
      const target = interaction.options.getUser('user', true);
      const freeze = interaction.options.getBoolean('freeze', true);
      economySystem.ensureUser(target.id, target.username);
      db.run('UPDATE users SET is_frozen = ? WHERE user_id = ?', [freeze ? 1 : 0, target.id]);
      db.recordAudit({ actorId, actorRole: 'OWNER', action: 'freeze_user', targetId: target.id, details: String(freeze) });
      await interaction.reply({
        content: `${freeze ? '❄️ Đã ĐÓNG BĂNG' : '🟢 Đã MỞ BĂNG'} giao dịch đối với <@${target.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'freezeall') {
      const freeze = interaction.options.getBoolean('freeze', true);
      const cfm = createConfirmationPrompt({
        actorId,
        title: freeze ? 'Đóng Băng Toàn Bộ Giao Dịch VNĐ' : 'Mở Khóa Giao Dịch Toàn Hệ Thống',
        summary: freeze
          ? 'Tạm dừng mọi hoạt động chuyển tiền, mua bán và đặt cược trên toàn hệ thống?'
          : 'Cho phép mọi giao dịch VNĐ hoạt động trở lại bình thường?',
        onConfirm: () => {
          db.setSetting('freezeAllTransactions', freeze);
          db.recordAudit({ actorId, actorRole: 'OWNER', action: 'freeze_all', details: String(freeze) });
          return `Trạng thái giao dịch toàn hệ thống: **${freeze ? '❄️ ĐANG ĐÓNG BĂNG' : '🟢 HOẠT ĐỘNG BÌNH THƯỜNG'}**.`;
        },
      });
      await interaction.reply(cfm.payload);
      return;
    }

    if (sub === 'airdrop') {
      const amount = interaction.options.getInteger('amount', true);
      const reason = interaction.options.getString('reason') ?? 'Quà tặng đặc biệt từ OWNER';
      const cfm = createConfirmationPrompt({
        actorId,
        title: 'Phát Thưởng Toàn Server (Global Airdrop)',
        summary: `Phát **+${formatVnd(amount)}** cho tất cả tài khoản người chơi hợp lệ trên hệ thống?\nLý do: *${reason}*`,
        onConfirm: () => {
          const res = eventSystem.distributeGlobalAirdrop({
            actorId,
            actorRole: 'OWNER',
            amountPerUser: amount,
            reason,
          });
          return `🎉 Đã phát **+${formatVnd(res.amountPerUser)}**/người cho **${res.recipientCount}** người chơi (Tổng: **${formatVnd(res.totalDistributed)}**)!`;
        },
      });
      await interaction.reply(cfm.payload);
      return;
    }

    if (sub === 'audit') {
      const logs = db.getAuditLogs(15, true);
      const staff = db.listStaffRoles();
      const staffLine =
        staff.length > 0
          ? staff.map((s) => `<@${s.user_id}> (\`${s.role}\`)`).join(', ')
          : '*Chưa cấp quyền ADMIN/MOD cho ai*';
      const lines =
        logs.length > 0
          ? logs.map((l) => `• <t:${Math.floor(l.created_at / 1000)}:R> <@${l.actor_id}>: \`${l.action}\` (${l.details.slice(0, 60)})`)
          : ['*Chưa có thao tác nào từ các ADMIN.*'];

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.PRIMARY)
            .setTitle('👑 Nhật Ký Giám Sát Nhân Sự ADMIN')
            .setDescription(`**Nhân sự hiện tại:** ${staffLine}\n\n${lines.join('\n')}`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'logchannel') {
      const cat = interaction.options.getString('category', true);
      const chan = interaction.options.getChannel('channel');
      logSystem.setLogChannel(cat, chan?.id ?? null);
      db.recordAudit({ actorId, actorRole: 'OWNER', action: 'set_log_channel', details: `${cat}=${chan?.id ?? 'off'}` });
      await interaction.reply({
        content: chan
          ? `✅ Đã đặt kênh nhận Log **[${cat}]** sang <#${chan.id}>.`
          : `🔇 Đã tắt kênh nhận Log **[${cat}]**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'servers') {
      const leaveId = interaction.options.getString('leave_guild_id');
      if (leaveId) {
        const g = interaction.client.guilds?.cache?.get(leaveId);
        if (!g) {
          await interaction.reply({ content: `❌ Không tìm thấy máy chủ ID \`${leaveId}\`.`, flags: MessageFlags.Ephemeral });
          return;
        }
        const name = g.name;
        await g.leave();
        await interaction.reply({ content: `🚪 Bot đã rời khỏi máy chủ **${name}** (\`${leaveId}\`).`, flags: MessageFlags.Ephemeral });
        return;
      }

      const guilds = [...(interaction.client.guilds?.cache?.values() ?? [])];
      const lines = guilds.map((g) => `• **${g.name}** (\`${g.id}\`) — ${g.memberCount} thành viên`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.INFO)
            .setTitle(`🌐 Danh Sách Máy Chủ Đang Dùng Bot (${guilds.length})`)
            .setDescription(lines.join('\n') || '*Không có dữ liệu.*'),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

// ============================================================================
// Xử lý Nút bấm, Select Menu & Modal trên ADMIN PRO Dashboard
// ============================================================================

export async function handleAdminInteraction(interaction, ctx) {
  if (await handleConfirmationButton(interaction)) {
    return true;
  }

  const id = interaction.customId || '';
  if (!id.startsWith('admdash:')) return false;

  const { db, economySystem } = ctx;
  const [, action, ownerId] = id.split(':');

  if (interaction.user.id !== ownerId || !hasBotRole(db, interaction.user.id, BOT_ROLES.ADMIN)) {
    await interaction.reply({
      content: '⛔ Bảng điều khiển quản trị này không thuộc quyền của bạn.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const actorRole = resolveBotRole(db, interaction.user.id);

  if (action === 'refresh') {
    await interaction.update(buildAdminDashboardPayload(interaction.user.id, actorRole, ctx));
    return true;
  }

  if (action === 'toggle_game' && interaction.isStringSelectMenu()) {
    const gameId = interaction.values[0];
    const current = { ...(db.getSetting('gamesEnabled') || {}) };
    current[gameId] = current[gameId] === false;
    db.setSetting('gamesEnabled', current);
    db.recordAudit({ actorId: interaction.user.id, actorRole, action: 'dashboard_toggle_game', details: `${gameId}=${current[gameId]}` });
    await interaction.update(buildAdminDashboardPayload(interaction.user.id, actorRole, ctx));
    return true;
  }

  if (action === 'backup') {
    const bk = await db.createBackup();
    await interaction.reply({
      content: `💾 Đã tạo sao lưu: \`${bk.filename}\` (${(bk.sizeBytes / 1024).toFixed(1)} KB).`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'toggle_maint' && isHardcodedOwner(interaction.user.id)) {
    const next = !db.getSetting('maintenanceMode');
    db.setSetting('maintenanceMode', next);
    await interaction.update(buildAdminDashboardPayload(interaction.user.id, actorRole, ctx));
    return true;
  }

  if (action === 'toggle_freeze' && isHardcodedOwner(interaction.user.id)) {
    const next = !db.getSetting('freezeAllTransactions');
    db.setSetting('freezeAllTransactions', next);
    await interaction.update(buildAdminDashboardPayload(interaction.user.id, actorRole, ctx));
    return true;
  }

  if (action === 'money_modal') {
    const modal = new ModalBuilder()
      .setCustomId(`admdash:money_submit:${interaction.user.id}`)
      .setTitle('Điều Chỉnh Số Dư Nhanh')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('target_id').setLabel('Discord User ID người chơi').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('delta').setLabel('Số tiền (+ để cộng, - để trừ)').setPlaceholder('Ví dụ: 50000 hoặc -20000').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'money_submit' && interaction.isModalSubmit()) {
    const targetId = interaction.fields.getTextInputValue('target_id').trim();
    const rawDelta = Number.parseInt(interaction.fields.getTextInputValue('delta').trim(), 10);
    if (!/^\d{15,22}$/.test(targetId) || Number.isNaN(rawDelta) || rawDelta === 0) {
      throw new Error('User ID hoặc số tiền nhập vào không hợp lệ.');
    }
    const res = economySystem.adminAdjustWallet({
      actorId: interaction.user.id,
      actorRole,
      targetId,
      mode: rawDelta > 0 ? 'add' : 'remove',
      amount: Math.abs(rawDelta),
      reason: 'Dashboard Modal Adjust',
    });
    await interaction.reply({
      content: `✅ Đã cập nhật ví của <@${targetId}>: \`${formatVnd(res.before)}\` → **${formatVnd(res.after)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'announce_modal') {
    const modal = new ModalBuilder()
      .setCustomId(`admdash:announce_submit:${interaction.user.id}`)
      .setTitle('Đăng Thông Báo Quản Trị')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('content').setLabel('Nội dung thông báo').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'announce_submit' && interaction.isModalSubmit()) {
    const text = interaction.fields.getTextInputValue('content');
    await interaction.channel?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('📢 THÔNG BÁO HỆ THỐNG')
          .setDescription(text)
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
    });
    await interaction.reply({ content: '✅ Đã gửi thông báo!', flags: MessageFlags.Ephemeral });
    return true;
  }

  return false;
}

export const ADMIN_COMMANDS = [adminCommand, ownerCommand];
