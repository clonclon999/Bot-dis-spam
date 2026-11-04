import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { TITLES } from '../../config/constants.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';

// 1. /balance
const balanceCmd = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Xem số dư ví tiền mặt, ngân hàng và sổ tiết kiệm VNĐ')
    .addUserOption((o) =>
      o.setName('user').setDescription('Xem số dư của người chơi khác').setRequired(false)
    ),
  async execute(interaction, { economySystem, bankSystem }) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (target.bot) {
      await interaction.reply({ content: '🤖 Tài khoản Bot không sử dụng ví VNĐ.', flags: MessageFlags.Ephemeral });
      return;
    }
    bankSystem.settleInterest(target.id, target.username);
    const bal = economySystem.getBalance(target.id, target.username);

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setAuthor({
        name: `Tài sản của ${target.username}`,
        iconURL: target.displayAvatarURL(),
      })
      .addFields(
        { name: '💵 Ví tiền mặt', value: `**${formatVnd(bal.wallet)}**`, inline: true },
        { name: '🏦 Ngân hàng', value: `**${formatVnd(bal.bank)}**`, inline: true },
        { name: '💎 Sổ tiết kiệm', value: `**${formatVnd(bal.savings)}**`, inline: true },
        { name: '📊 Tổng tài sản ròng', value: `**${formatVnd(bal.netWorth)}**`, inline: false }
      )
      .setFooter({
        text: bal.isFrozen
          ? '❄️ Tài khoản này hiện đang bị đóng băng giao dịch'
          : 'Đơn vị tiền tệ ảo trong Game Bot PRO',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// 2, 3, 4. /daily, /weekly, /monthly
function makePeriodicCmd(name, desc, title) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(desc),
    async execute(interaction, { economySystem }) {
      const res = economySystem.claimPeriodicReward(
        interaction.user.id,
        interaction.user.username,
        name
      );
      const streakLine =
        name === 'daily'
          ? `\n🔥 Chuỗi đăng nhập liên tục: **${res.streak} ngày** (Thưởng thêm: **+${formatVnd(res.streakBonus)}**)`
          : '';
      const lvLine = res.expResult?.leveledUp
        ? `\n🎉 **THĂNG CẤP!** Bạn đã đạt **Cấp ${res.expResult.newLevel}** (+${formatVnd(res.expResult.levelRewardVnd)})!`
        : '';

      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(title)
        .setDescription(
          `Bạn vừa nhận thành công **+${formatVnd(res.reward)}** và **+${res.expResult?.addedExp ?? 0} EXP**!${streakLine}${lvLine}\n` +
            `💵 Số dư ví hiện tại: **${formatVnd(res.balanceAfter)}**`
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  };
}

const dailyCmd = makePeriodicCmd('daily', 'Nhận phần thưởng điểm danh VNĐ hằng ngày', '🎁 Phần Thưởng Hằng Ngày');
const weeklyCmd = makePeriodicCmd('weekly', 'Nhận phần thưởng VNĐ hằng tuần', '📦 Phần Thưởng Hằng Tuần');
const monthlyCmd = makePeriodicCmd('monthly', 'Nhận phần thưởng VNĐ hằng tháng', '👑 Phần Thưởng Hằng Tháng');

// 5. /pay
const payCmd = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Chuyển VNĐ từ ví của bạn sang người chơi khác')
    .addUserOption((o) =>
      o.setName('user').setDescription('Người nhận VNĐ').setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('Số tiền VNĐ muốn chuyển (tối thiểu 1.000)')
        .setMinValue(1000)
        .setRequired(true)
    ),
  async execute(interaction, { economySystem }) {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    const res = economySystem.transfer({
      fromId: interaction.user.id,
      fromName: interaction.user.username,
      toId: target.id,
      toName: target.username,
      amount,
      isBotTarget: target.bot,
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('💸 Chuyển Tiền Thành Công')
      .setDescription(
        `<@${interaction.user.id}> đã chuyển **${formatVnd(res.amount)}** cho <@${target.id}>.\n` +
          `💵 Số dư ví còn lại của bạn: **${formatVnd(res.senderAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// 6. /top
const topCmd = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Xem bảng xếp hạng Đại Gia VNĐ hoặc Cấp Độ cao nhất')
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

      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle('⭐ Bảng Xếp Hạng Cấp Độ Server')
        .setDescription(lines.join('\n'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Bảng Xếp Hạng Top Đại Gia VNĐ')
      .setDescription(lines.join('\n'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`🧾 Lịch Sử Giao Dịch — ${interaction.user.username}`)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('💼 Hoàn Thành Ca Làm Việc!')
      .setDescription(
        `Bạn vừa làm **${res.jobName}** và nhận lương **+${formatVnd(res.earned)}**${bonusNote}!${lvNote}\n` +
          `💵 Số dư ví: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// 9. /beg
const begCmd = {
  data: new SlashCommandBuilder()
    .setName('beg')
    .setDescription('Thử vận may xin tiền hỗ trợ từ người qua đường'),
  async execute(interaction, { economySystem }) {
    const res = economySystem.beg(interaction.user.id, interaction.user.username);
    const embed = new EmbedBuilder()
      .setColor(res.lucky ? COLORS.SUCCESS : COLORS.WARNING)
      .setTitle(res.lucky ? '🤲 Gặp Người Tốt Bụng!' : '😅 Chưa Gặp May Rồi')
      .setDescription(
        res.lucky
          ? `Một đại gia đi ngang qua đã tặng bạn **+${formatVnd(res.earned)}**!\n💵 Số dư ví: **${formatVnd(res.balanceAfter)}**`
          : 'Mọi người đều đang bận rộn nên bạn chưa xin được đồng nào lần này. Thử lại sau ít phút nhé!'
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('🏦 Gửi Tiền Ngân Hàng Thành Công')
      .setDescription(
        `Đã gửi **${formatVnd(res.amount)}** vào **${account === 'savings' ? '💎 Sổ Tiết Kiệm' : '🏦 Ngân Hàng Thường'}**.\n` +
          `• Ví tiền mặt: **${formatVnd(res.walletAfter)}**\n` +
          `• Ngân hàng thường: **${formatVnd(res.bankAfter)}**\n` +
          `• Sổ tiết kiệm: **${formatVnd(res.savingsAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('🏧 Rút Tiền Thành Công')
      .setDescription(
        `Đã rút **${formatVnd(res.amount)}** về ví tiền mặt.\n` +
          `• Ví tiền mặt: **${formatVnd(res.walletAfter)}**\n` +
          `• Ngân hàng thường: **${formatVnd(res.bankAfter)}**\n` +
          `• Sổ tiết kiệm: **${formatVnd(res.savingsAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('🏦 Trung Tâm Lãi Suất & Tiết Kiệm')
      .setDescription(
        `${creditBanner}` +
          `• 🏦 Số dư Ngân hàng thường: **${formatVnd(info.bank)}** *(Lãi: **${(info.baseRate * 100).toFixed(2)}%** / ${info.intervalHours}h)*\n` +
          `• 💎 Số dư Sổ tiết kiệm: **${formatVnd(info.savings)}** *(Lãi ưu đãi: **${(info.savingsRate * 100).toFixed(2)}%** / ${info.intervalHours}h)*\n` +
          `• ⏳ Kỳ trả lãi tiếp theo sau: **${bankSystem.formatNextInterestCountdown(info.nextInterestInMs)}**`
      )
      .addFields({ name: '📑 Lịch sử Ngân hàng gần đây', value: histText })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
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
