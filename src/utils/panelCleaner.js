import { MessageFlags } from 'discord.js';

export const DEFAULT_PANEL_TTL_MS = 3 * 60_000; // 3 phút cho bảng phụ trợ (/games, /menu, /shop, /wallet...)
export const DEFAULT_RESULT_TTL_MS = 2 * 60_000; // 2 phút cho bảng kết quả mini-game đã hoàn tất

/**
 * Bộ quản lý tự động dọn dẹp các Bảng tương tác cũ & Hẹn giờ tự xóa (Auto-Cleanup):
 * 1. Mỗi khi người chơi mở bảng mới (/menu, /help, /shop, /quest, /games, /profile...),
 *    bảng cũ của người đó trong kênh tự động bị xóa ngay lập tức.
 * 2. Các bảng phụ trợ / kết quả mini-game tự động biến mất sau vài phút (2–3 phút) không tương tác
 *    để kênh chat luôn thoáng mắt, không ứ đọng rác giao diện.
 */
export class PanelCleaner {
  constructor({
    panelTtlMs = DEFAULT_PANEL_TTL_MS,
    resultTtlMs = DEFAULT_RESULT_TTL_MS,
  } = {}) {
    this.panelTtlMs = panelTtlMs;
    this.resultTtlMs = resultTtlMs;

    /** @type {Map<string, { messageId: string, commandName: string, isPvpInvite: boolean, createdAt: number, deleteFn: () => Promise<any> }>} */
    this.userPanels = new Map();

    /** @type {Map<string, { messageId: string, createdAt: number, deleteFn: () => Promise<any> }>} */
    this.ephemeralPanels = new Map();

    /** @type {Map<string, { messageId: string, createdAt: number, deleteFn: () => Promise<any> }>} */
    this.channelBoards = new Map();

    /** @type {Map<string, { timer: ReturnType<typeof setTimeout>, ttlMs: number, message: any, deleteFn: () => Promise<any> }>} */
    this.autoDeleteTimers = new Map();
  }

  /**
   * Hẹn giờ tự động xóa một tin nhắn bảng phụ trợ / kết quả sau `ttlMs` mili-giây.
   * Sử dụng `.unref()` để không giữ tiến trình Node.js khi tắt máy hoặc chạy kiểm thử.
   */
  scheduleAutoDelete(message, ttlMs = this.panelTtlMs) {
    if (!message?.id || typeof message.delete !== 'function') return false;
    const msgId = String(message.id);
    const effectiveTtl = Math.max(20, Number(ttlMs) || this.panelTtlMs);

    this.cancelAutoDelete(msgId);

    const deleteFn = () => message.delete();
    const timer = setTimeout(() => {
      this.autoDeleteTimers.delete(msgId);
      this._purgeMessageReferences(msgId);
      Promise.resolve()
        .then(() => deleteFn())
        .catch(() => {});
    }, effectiveTtl);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    this.autoDeleteTimers.set(msgId, {
      timer,
      ttlMs: effectiveTtl,
      message,
      deleteFn,
    });
    return true;
  }

  /**
   * Gia hạn lại đồng hồ tự xóa khi người chơi vẫn đang bấm nút tương tác trên bảng (VD: chuyển tab /games, /shop).
   */
  touchMessage(message, ttlMsOverride = null) {
    if (!message?.id) return false;
    const existing = this.autoDeleteTimers.get(String(message.id));
    if (!existing) return false;
    const nextTtl = ttlMsOverride ?? existing.ttlMs;
    return this.scheduleAutoDelete(existing.message || message, nextTtl);
  }

  cancelAutoDelete(messageId) {
    if (!messageId) return;
    const key = String(messageId);
    const existing = this.autoDeleteTimers.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.autoDeleteTimers.delete(key);
    }
  }

  clearAllTimers() {
    for (const entry of this.autoDeleteTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.autoDeleteTimers.clear();
  }

  _purgeMessageReferences(messageId) {
    for (const [k, v] of this.userPanels.entries()) {
      if (v.messageId === messageId) this.userPanels.delete(k);
    }
    for (const [k, v] of this.channelBoards.entries()) {
      if (v.messageId === messageId) this.channelBoards.delete(k);
    }
  }

  /**
   * Đăng ký bảng công khai mới của một người dùng trong kênh, xóa bảng cũ và hẹn giờ tự xóa sau vài phút.
   */
  async registerUserPanel({
    channelId,
    userId,
    commandName,
    message,
    isPvpInvite = false,
    ttlMs = null,
  }) {
    if (!channelId || !userId || !message?.id || typeof message.delete !== 'function') {
      return;
    }

    const key = `${channelId}:${userId}`;
    const prev = this.userPanels.get(key);

    if (prev && prev.messageId !== message.id) {
      const keepPvp = prev.isPvpInvite && commandName !== 'rps';
      if (!keepPvp) {
        this.userPanels.delete(key);
        this.cancelAutoDelete(prev.messageId);
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

    // Hẹn giờ tự động biến mất sau vài phút cho đỡ rối mắt (lời mời PvP dùng thời hạn rộng hơn để chờ đối thủ bấm)
    const defaultTtl = isPvpInvite ? Math.max(this.panelTtlMs, 3 * 60_000) : this.panelTtlMs;
    this.scheduleAutoDelete(message, ttlMs ?? defaultTtl);

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
   * Đăng ký bảng dùng chung của cả kênh (ví dụ bảng Trạng thái / Hub của Nối Từ)
   * và xóa ngay bảng cũ cùng loại trong kênh đó.
   */
  async registerChannelBoard(channelId, boardKey, message, { autoDeleteMs = null } = {}) {
    if (!channelId || !boardKey || !message?.id || typeof message.delete !== 'function') {
      return;
    }

    const key = `${channelId}:${boardKey}`;
    const prev = this.channelBoards.get(key);
    if (prev && prev.messageId !== message.id) {
      this.channelBoards.delete(key);
      this.cancelAutoDelete(prev.messageId);
      await prev.deleteFn().catch(() => {});
    }

    this.channelBoards.set(key, {
      messageId: message.id,
      createdAt: Date.now(),
      deleteFn: () => message.delete(),
    });

    if (autoDeleteMs && autoDeleteMs > 0) {
      this.scheduleAutoDelete(message, autoDeleteMs);
    }

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
      this.cancelAutoDelete(prev.messageId);
      await prev.deleteFn().catch(() => {});
    }
  }

  /**
   * Tích hợp tự động sau khi thực thi một Slash Command:
   * Lấy tin nhắn phản hồi vừa gửi, xóa bảng cũ trước đó và hẹn giờ tự xóa sau vài phút.
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

    // Bảng phiên chung toàn server (/game) được xóa theo cơ chế chuyển phiên riêng
    if (commandName === 'game') return;

    // Lệnh /noitu: nếu chỉ mở Hub / BXH / Luật (không tạo phòng chờ trực tiếp) thì tự xóa sau 3 phút
    if (commandName === 'noitu') {
      const sub = interaction.options?.getSubcommand?.(false) || 'hub';
      const isIdleInfoPanel = sub === 'hub' || sub === 'rules' || sub === 'stats' || sub === 'leaderboard';
      await this.registerChannelBoard(channelId, 'noitu_board', msg, {
        autoDeleteMs: isIdleInfoPanel ? this.panelTtlMs : null,
      });
      return;
    }

    const isPvpInvite =
      commandName === 'rps' && Boolean(interaction.options?.getUser?.('opponent'));

    // Các mini-game trả kết quả nhanh tự xóa sau 2 phút; các bảng điều khiển (/games, /menu, /shop...) tự xóa sau 3 phút
    const fastResultCmds = new Set(['coinflip', 'pay', 'work', 'daily', 'crime', 'rob', 'bail']);
    const ttlMs = fastResultCmds.has(commandName) ? this.resultTtlMs : this.panelTtlMs;

    await this.registerUserPanel({
      channelId,
      userId,
      commandName,
      message: msg,
      isPvpInvite,
      ttlMs,
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
