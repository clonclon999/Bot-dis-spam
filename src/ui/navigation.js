import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const GC_TABS = Object.freeze({
  HOME: 'home',
  GAMES: 'games',
  WALLET: 'wallet',
  QUESTS: 'quests',
  SHOP: 'shop',
  PROFILE: 'profile',
  LEADERBOARD: 'leaderboard',
  DETAIL: 'detail',
});

/**
 * Thanh điều hướng chuẩn GAME CENTER PRO MAX (Mục 2 & Mục 4):
 * Bao gồm đầy đủ: Trang chủ • Chơi game • Ví tiền • Nhiệm vụ • Cửa hàng • Hồ sơ • Xếp hạng • Làm mới • Quay lại • Đóng.
 * Bố cục 2 hàng gọn gàng hiển thị đẹp trên cả Discord Android/iOS lẫn Desktop (tổng chỉ 12 components).
 */
export function buildProMaxNavRows({
  userId,
  activeTab = GC_TABS.HOME,
  backTarget = GC_TABS.HOME,
  refreshTarget = null,
}) {
  const tabStyle = (tab) => (activeTab === tab ? ButtonStyle.Primary : ButtonStyle.Secondary);
  const actualRefresh = refreshTarget || activeTab || GC_TABS.HOME;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:home`)
      .setLabel('Trang chủ')
      .setEmoji('🏠')
      .setStyle(tabStyle(GC_TABS.HOME)),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:games`)
      .setLabel('Chơi game')
      .setEmoji('🎮')
      .setStyle(activeTab === GC_TABS.GAMES || activeTab === GC_TABS.DETAIL ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:wallet`)
      .setLabel('Ví tiền')
      .setEmoji('💰')
      .setStyle(tabStyle(GC_TABS.WALLET)),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:quests`)
      .setLabel('Nhiệm vụ')
      .setEmoji('📜')
      .setStyle(tabStyle(GC_TABS.QUESTS)),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:shop`)
      .setLabel('Cửa hàng')
      .setEmoji('🛒')
      .setStyle(tabStyle(GC_TABS.SHOP))
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:profile`)
      .setLabel('Hồ sơ')
      .setEmoji('👤')
      .setStyle(tabStyle(GC_TABS.PROFILE)),
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:leaderboard`)
      .setLabel('Xếp hạng')
      .setEmoji('🏆')
      .setStyle(tabStyle(GC_TABS.LEADERBOARD)),
    new ButtonBuilder()
      .setCustomId(`gc:refresh:${userId}:${actualRefresh}`)
      .setLabel('Làm mới')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:back:${userId}:${backTarget}`)
      .setLabel('Quay lại')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(activeTab === GC_TABS.HOME && backTarget === GC_TABS.HOME),
    new ButtonBuilder()
      .setCustomId(`gc:close:${userId}`)
      .setLabel('Đóng')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

/**
 * Hàng điều hướng nhanh sau mỗi ván game: Chơi lại • Ví tiền • Nhiệm vụ • Game Center • Đóng.
 */
export function buildGameResultNavRow({ replayCustomId, userId, extraButton = null }) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(replayCustomId)
      .setLabel('Chơi lại')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Success),
  ];

  if (extraButton) {
    buttons.push(extraButton);
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`gc:nav:${userId}:wallet`)
        .setLabel('Ví tiền')
        .setEmoji('💰')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`gc:nav:${userId}:quests`)
      .setLabel('Nhiệm vụ')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gc:home:${userId}`)
      .setLabel('Game Center')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gc:close:${userId}`)
      .setLabel('Đóng')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
  );

  return new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
}
