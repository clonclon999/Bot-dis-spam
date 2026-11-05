import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { SHOP_ITEMS } from '../../config/constants.js';
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
  verifyPanelOwner,
} from '../../ui/interactionHelpers.js';
import { THEME } from '../../ui/theme.js';
import { ASSET_PATHS, buildAssetAttachment } from '../../utils/assetRegistry.js';
import { formatVnd } from '../../utils/format.js';

const ITEM_CHOICES = Object.values(SHOP_ITEMS).map((item) => ({
  name: `${item.emoji} ${item.name} (${formatVnd(item.price)})`,
  value: item.id,
}));

// 1. /shop
const shopCmd = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Mở Cửa Hàng Vật Phẩm Cyber (Components V2 – Tăng Tốc, Trứng Thú Cưng, Khung & Hộp Quà)'),
  async execute(interaction, { shopSystem, economySystem }) {
    const bal = economySystem.getBalance(interaction.user.id, interaction.user.username);
    const items = shopSystem.listCatalog();
    const sBanner = buildAssetAttachment(ASSET_PATHS.SHOP_BANNER, 'shop_banner.png');

    const lines = items.map(
      (i) =>
        `${i.emoji} **${i.name}** (\`${i.id}\`) — Giá: **${formatVnd(i.price)}**\n┗ *${i.description}*`
    );

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`shop:quickbuy:${interaction.user.id}`)
        .setPlaceholder('🛍️ Chọn nhanh 1 vật phẩm để mua ngay...')
        .addOptions(
          items.map((i) => ({
            label: `${i.name} (${formatVnd(i.price)})`.slice(0, 95),
            value: i.id,
            emoji: i.emoji,
            description: i.description.slice(0, 95),
          }))
        )
    );

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gc:nav:${interaction.user.id}:shop_bag`)
        .setLabel('Mở Túi Đồ')
        .setEmoji('🎒')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`gc:home:${interaction.user.id}`)
        .setLabel('Game Center')
        .setEmoji('🏠')
        .setStyle(ButtonStyle.Secondary)
    );

    const card = createContainer({
      accentColor: THEME.NEON_PURPLE,
      children: [
        mediaGallery([{ url: sBanner.url, description: 'Cửa Hàng Vật Phẩm Trung Tâm' }]),
        textDisplay(
          `## 🛒 Cửa Hàng Vật Phẩm Trung Tâm\n` +
            `💵 **Ví của bạn:** **${formatVnd(bal.wallet)}** *(Mua thú cưng chọn loài tại \`/pet shop\`)*\n\n` +
            lines.join('\n\n')
        ),
        separator(),
        selectRow,
        navRow,
      ],
    });

    await safeReplyV2(interaction, buildCv2Payload({ containers: [card], files: [sBanner.attachment] }));
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🛍️ Mua Vật Phẩm Thành Công',
        body:
          `Bạn đã mua **x${res.quantity} ${res.item.emoji} ${res.item.name}** với giá **${formatVnd(res.totalCost)}**.\n` +
          `💵 Ví còn lại: **${formatVnd(res.balanceAfter)}**\n` +
          `💡 Gõ \`/use item:${res.item.name}\` để sử dụng ngay!`,
        accentColor: THEME.CYBER_EMERALD,
      })
    );
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
              `${item.emoji} **${item.name}** (\`${item.id}\`) — Số lượng: **x${quantity}** *(Bán lại: ${formatVnd(item.sellPrice)}/món)*`
          )
        : ['*Túi đồ hiện đang trống. Ghé thăm `/shop` để mua sắm nhé!*'];

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `🎒 Túi Đồ Vật Phẩm — ${target.username}`,
        body: lines.join('\n'),
        accentColor: THEME.NEON_CYAN,
      })
    );
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `${res.item.emoji} Đã Sử Dụng: ${res.item.name}`,
        body: res.effectMessage,
        accentColor: THEME.CYBER_EMERALD,
      })
    );
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

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '💰 Bán Vật Phẩm Thành Công',
        body:
          `Đã bán **x${res.quantity} ${res.item.emoji} ${res.item.name}** thu về **+${formatVnd(res.totalProceeds)}**.\n` +
          `💵 Ví hiện tại: **${formatVnd(res.balanceAfter)}**`,
        accentColor: THEME.NEON_CYAN,
      })
    );
  },
};

export async function handleShopInteraction(interaction, { shopSystem }) {
  const id = interaction.customId || '';
  if (!id.startsWith('shop:')) return false;

  const [, action, ownerId] = id.split(':');
  if (!(await verifyPanelOwner(interaction, ownerId, '/shop'))) {
    return true;
  }

  if (action === 'quickbuy' && interaction.isStringSelectMenu?.()) {
    const itemId = interaction.values[0];
    const res = shopSystem.buyItem(
      interaction.user.id,
      interaction.user.username,
      itemId,
      1
    );
    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: '🛍️ Mua Nhanh Thành Công!',
        body:
          `Đã mua **1x ${res.item.emoji} ${res.item.name}** (-${formatVnd(res.totalCost)}).\n` +
          `💵 Số dư còn lại: **${formatVnd(res.balanceAfter)}** • Gõ \`/use\` để dùng ngay!`,
        accentColor: THEME.CYBER_EMERALD,
        ephemeral: true,
      })
    );
    return true;
  }

  return false;
}

export const SHOP_COMMANDS = [shopCmd, buyCmd, inventoryCmd, useCmd, sellCmd];
