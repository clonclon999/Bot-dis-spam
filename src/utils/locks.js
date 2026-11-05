/**
 * Khóa đồng bộ theo từng người chơi (Mutex) và bộ giới hạn tốc độ thao tác (Rate Limiter).
 * Ngăn chặn triệt để:
 * - Race condition khi bấm nút liên thanh
 * - Double reward / Double transaction
 * - Spam lệnh làm nghẽn CPU trên gói BotKeep Free
 */
export class ConcurrencyGuard {
  constructor() {
    /** @type {Set<string>} */
    this.activeLocks = new Set();
    /** @type {Map<string, number>} */
    this.lastActionAt = new Map();
  }

  /**
   * Thực thi hàm bất đồng bộ dưới khóa độc quyền theo `key`.
   * Nếu đang có thao tác khác của cùng người dùng chưa xong, từ chối ngay lập tức.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T> | T} fn
   * @returns {Promise<{ acquired: true, result: T } | { acquired: false }>}
   */
  async runExclusive(key, fn) {
    if (this.activeLocks.has(key)) {
      return { acquired: false };
    }
    this.activeLocks.add(key);
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      this.activeLocks.delete(key);
    }
  }

  /**
   * Kiểm tra giới hạn tốc độ thao tác tối thiểu giữa 2 lệnh của cùng 1 người dùng.
   * @param {string} userId
   * @param {number} [cooldownMs=900]
   * @param {number} [now=Date.now()]
   * @returns {{ allowed: boolean, retryAfterMs: number }}
   */
  checkRateLimit(userId, cooldownMs = 900, now = Date.now()) {
    const prev = this.lastActionAt.get(userId) ?? 0;
    const elapsed = now - prev;
    if (elapsed < cooldownMs) {
      return { allowed: false, retryAfterMs: cooldownMs - elapsed };
    }
    this.lastActionAt.set(userId, now);

    // Tự thu gọn Map nếu vượt 3000 mục để giữ RAM siêu nhẹ
    if (this.lastActionAt.size > 3000) {
      for (const [k, ts] of this.lastActionAt.entries()) {
        if (now - ts > 60_000) this.lastActionAt.delete(k);
      }
    }

    return { allowed: true, retryAfterMs: 0 };
  }
}

export const globalGuard = new ConcurrencyGuard();

/** @type {Map<string, Promise<any>>} */
const serializedUserQueues = new Map();

/**
 * Khóa tuần tự hóa FIFO trên từng khóa `key` (bảo đảm nhiều thao tác đồng thời không bị mất lượt và chạy tuần tự 100%).
 * @template T
 * @param {string} key
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withUserLock(key, fn) {
  const k = String(key);
  const prev = serializedUserQueues.get(k) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => next, () => next);
  serializedUserQueues.set(k, chain);

  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (serializedUserQueues.get(k) === chain) {
      serializedUserQueues.delete(k);
    }
  }
}
