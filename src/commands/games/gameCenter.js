import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  GAME_CATALOG,
  GAME_IDS,
  OFFICIAL_GAME_ORDER,
} from '../../config/constants.js';
import {
  ASSET_PATHS,
  buildAssetAttachment,
  getGameBannerRelPath,
} from '../../utils/assetRegistry.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';

function getLivePlayersForGame(gameId, systems) {
  if (gameId === GAME_IDS.NOITU) {
    return systems.wordChainSystem?.getActivePlayerCount?.() ?? 0;
  }
  return systems.gameSystem?.getActivePlayerCount?.(gameId) ?? 0;
}

function getGameStatusLine(gameId, guildId, systems) {
  const gamesEnabled = systems.db.getSetting('gamesEnabled') || {};
  const enabled = gamesEnabled[gameId] !== false;
  const allowedChannels = guildId
    ? systems.db.getAllowedGameChannels(guildId, gameId)
    : [];
  const channelBadge =
    allowedChannels.length > 0
      ? allowedChannels.map((id) => `<#${id}>`).join(', ')
      : '*(Chưa gán kênh)*';
  const activeCount = getLivePlayersForGame(gameId, systems);

  return {
    enabled,
    allowedChannels,
    statusText: enabled ? '🟢 Đang hoạt động' : '🔴 Tạm bảo trì',
    channelBadge,
    activeCount,
  };
}

/**
 * Dựng giao diện Tổng Quan Game Center (/games) kèm Banner đồ họa cục bộ.
 */
export function buildGameCenterHomePayload(user, guildId, systems) {
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const banner = buildAssetAttachment(ASSET_PATHS.GAME_CENTER_BANNER, 'game_center.png');

  const lines = OFFICIAL_GAME_ORDER.map((gameId, idx) => {
    const meta = GAME_CATALOG[gameId];
    const st = getGameStatusLine(gameId, guildId, systems);
    return [
      `**${idx + 1}. ${meta.emoji} ${meta.name}** — ${st.statusText} • 👥 \`${st.activeCount} đang chơi\``,
      `┗ ${meta.shortDesc} *(Kênh: ${st.channelBadge})*`,
    ].join('\n');
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🎮 TRUNG TÂM TRÒ CHƠI TRỰC QUAN – DISCORD GAME BOT PRO')
    .setDescription(
      `Chào mừng <@${user.id}>! 💰 Số dư ví hiện tại: **${formatVnd(wallet)}**\n` +
      `Chọn 1 trong **7 trò chơi chính thức** bên dưới để xem hình ảnh bàn chơi, đọc luật hoặc tham gia ngay:\n\n` +
      lines.join('\n\n')
    )
    .setImage(banner.url)
    .setFooter({
      text: '100% Ngẫu nhiên công bằng (crypto.randomInt) • Tiền ảo VNĐ giải trí nội bộ',
    })
    .setTimestamp();

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`gc:select:${user.id}`)
      .setPlaceholder('🎯 Chọn nhanh trò chơi từ danh sách 7 game...')
      .addOptions(
        OFFICIAL_GAME_ORDER.map((gameId, idx) => {
          const meta = GAME_CATALOG[gameId];
          const st = getGameStatusLine(gameId, guildId, systems);
          return {
            label: `${idx + 1}. ${meta.name}`,
            value: gameId,
            emoji: meta.emoji,
            description: `${st.enabled ? 'Đang mở' : 'Bảo trì'} • ${st.activeCount} người đang chơi`.slice(0, 95),
          };
        })
      )
  );

  const btnRow1 = new ActionRowBuilder().addComponents(
    ...OFFICIAL_GAME_ORDER.slice(0, 4).map((gameId) => {
      const meta = GAME_CATALOG[gameId];
      return new ButtonBuilder()
        .setCustomId(`gc:view:${user.id}:${gameId}`)
        .setLabel(`${meta.emoji} ${meta.name.split(' (')[0]}`)
        .setStyle(ButtonStyle.Primary);
    })
  );

  const btnRow2 = new ActionRowBuilder().addComponents(
    ...OFFICIAL_GAME_ORDER.slice(4, 7).map((gameId) => {
      const meta = GAME_CATALOG[gameId];
      return new ButtonBuilder()
        .setCustomId(`gc:view:${user.id}:${gameId}`)
        .setLabel(`${meta.emoji} ${meta.name.split(' (')[0]}`)
        .setStyle(ButtonStyle.Primary);
    }),
    new ButtonBuilder()
      .setCustomId(`gc:refresh:${user.id}`)
      .setLabel('🔄 Làm mới')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    files: [banner.attachment],
    components: [selectRow, btnRow1, btnRow2],
  };
}

/**
 * Dựng thẻ chi tiết 1 trò chơi trong Game Center (hình ảnh riêng + nút Tham gia + nút Xem luật).
 */
export function buildGameDetailPayload(user, guildId, gameId, systems, showRulesExpanded = false) {
  const meta = GAME_CATALOG[gameId] || GAME_CATALOG.baucua;
  const st = getGameStatusLine(meta.id, guildId, systems);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const art = buildAssetAttachment(getGameBannerRelPath(meta.id), `${meta.id}_showcase.png`);

  const embed = new EmbedBuilder()
    .setColor(st.enabled ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`${meta.emoji} ${meta.name.toUpperCase()} — GAME CENTER`)
    .setDescription(
      `${meta.shortDesc}\n\n` +
      `• **Trạng thái:** ${st.statusText}\n` +
      `• **Người đang chơi:** 👥 \`${st.activeCount} người\`\n` +
      `• **Kênh bàn chơi:** ${st.channelBadge}\n` +
      `• **Ví của bạn:** 💰 **${formatVnd(wallet)}**\n` +
      `• **Lệnh tắt:** \`${meta.command}\`` +
      (showRulesExpanded ? `\n\n📖 **LUẬT CHƠI & THANH TOÁN CHI TIẾT:**\n${meta.rules}` : '')
    )
    .setImage(art.url)
    .setFooter({ text: 'Bấm "Tham Gia Ngay" để mở bàn chơi trực quan hoặc "Xem Luật" để đọc quy tắc' })
    .setTimestamp();

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`gc:select:${user.id}`)
      .setPlaceholder('🎯 Chuyển sang trò chơi khác...')
      .addOptions(
        OFFICIAL_GAME_ORDER.map((id, idx) => {
          const m = GAME_CATALOG[id];
          return {
            label: `${idx + 1}. ${m.name}`,
            value: id,
            emoji: m.emoji,
            default: id === meta.id,
          };
        })
      )
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:join:${user.id}:${meta.id}`)
      .setLabel('▶️ Tham Gia Ngay')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!st.enabled),
    new ButtonBuilder()
      .setCustomId(`gc:rules:${user.id}:${meta.id}`)
      .setLabel('📖 Xem Luật')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gc:home:${user.id}`)
      .setLabel('⬅️ Tổng Quan Game Center')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    files: [art.attachment],
    components: [selectRow, actionRow],
  };
}

function getSys(ctx) {
  return ctx?.systems || ctx;
}

export const gamesCommand = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('Mở Trung Tâm Trò Chơi Tương Tác Trực Quan (7 trò chơi chính thức)')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    const payload = buildGameCenterHomePayload(
      interaction.user,
      interaction.guildId,
      systems
    );
    if (typeof ctx?.sendPanel === 'function') {
      await ctx.sendPanel(interaction, payload);
    } else {
      await interaction.reply(payload);
    }
  },
};

/**
 * Xử lý toàn bộ tương tác `gc:*` của Game Center.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 * @param {(gameId: string, user: object, guildId: string, channelId: string, systems: object) => object} openVisualGameLauncher
 */
export async function handleGameCenterInteraction(interaction, ctx, openVisualGameLauncher) {
  if (!interaction.customId?.startsWith('gc:')) return false;

  const systems = getSys(ctx);
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ Bảng Game Center này thuộc về người chơi khác! Hãy gõ `/games` để mở bảng riêng của bạn.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'home' || action === 'refresh') {
    await interaction.update(
      buildGameCenterHomePayload(interaction.user, interaction.guildId, systems)
    );
    return true;
  }

  if (action === 'select') {
    const chosenId = interaction.values?.[0];
    if (!GAME_CATALOG[chosenId]) return true;
    await interaction.update(
      buildGameDetailPayload(interaction.user, interaction.guildId, chosenId, systems, false)
    );
    return true;
  }

  if (action === 'view') {
    const gameId = parts[3];
    await interaction.update(
      buildGameDetailPayload(interaction.user, interaction.guildId, gameId, systems, false)
    );
    return true;
  }

  if (action === 'rules') {
    const gameId = parts[3];
    await interaction.update(
      buildGameDetailPayload(interaction.user, interaction.guildId, gameId, systems, true)
    );
    return true;
  }

  if (action === 'join') {
    const gameId = parts[3];
    const meta = GAME_CATALOG[gameId];
    if (!meta) return true;

    // Tôn trọng nghiêm ngặt cấu hình kênh riêng của từng trò chơi để không làm loãng kênh chung
    if (interaction.guildId) {
      const allowed = systems.db.getAllowedGameChannels(interaction.guildId, gameId);
      if (allowed.length === 0) {
        await interaction.reply({
          content:
            `⚠️ Trò chơi **${meta.emoji} ${meta.name}** chưa được Quản trị viên gán kênh hoạt động!\n` +
            `👉 Nhờ Admin dùng lệnh \`/admin game setchannel\` để mở kênh bàn chơi nhé.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      if (!allowed.includes(String(interaction.channelId))) {
        const mentions = allowed.map((id) => `<#${id}>`).join(', ');
        await interaction.reply({
          content:
            `🎯 Để giữ trật tự phòng chat, bàn chơi **${meta.emoji} ${meta.name}** chỉ mở tại kênh riêng: ${mentions}!\n` +
            `👉 Bấm sang ${mentions} và gõ \`${meta.command}\` hoặc \`/games\` để vào bàn ngay nhé!`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
    }

    const launchPayload = openVisualGameLauncher(
      gameId,
      interaction.user,
      interaction.guildId,
      interaction.channelId,
      systems
    );
    await interaction.update(launchPayload);
    return true;
  }

  return false;
}
