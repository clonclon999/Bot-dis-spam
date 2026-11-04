import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd, renderProgressBar } from '../../utils/format.js';

function buildQuestEmbed(user, scope, quests) {
  const titles = {
    all: '📜 Tổng Quan Nhiệm Vụ Của Bạn',
    daily: '☀️ Nhiệm Vụ Hằng Ngày (Làm mới 00:00 UTC+7)',
    weekly: '📅 Nhiệm Vụ Hằng Tuần (Làm mới Thứ Hai)',
    special: '🌟 Nhiệm Vụ Đặc Biệt & Sự Kiện',
  };

  const lines =
    quests.length > 0
      ? quests.map((q) => {
          const statusIcon = q.claimed ? '✅' : q.claimable ? '🎁' : '⏳';
          const bar = renderProgressBar(q.progress, q.target, 8);
          return (
            `${statusIcon} **${q.name}** (\`${q.id}\`)\n` +
            `  ↳ ${q.description} • Thưởng: **${formatVnd(q.rewardVnd)}** + **${q.rewardExp} EXP**\n` +
            `  ↳ \`${bar}\` (**${q.progress}/${q.target}**)`
          );
        })
      : ['*Hiện không có nhiệm vụ nào trong mục này.*'];

  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(titles[scope] ?? titles.all)
    .setDescription(lines.join('\n\n').slice(0, 4000))
    .setFooter({ text: `Người chơi: ${user.username} • Nhấn nút Nhận Thưởng hoặc dùng /quest claim` })
    .setTimestamp();
}

function buildQuestComponents(userId, quests, activeScope) {
  const anyClaimable = quests.some((q) => q.claimable);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`quest:tab:${userId}:daily`)
      .setLabel('Hằng Ngày')
      .setEmoji('☀️')
      .setStyle(activeScope === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quest:tab:${userId}:weekly`)
      .setLabel('Hằng Tuần')
      .setEmoji('📅')
      .setStyle(activeScope === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quest:tab:${userId}:special`)
      .setLabel('Đặc Biệt')
      .setEmoji('🌟')
      .setStyle(activeScope === 'special' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quest:claim_all:${userId}:${activeScope}`)
      .setLabel('Nhận Thưởng Ngay')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!anyClaimable)
  );
  return [row];
}

export const questCommand = {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Xem tiến độ và nhận thưởng hệ thống Nhiệm vụ Hằng ngày, Tuần & Đặc biệt')
    .addSubcommand((s) =>
      s.setName('daily').setDescription('Xem danh sách nhiệm vụ hằng ngày')
    )
    .addSubcommand((s) =>
      s.setName('weekly').setDescription('Xem danh sách nhiệm vụ hằng tuần')
    )
    .addSubcommand((s) =>
      s.setName('special').setDescription('Xem nhiệm vụ Tân Thủ, Cao Thủ & Sự kiện')
    )
    .addSubcommand((s) =>
      s
        .setName('claim')
        .setDescription('Nhận thưởng các nhiệm vụ đã hoàn thành')
        .addStringOption((o) =>
          o
            .setName('quest_id')
            .setDescription('Mã nhiệm vụ cụ thể (để trống để nhận tất cả nhiệm vụ đã xong)')
            .setRequired(false)
        )
    ),

  async execute(interaction, { questSystem }) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'claim') {
      const questId = interaction.options.getString('quest_id');
      const res = questSystem.claimRewards(
        interaction.user.id,
        interaction.user.username,
        questId
      );

      const claimedList = res.claimedQuests
        .map((q) => `• **${q.name}**: +**${formatVnd(q.finalVnd)}**`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('🎁 Nhận Thưởng Nhiệm Vụ Thành Công!')
        .setDescription(
          `${claimedList}\n\n` +
            `💰 Tổng VNĐ nhận: **+${formatVnd(res.totalVnd)}**\n` +
            `✨ EXP nhận: **+${res.expResult?.addedExp ?? 0} EXP**\n` +
            `💵 Số dư ví mới: **${formatVnd(res.balanceAfter)}**`
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    const scope = sub; // daily | weekly | special
    const quests = questSystem.getUserQuests(
      interaction.user.id,
      interaction.user.username,
      scope
    );

    await interaction.reply({
      embeds: [buildQuestEmbed(interaction.user, scope, quests)],
      components: buildQuestComponents(interaction.user.id, quests, scope),
    });
  },
};

export async function handleQuestInteraction(interaction, { questSystem }) {
  const id = interaction.customId || '';
  if (!id.startsWith('quest:')) return false;

  const [, action, ownerId, scope] = id.split(':');
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '⛔ Đây là bảng nhiệm vụ của người chơi khác! Hãy gõ `/quest daily` cho riêng bạn.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'tab') {
    const quests = questSystem.getUserQuests(
      interaction.user.id,
      interaction.user.username,
      scope
    );
    await interaction.update({
      embeds: [buildQuestEmbed(interaction.user, scope, quests)],
      components: buildQuestComponents(interaction.user.id, quests, scope),
    });
    return true;
  }

  if (action === 'claim_all') {
    const res = questSystem.claimRewards(
      interaction.user.id,
      interaction.user.username,
      null
    );
    const quests = questSystem.getUserQuests(
      interaction.user.id,
      interaction.user.username,
      scope || 'daily'
    );
    const embed = buildQuestEmbed(interaction.user, scope || 'daily', quests);
    embed.spliceFields(0, 0, {
      name: '🎉 Đã Nhận Thưởng Tức Thì!',
      value: `Nhận **+${formatVnd(res.totalVnd)}** & **+${res.expResult?.addedExp ?? 0} EXP** (${res.claimedQuests.length} nhiệm vụ). Ví: **${formatVnd(res.balanceAfter)}**`,
    });

    await interaction.update({
      embeds: [embed],
      components: buildQuestComponents(interaction.user.id, quests, scope || 'daily'),
    });
    return true;
  }

  return false;
}

export const QUEST_COMMANDS = [questCommand];
