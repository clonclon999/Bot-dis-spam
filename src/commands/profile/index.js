import { SlashCommandBuilder } from 'discord.js';
import { SHOP_ITEMS, TITLES } from '../../config/constants.js';
import { expRequiredForLevel } from '../../systems/levelSystem.js';
import {
  buildCv2NoticePayload,
  buildCv2Payload,
  createContainer,
  mediaGallery,
  sectionWithThumbnail,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import { safeReplyV2 } from '../../ui/interactionHelpers.js';
import { renderNeonBar, resolveUserAvatarUrl, THEME } from '../../ui/theme.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { formatVnd } from '../../utils/format.js';
import { resolveBotRole } from '../../utils/permissions.js';

// 1. /profile
const profileCmd = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Xem Hồ sơ cá nhân, Cấp độ, Huy hiệu, Khung viền & Thú cưng đồng hành (Components V2)')
    .addUserOption((o) =>
      o.setName('user').setDescription('Xem hồ sơ người chơi khác').setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('equip_title')
        .setDescription('Đổi danh hiệu đang mở khóa của bạn (tùy chọn)')
        .setRequired(false)
        .addChoices(
          ...Object.values(TITLES).map((t) => ({ name: t.name, value: t.id }))
        )
    ),
  async execute(interaction, { db, economySystem, petSystem, bankSystem }) {
    const equipTitle = interaction.options.getString('equip_title');
    if (equipTitle) {
      const uSelf = economySystem.ensureUser(interaction.user.id, interaction.user.username);
      const unlocked = JSON.parse(uSelf.unlocked_titles || '["tan_thu"]');
      if (!unlocked.includes(equipTitle)) {
        throw new Error(`Bạn chưa mở khóa danh hiệu **${TITLES[equipTitle]?.name || equipTitle}**!`);
      }
      db.run('UPDATE users SET active_title = ? WHERE user_id = ?', [
        equipTitle,
        interaction.user.id,
      ]);
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    bankSystem.settleInterest(target.id, target.username);
    const u = economySystem.ensureUser(target.id, target.username);
    const petInfo = petSystem.getActivePetBonuses(target.id);
    const role = resolveBotRole(db, target.id);

    const frameItem = u.active_frame ? SHOP_ITEMS[u.active_frame] : null;
    const frameBorder = frameItem?.frameStyle ?? '⟦ CYBER STANDARD ⟧';
    const frameName = frameItem?.name ?? 'Mặc định';
    const titleObj = TITLES[u.active_title] ?? TITLES.tan_thu;
    const badges = JSON.parse(u.badges || '[]');
    const reqExp = expRequiredForLevel(u.level);
    const totalGames = u.games_won + u.games_lost + u.games_drawn;
    const winRate = totalGames > 0 ? ((u.games_won / totalGames) * 100).toFixed(1) : '0.0';

    const petLine = petInfo.pet
      ? `${petInfo.species.emoji} **${petInfo.pet.nickname}** (Lv.${petInfo.pet.level} • No: ${petInfo.pet.currentHunger}%) — *${petInfo.effectLabel}*`
      : '*Chưa có thú cưng đồng hành*';

    const buffs = [];
    const now = Date.now();
    if (u.protected_until > now) {
      buffs.push(`🛡️ Bảo hiểm đến <t:${Math.floor(u.protected_until / 1000)}:R>`);
    }
    if (u.exp_boost_until > now) {
      buffs.push(`⚡ x2 EXP đến <t:${Math.floor(u.exp_boost_until / 1000)}:R>`);
    }
    if (u.luck_charges > 0) {
      buffs.push(`🍀 Vé May Mắn: còn ${u.luck_charges} lượt`);
    }

    const pBanner = buildAssetAttachment(ASSET_PATHS.PROFILE_BANNER, 'profile_banner.png');
    const fbThumb = buildAssetAttachment(ASSET_PATHS.COIN_SAP, 'profile_avatar.png');
    const avatarUrl = resolveUserAvatarUrl(target, fbThumb.url);
    const files = avatarUrl === fbThumb.url ? [pBanner.attachment, fbThumb.attachment] : [pBanner.attachment];

    const card = createContainer({
      accentColor: THEME.NEON_PURPLE,
      children: [
        mediaGallery([{ url: pBanner.url, description: `Hồ sơ cá nhân ${target.username}` }]),
        sectionWithThumbnail({
          texts: [
            `## ${frameBorder} Hồ Sơ Cá Nhân — ${target.username}\n` +
              `🏅 Danh hiệu: **${titleObj.name}** • Khung: **${frameName}** • Vai trò: \`${role}\`\n` +
              `⭐ **Cấp ${u.level}** \`${renderNeonBar(u.exp, reqExp, 10)}\` (\`${u.exp}/${reqExp} EXP\`)`,
            `💰 **Tổng Tài Sản:** **${formatVnd(u.wallet + u.bank + u.savings)}**\n` +
              `┗ Ví: \`${formatVnd(u.wallet)}\` • Bank/TK: \`${formatVnd(u.bank + u.savings)}\``,
          ],
          url: avatarUrl,
          description: `Avatar ${target.username}`,
        }),
        separator(),
        textDisplay(
          `🎲 **Thành Tích Game:** Thắng \`${u.games_won}\` / Thua \`${u.games_lost}\` / Hòa \`${u.games_drawn}\` *(Winrate: **${winRate}%**)*\n` +
            `🐾 **Thú Cưng Đồng Hành:** ${petLine}\n` +
            `🎖️ **Huy Hiệu Đạt Được:** ${badges.length > 0 ? badges.join(' ') : '*Chưa có huy hiệu*'}` +
            (buffs.length > 0 ? `\n⚡ **Hiệu Ứng Đang Bật:** ${buffs.join('  │  ')}` : '')
        ),
      ],
    });

    await safeReplyV2(interaction, buildCv2Payload({ containers: [card], files }));
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
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🥷 Phi Vụ Cướp Thành Công!',
          body:
            `Bạn đã lẻn lấy được **+${formatVnd(res.stolen)}** từ ví của <@${victim.id}>!${bountyNote}\n` +
            `💵 Số dư ví của bạn: **${formatVnd(res.robberAfter)}**`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
      return;
    }

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🚓 Bị Bắt Tại Trận Khi Đi Cướp!',
        body:
          `Phi vụ nhắm vào <@${victim.id}> thất bại! Bạn bị phạt **-${formatVnd(res.fine)}** (bồi thường nạn nhân ${formatVnd(res.compensation)}) và bị treo thưởng Truy Nã thêm **+${formatVnd(res.addedBounty)}**!\n` +
          `💵 Số dư ví còn lại: **${formatVnd(res.robberAfter)}**`,
        accentColor: THEME.CRIMSON_NEON,
      })
    );
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🛡️ Kích Hoạt Bảo Hiểm Chống Cướp',
        body:
          `Đã mua thành công gói bảo vệ với chi phí **${formatVnd(res.cost)}**.\n` +
          `• Bảo vệ ví đến: <t:${untilUnix}:F> (<t:${untilUnix}:R>)\n` +
          `💵 Ví còn lại: **${formatVnd(res.balanceAfter)}**`,
        accentColor: THEME.CYBER_EMERALD,
      })
    );
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🎯 Đã Treo Lệnh Truy Nã!',
        body:
          `<@${interaction.user.id}> vừa treo thưởng lên <@${target.id}>!\n` +
          `• Tổng mức thưởng Truy Nã hiện tại trên đầu mục tiêu: **${formatVnd(res.totalBounty)}**\n` +
          `• Lý do: *${reason}*`,
        accentColor: THEME.AMBER_PULSE,
      })
    );
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '📜 Bảng Vàng Truy Nã Toàn Server',
        body:
          `${lines.join('\n')}\n\n` +
          `*(Ai cướp \`/rob\` thành công người bị truy nã sẽ ẵm trọn tiền thưởng!)*`,
        accentColor: THEME.CRIMSON_NEON,
      })
    );
  },
};

export const PROFILE_AND_CRIME_COMMANDS = [
  profileCmd,
  robCmd,
  protectCmd,
  bountyCmd,
  wantedCmd,
];
