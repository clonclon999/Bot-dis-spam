import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { SHOP_ITEMS } from '../../config/constants.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { COLORS } from '../../utils/embeds.js';
import { formatVnd } from '../../utils/format.js';

const ITEM_CHOICES = Object.values(SHOP_ITEMS).map((item) => ({
  name: `${item.emoji} ${item.name} (${formatVnd(item.price)})`,
  value: item.id,
}));

// 1. /shop
const shopCmd = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Mở Cửa Hàng Vật Phẩm, Thẻ Tăng Tốc, Thú Cưng, Khung Hồ Sơ & Hộp Quà Bí Ẩn'),
  async execute(interaction, { shopSystem, economySystem }) {
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    const items = shopSystem.listCatalog();
    const sBanner = buildAssetAttachment(ASSET_PATHS.SHOP_BANNER, 'shop_banner.png');

    const lines = items.map(
      (i) =>
        `${i.emoji} **${i.name}** (\`${i.id}\`) — Giá: **${formatVnd(i.price)}**\n  ↳ *${i.description}*`
    );

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🛒 Cửa Hàng Vật Phẩm Trung Tâm')
      .setDescription(
        `💵 Ví của bạn: **${formatVnd(bal.wallet)}** *(Mẹo: Mua thú cưng chọn loài tại \`/pet shop\`)*\n\n` +
          lines.join('\n\n')
      )
      .setImage(sBanner.url)
      .setFooter({ text: 'Chọn vật phẩm ở Menu bên dưới để mua nhanh 1 món hoặc dùng /buy' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`shop:quickbuy:${interaction.user.id}`)
        .setPlaceholder('🛍️ Chọn nhanh 1 vật phẩm để mua ngay...')
        .addOptions(
          items.map((i) => ({
            label: `${i.name} (${formatVnd(i.price)})`,
            value: i.id,
            emoji: i.emoji,
            description: i.description.slice(0, 95),
          }))
        )
    );

    await interaction.reply({ embeds: [embed], files: [sBanner.attachment], components: [row] });
  },
};

// 2. /buy
const buyCmd = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Mua vật phẩm từ Cửa Hàng')
    .addStringOption((o) =>
      o.setName('item').setDescription('Chọn vật phẩm muốn mua').setRequired(true).addChoices(...ITEM_CHOICES)
    )
    .addIntegerOption((o) =>
      o.setName('quantity').setDescription('Số lượng muốn mua (mặc định 1)').setMinValue(1).setMaxValue(99).setRequired(false)
    ),
  async execute(interaction, { shopSystem }) {
    const itemId = interaction.options.getString('item', true);
    const qty = interaction.options.getInteger('quantity') ?? 1;
    const res = shopSystem.buyItem(
      interaction.user.id,
      interaction.user.username,
      itemId,
      qty
    );

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('🛍️ Mua Vật Phẩm Thành Công')
      .setDescription(
        `Bạn đã mua **x${res.quantity} ${res.item.emoji} ${res.item.name}** với giá **${formatVnd(res.totalCost)}**.\n` +
          `💵 Ví còn lại: **${formatVnd(res.balanceAfter)}**\n` +
          `💡 Gõ \`/use item:${res.item.name}\` để sử dụng ngay!`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// 3. /inventory
const inventoryCmd = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Xem túi đồ vật phẩm đang sở hữu')
    .addUserOption((o) =>
      o.setName('user').setDescription('Xem túi đồ của người chơi khác').setRequired(false)
    ),
  async execute(interaction, { shopSystem }) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const bag = shopSystem.getInventory(target.id);

    const lines =
      bag.length > 0
        ? bag.map(
            ({ item, quantity }) =>
              `${item.emoji} **${item.name}** (\`${item.id}\`) — Số lượng: **x${quantity}** *(Giá bán lại: ${formatVnd(item.sellPrice)}/món)*`
          )
        : ['*Túi đồ hiện đang trống. Ghé thăm `/shop` để mua sắm nhé!*'];

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`🎒 Túi Đồ Vật Phẩm — ${target.username}`)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// 4. /use
const useCmd = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Sử dụng hoặc trang bị vật phẩm trong túi đồ')
    .addStringOption((o) =>
      o.setName('item').setDescription('Chọn vật phẩm muốn sử dụng').setRequired(true).addChoices(...ITEM_CHOICES)
    ),
  async execute(interaction, { shopSystem }) {
    const itemId = interaction.options.getString('item', true);
    const res = shopSystem.useItem(
      interaction.user.id,
      interaction.user.username,
      itemId
    );

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`${res.item.emoji} Đã Sử Dụng: ${res.item.name}`)
      .setDescription(res.effectMessage)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

// 5. /sell
const sellCmd = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Bán lại vật phẩm trong túi đồ để thu về VNĐ')
    .addStringOption((o) =>
      o.setName('item').setDescription('Chọn vật phẩm muốn bán').setRequired(true).addChoices(...ITEM_CHOICES)
    )
    .addIntegerOption((o) =>
      o.setName('quantity').setDescription('Số lượng muốn bán (mặc định 1)').setMinValue(1).setMaxValue(99).setRequired(false)
    ),
  async execute(interaction, { shopSystem }) {
    const itemId = interaction.options.getString('item', true);
    const qty = interaction.options.getInteger('quantity') ?? 1;
    const res = shopSystem.sellItem(
      interaction.user.id,
      interaction.user.username,
      itemId,
      qty
    );

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('💰 Bán Vật Phẩm Thành Công')
      .setDescription(
        `Đã bán **x${res.quantity} ${res.item.emoji} ${res.item.name}** thu về **+${formatVnd(res.totalProceeds)}**.\n` +
          `💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export async function handleShopInteraction(interaction, { shopSystem }) {
  const id = interaction.customId || '';
  if (!id.startsWith('shop:')) return false;

  const [, action, ownerId] = id.split(':');
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '⛔ Vui lòng gõ `/shop` của riêng bạn để mua sắm nhé!',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'quickbuy' && interaction.isStringSelectMenu()) {
    const itemId = interaction.values[0];
    const res = shopSystem.buyItem(
      interaction.user.id,
      interaction.user.username,
      itemId,
      1
    );
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle('🛍️ Mua Nhanh Thành Công!')
          .setDescription(
            `Đã mua **1x ${res.item.emoji} ${res.item.name}** (-${formatVnd(res.totalCost)}).\n` +
              `💵 Số dư còn lại: **${formatVnd(res.balanceAfter)}** • Gõ \`/use\` để dùng ngay!`
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

export const SHOP_COMMANDS = [shopCmd, buyCmd, inventoryCmd, useCmd, sellCmd];
