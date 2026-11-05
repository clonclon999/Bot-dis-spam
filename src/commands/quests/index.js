import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from 'discord.js';
import {
  buildCv2NoticePayload,
  buildCv2Payload,
  createContainer,
  mediaGallery,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import {
  safeReplyV2,
  safeUpdateV2,
  verifyPanelOwner,
} from '../../ui/interactionHelpers.js';
import { renderNeonBar, THEME } from '../../ui/theme.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { formatVnd } from '../../utils/format.js';

function buildQuestV2Payload(user, scope, quests, flashBanner = null) {
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
          const bar = renderNeonBar(q.progress, q.target, 8);
          return (
            `${statusIcon} **${q.name}** (\`${q.id}\`) — \`${bar}\` (**${q.progress}/${q.target}**)\n` +
            `┗ ${q.description} • Thưởng: **${formatVnd(q.rewardVnd)}** + **${q.rewardExp} EXP**`
          );
        })
      : ['*Hiện không có nhiệm vụ nào trong mục này.*'];

  const anyClaimable = quests.some((q) => q.claimable);
  const qBanner = buildAssetAttachment(ASSET_PATHS.QUEST_BANNER, 'quest_banner.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`quest:tab:${user.id}:daily`)
      .setLabel('Hằng Ngày')
      .setEmoji('☀️')
      .setStyle(scope === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quest:tab:${user.id}:weekly`)
      .setLabel('Hằng Tuần')
      .setEmoji('📅')
      .setStyle(scope === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quest:tab:${user.id}:special`)
      .setLabel('Đặc Biệt')
      .setEmoji('🌟')
      .setStyle(scope === 'special' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quest:claim_all:${user.id}:${scope}`)
      .setLabel('Nhận Thưởng Ngay')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!anyClaimable),
    new ButtonBuilder()
      .setCustomId(`gc:home:${user.id}`)
      .setLabel('Game Center')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary)
  );

  const card = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: qBanner.url, description: titles[scope] ?? titles.all }]),
      textDisplay(
        `## ${titles[scope] ?? titles.all}\n` +
          (flashBanner ? `🎉 **Đã Nhận Thưởng Tức Thì!** ${flashBanner}\n\n` : '') +
          lines.join('\n\n')
      ),
      separator(),
      row,
    ],
  });

  return buildCv2Payload({ containers: [card], files: [qBanner.attachment] });
}

export const questCommand = {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Xem tiến độ và nhận thưởng hệ thống Nhiệm vụ Hằng ngày, Tuần & Đặc biệt (Components V2)')
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

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🎁 Nhận Thưởng Nhiệm Vụ Thành Công!',
          body:
            `${claimedList}\n\n` +
            `💰 Tổng VNĐ nhận: **+${formatVnd(res.totalVnd)}**\n` +
            `✨ EXP nhận: **+${res.expResult?.addedExp ?? 0} EXP**\n` +
            `💵 Số dư ví mới: **${formatVnd(res.balanceAfter)}**`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
      return;
    }

    const scope = sub;
    const quests = questSystem.getUserQuests(
      interaction.user.id,
      interaction.user.username,
      scope
    );

    await safeReplyV2(interaction, buildQuestV2Payload(interaction.user, scope, quests));
  },
};

export async function handleQuestInteraction(interaction, { questSystem }) {
  const id = interaction.customId || '';
  if (!id.startsWith('quest:')) return false;

  const [, action, ownerId, scope] = id.split(':');
  if (!(await verifyPanelOwner(interaction, ownerId, '/quest daily'))) {
    return true;
  }

  if (action === 'tab') {
    const quests = questSystem.getUserQuests(
      interaction.user.id,
      interaction.user.username,
      scope
    );
    await safeUpdateV2(interaction, buildQuestV2Payload(interaction.user, scope, quests));
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
    const flash = `Nhận **+${formatVnd(res.totalVnd)}** & **+${res.expResult?.addedExp ?? 0} EXP** (${res.claimedQuests.length} nhiệm vụ). Ví: **${formatVnd(res.balanceAfter)}**`;
    await safeUpdateV2(
      interaction,
      buildQuestV2Payload(interaction.user, scope || 'daily', quests, flash)
    );
    return true;
  }

  return false;
}

export const QUEST_COMMANDS = [questCommand];
