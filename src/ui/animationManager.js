/**
 * Bộ Quản lý Diễn hoạt & Phiên Giao diện (`AnimationManager`):
 * - Giới hạn số lượng animation đồng thời trên toàn Bot chống quá tải CPU/RAM & Rate-Limit Discord.
 * - Cấp mã thế hệ phiên (`sessionGen`) để ngăn tương tác/timer cũ ghi đè lên phiên chơi mới.
 * - Quản lý và dọn sạch toàn bộ `setTimeout` khi kết thúc ván hoặc tắt Bot.
 */
export class AnimationManager {
  constructor({ maxGlobalAnimations = 12, maxConcurrentGlobal, defaultStepMs = 880 } = {}) {
    this.maxGlobalAnimations = maxConcurrentGlobal ?? maxGlobalAnimations;
    this.defaultStepMs = defaultStepMs;
    this.activeCount = 0;
    /** @type {Set<string>} */
    this.activeKeys = new Set();
    /** @type {Map<string, number>} */
    this.sessionGenerations = new Map();
    /** @type {Set<{ handle: ReturnType<typeof setTimeout>, resolve: () => void }>} */
    this.timers = new Set();
  }

  /**
   * Tăng số thế hệ của một phiên (`gameId:userId`) mỗi khi mở bàn mới / hủy bàn,
   * đảm bảo tương tác hoặc khung animation cũ tự động bị vô hiệu hóa.
   */
  bumpSession(scopeKey) {
    const next = ((this.sessionGenerations.get(scopeKey) ?? 0) + 1) % 1_000_000;
    this.sessionGenerations.set(scopeKey, next);
    if (this.sessionGenerations.size > 2000) {
      const oldest = this.sessionGenerations.keys().next().value;
      this.sessionGenerations.delete(oldest);
    }
    return next;
  }

  getSessionGen(scopeKey) {
    return this.sessionGenerations.get(scopeKey) ?? 0;
  }

  isCurrentSession(scopeKey, expectedGen) {
    if (expectedGen === undefined || expectedGen === null) return true;
    return this.getSessionGen(scopeKey) === Number(expectedGen);
  }

  /**
   * Tạm dừng bất đồng bộ có quản lý timer để giải phóng ngay khi cần dọn dẹp.
   */
  wait(ms = this.defaultStepMs) {
    const safeMs = Math.max(0, Number(ms) || 0);
    if (safeMs === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const entry = { handle: null, resolve };
      entry.handle = setTimeout(() => {
        this.timers.delete(entry);
        resolve();
      }, safeMs);
      this.timers.add(entry);
    });
  }

  /**
   * Chạy chuỗi khung hình diễn hoạt theo từng giai đoạn:
   * - Nếu vượt ngưỡng `maxGlobalAnimations`, tự động bỏ qua các khung trung gian và nhảy thẳng tới
   *   màn hình kết quả cuối cùng để bảo vệ Discord Rate Limit và giữ mượt BotKeep FREE.
   * - Nếu phiên đã bị hủy hoặc sang ván mới giữa chừng, tự động dừng cập nhật khung cũ.
   */
  async runStagedAnimation({
    scopeKey,
    sessionKey,
    editFn,
    interaction,
    stages = [],
    finalPayload,
  }) {
    const key = scopeKey || sessionKey || 'default';
    const updater =
      editFn ||
      (async (payload) => {
        if (!interaction) return null;
        if (!interaction.replied && !interaction.deferred && typeof interaction.update === 'function') {
          return interaction.update(payload);
        }
        if (typeof interaction.editReply === 'function') {
          return interaction.editReply(payload);
        }
        return null;
      });

    const gen = this.bumpSession(key);
    const canAnimateStages =
      this.activeCount < this.maxGlobalAnimations && !this.activeKeys.has(key);

    if (canAnimateStages && stages.length > 0) {
      this.activeCount += 1;
      this.activeKeys.add(key);
      try {
        for (const stage of stages) {
          if (!this.isCurrentSession(key, gen)) return { aborted: true };
          await Promise.resolve(updater(stage.payload)).catch(() => {});
          const delay = stage.delayMs ?? this.defaultStepMs;
          await this.wait(delay);
        }
      } finally {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.activeKeys.delete(key);
      }
    }

    if (!this.isCurrentSession(key, gen)) {
      return { aborted: true };
    }
    await Promise.resolve(updater(finalPayload)).catch(() => {});
    return { aborted: false, skippedStages: !canAnimateStages };
  }

  /**
   * Hủy toàn bộ timer đang chờ khi đóng tiến trình hoặc kết thúc bài kiểm thử.
   */
  clearAllTimers() {
    for (const entry of this.timers) {
      clearTimeout(entry.handle);
      entry.resolve?.();
    }
    this.timers.clear();
    this.activeCount = 0;
    this.activeKeys.clear();
  }

  shutdownCleanup() {
    this.clearAllTimers();
  }
}

export const globalAnimationManager = new AnimationManager();
