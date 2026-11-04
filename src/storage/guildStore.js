import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  createDefaultGuildConfig,
  DEFAULT_GUILD_CONFIG,
  SYSTEM_LIMITS,
} from '../config/defaults.js';
import { logger } from '../utils/logger.js';

/**
 * Kho lưu trữ cấu hình và lịch sử xử lý vi phạm bền vững theo từng máy chủ (Guild).
 * - Đọc tức thì từ bộ nhớ đệm (Map) với độ phức tạp O(1) để không gây nghẽn luồng sự kiện.
 * - Ghi xuống đĩa theo cơ chế nguyên tử (atomic write qua tệp tạm .tmp rồi rename) và gộp hàng đợi
 *   giúp an toàn dữ liệu ngay cả khi tiến trình khởi động lại đột ngột.
 */
export class GuildStore {
  /**
   * @param {string} dataDir - Thư mục lưu tệp JSON
   */
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.storeFile = path.join(this.dataDir, 'guilds-store.json');
    /** @type {Map<string, object>} */
    this.configs = new Map();
    /** @type {Map<string, Array<object>>} */
    this.logs = new Map();
    this._initialized = false;
    this._writeTimer = null;
    this._writeChain = Promise.resolve();
    this._dirty = false;
  }

  /**
   * Khởi tạo kho dữ liệu từ đĩa khi bot bắt đầu chạy.
   */
  async init() {
    if (this._initialized) return;

    await fsp.mkdir(this.dataDir, { recursive: true });

    if (fs.existsSync(this.storeFile)) {
      try {
        const raw = await fsp.readFile(this.storeFile, 'utf8');
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === 'object') {
          const rawConfigs = parsed.configs ?? {};
          for (const [guildId, cfg] of Object.entries(rawConfigs)) {
            this.configs.set(guildId, this._normalizeConfig(cfg));
          }

          const rawLogs = parsed.logs ?? {};
          for (const [guildId, entries] of Object.entries(rawLogs)) {
            if (Array.isArray(entries)) {
              this.logs.set(
                guildId,
                entries.slice(0, SYSTEM_LIMITS.MAX_LOGS_PER_GUILD)
              );
            }
          }
        }
        logger.info(
          'GuildStore',
          `Đã tải cấu hình của ${this.configs.size} máy chủ từ bộ nhớ bền vững.`
        );
      } catch (err) {
        logger.error(
          'GuildStore',
          'Tệp lưu trữ bị lỗi định dạng, tạo bản sao lưu .bak và khởi tạo mới.',
          err
        );
        try {
          await fsp.copyFile(this.storeFile, `${this.storeFile}.bak`);
        } catch {
          // Bỏ qua nếu không thể sao lưu
        }
      }
    }

    this._initialized = true;
  }

  /**
   * Chuẩn hóa cấu hình đọc từ đĩa để luôn tương thích ngược khi có thêm trường mới.
   * @param {object} partial
   * @returns {object}
   */
  _normalizeConfig(partial = {}) {
    const base = createDefaultGuildConfig();
    return {
      ...base,
      ...partial,
      whitelistRoles: Array.isArray(partial.whitelistRoles)
        ? [...new Set(partial.whitelistRoles.map(String))]
        : [],
      whitelistUsers: Array.isArray(partial.whitelistUsers)
        ? [...new Set(partial.whitelistUsers.map(String))]
        : [],
      whitelistChannels: Array.isArray(partial.whitelistChannels)
        ? [...new Set(partial.whitelistChannels.map(String))]
        : [],
      stats: {
        ...base.stats,
        ...(partial.stats && typeof partial.stats === 'object' ? partial.stats : {}),
      },
      updatedAt: partial.updatedAt || base.updatedAt,
    };
  }

  /**
   * Lấy cấu hình của máy chủ (tự tạo mặc định trong RAM nếu chưa tồn tại).
   * @param {string} guildId
   * @returns {object}
   */
  getConfig(guildId) {
    let cfg = this.configs.get(guildId);
    if (!cfg) {
      cfg = createDefaultGuildConfig();
      this.configs.set(guildId, cfg);
      this._scheduleSave();
    }
    return cfg;
  }

  /**
   * Cập nhật một phần cấu hình của máy chủ và lên lịch lưu bền vững.
   * @param {string} guildId
   * @param {object} patch
   * @returns {object} Cấu hình sau khi cập nhật
   */
  updateConfig(guildId, patch) {
    const current = this.getConfig(guildId);
    const updated = this._normalizeConfig({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });

    // Đảm bảo tính nhất quán logic giữa giới hạn 1 tin nhắn và giới hạn cửa sổ thời gian
    if (updated.maxMentionsWindow < updated.maxMentionsPerMessage) {
      updated.maxMentionsWindow = updated.maxMentionsPerMessage;
    }

    this.configs.set(guildId, updated);
    this._scheduleSave();
    return updated;
  }

  /**
   * Đặt lại cấu hình máy chủ về mặc định ban đầu.
   * @param {string} guildId
   * @param {{ keepLogs?: boolean }} [options]
   * @returns {object}
   */
  resetConfig(guildId, { keepLogs = true } = {}) {
    const fresh = createDefaultGuildConfig();
    this.configs.set(guildId, fresh);
    if (!keepLogs) {
      this.logs.delete(guildId);
    }
    this._scheduleSave();
    return fresh;
  }

  /**
   * Ghi nhận một bản ghi lịch sử xử lý vi phạm mới cho máy chủ (giới hạn tối đa MAX_LOGS_PER_GUILD).
   * @param {string} guildId
   * @param {object} logEntry
   */
  appendViolationLog(guildId, logEntry) {
    const cfg = this.getConfig(guildId);
    cfg.stats.totalViolations = (cfg.stats.totalViolations || 0) + 1;
    if (logEntry.actions?.messageDeleted) {
      cfg.stats.deletedMessages = (cfg.stats.deletedMessages || 0) + 1;
    }
    if (logEntry.actions?.warningSent) {
      cfg.stats.warningsIssued = (cfg.stats.warningsIssued || 0) + 1;
    }
    if (logEntry.actions?.timeoutApplied) {
      cfg.stats.timeoutsIssued = (cfg.stats.timeoutsIssued || 0) + 1;
    }

    const list = this.logs.get(guildId) ?? [];
    list.unshift(logEntry);
    if (list.length > SYSTEM_LIMITS.MAX_LOGS_PER_GUILD) {
      list.length = SYSTEM_LIMITS.MAX_LOGS_PER_GUILD;
    }
    this.logs.set(guildId, list);
    this._scheduleSave();
  }

  /**
   * Truy vấn lịch sử xử lý vi phạm của máy chủ (hỗ trợ lọc theo người dùng và số lượng).
   * @param {string} guildId
   * @param {{ userId?: string | null, limit?: number }} [options]
   * @returns {Array<object>}
   */
  getViolationLogs(guildId, { userId = null, limit = 10 } = {}) {
    const list = this.logs.get(guildId) ?? [];
    const filtered = userId ? list.filter((item) => item.userId === userId) : list;
    const safeLimit = Math.max(1, Math.min(25, limit));
    return filtered.slice(0, safeLimit);
  }

  /**
   * Quản lý danh sách miễn trừ (Whitelist) cho vai trò, người dùng hoặc kênh.
   * @param {string} guildId
   * @param {'role' | 'user' | 'channel'} targetType
   * @param {'add' | 'remove'} operation
   * @param {string} targetId
   * @returns {{ changed: boolean, config: object }}
   */
  modifyWhitelist(guildId, targetType, operation, targetId) {
    const fieldMap = {
      role: 'whitelistRoles',
      user: 'whitelistUsers',
      channel: 'whitelistChannels',
    };
    const field = fieldMap[targetType];
    if (!field) throw new Error(`Loại đối tượng miễn trừ không hợp lệ: ${targetType}`);

    const cfg = this.getConfig(guildId);
    const set = new Set(cfg[field]);
    let changed = false;

    if (operation === 'add' && !set.has(targetId)) {
      set.add(targetId);
      changed = true;
    } else if (operation === 'remove' && set.has(targetId)) {
      set.delete(targetId);
      changed = true;
    }

    if (changed) {
      cfg[field] = [...set];
      cfg.updatedAt = new Date().toISOString();
      this._scheduleSave();
    }

    return { changed, config: cfg };
  }

  /**
   * Xóa toàn bộ danh sách miễn trừ tùy chỉnh của máy chủ.
   * @param {string} guildId
   * @returns {object}
   */
  clearWhitelist(guildId) {
    return this.updateConfig(guildId, {
      whitelistRoles: [],
      whitelistUsers: [],
      whitelistChannels: [],
    });
  }

  /**
   * Gom nhóm các thao tác ghi đĩa trong 250ms để giảm tải I/O khi có đợt spam lớn.
   */
  _scheduleSave() {
    this._dirty = true;
    if (this._writeTimer) return;

    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      this.flush().catch((err) => {
        logger.error('GuildStore', 'Lỗi khi lưu dữ liệu xuống đĩa', err);
      });
    }, 250);

    if (typeof this._writeTimer.unref === 'function') {
      this._writeTimer.unref();
    }
  }

  /**
   * Ghi ngay lập tức mọi thay đổi đang chờ xuống đĩa một cách an toàn (atomic write).
   */
  async flush() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    if (!this._dirty) return this._writeChain;

    this._dirty = false;
    const snapshot = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      defaultsReference: DEFAULT_GUILD_CONFIG,
      configs: Object.fromEntries(this.configs.entries()),
      logs: Object.fromEntries(this.logs.entries()),
    };

    this._writeChain = this._writeChain.then(async () => {
      await fsp.mkdir(this.dataDir, { recursive: true });
      const tmpPath = `${this.storeFile}.${process.pid}.tmp`;
      const json = JSON.stringify(snapshot, null, 2);
      await fsp.writeFile(tmpPath, json, 'utf8');
      await fsp.rename(tmpPath, this.storeFile);
    });

    return this._writeChain;
  }
}
