import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  GAME_CATALOG,
  GAME_IDS,
  OFFICIAL_GAME_ORDER,
  SHOP_ITEMS,
  TITLES,
} from '../../config/constants.js';
import { expRequiredForLevel } from '../../systems/levelSystem.js';
import {
  buildCv2NoticePayload,
  buildCv2Payload,
  createContainer,
  mediaGallery,
  sectionWithButton,
  sectionWithThumbnail,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import {
  safeClosePanel,
  safeReplyV2,
  safeUpdateV2,
  verifyPanelOwner,
} from '../../ui/interactionHelpers.js';
import { buildProMaxNavRows, GC_TABS } from '../../ui/navigation.js';
import { renderNeonBar, resolveUserAvatarUrl, THEME } from '../../ui/theme.js';
import {
  ASSET_PATHS,
  buildAssetAttachment,
  getGameBannerRelPath,
} from '../../utils/assetRegistry.js';
import { formatNumber, formatRemainingMs, formatVnd } from '../../utils/format.js';
import { resolveBotRole } from '../../utils/permissions.js';

function getSys(ctx) {
  return ctx?.systems || ctx;
}

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
    statusText: enabled ? '🟢 Mở' : '🔴 Bảo trì',
    channelBadge,
    activeCount,
  };
}

function buildGameSelectRow(userId, guildId, systems, selectedGameId = null) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`gc:select:${userId}`)
      .setPlaceholder('🎯 Chọn nhanh 1 trong 7 trò chơi chính thức...')
      .addOptions(
        OFFICIAL_GAME_ORDER.map((gameId, idx) => {
          const meta = GAME_CATALOG[gameId];
          const st = getGameStatusLine(gameId, guildId, systems);
          return {
            label: `${idx + 1}. ${meta.name}`,
            value: gameId,
            emoji: meta.emoji,
            default: selectedGameId === gameId,
            description: `${st.enabled ? 'Đang hoạt động' : 'Bảo trì'} • ${st.activeCount} đang chơi`.slice(0, 95),
          };
        })
      )
  );
}

// ============================================================================
// 1. KHU VỰC TRANG CHỦ (HOME) — GAME CENTER PRO MAX
// ============================================================================

export function buildGameCenterHomePayload(user, guildId, systems, { ephemeral = false, flashNote = null } = {}) {
  systems.bankSystem?.settleInterest?.(user.id, user.username);
  const u = systems.economySystem.ensureUser(user.id, user.username);
  const reqExp = expRequiredForLevel(u.level);
  const role = resolveBotRole(systems.db, user.id);
  const titleName = TITLES[u.active_title]?.name ?? '🌱 Tân Thủ';

  const banner = buildAssetAttachment(ASSET_PATHS.GAME_CENTER_BANNER, 'game_center.png');
  const fallbackThumb = buildAssetAttachment(ASSET_PATHS.GAME_BAUCUA, 'gc_avatar_fallback.png');
  const avatarUrl = resolveUserAvatarUrl(user, fallbackThumb.url);
  const files = avatarUrl === fallbackThumb.url ? [banner.attachment, fallbackThumb.attachment] : [banner.attachment];

  const totalLive = OFFICIAL_GAME_ORDER.reduce((s, id) => s + getLivePlayersForGame(id, systems), 0);
  const compactRoster = OFFICIAL_GAME_ORDER.map((id, i) => {
    const m = GAME_CATALOG[id];
    const st = getGameStatusLine(id, guildId, systems);
    return `\`${i + 1}\` ${m.emoji} **${m.name.split(' (')[0]}** (${st.statusText} • 👥${st.activeCount})`;
  }).join('  •  ');

  const headerSection = sectionWithThumbnail({
    texts: [
      `## 🎮 GAME CENTER PRO MAX\n👤 <@${user.id}> • **${titleName}** \`[${role}]\``,
      `💰 **Ví VNĐ:** \`${formatVnd(u.wallet)}\` • 🏦 **Ngân hàng:** \`${formatVnd(u.bank + u.savings)}\`\n⭐ **Cấp ${u.level}** \`${renderNeonBar(u.exp, reqExp, 10)}\` (\`${u.exp}/${reqExp} EXP\`) • 🔥 Daily: \`${u.login_streak} ngày\``,
    ],
    url: avatarUrl,
    description: `Tài khoản ${user.username}`,
  });

  const privacySection = sectionWithButton({
    texts: [
      flashNote
        ? `✨ ${flashNote}`
        : `⚡ **Trực tuyến:** \`${totalLive} người chơi\` trên **7 trò chơi chính thức** *(100% crypto.randomInt)*`,
    ],
    button: new ButtonBuilder()
      .setCustomId(`gc:private:${user.id}:wallet`)
      .setLabel('Ví Riêng Tư')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary),
  });

  const heroContainer = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: banner.url, description: 'DISCORD GAME CENTER PRO MAX' }]),
      headerSection,
      separator(),
      privacySection,
    ],
  });

  const quickPlayRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:view:${user.id}:baucua`)
      .setLabel('Bầu Cua')
      .setEmoji('🦀')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`gc:view:${user.id}:taixiu`)
      .setLabel('Tài Xỉu')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`gc:view:${user.id}:noitu`)
      .setLabel('Nối Từ')
      .setEmoji('🔤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gc:act:${user.id}:daily`)
      .setLabel('Điểm danh')
      .setEmoji('📅')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:act:${user.id}:work`)
      .setLabel('Đi làm')
      .setEmoji('💼')
      .setStyle(ButtonStyle.Secondary)
  );

  const launcherContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      textDisplay(`### 🕹️ SẢNH 7 TRÒ CHƠI CHÍNH THỨC\n${compactRoster}`),
      buildGameSelectRow(user.id, guildId, systems),
      quickPlayRow,
      separator(),
      ...buildProMaxNavRows({ userId: user.id, activeTab: GC_TABS.HOME, backTarget: GC_TABS.HOME }),
    ],
  });

  return buildCv2Payload({
    containers: [heroContainer, launcherContainer],
    files,
    ephemeral,
  });
}

// ============================================================================
// 2. KHU VỰC DANH SÁCH TRÒ CHƠI (GAMES LIST) & CHI TIẾT TỪNG GAME (DETAIL)
// ============================================================================

export function buildGameListPayload(user, guildId, systems, { ephemeral = false } = {}) {
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;

  const files = [];
  const galleryItems = OFFICIAL_GAME_ORDER.map((gameId, idx) => {
    const meta = GAME_CATALOG[gameId];
    const att = buildAssetAttachment(getGameBannerRelPath(gameId), `gc_card_${gameId}.png`);
    files.push(att.attachment);
    return {
      url: att.url,
      description: `${idx + 1}. ${meta.name} — ${meta.shortDesc}`,
    };
  });

  const detailLines = OFFICIAL_GAME_ORDER.map((gameId, idx) => {
    const meta = GAME_CATALOG[gameId];
    const st = getGameStatusLine(gameId, guildId, systems);
    return (
      `**${idx + 1}. ${meta.emoji} ${meta.name}** — ${st.statusText} • 👥 \`${st.activeCount} chơi\`\n` +
      `┗ ${meta.shortDesc} • Kênh: ${st.channelBadge}`
    );
  }).join('\n');

  const topContainer = createContainer({
    accentColor: THEME.CYAN_BRIGHT,
    children: [
      textDisplay(`## 🎮 DANH SÁCH 7 TRÒ CHƠI CHÍNH THỨC\n💰 **Số dư ví của bạn:** \`${formatVnd(wallet)}\` • Chạm ảnh để phóng to hoặc chọn bên dưới để vào bàn!`),
      mediaGallery(galleryItems),
      separator(),
      textDisplay(detailLines),
    ],
  });

  const fastRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:join:${user.id}:baucua`)
      .setLabel('Vào Bầu Cua')
      .setEmoji('🦀')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`gc:join:${user.id}:taixiu`)
      .setLabel('Vào Tài Xỉu')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`gc:join:${user.id}:noitu`)
      .setLabel('Vào Nối Từ')
      .setEmoji('🔤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gc:join:${user.id}:race`)
      .setLabel('Vào Đua Thú')
      .setEmoji('🐎')
      .setStyle(ButtonStyle.Secondary)
  );

  const navContainer = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      buildGameSelectRow(user.id, guildId, systems),
      fastRow,
      separator(),
      ...buildProMaxNavRows({ userId: user.id, activeTab: GC_TABS.GAMES, backTarget: GC_TABS.HOME }),
    ],
  });

  return buildCv2Payload({ containers: [topContainer, navContainer], files, ephemeral });
}

export function buildGameDetailPayload(
  user,
  guildId,
  gameId,
  systems,
  showRulesExpanded = false,
  { ephemeral = false } = {}
) {
  const meta = GAME_CATALOG[gameId] || GAME_CATALOG.baucua;
  const st = getGameStatusLine(meta.id, guildId, systems);
  const wallet = systems.economySystem.ensureUser(user.id, user.username).wallet;
  const art = buildAssetAttachment(getGameBannerRelPath(meta.id), `${meta.id}_showcase.png`);

  const infoTexts = [
    `## ${meta.emoji} ${meta.name.toUpperCase()}\n${meta.shortDesc}`,
    `• **Trạng thái:** ${st.statusText} • 👥 \`${st.activeCount} người đang chơi\`\n` +
      `• **Kênh bàn chơi:** ${st.channelBadge}\n` +
      `• **Ví VNĐ hiện có:** \`${formatVnd(wallet)}\` • Lệnh tắt: \`${meta.command}\``,
  ];

  const cardChildren = [
    mediaGallery([{ url: art.url, description: meta.name }]),
    sectionWithButton({
      texts: infoTexts,
      button: new ButtonBuilder()
        .setCustomId(`gc:join:${user.id}:${meta.id}`)
        .setLabel('Tham Gia Ngay')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!st.enabled),
    }),
  ];

  if (showRulesExpanded) {
    cardChildren.push(separator());
    cardChildren.push(textDisplay(`### 📖 LUẬT CHƠI & CƠ CẤU TRẢ THƯỞNG\n${meta.rules}`));
  }

  const gameCard = createContainer({
    accentColor: st.enabled ? THEME.NEON_CYAN : THEME.CRIMSON_NEON,
    children: cardChildren,
  });

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:join_now:${user.id}:${meta.id}`)
      .setLabel('Mở Bàn Chơi')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!st.enabled),
    new ButtonBuilder()
      .setCustomId(`gc:rules:${user.id}:${meta.id}:${showRulesExpanded ? '0' : '1'}`)
      .setLabel(showRulesExpanded ? 'Thu Gọn Luật' : 'Xem Luật Chi Tiết')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gc:list_all:${user.id}`)
      .setLabel('Tất Cả 7 Game')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );

  const navCard = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      buildGameSelectRow(user.id, guildId, systems, meta.id),
      actionRow,
      separator(),
      ...buildProMaxNavRows({
        userId: user.id,
        activeTab: GC_TABS.DETAIL,
        backTarget: GC_TABS.GAMES,
        refreshTarget: `detail_${meta.id}`,
      }),
    ],
  });

  return buildCv2Payload({
    containers: [gameCard, navCard],
    files: [art.attachment],
    ephemeral,
  });
}

// ============================================================================
// 3. KHU VỰC VÍ TIỀN & NGÂN HÀNG VNĐ (WALLET)
// ============================================================================

export function buildGameCenterWalletPayload(user, systems, { ephemeral = false, flashNote = null } = {}) {
  const interest = systems.bankSystem.settleInterest(user.id, user.username);
  const bal = systems.economySystem.getBalance(user.id, user.username);
  const u = systems.economySystem.ensureUser(user.id, user.username);

  const banner = buildAssetAttachment(ASSET_PATHS.WALLET_BANNER, 'wallet_banner.png');
  const fallbackThumb = buildAssetAttachment(ASSET_PATHS.COIN_SAP, 'wallet_coin.png');
  const avatarUrl = resolveUserAvatarUrl(user, fallbackThumb.url);
  const files = avatarUrl === fallbackThumb.url ? [banner.attachment, fallbackThumb.attachment] : [banner.attachment];

  const txRows = systems.db.all(
    `SELECT type, amount, note, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 4`,
    [String(user.id)]
  );
  const txText =
    txRows.length > 0
      ? txRows
          .map((t) => `• \`${t.amount >= 0 ? '+' : ''}${formatVnd(t.amount)}\` — ${t.note || t.type}`)
          .join('\n')
      : '*(Chưa phát sinh giao dịch gần đây)*';

  const walletCard = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: banner.url, description: 'Ví Điện Tử & Ngân Hàng VNĐ' }]),
      sectionWithThumbnail({
        texts: [
          `## 💰 TÀI KHOẢN VNĐ — ${user.username}\n` +
            (flashNote ? `✅ **${flashNote}**\n` : '') +
            `💵 **Ví tiền mặt:** \`${formatVnd(bal.wallet)}\`\n` +
            `🏦 **Ngân hàng:** \`${formatVnd(bal.bank)}\` *(Lãi ${(interest.baseRate * 100).toFixed(1)}%/chu kỳ)*\n` +
            `💎 **Sổ tiết kiệm:** \`${formatVnd(bal.savings)}\` *(Lãi ${(interest.savingsRate * 100).toFixed(1)}%/chu kỳ)*`,
          `📊 **Tổng tài sản ròng:** **${formatVnd(bal.netWorth)}** • Chuỗi Daily: \`${u.login_streak} ngày\``,
        ],
        url: avatarUrl,
        description: `Ví của ${user.username}`,
      }),
      separator(),
      textDisplay(`### 🧾 SAO KÊ GIAO DỊCH GẦN NHẤT\n${txText}`),
    ],
  });

  const bankActionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:act:${user.id}:daily`)
      .setLabel('Nhận Daily')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`gc:act:${user.id}:work`)
      .setLabel('Đi Làm')
      .setEmoji('💼')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gc:act:${user.id}:dep_all`)
      .setLabel('Gửi Hết Bank')
      .setEmoji('🏦')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(bal.wallet < 1_000),
    new ButtonBuilder()
      .setCustomId(`gc:bank_modal:${user.id}:deposit`)
      .setLabel('Gửi Tiền')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:bank_modal:${user.id}:withdraw`)
      .setLabel('Rút Tiền')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(bal.bank <= 0)
  );

  const navCard = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      bankActionRow,
      separator(),
      ...buildProMaxNavRows({ userId: user.id, activeTab: GC_TABS.WALLET, backTarget: GC_TABS.HOME }),
    ],
  });

  return buildCv2Payload({ containers: [walletCard, navCard], files, ephemeral });
}

// ============================================================================
// 4. KHU VỰC NHIỆM VỤ (QUESTS)
// ============================================================================

export function buildGameCenterQuestsPayload(
  user,
  systems,
  scope = 'daily',
  { ephemeral = false, flashNote = null } = {}
) {
  const validScope = ['daily', 'weekly', 'special'].includes(scope) ? scope : 'daily';
  const quests = systems.questSystem.getUserQuests(user.id, user.username, validScope);
  const anyClaimable = quests.some((q) => q.claimable);
  const qBanner = buildAssetAttachment(ASSET_PATHS.QUEST_BANNER, 'quest_banner.png');

  const scopeLabels = {
    daily: '☀️ NHIỆM VỤ HẰNG NGÀY (9 CHỈ TIÊU)',
    weekly: '📅 NHIỆM VỤ HẰNG TUẦN (4 CHỈ TIÊU)',
    special: '🌟 NHIỆM VỤ ĐẶC BIỆT & TÂN THỦ',
  };

  const lines =
    quests.length > 0
      ? quests
          .map((q) => {
            const st = q.claimed ? '✅' : q.claimable ? '🎁' : '⏳';
            return (
              `${st} **${q.name}** — \`${renderNeonBar(q.progress, q.target, 8)}\` (**${q.progress}/${q.target}**)\n` +
              `┗ *${q.description}* • Thưởng: \`+${formatVnd(q.rewardVnd)}\` & \`+${q.rewardExp} EXP\``
            );
          })
          .join('\n')
      : '*(Chưa có nhiệm vụ trong mục này)*';

  const questCard = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: [
      mediaGallery([{ url: qBanner.url, description: 'Trung Tâm Nhiệm Vụ' }]),
      textDisplay(
        `## 📜 ${scopeLabels[validScope]}\n` +
          (flashNote ? `🎉 **${flashNote}**\n\n` : '') +
          lines
      ),
    ],
  });

  const tabRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:qtab:${user.id}:daily`)
      .setLabel('Hằng Ngày')
      .setEmoji('☀️')
      .setStyle(validScope === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:qtab:${user.id}:weekly`)
      .setLabel('Hằng Tuần')
      .setEmoji('📅')
      .setStyle(validScope === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:qtab:${user.id}:special`)
      .setLabel('Đặc Biệt')
      .setEmoji('🌟')
      .setStyle(validScope === 'special' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:qclaim:${user.id}:${validScope}`)
      .setLabel('Nhận Thưởng Ngay')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!anyClaimable)
  );

  const navCard = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      tabRow,
      separator(),
      ...buildProMaxNavRows({
        userId: user.id,
        activeTab: GC_TABS.QUESTS,
        backTarget: GC_TABS.HOME,
        refreshTarget: `quests_${validScope}`,
      }),
    ],
  });

  return buildCv2Payload({ containers: [questCard, navCard], files: [qBanner.attachment], ephemeral });
}

// ============================================================================
// 5. KHU VỰC CỬA HÀNG & TÚI ĐỒ (SHOP & INVENTORY)
// ============================================================================

export function buildGameCenterShopPayload(
  user,
  systems,
  mode = 'catalog',
  { ephemeral = false, flashNote = null } = {}
) {
  const bal = systems.economySystem.getBalance(user.id, user.username);
  const catalog = systems.shopSystem.listCatalog();
  const bag = systems.shopSystem.getInventory(user.id);
  const sBanner = buildAssetAttachment(ASSET_PATHS.SHOP_BANNER, 'shop_banner.png');

  const isBagMode = mode === 'bag';
  const bodyLines = isBagMode
    ? bag.length > 0
      ? bag
          .map(
            ({ item, quantity }) =>
              `${item.emoji} **${item.name}** — Đang có: **x${quantity}** *(Bán lại: \`${formatVnd(item.sellPrice)}\`)*\n┗ *${item.description}*`
          )
          .join('\n')
      : '*(Túi đồ hiện đang trống — hãy chuyển sang Kệ Hàng để mua vật phẩm nhé!)*'
    : catalog
        .map(
          (i) =>
            `${i.emoji} **${i.name}** — Giá: **${formatVnd(i.price)}**\n┗ *${i.description}*`
        )
        .join('\n');

  const shopCard = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      mediaGallery([{ url: sBanner.url, description: 'Cửa Hàng Vật Phẩm Cyber' }]),
      textDisplay(
        `## 🛒 ${isBagMode ? 'TÚI ĐỒ VẬT PHẨM ĐANG SỞ HỮU' : 'CỬA HÀNG VẬT PHẨM TRUNG TÂM'}\n` +
          `💰 **Số dư ví:** \`${formatVnd(bal.wallet)}\` • 🎒 **Số loại vật phẩm trong túi:** \`${bag.length}\`\n` +
          (flashNote ? `✨ **${flashNote}**\n\n` : '\n') +
          bodyLines
      ),
    ],
  });

  const controlChildren = [];
  if (!isBagMode) {
    controlChildren.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`gc:shop_buy:${user.id}`)
          .setPlaceholder('🛍️ Chọn 1 vật phẩm để Mua Nhanh (x1)...')
          .addOptions(
            catalog.map((i) => ({
              label: `${i.name} (${formatNumber(i.price)} VNĐ)`.slice(0, 95),
              value: i.id,
              emoji: i.emoji,
              description: i.description.slice(0, 95),
            }))
          )
      )
    );
  } else if (bag.length > 0) {
    controlChildren.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`gc:shop_use:${user.id}`)
          .setPlaceholder('⚡ Chọn vật phẩm trong túi để Sử Dụng Ngay...')
          .addOptions(
            bag.slice(0, 25).map(({ item, quantity }) => ({
              label: `Dùng: ${item.name} (Còn x${quantity})`.slice(0, 95),
              value: item.id,
              emoji: item.emoji,
              description: item.description.slice(0, 95),
            }))
          )
      )
    );
  }

  controlChildren.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gc:shop_mode:${user.id}:catalog`)
        .setLabel('Kệ Hàng Shop')
        .setEmoji('🛍️')
        .setStyle(!isBagMode ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gc:shop_mode:${user.id}:bag`)
        .setLabel(`Túi Đồ (${bag.reduce((s, x) => s + x.quantity, 0)})`)
        .setEmoji('🎒')
        .setStyle(isBagMode ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
    separator(),
    ...buildProMaxNavRows({
      userId: user.id,
      activeTab: GC_TABS.SHOP,
      backTarget: GC_TABS.HOME,
      refreshTarget: isBagMode ? 'shop_bag' : GC_TABS.SHOP,
    })
  );

  const navCard = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: controlChildren,
  });

  return buildCv2Payload({ containers: [shopCard, navCard], files: [sBanner.attachment], ephemeral });
}

// ============================================================================
// 6. KHU VỰC HỒ SƠ CÁ NHÂN (PROFILE)
// ============================================================================

export function buildGameCenterProfilePayload(user, systems, { ephemeral = false, flashNote = null } = {}) {
  systems.economySystem.ensureUser(user.id, user.username);
  systems.levelSystem.evaluateMilestoneTitles(user.id);
  const fresh = systems.db.get('SELECT * FROM users WHERE user_id = ?', [String(user.id)]);

  const role = resolveBotRole(systems.db, user.id);
  const activeTitle = TITLES[fresh.active_title]?.name ?? '🌱 Tân Thủ';
  const unlockedIds = JSON.parse(fresh.unlocked_titles || '["tan_thu"]');
  const reqExp = expRequiredForLevel(fresh.level);
  const winRate =
    fresh.games_played > 0
      ? ((fresh.games_won / fresh.games_played) * 100).toFixed(1)
      : '0.0';

  const petInfo = systems.petSystem.getActivePetBonuses(user.id);
  const petLine = petInfo.pet
    ? `${petInfo.species.emoji} **${petInfo.pet.nickname}** (Lv.${petInfo.pet.level}) • *${petInfo.effectLabel}*`
    : '*(Chưa trang bị — mua tại `/pet shop` hoặc nở Trứng Thú Cưng)*';

  const now = Date.now();
  const buffs = [];
  if (fresh.protected_until > now) buffs.push(`🛡️ Bảo hiểm (${formatRemainingMs(fresh.protected_until - now)})`);
  if (fresh.exp_boost_until > now) buffs.push(`✨ x2 EXP (${formatRemainingMs(fresh.exp_boost_until - now)})`);
  if (fresh.lucky_boost_until > now) buffs.push(`🎟️ Vé May Mắn (${formatRemainingMs(fresh.lucky_boost_until - now)})`);

  const pBanner = buildAssetAttachment(ASSET_PATHS.PROFILE_BANNER, 'profile_banner.png');
  const fallbackThumb = buildAssetAttachment(ASSET_PATHS.GAME_GUESS, 'profile_avatar.png');
  const avatarUrl = resolveUserAvatarUrl(user, fallbackThumb.url);
  const files = avatarUrl === fallbackThumb.url ? [pBanner.attachment, fallbackThumb.attachment] : [pBanner.attachment];

  const frameDecor = fresh.active_frame ? `${SHOP_ITEMS[fresh.active_frame]?.frameStyle ?? ''}\n` : '';

  const profileCard = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      mediaGallery([{ url: pBanner.url, description: 'Hồ Sơ Chiến Binh' }]),
      sectionWithThumbnail({
        texts: [
          `## 👤 HỒ SƠ: ${user.username} \`[${role}]\`\n${frameDecor}` +
            (flashNote ? `✅ **${flashNote}**\n` : '') +
            `🏅 **Danh hiệu:** **${activeTitle}**\n` +
            `⭐ **Cấp độ ${fresh.level}:** \`${renderNeonBar(fresh.exp, reqExp, 10)}\` (\`${fresh.exp}/${reqExp} EXP\`)`,
          `💰 **Tài sản:** Ví \`${formatVnd(fresh.wallet)}\` • Bank \`${formatVnd(fresh.bank + fresh.savings)}\`\n` +
            `🎲 **Thành tích:** \`${fresh.games_won}/${fresh.games_played}\` thắng (**${winRate}%**) • Chuỗi Daily: \`${fresh.login_streak} ngày\``,
        ],
        url: avatarUrl,
        description: `Avatar ${user.username}`,
      }),
      separator(),
      sectionWithButton({
        texts: [
          `🐾 **Thú cưng đồng hành:** ${petLine}\n` +
            `⚡ **Hiệu ứng đang bật:** ${buffs.length > 0 ? buffs.join(' • ') : '*(Không có)*'}`,
        ],
        button: new ButtonBuilder()
          .setCustomId(`gc:private:${user.id}:profile`)
          .setLabel('Xem Riêng Tư')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Secondary),
      }),
    ],
  });

  const navChildren = [];
  if (unlockedIds.length > 0) {
    navChildren.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`gc:equip_title:${user.id}`)
          .setPlaceholder('🏅 Đổi danh hiệu hiển thị trên Hồ sơ...')
          .addOptions(
            unlockedIds
              .filter((id) => TITLES[id])
              .slice(0, 25)
              .map((id) => ({
                label: TITLES[id].name,
                value: id,
                default: id === fresh.active_title,
              }))
          )
      )
    );
  }
  navChildren.push(
    separator(),
    ...buildProMaxNavRows({ userId: user.id, activeTab: GC_TABS.PROFILE, backTarget: GC_TABS.HOME })
  );

  const navCard = createContainer({
    accentColor: THEME.NEON_CYAN,
    children: navChildren,
  });

  return buildCv2Payload({ containers: [profileCard, navCard], files, ephemeral });
}

// ============================================================================
// 7. KHU VỰC BẢNG XẾP HẠNG (LEADERBOARD)
// ============================================================================

export function buildGameCenterLeaderboardPayload(
  user,
  systems,
  boardType = 'wealth',
  { ephemeral = false } = {}
) {
  const validType = ['wealth', 'level', 'wins', 'noitu'].includes(boardType) ? boardType : 'wealth';
  const lbBanner = buildAssetAttachment(ASSET_PATHS.LEADERBOARD_BANNER, 'leaderboard_banner.png');
  const medals = ['🥇', '🥈', '🥉'];

  let title = '💰 TOP 10 ĐẠI GIA TÀI SẢN RÒNG (VNĐ)';
  let lines = [];

  if (validType === 'wealth') {
    const rows = systems.economySystem.getRichLeaderboard(10);
    lines = rows.map(
      (r, idx) =>
        `${medals[idx] ?? `\`#${idx + 1}\``} <@${r.user_id}> — **${formatVnd(r.net_worth)}** *(Lv.${r.level})*`
    );
  } else if (validType === 'level') {
    title = '⭐ TOP 10 CAO THỦ CẤP ĐỘ & KINH NGHIỆM';
    const rows = systems.db.all(
      `SELECT user_id, level, exp, games_won FROM users WHERE is_banned = 0 ORDER BY level DESC, exp DESC LIMIT 10`
    );
    lines = rows.map(
      (r, idx) =>
        `${medals[idx] ?? `\`#${idx + 1}\``} <@${r.user_id}> — **Cấp ${r.level}** (\`${r.exp} EXP\` • ${r.games_won} ván thắng)`
    );
  } else if (validType === 'wins') {
    title = '🎲 TOP 10 THẦN BÀI CHIẾN THẮNG NHIỀU VÁN NHẤT';
    const rows = systems.db.all(
      `SELECT user_id, games_won, games_played, total_earned FROM users WHERE is_banned = 0 AND games_played > 0 ORDER BY games_won DESC, total_earned DESC LIMIT 10`
    );
    lines = rows.map(
      (r, idx) =>
        `${medals[idx] ?? `\`#${idx + 1}\``} <@${r.user_id}> — **${r.games_won} thắng** / ${r.games_played} ván`
    );
  } else if (validType === 'noitu') {
    title = '🔤 TOP 10 VUA TIẾNG VIỆT (NỐI TỪ 1v1)';
    const boards = systems.wordChainSystem.getLeaderboards(10);
    lines = boards.topWins.map(
      (r, idx) =>
        `${medals[idx] ?? `\`#${idx + 1}\``} <@${r.user_id}> — **${r.wins} trận thắng** • Chuỗi đỉnh: \`${r.best_streak}\` (${formatVnd(r.total_vnd_earned)})`
    );
  }

  const lbCard = createContainer({
    accentColor: THEME.NEON_GOLD,
    children: [
      mediaGallery([{ url: lbBanner.url, description: 'Bảng Vàng Xếp Hạng Server' }]),
      textDisplay(
        `## 🏆 ${title}\n` +
          (lines.length > 0 ? lines.join('\n') : '*(Chưa có dữ liệu xếp hạng ở hạng mục này)*')
      ),
    ],
  });

  const catRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:lb:${user.id}:wealth`)
      .setLabel('Đại Gia VNĐ')
      .setEmoji('💰')
      .setStyle(validType === 'wealth' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:lb:${user.id}:level`)
      .setLabel('Top Cấp Độ')
      .setEmoji('⭐')
      .setStyle(validType === 'level' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:lb:${user.id}:wins`)
      .setLabel('Top Thắng Game')
      .setEmoji('🎲')
      .setStyle(validType === 'wins' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:lb:${user.id}:noitu`)
      .setLabel('Top Nối Từ')
      .setEmoji('🔤')
      .setStyle(validType === 'noitu' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const navCard = createContainer({
    accentColor: THEME.NEON_PURPLE,
    children: [
      catRow,
      separator(),
      ...buildProMaxNavRows({
        userId: user.id,
        activeTab: GC_TABS.LEADERBOARD,
        backTarget: GC_TABS.HOME,
        refreshTarget: `lb_${validType}`,
      }),
    ],
  });

  return buildCv2Payload({ containers: [lbCard, navCard], files: [lbBanner.attachment], ephemeral });
}

/**
 * Điều phối render bất kỳ phân khu nào trong 7 khu vực Game Center PRO MAX.
 */
export function renderGameCenterScreen(tabKey, user, guildId, systems, opts = {}) {
  if (tabKey?.startsWith('detail_')) {
    return buildGameDetailPayload(user, guildId, tabKey.slice(7), systems, false, opts);
  }
  if (tabKey?.startsWith('quests_')) {
    return buildGameCenterQuestsPayload(user, systems, tabKey.slice(7), opts);
  }
  if (tabKey === 'shop_bag') {
    return buildGameCenterShopPayload(user, systems, 'bag', opts);
  }
  if (tabKey?.startsWith('lb_')) {
    return buildGameCenterLeaderboardPayload(user, systems, tabKey.slice(3), opts);
  }

  switch (tabKey) {
    case GC_TABS.GAMES:
      return buildGameListPayload(user, guildId, systems, opts);
    case GC_TABS.WALLET:
      return buildGameCenterWalletPayload(user, systems, opts);
    case GC_TABS.QUESTS:
      return buildGameCenterQuestsPayload(user, systems, 'daily', opts);
    case GC_TABS.SHOP:
      return buildGameCenterShopPayload(user, systems, 'catalog', opts);
    case GC_TABS.PROFILE:
      return buildGameCenterProfilePayload(user, systems, opts);
    case GC_TABS.LEADERBOARD:
      return buildGameCenterLeaderboardPayload(user, systems, 'wealth', opts);
    case GC_TABS.HOME:
    default:
      return buildGameCenterHomePayload(user, guildId, systems, opts);
  }
}

// ============================================================================
// SLASH COMMAND /games & BỘ XỬ LÝ TƯƠNG TÁC TOÀN DIỆN (gc:* & gc_modal:*)
// ============================================================================

export const gamesCommand = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('Mở ứng dụng GAME CENTER PRO MAX (Components V2 – 7 Trò Chơi, Ví, Nhiệm Vụ, Shop & Hồ Sơ)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('khu_vuc')
        .setDescription('Chọn nhanh khu vực muốn mở trong Game Center PRO MAX')
        .setRequired(false)
        .addChoices(
          { name: '🏠 1. Trang chủ Game Center', value: 'home' },
          { name: '🎮 2. Danh sách 7 Trò chơi', value: 'games' },
          { name: '💰 3. Ví tiền & Ngân hàng VNĐ', value: 'wallet' },
          { name: '📜 4. Nhiệm vụ Ngày & Tuần', value: 'quests' },
          { name: '🛒 5. Cửa hàng & Túi đồ', value: 'shop' },
          { name: '👤 6. Hồ sơ & Danh hiệu', value: 'profile' },
          { name: '🏆 7. Bảng xếp hạng Server', value: 'leaderboard' }
        )
    )
    .addBooleanOption((o) =>
      o
        .setName('rieng_tu')
        .setDescription('Chỉ hiển thị giao diện riêng tư cho một mình bạn (Ephemeral)')
        .setRequired(false)
    ),

  async execute(interaction, ctx) {
    const systems = getSys(ctx);
    const tab = interaction.options?.getString?.('khu_vuc') || GC_TABS.HOME;
    const ephemeral = Boolean(interaction.options?.getBoolean?.('rieng_tu'));
    const payload = renderGameCenterScreen(
      tab,
      interaction.user,
      interaction.guildId,
      systems,
      { ephemeral }
    );
    await safeReplyV2(interaction, payload);
  },
};

export async function handleGameCenterInteraction(interaction, ctx, openVisualGameLauncher) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('gc:') && !customId.startsWith('gc_modal:')) {
    return false;
  }

  const systems = getSys(ctx);

  // Xử lý Modal Gửi / Rút Ngân hàng ngay bên trong khu vực Ví Tiền của Game Center
  if (interaction.isModalSubmit?.() && customId.startsWith('gc_modal:')) {
    const [, kind, ownerId, mode] = customId.split(':');
    if (!(await verifyPanelOwner(interaction, ownerId, '/games'))) return true;

    if (kind === 'bank') {
      const rawAmt = interaction.fields.getTextInputValue('bank_amount').trim().toLowerCase();
      const amtOrAll = rawAmt === 'all' || rawAmt === 'tatca' ? 'all' : Number.parseInt(rawAmt.replace(/[.,_\s₫vnd]/gi, ''), 10);
      try {
        const res =
          mode === 'withdraw'
            ? systems.bankSystem.withdraw(interaction.user.id, interaction.user.username, amtOrAll, 'checking')
            : systems.bankSystem.deposit(interaction.user.id, interaction.user.username, amtOrAll, 'checking');
        const note =
          mode === 'withdraw'
            ? `Đã rút +${formatVnd(res.amount)} từ Ngân hàng về Ví!`
            : `Đã gửi ${formatVnd(res.amount)} vào Ngân hàng sinh lãi!`;
        await safeUpdateV2(
          interaction,
          buildGameCenterWalletPayload(interaction.user, systems, { flashNote: note })
        );
      } catch (err) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '⚠️ Giao Dịch Ngân Hàng Chưa Hợp Lệ',
            body: err.message,
            accentColor: THEME.CRIMSON_NEON,
            ephemeral: true,
          })
        );
      }
      return true;
    }
  }

  const parts = customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  const arg1 = parts[3];
  const arg2 = parts[4];

  if (!(await verifyPanelOwner(interaction, ownerId, '/games'))) {
    return true;
  }

  if (action === 'close') {
    await safeClosePanel(interaction, interaction.user.username);
    return true;
  }

  if (action === 'home') {
    await safeUpdateV2(
      interaction,
      buildGameCenterHomePayload(interaction.user, interaction.guildId, systems)
    );
    return true;
  }

  if (action === 'list_all') {
    await safeUpdateV2(
      interaction,
      buildGameListPayload(interaction.user, interaction.guildId, systems)
    );
    return true;
  }

  if (action === 'nav' || action === 'back' || action === 'refresh') {
    const targetTab = arg1 || GC_TABS.HOME;
    await safeUpdateV2(
      interaction,
      renderGameCenterScreen(targetTab, interaction.user, interaction.guildId, systems)
    );
    return true;
  }

  if (action === 'private') {
    const targetTab = arg1 || GC_TABS.WALLET;
    await safeReplyV2(
      interaction,
      renderGameCenterScreen(targetTab, interaction.user, interaction.guildId, systems, {
        ephemeral: true,
      })
    );
    return true;
  }

  if (action === 'select') {
    const chosenId = interaction.values?.[0];
    if (!GAME_CATALOG[chosenId]) return true;
    await safeUpdateV2(
      interaction,
      buildGameDetailPayload(interaction.user, interaction.guildId, chosenId, systems, false)
    );
    return true;
  }

  if (action === 'view') {
    await safeUpdateV2(
      interaction,
      buildGameDetailPayload(interaction.user, interaction.guildId, arg1, systems, false)
    );
    return true;
  }

  if (action === 'rules') {
    const expand = arg2 === undefined ? true : arg2 === '1';
    await safeUpdateV2(
      interaction,
      buildGameDetailPayload(interaction.user, interaction.guildId, arg1, systems, expand)
    );
    return true;
  }

  if (action === 'act') {
    try {
      let flash = '';
      if (arg1 === 'daily') {
        const r = systems.economySystem.claimPeriodicReward(
          interaction.user.id,
          interaction.user.username,
          'daily'
        );
        flash = `Điểm danh nhận +${formatVnd(r.reward)} (Chuỗi ${r.streak} ngày)!`;
      } else if (arg1 === 'work') {
        const r = systems.economySystem.work(interaction.user.id, interaction.user.username);
        flash = `${r.jobName}: Nhận lương +${formatVnd(r.earned)}!`;
      } else if (arg1 === 'dep_all') {
        const r = systems.bankSystem.deposit(
          interaction.user.id,
          interaction.user.username,
          'all',
          'checking'
        );
        flash = `Đã gửi toàn bộ ${formatVnd(r.amount)} vào Ngân hàng!`;
      }
      const nextScreen =
        arg1 === 'dep_all'
          ? buildGameCenterWalletPayload(interaction.user, systems, { flashNote: flash })
          : buildGameCenterHomePayload(interaction.user, interaction.guildId, systems, {
              flashNote: flash,
            });
      await safeUpdateV2(interaction, nextScreen);
    } catch (err) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⏳ Chưa Thể Thực Hiện Ngay',
          body: err.message,
          accentColor: THEME.AMBER_PULSE,
          ephemeral: true,
        })
      );
    }
    return true;
  }

  if (action === 'bank_modal') {
    const mode = arg1 === 'withdraw' ? 'withdraw' : 'deposit';
    const modal = new ModalBuilder()
      .setCustomId(`gc_modal:bank:${ownerId}:${mode}`)
      .setTitle(mode === 'withdraw' ? 'Rút Tiền Ngân Hàng Về Ví' : 'Gửi Tiền Vào Ngân Hàng');
    const input = new TextInputBuilder()
      .setCustomId('bank_amount')
      .setLabel('Nhập số tiền VNĐ hoặc gõ "all"')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ví dụ: 50000 hoặc all')
      .setRequired(true)
      .setMaxLength(15);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'qtab') {
    await safeUpdateV2(
      interaction,
      buildGameCenterQuestsPayload(interaction.user, systems, arg1)
    );
    return true;
  }

  if (action === 'qclaim') {
    try {
      const res = systems.questSystem.claimRewards(
        interaction.user.id,
        interaction.user.username,
        null
      );
      await safeUpdateV2(
        interaction,
        buildGameCenterQuestsPayload(interaction.user, systems, arg1 || 'daily', {
          flashNote: `Đã nhận +${formatVnd(res.totalVnd)} & +${res.expResult?.addedExp ?? 0} EXP (${res.claimedQuests.length} nhiệm vụ)!`,
        })
      );
    } catch (err) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '📜 Thông Báo Nhiệm Vụ',
          body: err.message,
          accentColor: THEME.AMBER_PULSE,
          ephemeral: true,
        })
      );
    }
    return true;
  }

  if (action === 'shop_mode') {
    await safeUpdateV2(
      interaction,
      buildGameCenterShopPayload(interaction.user, systems, arg1 === 'bag' ? 'bag' : 'catalog')
    );
    return true;
  }

  if (action === 'shop_buy' && interaction.isStringSelectMenu?.()) {
    try {
      const itemId = interaction.values[0];
      const res = systems.shopSystem.buyItem(
        interaction.user.id,
        interaction.user.username,
        itemId,
        1
      );
      await safeUpdateV2(
        interaction,
        buildGameCenterShopPayload(interaction.user, systems, 'catalog', {
          flashNote: `Đã mua 1x ${res.item.emoji} ${res.item.name} (-${formatVnd(res.totalCost)})!`,
        })
      );
    } catch (err) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🛒 Không Thể Mua Vật Phẩm',
          body: err.message,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
    }
    return true;
  }

  if (action === 'shop_use' && interaction.isStringSelectMenu?.()) {
    try {
      const itemId = interaction.values[0];
      const res = systems.shopSystem.useItem(
        interaction.user.id,
        interaction.user.username,
        itemId
      );
      await safeUpdateV2(
        interaction,
        buildGameCenterShopPayload(interaction.user, systems, 'bag', {
          flashNote: `${res.item.emoji} ${res.effectMessage}`,
        })
      );
    } catch (err) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🎒 Chưa Thể Dùng Vật Phẩm',
          body: err.message,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
    }
    return true;
  }

  if (action === 'equip_title' && interaction.isStringSelectMenu?.()) {
    try {
      const titleId = interaction.values[0];
      const equipped = systems.levelSystem.equipTitle(interaction.user.id, titleId);
      await safeUpdateV2(
        interaction,
        buildGameCenterProfilePayload(interaction.user, systems, {
          flashNote: `Đã đổi sang danh hiệu: ${equipped.name}!`,
        })
      );
    } catch (err) {
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🏅 Chưa Thể Đổi Danh Hiệu',
          body: err.message,
          accentColor: THEME.CRIMSON_NEON,
          ephemeral: true,
        })
      );
    }
    return true;
  }

  if (action === 'lb') {
    await safeUpdateV2(
      interaction,
      buildGameCenterLeaderboardPayload(interaction.user, systems, arg1)
    );
    return true;
  }

  if (action === 'join' || action === 'join_now') {
    const gameId = arg1;
    const meta = GAME_CATALOG[gameId];
    if (!meta) return true;

    // Tôn trọng nghiêm ngặt kênh riêng của từng trò chơi
    if (interaction.guildId) {
      const allowed = systems.db.getAllowedGameChannels(interaction.guildId, gameId);
      if (allowed.length === 0) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '📍 Trò Chơi Chưa Gán Kênh Riêng',
            body:
              `Trò chơi **${meta.emoji} ${meta.name}** chưa được Quản trị viên chỉ định kênh bàn chơi!\n` +
              `👉 Nhờ Admin dùng lệnh \`/admin game setchannel\` để mở sòng nhé.`,
            accentColor: THEME.AMBER_PULSE,
            ephemeral: true,
          })
        );
        return true;
      }
      if (!allowed.includes(String(interaction.channelId))) {
        const mentions = allowed.map((id) => `<#${id}>`).join(', ');
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🎯 Chuyển Tới Đúng Kênh Bàn Chơi',
            body:
              `Để giữ trật tự phòng chat, bàn chơi **${meta.emoji} ${meta.name}** hoạt động riêng tại ${mentions}!\n` +
              `👉 Bấm sang ${mentions} và gõ \`${meta.command}\` hoặc \`/games\` để vào bàn ngay nhé!`,
            accentColor: THEME.NEON_CYAN,
            ephemeral: true,
          })
        );
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
    await safeUpdateV2(interaction, launchPayload);
    return true;
  }

  return false;
}
