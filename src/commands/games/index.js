import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  BAUCUA_MASCOTS,
  RACE_ANIMALS,
  RPS_CHOICES,
} from '../../config/constants.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';

/**
 * Bộ nhớ phiên tương tác ngắn hạn cho bàn Bầu Cua, Tài Xỉu và thách đấu Oẳn Tù Tì PvP.
 * Giới hạn kích thước và tự dọn các phiên cũ > 10 phút để giữ RAM siêu nhẹ trên BotKeep Free.
 */
const baucuaSessions = new Map();
const taixiuSessions = new Map();
const rpsDuels = new Map();

export function sweepGameSessions(now = Date.now()) {
  const ttl = 10 * 60 * 1000;
  for (const [k, v] of baucuaSessions.entries()) {
    if (now - v.updatedAt > ttl) baucuaSessions.delete(k);
  }
  for (const [k, v] of taixiuSessions.entries()) {
    if (now - v.updatedAt > ttl) taixiuSessions.delete(k);
  }
  for (const [k, v] of rpsDuels.entries()) {
    if (now - v.createdAt > ttl) rpsDuels.delete(k);
  }
}

// ============================================================================
// Giao diện Bàn Bầu Cua Tương Tác (Select Menu + Buttons + Modal)
// ============================================================================

function getOrInitBauCuaSession(userId) {
  let s = baucuaSessions.get(userId);
  if (!s) {
    s = { chip: 5_000, selectedMascots: ['bau'], bets: {}, updatedAt: Date.now() };
    baucuaSessions.set(userId, s);
  }
  s.updatedAt = Date.now();
  return s;
}

function buildBauCuaPanelPayload(user, session, walletBal, lastResultText = '') {
  const betsLines = Object.entries(session.bets).map(([mId, amt]) => {
    const m = BAUCUA_MASCOTS.find((x) => x.id === mId);
    return `• ${m.emoji} **${m.name}**: **${formatVnd(amt)}**`;
  });
  const totalStaked = Object.values(session.bets).reduce((a, b) => a + b, 0);

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🎲 Sòng Bầu Cua Tôm Cá PRO')
    .setDescription(
      (lastResultText ? `${lastResultText}\n──────────────\n` : '') +
        `👤 Người chơi: <@${user.id}> | 💵 Ví: **${formatVnd(walletBal)}**\n` +
        `🪙 Mức phỉnh đang chọn: **${formatVnd(session.chip)}** / cửa\n\n` +
        `**📋 Cửa đã đặt (Tổng: ${formatVnd(totalStaked)}):**\n` +
        (betsLines.length > 0 ? betsLines.join('\n') : '*Chưa đặt cửa nào — Hãy chọn linh vật bên dưới!*')
    )
    .setFooter({ text: 'Chọn 1 hoặc nhiều linh vật trong Menu để cộng phỉnh • Bấm Lắc Ngay để mở bát!' });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`game:bc_select:${user.id}`)
      .setPlaceholder('🍐🦀🦐 Chọn 1 hoặc nhiều linh vật để đặt cược...')
      .setMinValues(1)
      .setMaxValues(6)
      .addOptions(
        BAUCUA_MASCOTS.map((m) => ({
          label: m.name,
          value: m.id,
          emoji: m.emoji,
          description: `Cộng thêm ${formatVnd(session.chip)} vào cửa ${m.name}`,
        }))
      )
  );

  const chipsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`game:bc_chip:${user.id}:5000`)
      .setLabel('5K')
      .setStyle(session.chip === 5_000 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`game:bc_chip:${user.id}:20000`)
      .setLabel('20K')
      .setStyle(session.chip === 20_000 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`game:bc_chip:${user.id}:100000`)
      .setLabel('100K')
      .setStyle(session.chip === 100_000 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`game:bc_custom:${user.id}`)
      .setLabel('Nhập tiền khác')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`game:bc_roll:${user.id}`)
      .setLabel('Lắc Xúc Xắc!')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Success)
      .setDisabled(totalStaked <= 0),
    new ButtonBuilder()
      .setCustomId(`game:bc_clear:${user.id}`)
      .setLabel('Xóa cược')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(totalStaked <= 0)
  );

  return { embeds: [embed], components: [selectRow, chipsRow, actionRow] };
}

// 1. /baucua
const baucuaCmd = {
  data: new SlashCommandBuilder()
    .setName('baucua')
    .setDescription('Chơi Bầu Cua Tôm Cá (hỗ trợ đặt nhiều cửa bằng Menu & Nút bấm)')
    .addStringOption((o) =>
      o
        .setName('linh_vat')
        .setDescription('Đặt nhanh 1 linh vật (bỏ trống để mở bàn đặt nhiều linh vật)')
        .setRequired(false)
        .addChoices(...BAUCUA_MASCOTS.map((m) => ({ name: `${m.emoji} ${m.name}`, value: m.id })))
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Số tiền VNĐ cược nhanh').setMinValue(1000).setRequired(false)
    ),
  async execute(interaction, { gameSystem, economySystem }) {
    const quickMascot = interaction.options.getString('linh_vat');
    const quickBet = interaction.options.getInteger('tien_cuoc');

    if (quickMascot && quickBet) {
      const res = gameSystem.playBauCua({
        userId: interaction.user.id,
        username: interaction.user.username,
        bets: { [quickMascot]: quickBet },
      });

      const diceLine = res.rolledMascots.map((m) => `${m.emoji} **${m.name}**`).join('  |  ');
      const netLine =
        res.net > 0
          ? `🎉 **THẮNG LỚN: +${formatVnd(res.net)}**`
          : res.net === 0
            ? `⚖️ **HÒA VỐN (0 VNĐ)**`
            : `💸 **THUA: ${formatVnd(res.net)}**`;

      const embed = new EmbedBuilder()
        .setColor(res.net >= 0 ? COLORS.SUCCESS : COLORS.DANGER)
        .setTitle('🎲 Kết Quả Lắc Bầu Cua')
        .setDescription(
          `🎯 Ba mặt xúc xắc:  ${diceLine}\n\n` +
            `${res.breakdown.join('\n')}\n\n` +
            `${netLine}\n💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`game:bc_open:${interaction.user.id}`)
          .setLabel('Mở bàn đặt nhiều linh vật')
          .setEmoji('🎛️')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    const session = getOrInitBauCuaSession(interaction.user.id);
    if (quickBet) session.chip = quickBet;
    if (quickMascot) session.bets[quickMascot] = (session.bets[quickMascot] || 0) + session.chip;

    await interaction.reply(buildBauCuaPanelPayload(interaction.user, session, bal.wallet));
  },
};

// ============================================================================
// 2. /taixiu (Tài Xỉu & Tài Xỉu Nâng Cao)
// ============================================================================

function buildTaiXiuPanelPayload(user, betAmount, walletBal, dashboard, lastRollResult = null) {
  const road =
    dashboard.recentLogs.length > 0
      ? dashboard.recentLogs
          .slice(0, 8)
          .reverse()
          .map((r) => (r.detail.includes('TÀI') ? '🔴T' : r.detail.includes('XỈU') ? '🔵X' : '🟡B'))
          .join(' → ')
      : '*Chưa có cầu gần đây*';

  let resultBlock = '';
  if (lastRollResult) {
    const faces = lastRollResult.diceFaces
      .map((f, idx) => `${f} \`(${lastRollResult.dice[idx]})\``)
      .join('  ');
    const statusText =
      lastRollResult.net > 0
        ? `🎉 **BẠN THẮNG: +${formatVnd(lastRollResult.net)}**`
        : `💸 **BẠN THUA: ${formatVnd(lastRollResult.net)}**`;

    resultBlock =
      `**🎲 Kết quả ván vừa lắc:** ${faces}\n` +
      `👉 Tổng: **${lastRollResult.outcomeLabel}** | Bạn chọn: **${lastRollResult.choice.toUpperCase()}**\n` +
      `${statusText}\n──────────────\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(lastRollResult ? (lastRollResult.won ? COLORS.SUCCESS : COLORS.DANGER) : COLORS.PRIMARY)
    .setTitle('🎯 Sòng Tài Xỉu Nâng Cao PRO')
    .setDescription(
      resultBlock +
        `👤 Người chơi: <@${user.id}> | 💵 Ví: **${formatVnd(walletBal)}**\n` +
        `💰 Mức cược mỗi ván: **${formatVnd(betAmount)}**\n` +
        `📈 Thống kê cá nhân: **${dashboard.personal.wins} Thắng / ${dashboard.personal.losses} Thua** (Tỷ lệ thắng: **${dashboard.personal.winRate}%**)\n` +
        `📊 Cầu 8 ván gần nhất: ${road}`
    )
    .setFooter({ text: '4–10 điểm: Xỉu • 11–17 điểm: Tài • Bộ ba đồng nhất: Bão' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`game:tx_play:${user.id}:tai`)
      .setLabel(`Đặt TÀI (${formatVnd(betAmount)})`)
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`game:tx_play:${user.id}:xiu`)
      .setLabel(`Đặt XỈU (${formatVnd(betAmount)})`)
      .setEmoji('🔵')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`game:tx_betmodal:${user.id}`)
      .setLabel('Đổi mức cược')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`game:tx_stats:${user.id}`)
      .setLabel('Làm mới thống kê')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1] };
}

const taixiuCmd = {
  data: new SlashCommandBuilder()
    .setName('taixiu')
    .setDescription('Chơi Tài Xỉu 3 xúc xắc kèm bảng cầu lịch sử và thống kê thắng thua')
    .addStringOption((o) =>
      o
        .setName('chon')
        .setDescription('Chọn nhanh Tài hoặc Xỉu (bỏ trống để mở bàn điều khiển Tài Xỉu nâng cao)')
        .setRequired(false)
        .addChoices(
          { name: '🔴 Tài (11 - 17 điểm)', value: 'tai' },
          { name: '🔵 Xỉu (4 - 10 điểm)', value: 'xiu' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Số tiền VNĐ đặt cược').setMinValue(1000).setRequired(false)
    ),
  async execute(interaction, { gameSystem, economySystem }) {
    const choice = interaction.options.getString('chon');
    const bet = interaction.options.getInteger('tien_cuoc') ?? 10_000;
    taixiuSessions.set(interaction.user.id, { bet, updatedAt: Date.now() });

    let rollRes = null;
    if (choice) {
      rollRes = gameSystem.playTaiXiu({
        userId: interaction.user.id,
        username: interaction.user.username,
        choice,
        bet,
      });
    }

    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    const dash = gameSystem.getTaiXiuDashboard(interaction.user.id);
    await interaction.reply(
      buildTaiXiuPanelPayload(interaction.user, bet, bal.wallet, dash, rollRes)
    );
  },
};

// ============================================================================
// 3. /coinflip (Tung Đồng Xu)
// ============================================================================

const coinflipCmd = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Tung đồng xu Sấp / Ngửa đặt cược VNĐ công bằng 50/50')
    .addStringOption((o) =>
      o
        .setName('chon')
        .setDescription('Chọn mặt đồng xu')
        .setRequired(true)
        .addChoices(
          { name: '🪙 Mặt Sấp', value: 'sap' },
          { name: '🌟 Mặt Ngửa', value: 'ngua' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Số tiền cược VNĐ').setMinValue(1000).setRequired(true)
    ),
  async execute(interaction, { gameSystem }) {
    const side = interaction.options.getString('chon', true);
    const bet = interaction.options.getInteger('tien_cuoc', true);
    const res = gameSystem.playCoinflip({
      userId: interaction.user.id,
      username: interaction.user.username,
      side,
      bet,
    });

    const embed = new EmbedBuilder()
      .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
      .setTitle('🪙 Tung Đồng Xu May Mắn')
      .setDescription(
        `• Bạn chọn: **${side === 'sap' ? 'Mặt Sấp' : 'Mặt Ngửa'}**\n` +
          `• Kết quả đồng xu: **${res.resultSide === 'sap' ? '🪙 Mặt Sấp' : '🌟 Mặt Ngửa'}**\n\n` +
          (res.won
            ? `🎉 **CHÚC MỪNG! Bạn thắng +${formatVnd(res.net)}!**`
            : `💸 **Rất tiếc! Bạn mất ${formatVnd(Math.abs(res.net))}.**`) +
          `\n💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`game:cf_again:${interaction.user.id}:sap:${bet}`)
        .setLabel(`Tung tiếp Sấp (${formatVnd(bet)})`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`game:cf_again:${interaction.user.id}:ngua:${bet}`)
        .setLabel(`Tung tiếp Ngửa (${formatVnd(bet)})`)
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};

// ============================================================================
// 4. /guess (Đoán Số theo độ khó)
// ============================================================================

const guessCmd = {
  data: new SlashCommandBuilder()
    .setName('guess')
    .setDescription('Đoán con số bí mật của Bot để nhận thưởng tới x22 tiền cược')
    .addStringOption((o) =>
      o
        .setName('do_kho')
        .setDescription('Chọn cấp độ thử thách')
        .setRequired(true)
        .addChoices(
          { name: '🟢 Dễ (1 - 5) • Thưởng x4.5', value: 'easy' },
          { name: '🟡 Trung bình (1 - 10) • Thưởng x9', value: 'medium' },
          { name: '🔴 Khó (1 - 25) • Thưởng x22', value: 'hard' }
        )
    )
    .addIntegerOption((o) =>
      o.setName('so_doan').setDescription('Con số bạn dự đoán').setMinValue(1).setMaxValue(25).setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Số tiền cược VNĐ').setMinValue(1000).setRequired(true)
    ),
  async execute(interaction, { gameSystem }) {
    const difficulty = interaction.options.getString('do_kho', true);
    const guessNumber = interaction.options.getInteger('so_doan', true);
    const bet = interaction.options.getInteger('tien_cuoc', true);

    const res = gameSystem.playGuess({
      userId: interaction.user.id,
      username: interaction.user.username,
      difficulty,
      guessNumber,
      bet,
    });

    const embed = new EmbedBuilder()
      .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
      .setTitle(`🔢 Đoán Số Bí Mật — ${res.mode.label}`)
      .setDescription(
        `• Con số bạn chọn: **#${res.pick}**\n` +
          `• Con số bí mật của Bot: **#${res.secret}**\n\n` +
          (res.won
            ? `🎯 **ĐOÁN CHÍNH XÁC! Bạn trúng lớn +${formatVnd(res.net)}!**`
            : `❌ **Chưa trúng rồi!** Bạn mất **${formatVnd(Math.abs(res.net))}**.`) +
          `\n💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// ============================================================================
// 5. /race (Đua Thú mô phỏng trực tiếp bằng hiệu ứng cập nhật Embed)
// ============================================================================

const raceCmd = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription('Đặt cược Đua Thú tốc độ với hiệu ứng đường đua trực tiếp (Thưởng x4.5)')
    .addStringOption((o) =>
      o
        .setName('thu_dua')
        .setDescription('Chọn chiến binh thú đua của bạn')
        .setRequired(true)
        .addChoices(...RACE_ANIMALS.map((a) => ({ name: `${a.emoji} ${a.name}`, value: a.id })))
    )
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Số tiền đặt cược VNĐ').setMinValue(1000).setRequired(true)
    ),
  async execute(interaction, { gameSystem }) {
    const animalId = interaction.options.getString('thu_dua', true);
    const bet = interaction.options.getInteger('tien_cuoc', true);

    const res = gameSystem.playRace({
      userId: interaction.user.id,
      username: interaction.user.username,
      animalId,
      bet,
    });

    // Khung hình 1: Xuất phát
    const startEmbed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('🏇 Trường Đua Thú Đang Diễn Ra!')
      .setDescription(
        `Bạn đặt **${formatVnd(bet)}** cho ${res.chosen.emoji} **${res.chosen.name}**!\n\n` +
          `${res.frames[0]}`
      )
      .setFooter({ text: 'Đang tăng tốc về đích...' });

    await interaction.reply({ embeds: [startEmbed] });

    // Cập nhật mượt 2 nhịp tiếp theo trên cùng 1 Embed (không spam nhiều tin nhắn)
    await new Promise((r) => setTimeout(r, 850));
    const midEmbed = EmbedBuilder.from(startEmbed).setDescription(
      `Bạn đặt **${formatVnd(bet)}** cho ${res.chosen.emoji} **${res.chosen.name}**!\n\n${res.frames[1]}`
    );
    await interaction.editReply({ embeds: [midEmbed] }).catch(() => {});

    await new Promise((r) => setTimeout(r, 850));
    const finalEmbed = new EmbedBuilder()
      .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
      .setTitle('🏁 Kết Quả Chung Cuộc Đua Thú!')
      .setDescription(
        `${res.frames[2]}\n\n` +
          `🏆 Về nhất: ${res.winner.emoji} **${res.winner.name}**\n` +
          (res.won
            ? `🎉 **CHIẾN THẮNG! Bạn nhận lãi +${formatVnd(res.net)}!**`
            : `💸 **Thú của bạn chưa về nhất!** Kết quả: **${formatVnd(res.net)}**.`) +
          `\n💵 Số dư ví: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed] }).catch(() => {});
  },
};

// ============================================================================
// 6. /rps (Oẳn Tù Tì — Chơi với Bot hoặc Thách đấu Người chơi khác cược VNĐ)
// ============================================================================

const rpsCmd = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Chơi Oẳn Tù Tì (Kéo, Búa, Bao) với Bot hoặc thách đấu người chơi khác')
    .addIntegerOption((o) =>
      o.setName('tien_cuoc').setDescription('Số tiền cược VNĐ').setMinValue(1000).setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('chon')
        .setDescription('Nước đi của bạn (bắt buộc khi đấu với Bot)')
        .setRequired(false)
        .addChoices(
          { name: '✊ Búa', value: 'rock' },
          { name: '🖐️ Bao', value: 'paper' },
          { name: '✌️ Kéo', value: 'scissors' }
        )
    )
    .addUserOption((o) =>
      o.setName('doi_thu').setDescription('Chọn người chơi khác nếu muốn thách đấu PvP').setRequired(false)
    ),
  async execute(interaction, { gameSystem, economySystem }) {
    const bet = gameSystem.validateBetAmount(interaction.options.getInteger('tien_cuoc', true));
    const opponent = interaction.options.getUser('doi_thu');
    const choice = interaction.options.getString('chon');

    // Chế độ PvP giữa 2 người chơi
    if (opponent && opponent.id !== interaction.user.id) {
      if (opponent.bot) {
        await interaction.reply({
          content: '🤖 Để đấu với Bot, bạn chỉ cần bỏ trống ô `doi_thu` và chọn nước đi!',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const challengerBal = economySystem.getBalance(interaction.user.id, interaction.user.username);
      if (challengerBal.wallet < bet) {
        throw new Error(`Bạn cần có ít nhất **${formatVnd(bet)}** trong ví để gửi lời thách đấu.`);
      }

      const duelId = `${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;
      rpsDuels.set(duelId, {
        duelId,
        p1Id: interaction.user.id,
        p1Name: interaction.user.username,
        p1Choice: choice || null,
        p2Id: opponent.id,
        p2Name: opponent.username,
        p2Choice: null,
        bet,
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⚔️ Lời Thách Đấu Oẳn Tù Tì PvP!')
        .setDescription(
          `<@${interaction.user.id}> thách đấu <@${opponent.id}> một ván **Oẳn Tù Tì** mức cược **${formatVnd(bet)}**!\n\n` +
            `• <@${interaction.user.id}>: ${choice ? '✅ Đã chọn nước đi bí mật' : '⏳ Chưa chọn'}\n` +
            `• <@${opponent.id}>: ⏳ Đang chờ chọn nước đi...`
        )
        .setFooter({ text: 'Cả hai bấm chọn Kéo / Búa / Bao bên dưới để phân thắng bại!' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`game:rps_pvp:${duelId}:rock`).setLabel('Búa').setEmoji('✊').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`game:rps_pvp:${duelId}:paper`).setLabel('Bao').setEmoji('🖐️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`game:rps_pvp:${duelId}:scissors`).setLabel('Kéo').setEmoji('✌️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`game:rps_cancel:${duelId}`).setLabel('Hủy').setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        content: `<@${opponent.id}>`,
        embeds: [embed],
        components: [row],
        allowedMentions: { users: [opponent.id] },
      });
      return;
    }

    // Chế độ đấu với Bot (PvE)
    const finalChoice = choice ?? 'rock';
    const res = gameSystem.playRpsBot({
      userId: interaction.user.id,
      username: interaction.user.username,
      choice: finalChoice,
      bet,
    });

    const statusLine =
      res.outcome === 'win'
        ? `🎉 **BẠN THẮNG: +${formatVnd(res.net)}!**`
        : res.outcome === 'tie'
          ? '⚖️ **HÒA NHAU! Đã hoàn trả nguyên tiền cược.**'
          : `💸 **BẠN THUA: ${formatVnd(res.net)}!**`;

    const embed = new EmbedBuilder()
      .setColor(res.outcome === 'win' ? COLORS.SUCCESS : res.outcome === 'tie' ? COLORS.INFO : COLORS.DANGER)
      .setTitle('✂️ Oẳn Tù Tì vs Bot')
      .setDescription(
        `• Bạn ra: ${res.userMove.emoji} **${res.userMove.name}**\n` +
          `• Bot ra: ${res.botMove.emoji} **${res.botMove.name}**\n\n` +
          `${statusLine}\n💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// ============================================================================
// Bộ xử lý Nút bấm, Select Menu & Modal cho toàn bộ Trò Chơi
// ============================================================================

export async function handleGameInteraction(interaction, { gameSystem, economySystem }) {
  const id = interaction.customId || '';
  if (!id.startsWith('game:')) return false;

  const parts = id.split(':');
  const action = parts[1];

  // --- Bàn PvP Oẳn Tù Tì (cho phép cả p1 và p2 tương tác) ---
  if (action === 'rps_pvp' || action === 'rps_cancel') {
    const duelId = parts[2];
    const duel = rpsDuels.get(duelId);
    if (!duel) {
      await interaction.reply({ content: '⌛ Phiên thách đấu này đã hết hạn.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const uid = interaction.user.id;
    if (uid !== duel.p1Id && uid !== duel.p2Id) {
      await interaction.reply({ content: '⛔ Bạn không phải người tham gia trận thách đấu này!', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'rps_cancel') {
      rpsDuels.delete(duelId);
      await interaction.update({
        content: null,
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.MUTED)
            .setTitle('🏳️ Trận Thách Đấu Đã Hủy')
            .setDescription(`<@${uid}> đã hủy lời thách đấu Oẳn Tù Tì.`),
        ],
        components: [],
      });
      return true;
    }

    const move = parts[3];
    if (uid === duel.p1Id) duel.p1Choice = move;
    if (uid === duel.p2Id) duel.p2Choice = move;

    if (!duel.p1Choice || !duel.p2Choice) {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.WARNING)
            .setTitle('⚔️ Lời Thách Đấu Oẳn Tù Tì PvP!')
            .setDescription(
              `Mức cược: **${formatVnd(duel.bet)}**\n\n` +
                `• <@${duel.p1Id}>: ${duel.p1Choice ? '✅ Đã khóa lựa chọn' : '⏳ Đang suy nghĩ...'}\n` +
                `• <@${duel.p2Id}>: ${duel.p2Choice ? '✅ Đã khóa lựa chọn' : '⏳ Đang suy nghĩ...'}`
            ),
        ],
      });
      return true;
    }

    // Cả hai đã chọn -> Quyết toán ngay
    rpsDuels.delete(duelId);
    const settled = gameSystem.settleRpsPvp(duel);
    const resultDesc =
      settled.outcome === 'tie'
        ? `⚖️ **KẾT QUẢ HÒA!** Không ai bị trừ tiền.`
        : `🏆 Người chiến thắng: <@${settled.winnerId}> (**+${formatVnd(settled.bet)}**)!`;

    await interaction.update({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(settled.outcome === 'tie' ? COLORS.INFO : COLORS.SUCCESS)
          .setTitle('⚔️ Kết Quả Oẳn Tù Tì PvP')
          .setDescription(
            `• <@${duel.p1Id}> ra: ${settled.move1.emoji} **${settled.move1.name}**\n` +
              `• <@${duel.p2Id}> ra: ${settled.move2.emoji} **${settled.move2.name}**\n\n` +
              resultDesc
          )
          .setTimestamp(),
      ],
      components: [],
    });
    return true;
  }

  // --- Các tương tác cá nhân: Kiểm tra chính chủ chống giả mạo tương tác ---
  const ownerId = parts[2];
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '⛔ Đây là bàn chơi riêng của người khác! Hãy gõ lệnh của riêng bạn nhé.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Modal nhập tiền cược Bầu Cua / Tài Xỉu
  if (interaction.isModalSubmit?.()) {
    const rawVal = interaction.fields.getTextInputValue('bet_amount');
    const cleanAmt = gameSystem.validateBetAmount(Number.parseInt(rawVal.replace(/\D/g, ''), 10));
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);

    if (action === 'bc_modal_submit') {
      const session = getOrInitBauCuaSession(interaction.user.id);
      session.chip = cleanAmt;
      await interaction.update(buildBauCuaPanelPayload(interaction.user, session, bal.wallet));
      return true;
    }

    if (action === 'tx_modal_submit') {
      taixiuSessions.set(interaction.user.id, { bet: cleanAmt, updatedAt: Date.now() });
      const dash = gameSystem.getTaiXiuDashboard(interaction.user.id);
      await interaction.update(buildTaiXiuPanelPayload(interaction.user, cleanAmt, bal.wallet, dash));
      return true;
    }
  }

  // Xử lý Bầu Cua
  if (action === 'bc_open') {
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    const session = getOrInitBauCuaSession(interaction.user.id);
    await interaction.update(buildBauCuaPanelPayload(interaction.user, session, bal.wallet));
    return true;
  }

  if (action === 'bc_chip') {
    const chipVal = Number.parseInt(parts[3], 10);
    const session = getOrInitBauCuaSession(interaction.user.id);
    session.chip = chipVal;
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    await interaction.update(buildBauCuaPanelPayload(interaction.user, session, bal.wallet));
    return true;
  }

  if (action === 'bc_custom') {
    const modal = new ModalBuilder()
      .setCustomId(`game:bc_modal_submit:${interaction.user.id}`)
      .setTitle('Nhập Mức Phỉnh Bầu Cua')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bet_amount')
            .setLabel('Số tiền VNĐ mỗi lần chọn cửa')
            .setPlaceholder('Ví dụ: 25000')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'bc_select' && interaction.isStringSelectMenu()) {
    const session = getOrInitBauCuaSession(interaction.user.id);
    for (const mId of interaction.values) {
      session.bets[mId] = (session.bets[mId] || 0) + session.chip;
    }
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    await interaction.update(buildBauCuaPanelPayload(interaction.user, session, bal.wallet));
    return true;
  }

  if (action === 'bc_clear') {
    const session = getOrInitBauCuaSession(interaction.user.id);
    session.bets = {};
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    await interaction.update(buildBauCuaPanelPayload(interaction.user, session, bal.wallet));
    return true;
  }

  if (action === 'bc_roll') {
    const session = getOrInitBauCuaSession(interaction.user.id);
    const res = gameSystem.playBauCua({
      userId: interaction.user.id,
      username: interaction.user.username,
      bets: session.bets,
    });
    const diceStr = res.rolledMascots.map((m) => `${m.emoji} **${m.name}**`).join(' | ');
    const summary =
      `🎲 **Ván vừa mở:** ${diceStr}\n` +
      `${res.breakdown.join('\n')}\n` +
      (res.net >= 0
        ? `🎉 **Lãi ròng: +${formatVnd(res.net)}**`
        : `💸 **Kết quả: ${formatVnd(res.net)}**`);

    // Giữ mức phỉnh nhưng làm sạch cửa cho ván kế tiếp để tránh bấm đúp nhầm
    session.bets = {};
    await interaction.update(
      buildBauCuaPanelPayload(interaction.user, session, res.balanceAfter, summary)
    );
    return true;
  }

  // Xử lý Tài Xỉu
  if (action === 'tx_betmodal') {
    const modal = new ModalBuilder()
      .setCustomId(`game:tx_modal_submit:${interaction.user.id}`)
      .setTitle('Đổi Mức Cược Tài Xỉu')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bet_amount')
            .setLabel('Nhập số tiền cược VNĐ')
            .setPlaceholder('Ví dụ: 50000')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'tx_play') {
    const choice = parts[3];
    const txSession = taixiuSessions.get(interaction.user.id) ?? { bet: 10_000 };
    const rollRes = gameSystem.playTaiXiu({
      userId: interaction.user.id,
      username: interaction.user.username,
      choice,
      bet: txSession.bet,
    });
    const dash = gameSystem.getTaiXiuDashboard(interaction.user.id);
    await interaction.update(
      buildTaiXiuPanelPayload(interaction.user, txSession.bet, rollRes.balanceAfter, dash, rollRes)
    );
    return true;
  }

  if (action === 'tx_stats') {
    const txSession = taixiuSessions.get(interaction.user.id) ?? { bet: 10_000 };
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    const dash = gameSystem.getTaiXiuDashboard(interaction.user.id);
    await interaction.update(
      buildTaiXiuPanelPayload(interaction.user, txSession.bet, bal.wallet, dash)
    );
    return true;
  }

  // Xử lý Coinflip chơi lại
  if (action === 'cf_again') {
    const side = parts[3];
    const bet = Number.parseInt(parts[4], 10);
    const res = gameSystem.playCoinflip({
      userId: interaction.user.id,
      username: interaction.user.username,
      side,
      bet,
    });
    const embed = new EmbedBuilder()
      .setColor(res.won ? COLORS.SUCCESS : COLORS.DANGER)
      .setTitle('🪙 Tung Đồng Xu May Mắn')
      .setDescription(
        `• Bạn chọn: **${side === 'sap' ? 'Mặt Sấp' : 'Mặt Ngửa'}**\n` +
          `• Kết quả đồng xu: **${res.resultSide === 'sap' ? '🪙 Mặt Sấp' : '🌟 Mặt Ngửa'}**\n\n` +
          (res.won
            ? `🎉 **CHÚC MỪNG! Bạn thắng +${formatVnd(res.net)}!**`
            : `💸 **Rất tiếc! Bạn mất ${formatVnd(Math.abs(res.net))}.**`) +
          `\n💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    await interaction.update({ embeds: [embed] });
    return true;
  }

  return false;
}

export const GAME_COMMANDS = [
  baucuaCmd,
  taixiuCmd,
  coinflipCmd,
  guessCmd,
  raceCmd,
  rpsCmd,
];
