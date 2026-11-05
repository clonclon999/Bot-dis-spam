import { MessageFlags } from 'discord.js';

/**
 * Bộ quản lý tự động dọn dẹp các Bảng tương tác cũ (Auto-Delete Previous Panel):
 * - Mỗi khi người chơi mở bảng mới (/menu, /help, /shop, /quest, /baucua, /taixiu, /profile...),
 *   bảng cũ của người đó trong kênh sẽ tự động bị xóa ngay lập tức để đoạn chat luôn gọn gàng.
 * - Hỗ trợ thêm quản lý bảng chung toàn kênh (như bảng trạng thái / lượt Bot của trò Nối Từ).
 */
export class PanelCleaner {
  constructor() {
    /** @type {Map<string, { messageId: string, commandName: string, isPvpInvite: boolean, createdAt: number, deleteFn: () => Promise<any> }>} */
    this.userPanels = new Map();

    /** @type {Map<string, { messageId: string, createdAt: number, deleteFn: () => Promise<any> }>} */
    this.ephemeralPanels = new Map();

    /** @type {Map<string, { messageId: string, createdAt: number, deleteFn: () => Promise<any> }>} */
    this.channelBoards = new Map();
  }

  /**
   * Đăng ký bảng công khai mới của một người dùng trong kênh và tự động xóa bảng cũ của họ.
   */
  async registerUserPanel({
    channelId,
    userId,
    commandName,
    message,
    isPvpInvite = false,
  }) {
    if (!channelId || !userId || !message?.id || typeof message.delete !== 'function') {
      return;
    }

    const key = `${channelId}:${userId}`;
    const prev = this.userPanels.get(key);

    if (prev && prev.messageId !== message.id) {
      // Giữ nguyên lời thách đấu PvP đang chờ đối thủ nếu người chơi chỉ mở bảng phụ khác
      const keepPvp = prev.isPvpInvite && commandName !== 'rps';
      if (!keepPvp) {
        this.userPanels.delete(key);
        await prev.deleteFn().catch(() => {});
      }
    }

    if (!prev?.isPvpInvite || commandName === 'rps' || !this.userPanels.has(key)) {
      this.userPanels.set(key, {
        messageId: message.id,
        commandName,
        isPvpInvite,
        createdAt: Date.now(),
        deleteFn: () => message.delete(),
      });
    }

    this._trimIfNeeded();
  }

  /**
   * Tự động thu hồi bảng Ephemeral cũ (như /admin system dashboard) qua Webhook của Interaction.
   */
  async registerEphemeralPanel({ channelId, userId, commandName, messageId, webhook }) {
    if (!channelId || !userId || !messageId || typeof webhook?.deleteMessage !== 'function') {
      return;
    }

    const key = `${channelId}:${userId}:${commandName}`;
    const prev = this.ephemeralPanels.get(key);
    if (prev && prev.messageId !== messageId && Date.now() - prev.createdAt < 14 * 60_000) {
      this.ephemeralPanels.delete(key);
      await prev.deleteFn().catch(() => {});
    }

    this.ephemeralPanels.set(key, {
      messageId,
      createdAt: Date.now(),
      deleteFn: () => webhook.deleteMessage(messageId),
    });
  }

  /**
   * Đăng ký bảng dùng chung của cả kênh (ví dụ bảng Trạng thái / Lượt nối từ trong kênh #nối-từ)
   * và xóa ngay bảng cũ cùng loại trong kênh đó.
   */
  async registerChannelBoard(channelId, boardKey, message) {
    if (!channelId || !boardKey || !message?.id || typeof message.delete !== 'function') {
      return;
    }

    const key = `${channelId}:${boardKey}`;
    const prev = this.channelBoards.get(key);
    if (prev && prev.messageId !== message.id) {
      this.channelBoards.delete(key);
      await prev.deleteFn().catch(() => {});
    }

    this.channelBoards.set(key, {
      messageId: message.id,
      createdAt: Date.now(),
      deleteFn: () => message.delete(),
    });

    this._trimIfNeeded();
  }

  /**
   * Xóa ngay bảng chung của kênh nếu đang tồn tại.
   */
  async clearChannelBoard(channelId, boardKey) {
    const key = `${channelId}:${boardKey}`;
    const prev = this.channelBoards.get(key);
    if (prev) {
      this.channelBoards.delete(key);
      await prev.deleteFn().catch(() => {});
    }
  }

  /**
   * Tích hợp tự động sau khi thực thi một Slash Command:
   * Lấy tin nhắn phản hồi vừa gửi và tự động dọn bảng cũ trước đó.
   */
  async captureInteractionReply(interaction, commandName) {
    if (!interaction?.replied && !interaction?.deferred) return;
    if (typeof interaction.fetchReply !== 'function') return;

    const msg = await interaction.fetchReply().catch(() => null);
    if (!msg?.id) return;

    const channelId = interaction.channelId ?? msg.channelId;
    const userId = interaction.user?.id;
    if (!channelId || !userId) return;

    const isEphemeral = Boolean(msg.flags?.has?.(MessageFlags.Ephemeral));
    if (isEphemeral) {
      await this.registerEphemeralPanel({
        channelId,
        userId,
        commandName,
        messageId: msg.id,
        webhook: interaction.webhook,
      });
      return;
    }

    // Lệnh trả thưởng đơn thuần như /pay (chuyển khoản giữa 2 người) giữ lại làm biên lai giao dịch
    if (commandName === 'pay') return;

    // Lệnh /noitu dùng bảng chung theo kênh để không chồng bảng trạng thái phòng chơi
    if (commandName === 'noitu') {
      await this.registerChannelBoard(channelId, 'noitu_board', msg);
      return;
    }

    const isPvpInvite =
      commandName === 'rps' && Boolean(interaction.options?.getUser?.('opponent'));

    await this.registerUserPanel({
      channelId,
      userId,
      commandName,
      message: msg,
      isPvpInvite,
    });
  }

  sweepExpired(now = Date.now()) {
    const ttl = 30 * 60_000;
    for (const [k, v] of this.userPanels.entries()) {
      if (now - v.createdAt > ttl) this.userPanels.delete(k);
    }
    for (const [k, v] of this.ephemeralPanels.entries()) {
      if (now - v.createdAt > 15 * 60_000) this.ephemeralPanels.delete(k);
    }
    for (const [k, v] of this.channelBoards.entries()) {
      if (now - v.createdAt > ttl) this.channelBoards.delete(k);
    }
  }

  _trimIfNeeded() {
    if (this.userPanels.size > 1500 || this.channelBoards.size > 500) {
      this.sweepExpired();
    }
  }
}

export const globalPanelCleaner = new PanelCleaner();
