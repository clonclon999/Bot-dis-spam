import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from 'discord.js';
import { TITLES } from '../../config/constants.js';
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
import { resolveUserAvatarUrl, THEME } from '../../ui/theme.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { formatVnd } from '../../utils/format.js';

// 1. /balance
const balanceCmd = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Kiểm tra số dư Ví, Ngân hàng, Tiết kiệm và Tổng tài sản VNĐ (Components V2)')
    .addUserOption((o) =>
      o.setName('user').setDescription('Xem số dư của người chơi khác').setRequired(false)
    ),
  async execute(interaction, { economySystem, bankSystem }) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    bankSystem.settleInterest(target.id, target.username);
    const bal = economySystem.getBalance(target.id, target.username);

    const wBanner = buildAssetAttachment(ASSET_PATHS.WALLET_BANNER, 'wallet_banner.png');
    const fbThumb = buildAssetAttachment(ASSET_PATHS.COIN_SAP, 'bal_avatar.png');
    const avatarUrl = resolveUserAvatarUrl(target, fbThumb.url);
    const files = avatarUrl === fbThumb.url ? [wBanner.attachment, fbThumb.attachment] : [wBanner.attachment];

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gc:nav:${interaction.user.id}:wallet`)
        .setLabel('Quản Lý Ví & Ngân Hàng')
        .setEmoji('🏦')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`gc:home:${interaction.user.id}`)
        .setLabel('Game Center')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Secondary)
    );

    const card = createContainer({
      accentColor: THEME.NEON_CYAN,
      children: [
        mediaGallery([{ url: wBanner.url, description: `Tài khoản VNĐ — ${target.username}` }]),
        sectionWithThumbnail({
          texts: [
            `## 💰 Hồ Sơ Tài Chính — ${target.username}\n` +
              `• 💵 **Ví tiền mặt:** **${formatVnd(bal.wallet)}**\n` +
              `• 🏦 **Ngân hàng thường:** **${formatVnd(bal.bank)}**\n` +
              `• 💎 **Sổ tiết kiệm:** **${formatVnd(bal.savings)}**\n` +
              `• 📊 **Tổng tài sản ròng:** **${formatVnd(bal.netWorth)}**`,
            `*(Tiền tệ ảo VNĐ chỉ lưu hành nội bộ để giải trí trong hệ thống Game Center)*`,
          ],
          url: avatarUrl,
          description: `Avatar ${target.username}`,
        }),
        separator(),
        navRow,
      ],
    });

    await safeReplyV2(interaction, buildCv2Payload({ containers: [card], files }));
  },
};

// 2–4. /daily, /weekly, /monthly
function createPeriodicCommand(name, desc, periodKey, labelTitle) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(desc),
    async execute(interaction, { economySystem }) {
      const res = economySystem.claimPeriodicReward(
        interaction.user.id,
        interaction.user.username,
        periodKey
      );
      const streakLine =
        periodKey === 'daily'
          ? `\n🔥 Chuỗi đăng nhập liên tiếp: **${res.streak} ngày**`
          : '';
      const lvLine = res.expResult?.leveledUp
        ? `\n🎉 **CHÚC MỪNG LÊN CẤP ${res.expResult.newLevel}!** Thưởng thêm +**${formatVnd(res.expResult.levelRewardVnd)}**!`
        : '';

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: `🎁 ${labelTitle}`,
          body:
            `Bạn vừa nhận thành công **+${formatVnd(res.reward)}** vào ví!${streakLine}${lvLine}\n` +
            `💵 Số dư ví hiện tại: **${formatVnd(res.balanceAfter)}**`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
    },
  };
}

const dailyCmd = createPeriodicCommand(
  'daily',
  'Điểm danh nhận tiền thưởng VNĐ hằng ngày (tích chuỗi thưởng thêm)',
  'daily',
  'Điểm Danh Hằng Ngày Thành Công!'
);
const weeklyCmd = createPeriodicCommand(
  'weekly',
  'Nhận gói trợ cấp VNĐ hằng tuần',
  'weekly',
  'Nhận Quà Hằng Tuần Thành Công!'
);
const monthlyCmd = createPeriodicCommand(
  'monthly',
  'Nhận đại lễ thưởng VNĐ hằng tháng',
  'monthly',
  'Nhận Đại Lễ Hằng Tháng Thành Công!'
);

// 5. /pay
const payCmd = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Chuyển tiền VNĐ an toàn sang ví người chơi khác')
    .addUserOption((o) =>
      o.setName('user').setDescription('Người nhận tiền').setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('Số tiền VNĐ muốn chuyển')
        .setMinValue(1000)
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('note').setDescription('Lời nhắn đính kèm (tùy chọn)').setRequired(false)
    ),
  async execute(interaction, { economySystem }) {
    const recipient = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const note = interaction.options.getString('note') ?? '';

    const res = economySystem.transferVnd({
      senderId: interaction.user.id,
      senderName: interaction.user.username,
      recipientId: recipient.id,
      recipientName: recipient.username,
      amount,
      isRecipientBot: recipient.bot,
    });

    const feeLine =
      res.fee > 0
        ? `• Phí giao dịch (${res.feePct}%): \`${formatVnd(res.fee)}\`\n`
        : '';

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '💸 Chuyển Khoản VNĐ Thành Công',
        body:
          `• Người gửi: <@${interaction.user.id}>\n` +
          `• Người nhận: <@${recipient.id}>\n` +
          `• Số tiền chuyển: **${formatVnd(res.amount)}**\n` +
          `${feeLine}` +
          `• Thực nhận: **+${formatVnd(res.netReceived)}**\n` +
          (note ? `• Lời nhắn: *${note}*\n` : '') +
          `• Số dư ví còn lại của bạn: **${formatVnd(res.senderBalanceAfter)}**`,
        accentColor: THEME.CYBER_EMERALD,
      })
    );
  },
};

// 6. /top
const topCmd = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Xem bảng xếp hạng Đại Gia VNĐ hoặc Cấp Độ cao nhất (Components V2)')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Loại bảng xếp hạng')
        .setRequired(false)
        .addChoices(
          { name: '💰 Top Đại Gia Giàu Nhất', value: 'rich' },
          { name: '⭐ Top Cấp Độ Cao Nhất', value: 'level' }
        )
    ),
  async execute(interaction, { economySystem, levelSystem }) {
    const type = interaction.options.getString('type') ?? 'rich';
    const medals = ['🥇', '🥈', '🥉'];
    const lbBanner = buildAssetAttachment(ASSET_PATHS.LEADERBOARD_BANNER, 'leaderboard_banner.png');

    if (type === 'level') {
      const rows = levelSystem.getLevelLeaderboard(10);
      const lines =
        rows.length > 0
          ? rows.map((r, i) => {
              const badge = medals[i] ?? `\`#${i + 1}\``;
              const titleName = TITLES[r.active_title]?.name ?? '🌱 Tân Thủ';
              return `${badge} <@${r.user_id}> — **Cấp ${r.level}** (${r.exp} EXP) • *${titleName}*`;
            })
          : ['*Chưa có dữ liệu xếp hạng.*'];

      const card = createContainer({
        accentColor: THEME.NEON_PURPLE,
        children: [
          mediaGallery([{ url: lbBanner.url, description: 'Bảng xếp hạng Cấp Độ Server' }]),
          textDisplay(`## ⭐ Bảng Xếp Hạng Cấp Độ Server\n${lines.join('\n')}`),
        ],
      });
      await safeReplyV2(interaction, buildCv2Payload({ containers: [card], files: [lbBanner.attachment] }));
      return;
    }

    const rows = economySystem.getRichLeaderboard(10);
    const lines =
      rows.length > 0
        ? rows.map((r, i) => {
            const badge = medals[i] ?? `\`#${i + 1}\``;
            return `${badge} <@${r.user_id}> — **${formatVnd(r.net_worth)}** *(Cấp ${r.level})*`;
          })
        : ['*Chưa có dữ liệu xếp hạng.*'];

    const card = createContainer({
      accentColor: THEME.NEON_GOLD,
      children: [
        mediaGallery([{ url: lbBanner.url, description: 'Bảng xếp hạng Top Đại Gia VNĐ' }]),
        textDisplay(`## 🏆 Bảng Xếp Hạng Top Đại Gia VNĐ\n${lines.join('\n')}`),
      ],
    });
    await safeReplyV2(interaction, buildCv2Payload({ containers: [card], files: [lbBanner.attachment] }));
  },
};

// 7. /history
const historyCmd = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Xem lịch sử biến động số dư và giao dịch VNĐ gần nhất'),
  async execute(interaction, { economySystem }) {
    const rows = economySystem.getHistory(interaction.user.id, 10);
    const lines =
      rows.length > 0
        ? rows.map((r) => {
            const ts = Math.floor(r.created_at / 1000);
            const sign = r.amount >= 0 ? `+${formatVnd(r.amount)}` : formatVnd(r.amount);
            return `• <t:${ts}:R> | **${sign}** → Ví: \`${formatVnd(r.balance_after)}\`\n  ↳ *${r.note || r.type}*`;
          })
        : ['*Chưa có giao dịch nào được ghi nhận.*'];

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `🧾 Lịch Sử Giao Dịch — ${interaction.user.username}`,
        body: lines.join('\n'),
        accentColor: THEME.NEON_CYAN,
        ephemeral: true,
      })
    );
  },
};

// 8. /work
const workCmd = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Đi làm chăm chỉ để kiếm tiền VNĐ và tích lũy EXP'),
  async execute(interaction, { economySystem }) {
    const res = economySystem.work(interaction.user.id, interaction.user.username);
    const bonusNote =
      res.multiplier > 1
        ? ` *(Hệ số thưởng x${res.multiplier} từ Pet / Vé May Mắn)*`
        : '';
    const lvNote = res.expResult?.leveledUp
      ? `\n🎉 **THĂNG CẤP ${res.expResult.newLevel}!** Nhận thưởng +**${formatVnd(res.expResult.levelRewardVnd)}**!`
      : '';

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '💼 Hoàn Thành Ca Làm Việc!',
        body:
          `Bạn vừa làm **${res.jobName}** và nhận lương **+${formatVnd(res.earned)}**${bonusNote}!${lvNote}\n` +
          `💵 Số dư ví: **${formatVnd(res.balanceAfter)}**`,
        accentColor: THEME.CYBER_EMERALD,
      })
    );
  },
};

// 9. /beg
const begCmd = {
  data: new SlashCommandBuilder()
    .setName('beg')
    .setDescription('Thử vận may xin tiền hỗ trợ từ người qua đường'),
  async execute(interaction, { economySystem }) {
    const res = economySystem.beg(interaction.user.id, interaction.user.username);
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: res.lucky ? '🤲 Gặp Người Tốt Bụng!' : '😅 Chưa Gặp May Rồi',
        body: res.lucky
          ? `Một đại gia đi ngang qua đã tặng bạn **+${formatVnd(res.earned)}**!\n💵 Số dư ví: **${formatVnd(res.balanceAfter)}**`
          : 'Mọi người đều đang bận rộn nên bạn chưa xin được đồng nào lần này. Thử lại sau ít phút nhé!',
        accentColor: res.lucky ? THEME.CYBER_EMERALD : THEME.AMBER_PULSE,
      })
    );
  },
};

// 10. /deposit
const depositCmd = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Gửi VNĐ vào Ngân hàng hoặc mở Sổ Tiết Kiệm hưởng lãi cao')
    .addStringOption((o) =>
      o
        .setName('amount')
        .setDescription('Nhập số tiền muốn gửi hoặc gõ "all" để gửi toàn bộ ví')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('account')
        .setDescription('Loại tài khoản ngân hàng muốn gửi vào')
        .setRequired(false)
        .addChoices(
          { name: '🏦 Tài khoản Ngân hàng thường', value: 'checking' },
          { name: '💎 Sổ Tiết Kiệm (Lãi suất x1.5)', value: 'savings' }
        )
    ),
  async execute(interaction, { bankSystem }) {
    const rawAmt = interaction.options.getString('amount', true).trim().toLowerCase();
    const account = interaction.options.getString('account') ?? 'checking';
    const parsedAmt = rawAmt === 'all' ? 'all' : Number.parseInt(rawAmt, 10);

    const res = bankSystem.deposit(
      interaction.user.id,
      interaction.user.username,
      parsedAmt,
      account
    );

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🏦 Gửi Tiền Ngân Hàng Thành Công',
        body:
          `Đã gửi **${formatVnd(res.amount)}** vào **${account === 'savings' ? '💎 Sổ Tiết Kiệm' : '🏦 Ngân Hàng Thường'}**.\n` +
          `• Ví tiền mặt: **${formatVnd(res.walletAfter)}**\n` +
          `• Ngân hàng thường: **${formatVnd(res.bankAfter)}**\n` +
          `• Sổ tiết kiệm: **${formatVnd(res.savingsAfter)}**`,
        accentColor: THEME.CYBER_EMERALD,
      })
    );
  },
};

// 11. /withdraw
const withdrawCmd = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Rút VNĐ từ Ngân hàng hoặc Sổ Tiết Kiệm về ví tiền mặt')
    .addStringOption((o) =>
      o
        .setName('amount')
        .setDescription('Nhập số tiền muốn rút hoặc gõ "all" để rút toàn bộ')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('account')
        .setDescription('Tài khoản nguồn muốn rút')
        .setRequired(false)
        .addChoices(
          { name: '🏦 Tài khoản Ngân hàng thường', value: 'checking' },
          { name: '💎 Sổ Tiết Kiệm', value: 'savings' }
        )
    ),
  async execute(interaction, { bankSystem }) {
    const rawAmt = interaction.options.getString('amount', true).trim().toLowerCase();
    const account = interaction.options.getString('account') ?? 'checking';
    const parsedAmt = rawAmt === 'all' ? 'all' : Number.parseInt(rawAmt, 10);

    const res = bankSystem.withdraw(
      interaction.user.id,
      interaction.user.username,
      parsedAmt,
      account
    );

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🏧 Rút Tiền Thành Công',
        body:
          `Đã rút **${formatVnd(res.amount)}** về ví tiền mặt.\n` +
          `• Ví tiền mặt: **${formatVnd(res.walletAfter)}**\n` +
          `• Ngân hàng thường: **${formatVnd(res.bankAfter)}**\n` +
          `• Sổ tiết kiệm: **${formatVnd(res.savingsAfter)}**`,
        accentColor: THEME.NEON_CYAN,
      })
    );
  },
};

// 12. /interest
const interestCmd = {
  data: new SlashCommandBuilder()
    .setName('interest')
    .setDescription('Xem thông tin lãi suất, lịch sử gửi/rút và nhận lãi ngân hàng định kỳ'),
  async execute(interaction, { bankSystem }) {
    const info = bankSystem.settleInterest(
      interaction.user.id,
      interaction.user.username
    );
    const history = bankSystem.getBankHistory(interaction.user.id, 5);

    const histText =
      history.length > 0
        ? history
            .map((h) => {
              const ts = Math.floor(h.created_at / 1000);
              const s = h.amount >= 0 ? `+${formatVnd(h.amount)}` : formatVnd(h.amount);
              return `• <t:${ts}:R>: **${s}** (${h.note})`;
            })
            .join('\n')
        : '*Chưa có lịch sử giao dịch ngân hàng.*';

    const creditBanner =
      info.credited > 0
        ? `🎉 **Đã tất toán lãi tự động (${info.periodsApplied} chu kỳ): +${formatVnd(info.credited)}!**\n\n`
        : '';

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🏦 Trung Tâm Lãi Suất & Tiết Kiệm',
        body:
          `${creditBanner}` +
          `• 🏦 Số dư Ngân hàng thường: **${formatVnd(info.bank)}** *(Lãi: **${(info.baseRate * 100).toFixed(2)}%** / ${info.intervalHours}h)*\n` +
          `• 💎 Số dư Sổ tiết kiệm: **${formatVnd(info.savings)}** *(Lãi ưu đãi: **${(info.savingsRate * 100).toFixed(2)}%** / ${info.intervalHours}h)*\n` +
          `• ⏳ Kỳ trả lãi tiếp theo sau: **${bankSystem.formatNextInterestCountdown(info.nextInterestInMs)}**\n\n` +
          `### 📑 Lịch Sử Ngân Hàng Gần Đây\n${histText}`,
        accentColor: THEME.NEON_PURPLE,
      })
    );
  },
};

export const ECONOMY_COMMANDS = [
  balanceCmd,
  dailyCmd,
  weeklyCmd,
  monthlyCmd,
  payCmd,
  topCmd,
  historyCmd,
  workCmd,
  begCmd,
  depositCmd,
  withdrawCmd,
  interestCmd,
];
