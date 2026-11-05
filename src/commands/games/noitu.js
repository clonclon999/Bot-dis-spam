import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { BOT_ROLES, GAME_IDS } from '../../config/constants.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';
import { canManageAntiSpam, hasBotRole } from '../../utils/permissions.js';

export function buildNoituBoardPayload(session) {
  const isBotMode = session.mode === 'bot';
  const modeLabel = isBotMode
    ? '🤖 Đấu với Bot (Chơi 1 mình hoặc nhiều người cùng đấu Bot)'
    : '👥 Cộng đồng PvP (Luân phiên nhiều người nối tiếp nhau)';

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🔤 SÒNG NỐI TỪ TIẾNG VIỆT ĐỜI THƯỜNG')
    .setDescription(
      `📌 **Chế độ:** ${modeLabel}\n` +
        `✨ **Luật chơi:** Dùng từ ghép **2 tiếng Tiếng Việt thông dụng** (không dùng từ Hán-Việt khó). Gõ dấu \`.\` ở đầu câu nếu muốn chat ngoài lề.\n\n` +
        `🎯 **Từ hiện tại:** \` ${session.currentWord.toUpperCase()} \`\n` +
        `👉 **Hãy gõ từ bắt đầu bằng chữ:** **\`${session.nextSyllable}\`** *(ví dụ: \`${session.nextSyllable} ...\`)*`
    )
    .addFields(
      { name: '🔗 Độ dài chuỗi', value: `**${session.chainLength} từ**`, inline: true },
      {
        name: isBotMode ? '🏆 Thưởng thắng Bot' : '💰 Hũ thưởng chuỗi',
        value: isBotMode ? '**+15.000 VNĐ**' : `**${formatVnd(session.potVnd)}**`,
        inline: true,
      }
    )
    .setFooter({ text: 'Gõ trực tiếp từ nối vào kênh này • Bảng cũ tự động xóa cho gọn đoạn chat!' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('noitu:skip')
      .setLabel('Đổi Từ Mới')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('noitu:hint')
      .setLabel('Gợi Ý (-1.000 VNĐ)')
      .setEmoji('💡')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('noitu:toggle_mode')
      .setLabel(isBotMode ? 'Chuyển sang Cộng đồng' : 'Chuyển sang Đấu Bot')
      .setEmoji(isBotMode ? '👥' : '🤖')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

export const noituCommand = {
  data: new SlashCommandBuilder()
    .setName('noitu')
    .setDescription('Trò chơi Nối Từ Tiếng Việt đời thường (dễ chơi, không dùng từ Hán-Việt khó)')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Bắt đầu ván Nối Từ Tiếng Việt mới trong kênh chỉ định')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Chọn chế độ chơi')
            .setRequired(false)
            .addChoices(
              { name: '🤖 Đấu với Bot (Chơi 1 mình cực vui)', value: 'bot' },
              { name: '👥 Cộng đồng PvP (Nhiều người nối luân phiên)', value: 'pvp' }
            )
        )
    )
    .addSubcommand((s) =>
      s.setName('skip').setDescription('Đổi sang từ mở màn mới nếu cả phòng đang bí từ')
    )
    .addSubcommand((s) =>
      s.setName('hint').setDescription('Mua 1 gợi ý từ nối hợp lệ (phí 1.000 VNĐ, chỉ mình bạn thấy)')
    )
    .addSubcommand((s) =>
      s.setName('top').setDescription('Xem Bảng xếp hạng Vua Nối Từ Tiếng Việt')
    )
    .addSubcommand((s) =>
      s.setName('stop').setDescription('Tạm dừng ván Nối Từ hiện tại trong kênh')
    )
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('[Admin/Owner] Chỉ định kênh chat riêng cho trò Nối Từ')
        .addChannelOption((o) =>
          o
            .setName('target')
            .setDescription('Kênh văn bản dành riêng cho Nối Từ')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('addword')
        .setDescription('[Admin/Owner] Bổ sung thêm một từ ghép Tiếng Việt đời thường vào từ điển')
        .addStringOption((o) =>
          o.setName('word').setDescription('Từ ghép 2 tiếng (ví dụ: bánh tráng)').setRequired(true)
        )
    ),

  async execute(interaction, { db, wordChainSystem }) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    // 1. Cài đặt kênh Nối Từ (cho phép Admin Server hoặc Admin/Owner Bot gọi ở bất kỳ kênh nào)
    if (sub === 'channel') {
      const isStaff =
        hasBotRole(db, uid, BOT_ROLES.ADMIN) ||
        canManageAntiSpam(interaction.member, false);
      if (!isStaff) {
        await interaction.reply({
          content: '⛔ Chỉ **OWNER / ADMIN** mới có quyền chỉ định kênh chơi Nối Từ.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const targetChan = interaction.options.getChannel('target', true);
      db.setGameChannel(interaction.guildId, GAME_IDS.NOITU, targetChan.id, uid);
      db.recordAudit({
        actorId: uid,
        actorRole: 'ADMIN',
        action: 'set_game_channel',
        details: `noitu=${targetChan.id}`,
      });
      await interaction.reply({
        content: `✅ Đã chỉ định kênh <#${targetChan.id}> làm phòng chơi **🔤 Nối Từ Tiếng Việt**! Hãy qua <#${targetChan.id}> và gõ \`/noitu start\` để mở sòng nhé.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Thêm từ mới vào từ điển
    if (sub === 'addword') {
      if (!hasBotRole(db, uid, BOT_ROLES.ADMIN) && !canManageAntiSpam(interaction.member, false)) {
        await interaction.reply({
          content: '⛔ Chỉ **OWNER / ADMIN** mới có quyền thêm từ mới vào từ điển.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const raw = interaction.options.getString('word', true);
      const added = wordChainSystem.addCustomWord(raw, uid);
      await interaction.reply({
        content: `✅ Đã thêm từ Tiếng Việt **"${added}"** vào từ điển Nối Từ!`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'start') {
      const mode = interaction.options.getString('mode') ?? 'bot';
      const session = wordChainSystem.startSession({
        guildId: interaction.guildId ?? 'dm',
        channelId: interaction.channelId,
        mode,
        startedBy: uid,
      });
      await interaction.reply(buildNoituBoardPayload(session));
      return;
    }

    if (sub === 'skip') {
      const session = wordChainSystem.skipWord(interaction.channelId);
      await interaction.reply(buildNoituBoardPayload(session));
      return;
    }

    if (sub === 'hint') {
      const res = wordChainSystem.buyHint(
        interaction.channelId,
        uid,
        interaction.user.username
      );
      await interaction.reply({
        content: `💡 **Gợi ý mật cho bạn (-${formatVnd(res.fee)}):** Bạn có thể gõ từ **\`${res.hintWord}\`**!`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'stop') {
      const old = wordChainSystem.stopSession(interaction.channelId);
      if (!old) {
        await interaction.reply({
          content: 'ℹ️ Hiện không có ván Nối Từ nào đang chạy trong kênh này.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.WARNING)
            .setTitle('🏁 Đã Dừng Ván Nối Từ Tiếng Việt')
            .setDescription(`Chuỗi vừa dừng ở độ dài **${old.chainLength} từ**. Gõ \`/noitu start\` bất cứ lúc nào để chơi tiếp!`),
        ],
      });
      return;
    }

    // top
    const rows = wordChainSystem.getLeaderboard(10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines =
      rows.length > 0
        ? rows.map(
            (r, i) =>
              `${medals[i] ?? `\`#${i + 1}\``} <@${r.user_id}> — **${r.correct_turns} từ đúng** • Thắng ${r.rounds_won} ván • Chuỗi đỉnh: ${r.best_chain}`
          )
        : ['*Chưa có ai ghi điểm Nối Từ. Hãy gõ `/noitu start` để mở màn!*'];

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.PRIMARY)
          .setTitle('🏆 Bảng Xếp Hạng Vua Nối Từ Tiếng Việt')
          .setDescription(lines.join('\n'))
          .setTimestamp(),
      ],
    });
  },
};

export async function handleNoituInteraction(interaction, { wordChainSystem }) {
  const id = interaction.customId || '';
  if (!id.startsWith('noitu:')) return false;

  const action = id.split(':')[1];

  if (action === 'skip') {
    const session = wordChainSystem.skipWord(interaction.channelId);
    await interaction.update(buildNoituBoardPayload(session));
    return true;
  }

  if (action === 'toggle_mode') {
    const cur = wordChainSystem.getSession(interaction.channelId);
    const nextMode = cur?.mode === 'bot' ? 'pvp' : 'bot';
    const session = wordChainSystem.startSession({
      guildId: interaction.guildId ?? 'dm',
      channelId: interaction.channelId,
      mode: nextMode,
      startedBy: interaction.user.id,
    });
    await interaction.update(buildNoituBoardPayload(session));
    return true;
  }

  if (action === 'hint') {
    const res = wordChainSystem.buyHint(
      interaction.channelId,
      interaction.user.id,
      interaction.user.username
    );
    await interaction.reply({
      content: `💡 **Gợi ý mật (-${formatVnd(res.fee)}):** Hãy thử từ **\`${res.hintWord}\`** nhé!`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}
