import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { SHOP_ITEMS, TITLES } from '../../config/constants.js';
import { expRequiredForLevel } from '../../systems/levelSystem.js';
import { COLORS } from '../../utils/embeds.js';
import { formatRemainingMs, formatVnd, renderProgressBar } from '../../utils/format.js';
import { resolveBotRole } from '../../utils/permissions.js';

const TITLE_CHOICES = Object.values(TITLES).map((t) => ({
  name: t.name,
  value: t.id,
}));

// 1. /profile
const profileCmd = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Xem Hồ Sơ Cá Nhân, Cấp Độ, Huy Hiệu, Khung Viền hoặc đổi Danh Hiệu')
    .addUserOption((o) =>
      o.setName('user').setDescription('Xem hồ sơ của người chơi khác').setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('equip_title')
        .setDescription('Chọn danh hiệu đã mở khóa để hiển thị lên hồ sơ của bạn')
        .setRequired(false)
        .addChoices(...TITLE_CHOICES)
    ),

  async execute(interaction, { db, economySystem, levelSystem, petSystem }) {
    const equipTitleId = interaction.options.getString('equip_title');
    if (equipTitleId) {
      economySystem.ensureUser(interaction.user.id, interaction.user.username);
      levelSystem.evaluateMilestoneTitles(interaction.user.id);
      const equipped = levelSystem.equipTitle(interaction.user.id, equipTitleId);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setTitle('🏅 Đã Trang Bị Danh Hiệu Mới!')
            .setDescription(`Hồ sơ của bạn hiện đang hiển thị danh hiệu: **${equipped.name}**.`),
        ],
      });
      return;
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const u = economySystem.ensureUser(target.id, target.username);
    levelSystem.evaluateMilestoneTitles(target.id);
    const fresh = db.get('SELECT * FROM users WHERE user_id = ?', [target.id]);

    const role = resolveBotRole(db, target.id);
    const activeTitle = TITLES[fresh.active_title]?.name ?? '🌱 Tân Thủ';
    const unlockedIds = JSON.parse(fresh.unlocked_titles || '["tan_thu"]');
    const badges = unlockedIds
      .map((id) => TITLES[id]?.name)
      .filter(Boolean)
      .join(' • ');

    const frameBanner = fresh.active_frame
      ? `${SHOP_ITEMS[fresh.active_frame]?.frameStyle ?? ''}\n`
      : '';

    const petInfo = petSystem.getActivePetBonuses(target.id);
    const petLine = petInfo.pet
      ? `${petInfo.species.emoji} **${petInfo.pet.nickname}** (Lv.${petInfo.pet.level}) • *${petInfo.effectLabel}*`
      : '*Chưa trang bị*';

    const reqExp = expRequiredForLevel(fresh.level);
    const winRate =
      fresh.games_played > 0
        ? ((fresh.games_won / fresh.games_played) * 100).toFixed(1)
        : '0.0';

    const now = Date.now();
    const buffs = [];
    if (fresh.protected_until > now) {
      buffs.push(`🛡️ Bảo hiểm (${formatRemainingMs(fresh.protected_until - now)})`);
    }
    if (fresh.exp_boost_until > now) {
      buffs.push(`✨ x2 EXP (${formatRemainingMs(fresh.exp_boost_until - now)})`);
    }
    if (fresh.lucky_boost_until > now) {
      buffs.push(`🎟️ Vé May Mắn (${formatRemainingMs(fresh.lucky_boost_until - now)})`);
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: `Hồ Sơ Chiến Binh — ${target.username} [${role}]`,
        iconURL: target.displayAvatarURL(),
      })
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `${frameBanner}` +
          `🏅 Danh hiệu hiện tại: **${activeTitle}**\n` +
          `⭐ **Cấp ${fresh.level}** • \`${renderProgressBar(fresh.exp, reqExp, 10)}\` (${fresh.exp}/${reqExp} EXP)`
      )
      .addFields(
        {
          name: '💰 Tài Sản Cá Nhân',
          value: `• Ví: **${formatVnd(fresh.wallet)}**\n• Ngân hàng: **${formatVnd(fresh.bank)}**\n• Tiết kiệm: **${formatVnd(fresh.savings)}**`,
          inline: true,
        },
        {
          name: '🎲 Thống Kê Giải Trí',
          value: `• Đã chơi: **${fresh.games_played}** ván\n• Thắng: **${fresh.games_won}** (${winRate}%)\n• Chuỗi Daily: **${fresh.login_streak} ngày**`,
          inline: true,
        },
        {
          name: '🐾 Thú Cưng & Hiệu Ứng',
          value: petLine,
          inline: false,
        },
        {
          name: `🎖️ Bộ Huy Hiệu Đã Mở Khóa (${unlockedIds.length})`,
          value: badges || '🌱 Tân Thủ',
          inline: false,
        }
      )
      .setTimestamp();

    if (buffs.length > 0) {
      embed.addFields({ name: '⚡ Hiệu Ứng Đang Bật', value: buffs.join('  |  ') });
    }

    await interaction.reply({ embeds: [embed] });
  },
};

// 2. /rob
const robCmd = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Thử vận may cướp tiền mặt trong ví của người chơi khác (cẩn thận bị truy nã!)')
    .addUserOption((o) =>
      o.setName('target').setDescription('Mục tiêu bạn muốn nhắm tới').setRequired(true)
    ),
  async execute(interaction, { crimeSystem }) {
    const victim = interaction.options.getUser('target', true);
    const res = crimeSystem.rob({
      robberId: interaction.user.id,
      robberName: interaction.user.username,
      victimId: victim.id,
      victimName: victim.username,
      isVictimBot: victim.bot,
    });

    if (res.succeeded) {
      const bountyNote =
        res.bountyBonus > 0
          ? `\n🎯 **Thu luôn tiền thưởng Truy Nã của mục tiêu: +${formatVnd(res.bountyBonus)}!**`
          : '';
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setTitle('🥷 Phi Vụ Cướp Thành Công!')
            .setDescription(
              `Bạn đã lẻn lấy được **+${formatVnd(res.stolen)}** từ ví của <@${victim.id}>!${bountyNote}\n` +
                `💵 Số dư ví của bạn: **${formatVnd(res.robberAfter)}**`
            ),
        ],
      });
      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setTitle('🚓 Bị Bắt Tại Trận Khi Đi Cướp!')
          .setDescription(
            `Phi vụ nhắm vào <@${victim.id}> thất bại! Bạn bị phạt **-${formatVnd(res.fine)}** (bồi thường nạn nhân ${formatVnd(res.compensation)}) và bị treo thưởng Truy Nã thêm **+${formatVnd(res.addedBounty)}**!\n` +
              `💵 Số dư ví còn lại: **${formatVnd(res.robberAfter)}**`
          ),
      ],
    });
  },
};

// 3. /protect
const protectCmd = {
  data: new SlashCommandBuilder()
    .setName('protect')
    .setDescription('Mua Bảo Hiểm Chống Cướp bảo vệ an toàn ví tiền của bạn')
    .addIntegerOption((o) =>
      o.setName('days').setDescription('Số ngày bảo hiểm muốn mua (1 - 7 ngày, mặc định 1)').setMinValue(1).setMaxValue(7).setRequired(false)
    ),
  async execute(interaction, { crimeSystem }) {
    const days = interaction.options.getInteger('days') ?? 1;
    const res = crimeSystem.buyProtection(
      interaction.user.id,
      interaction.user.username,
      days * 24
    );
    const untilUnix = Math.floor(res.protectedUntil / 1000);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle('🛡️ Kích Hoạt Bảo Hiểm Chống Cướp')
          .setDescription(
            `Đã mua thành công gói bảo vệ với chi phí **${formatVnd(res.cost)}**.\n` +
              `• Bảo vệ ví đến: <t:${untilUnix}:F> (<t:${untilUnix}:R>)\n` +
              `💵 Ví còn lại: **${formatVnd(res.balanceAfter)}**`
          ),
      ],
    });
  },
};

// 4. /bounty
const bountyCmd = {
  data: new SlashCommandBuilder()
    .setName('bounty')
    .setDescription('Đặt tiền thưởng Truy Nã lên một người chơi khác')
    .addUserOption((o) =>
      o.setName('target').setDescription('Người bị truy nã').setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Mức thưởng truy nã (tối thiểu 5.000 VNĐ)').setMinValue(5000).setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Lý do truy nã').setRequired(false)
    ),
  async execute(interaction, { crimeSystem }) {
    const target = interaction.options.getUser('target', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') ?? 'Truy nã giang hồ';

    const res = crimeSystem.placeBounty({
      placerId: interaction.user.id,
      placerName: interaction.user.username,
      targetId: target.id,
      targetName: target.username,
      amount,
      reason,
      isTargetBot: target.bot,
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle('🎯 Đã Treo Lệnh Truy Nã!')
          .setDescription(
            `<@${interaction.user.id}> vừa treo thưởng lên <@${target.id}>!\n` +
              `• Tổng mức thưởng Truy Nã hiện tại trên đầu mục tiêu: **${formatVnd(res.totalBounty)}**\n` +
              `• Lý do: *${reason}*`
          ),
      ],
    });
  },
};

// 5. /wanted
const wantedCmd = {
  data: new SlashCommandBuilder()
    .setName('wanted')
    .setDescription('Xem Bảng Truy Nã các mục tiêu đang có tiền thưởng cao nhất'),
  async execute(interaction, { crimeSystem }) {
    const rows = crimeSystem.getWantedList(10);
    const lines =
      rows.length > 0
        ? rows.map(
            (r, idx) =>
              `\`#${idx + 1}\` 🎯 <@${r.target_id}> — Thưởng: **${formatVnd(r.amount)}** • *${r.reason}*`
          )
        : ['*Hiện không có ai trên bảng Truy Nã. Thành phố đang bình yên!*'];

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setTitle('📜 Bảng Vàng Truy Nã Toàn Server')
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Ai cướp (/rob) thành công người bị truy nã sẽ ẵm trọn tiền thưởng!' })
          .setTimestamp(),
      ],
    });
  },
};

export const PROFILE_AND_CRIME_COMMANDS = [
  profileCmd,
  robCmd,
  protectCmd,
  bountyCmd,
  wantedCmd,
];
