import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../config/defaults.js';
import { logger } from '../utils/logger.js';
import { SCHEMA_SQL } from './schema.js';

let sqlEnginePromise = null;

function getSqlEngine() {
  if (!sqlEnginePromise) {
    sqlEnginePromise = initSqlJs();
  }
  return sqlEnginePromise;
}

/**
 * Cơ sở dữ liệu SQLite hiệu năng cao (WASM) tối ưu riêng cho gói FREE của BotKeep.cloud:
 * - Không biên dịch C++ (node-gyp), cài đặt tức thì trên mọi phiên bản Node.js.
 * - Hỗ trợ Transaction ACID thực thụ + Savepoint lồng nhau chống mọi race condition tiền tệ.
 * - Lưu xuống đĩa nguyên tử (atomic .tmp -> rename) kèm cơ chế Backup / Restore an toàn.
 */
export class GameDatabase {
  /**
   * @param {string} dataDir
   * @param {string} [filename='gamebot-pro.sqlite']
   */
  constructor(dataDir, filename = 'gamebot-pro.sqlite') {
    this.dataDir = path.resolve(dataDir);
    this.backupDir = path.join(this.dataDir, 'backups');
    this.dbPath = path.join(this.dataDir, filename);
    this.SQL = null;
    this.db = null;
    this._txDepth = 0;
    this._dirty = false;
    this._flushTimer = null;
    this._writeChain = Promise.resolve();
    /** @type {Map<string, any>} */
    this.settingsCache = new Map();
    /** @type {Map<string, string>} Khóa `${guildId}:${gameId}` -> `channelId` */
    this.gameChannelsCache = new Map();
  }

  async init() {
    if (this.db) return;

    await fsp.mkdir(this.backupDir, { recursive: true });
    this.SQL = await getSqlEngine();

    if (fs.existsSync(this.dbPath)) {
      try {
        const buf = await fsp.readFile(this.dbPath);
        this.db = new this.SQL.Database(new Uint8Array(buf));
        logger.info('Database', `Đã nạp cơ sở dữ liệu SQLite từ ${this.dbPath}`);
      } catch (err) {
        logger.error('Database', 'Tệp SQLite bị hỏng, tạo bản sao lưu .corrupt và khởi tạo mới', err);
        await fsp.copyFile(this.dbPath, `${this.dbPath}.corrupt.${Date.now()}`).catch(() => {});
        this.db = new this.SQL.Database();
      }
    } else {
      this.db = new this.SQL.Database();
      logger.info('Database', `Khởi tạo cơ sở dữ liệu SQLite mới tại ${this.dbPath}`);
    }

    this.db.run(SCHEMA_SQL);
    this._runSafeMigrations();
    this._loadOrSeedSettings();
    await this.flush();
  }

  _runSafeMigrations() {
    try {
      const cols = this.all('PRAGMA table_info(guild_game_channels)');
      if (!cols.some((c) => c.name === 'extra_channels')) {
        this.db.run(
          "ALTER TABLE guild_game_channels ADD COLUMN extra_channels TEXT NOT NULL DEFAULT '[]'"
        );
      }
    } catch {
      // Bỏ qua nếu cột đã tồn tại
    }
  }

  _loadOrSeedSettings() {
    this.settingsCache.clear();
    const existingRows = this.all('SELECT key, value FROM system_settings');
    const existingMap = new Map(existingRows.map((r) => [r.key, r.value]));

    this.transaction(() => {
      for (const [key, defaultVal] of Object.entries(DEFAULT_SYSTEM_SETTINGS)) {
        if (existingMap.has(key)) {
          try {
            const parsed = JSON.parse(existingMap.get(key));
            if (defaultVal && typeof defaultVal === 'object' && !Array.isArray(defaultVal)) {
              this.settingsCache.set(key, { ...defaultVal, ...parsed });
            } else {
              this.settingsCache.set(key, parsed);
            }
          } catch {
            this.settingsCache.set(key, structuredClone(defaultVal));
          }
        } else {
          const cloned = structuredClone(defaultVal);
          this.settingsCache.set(key, cloned);
          this.run(
            'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
            [key, JSON.stringify(cloned)]
          );
        }
      }
    });

    this.gameChannelsCache.clear();
    const chanRows = this.all(
      'SELECT guild_id, game_id, channel_id, extra_channels FROM guild_game_channels'
    );
    for (const r of chanRows) {
      let extras = [];
      try {
        extras = JSON.parse(r.extra_channels || '[]');
      } catch {
        extras = [];
      }
      const set = new Set([String(r.channel_id), ...extras.map(String)].filter(Boolean));
      this.gameChannelsCache.set(`${r.guild_id}:${r.game_id}`, {
        primary: String(r.channel_id),
        allowed: set,
      });
    }
  }

  /**
   * Gán kênh chat bắt buộc cho một trò chơi cụ thể trong máy chủ.
   */
  setGameChannel(guildId, gameId, channelId, updatedBy = '') {
    const gId = String(guildId);
    const gmId = String(gameId);
    const chId = String(channelId);
    this.gameChannelsCache.set(`${gId}:${gmId}`, {
      primary: chId,
      allowed: new Set([chId]),
    });
    this.run(
      `INSERT OR REPLACE INTO guild_game_channels (guild_id, game_id, channel_id, extra_channels, updated_by, updated_at)
       VALUES (?, ?, ?, '[]', ?, ?)`,
      [gId, gmId, chId, String(updatedBy), Date.now()]
    );
  }

  /**
   * Bổ sung thêm kênh phụ hợp lệ cho cùng một trò chơi (ví dụ nhiều phòng Nối Từ ở #nối-từ-1, #nối-từ-2).
   */
  addGameChannel(guildId, gameId, channelId, updatedBy = '') {
    const gId = String(guildId);
    const gmId = String(gameId);
    const chId = String(channelId);
    const cur = this.gameChannelsCache.get(`${gId}:${gmId}`);
    if (!cur) {
      this.setGameChannel(gId, gmId, chId, updatedBy);
      return;
    }
    cur.allowed.add(chId);
    const extras = [...cur.allowed].filter((id) => id !== cur.primary);
    this.run(
      `INSERT OR REPLACE INTO guild_game_channels (guild_id, game_id, channel_id, extra_channels, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [gId, gmId, cur.primary, JSON.stringify(extras), String(updatedBy), Date.now()]
    );
  }

  /**
   * Gỡ cấu hình kênh của một trò chơi trong máy chủ.
   */
  clearGameChannel(guildId, gameId) {
    const gId = String(guildId);
    const gmId = String(gameId);
    this.gameChannelsCache.delete(`${gId}:${gmId}`);
    this.run(
      'DELETE FROM guild_game_channels WHERE guild_id = ? AND game_id = ?',
      [gId, gmId]
    );
  }

  /**
   * Tra cứu O(1) kênh chính đã chỉ định cho `gameId` tại `guildId` (trả về `null` nếu chưa gán).
   */
  getGameChannel(guildId, gameId) {
    if (!guildId || !gameId) return null;
    return this.gameChannelsCache.get(`${guildId}:${gameId}`)?.primary ?? null;
  }

  /**
   * Lấy danh sách tất cả ID kênh được phép chơi `gameId` tại `guildId`.
   */
  getAllowedGameChannels(guildId, gameId) {
    if (!guildId || !gameId) return [];
    const entry = this.gameChannelsCache.get(`${guildId}:${gameId}`);
    return entry ? [...entry.allowed] : [];
  }

  /**
   * Kiểm tra O(1) xem `channelId` (hoặc Thread con có `parentChannelId`) có phải kênh hợp lệ của `gameId` không.
   */
  isAllowedGameChannel(guildId, gameId, channelId, parentChannelId = null) {
    const entry = this.gameChannelsCache.get(`${guildId}:${gameId}`);
    if (!entry) return false;
    if (channelId && entry.allowed.has(String(channelId))) return true;
    if (parentChannelId && entry.allowed.has(String(parentChannelId))) return true;
    return false;
  }

  /**
   * Lấy toàn bộ bản đồ `gameId -> channelId` (hoặc danh sách kênh) của một máy chủ.
   */
  getGuildGameChannels(guildId) {
    const out = {};
    const prefix = `${guildId}:`;
    for (const [k, entry] of this.gameChannelsCache.entries()) {
      if (k.startsWith(prefix)) {
        out[k.slice(prefix.length)] = entry.primary;
      }
    }
    return out;
  }

  /**
   * Đọc một thiết lập hệ thống từ bộ đệm O(1).
   * @param {string} key
   * @returns {any}
   */
  getSetting(key) {
    if (this.settingsCache.has(key)) {
      return this.settingsCache.get(key);
    }
    return DEFAULT_SYSTEM_SETTINGS[key];
  }

  /**
   * Cập nhật thiết lập hệ thống và lưu bền vững vào SQLite.
   * @param {string} key
   * @param {any} value
   */
  setSetting(key, value) {
    this.settingsCache.set(key, value);
    this.run('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
      key,
      JSON.stringify(value),
    ]);
  }

  /**
   * Lấy toàn bộ bản chụp cấu hình hệ thống hiện hành.
   * @returns {object}
   */
  getAllSettings() {
    const out = {};
    for (const [k, v] of this.settingsCache.entries()) {
      out[k] = v;
    }
    return out;
  }

  /**
   * Thực thi câu lệnh ghi SQL (`INSERT`, `UPDATE`, `DELETE`).
   * @param {string} sql
   * @param {any[]} [params=[]]
   */
  run(sql, params = []) {
    this.db.run(sql, params);
    this._scheduleFlush();
  }

  /**
   * Truy vấn 1 dòng dữ liệu duy nhất dạng Object.
   * @param {string} sql
   * @param {any[]} [params=[]]
   * @returns {Record<string, any> | null}
   */
  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /**
   * Truy vấn nhiều dòng dữ liệu dạng mảng Object.
   * @param {string} sql
   * @param {any[]} [params=[]]
   * @returns {Array<Record<string, any>>}
   */
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  /**
   * Thực thi hàm bên trong Transaction ACID đồng bộ (hỗ trợ Savepoint khi lồng nhau).
   * Đảm bảo không bao giờ xảy ra lệch số dư hoặc trừ tiền hai lần.
   *
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  transaction(fn) {
    const depth = this._txDepth;
    const spName = `sp_${depth}`;
    this._txDepth += 1;

    if (depth === 0) {
      this.db.run('BEGIN TRANSACTION');
    } else {
      this.db.run(`SAVEPOINT ${spName}`);
    }

    try {
      const result = fn();
      if (depth === 0) {
        this.db.run('COMMIT');
      } else {
        this.db.run(`RELEASE SAVEPOINT ${spName}`);
      }
      this._scheduleFlush();
      return result;
    } catch (err) {
      try {
        if (depth === 0) {
          this.db.run('ROLLBACK');
        } else {
          this.db.run(`ROLLBACK TO SAVEPOINT ${spName}`);
          this.db.run(`RELEASE SAVEPOINT ${spName}`);
        }
      } catch {
        // Bỏ qua lỗi rollback phụ
      }
      throw err;
    } finally {
      this._txDepth -= 1;
    }
  }

  // ==========================================================================
  // Quản lý Phân quyền Nhân sự (ADMIN / MODERATOR)
  // ==========================================================================

  getStaffRole(userId) {
    const row = this.get('SELECT role FROM staff_roles WHERE user_id = ?', [String(userId)]);
    return row ? row.role : null;
  }

  listStaffRoles() {
    return this.all('SELECT user_id, role, granted_by, created_at FROM staff_roles ORDER BY role ASC, created_at ASC');
  }

  setStaffRole(userId, role, grantedBy) {
    if (role === null || role === 'MEMBER') {
      this.run('DELETE FROM staff_roles WHERE user_id = ?', [String(userId)]);
      return;
    }
    if (role !== 'ADMIN' && role !== 'MODERATOR') {
      throw new Error('Vai trò nhân sự chỉ nhận ADMIN hoặc MODERATOR.');
    }
    this.run(
      `INSERT INTO staff_roles (user_id, role, granted_by, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, created_at = excluded.created_at`,
      [String(userId), role, String(grantedBy), Date.now()]
    );
  }

  revokeAllAdmins() {
    this.run("DELETE FROM staff_roles WHERE role = 'ADMIN'");
  }

  // ==========================================================================
  // Nhật ký kiểm toán (Audit Log)
  // ==========================================================================

  recordAudit({ actorId, actorRole, action, targetId = null, details = '' }) {
    this.run(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [String(actorId), String(actorRole), String(action), targetId ? String(targetId) : null, String(details), Date.now()]
    );
  }

  getAuditLogs(limit = 15, onlyAdmins = false) {
    const safeLimit = Math.max(1, Math.min(50, limit));
    if (onlyAdmins) {
      return this.all(
        "SELECT * FROM audit_logs WHERE actor_role = 'ADMIN' ORDER BY id DESC LIMIT ?",
        [safeLimit]
      );
    }
    return this.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [safeLimit]);
  }

  // ==========================================================================
  // Lưu đĩa nguyên tử, Sao lưu (Backup) & Khôi phục (Restore)
  // ==========================================================================

  _scheduleFlush() {
    this._dirty = true;
    if (this._flushTimer) return;

    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush().catch((err) => {
        logger.error('Database', 'Lỗi lưu SQLite xuống đĩa', err);
      });
    }, 300);

    if (typeof this._flushTimer.unref === 'function') {
      this._flushTimer.unref();
    }
  }

  async flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty || !this.db) return this._writeChain;

    this._dirty = false;
    const binaryArray = this.db.export();
    const buffer = Buffer.from(binaryArray);

    this._writeChain = this._writeChain.then(async () => {
      await fsp.mkdir(this.dataDir, { recursive: true });
      const tmpPath = `${this.dbPath}.${process.pid}.tmp`;
      await fsp.writeFile(tmpPath, buffer);
      await fsp.rename(tmpPath, this.dbPath);
    });

    return this._writeChain;
  }

  /**
   * Tạo tệp sao lưu `.sqlite` trong `data/backups/` (giữ tối đa 5 bản mới nhất để tiết kiệm dung lượng gói Free).
   * @returns {Promise<{ filename: string, fullPath: string, sizeBytes: number }>}
   */
  async createBackup() {
    await this.flush();
    await fsp.mkdir(this.backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${stamp}.sqlite`;
    const fullPath = path.join(this.backupDir, filename);

    const binaryArray = this.db.export();
    const buffer = Buffer.from(binaryArray);
    await fsp.writeFile(fullPath, buffer);

    // Tự động dọn các bản sao lưu cũ quá 5 tệp để bảo vệ 1GB Disk của BotKeep Free
    const files = (await fsp.readdir(this.backupDir))
      .filter((f) => f.endsWith('.sqlite'))
      .sort()
      .reverse();

    for (const oldFile of files.slice(5)) {
      await fsp.unlink(path.join(this.backupDir, oldFile)).catch(() => {});
    }

    return { filename, fullPath, sizeBytes: buffer.length };
  }

  async listBackups() {
    await fsp.mkdir(this.backupDir, { recursive: true });
    const files = (await fsp.readdir(this.backupDir))
      .filter((f) => f.endsWith('.sqlite'))
      .sort()
      .reverse();
    return files;
  }

  /**
   * Khôi phục dữ liệu toàn hệ thống từ một tệp sao lưu `.sqlite`.
   * @param {string} filename
   */
  async restoreBackup(filename) {
    const cleanName = path.basename(filename);
    const fullPath = path.join(this.backupDir, cleanName);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Không tìm thấy bản sao lưu: ${cleanName}`);
    }

    const buf = await fsp.readFile(fullPath);
    const restoredDb = new this.SQL.Database(new Uint8Array(buf));
    // Kiểm tra tính toàn vẹn bảng cốt lõi trước khi hoán đổi
    restoredDb.exec('SELECT count(*) FROM users; SELECT count(*) FROM system_settings;');

    const prevDb = this.db;
    this.db = restoredDb;
    if (prevDb) {
      try {
        prevDb.close();
      } catch {
        // Bỏ qua
      }
    }

    this.db.run(SCHEMA_SQL);
    this._runSafeMigrations();
    this._loadOrSeedSettings();
    this._dirty = true;
    await this.flush();
    return cleanName;
  }

  /**
   * Cắt gọn các bản ghi lịch sử quá cũ để giữ RAM thấp ổn định lâu dài.
   */
  pruneOldHistory() {
    this.transaction(() => {
      this.run(
        `DELETE FROM transactions WHERE id NOT IN (
           SELECT id FROM transactions ORDER BY id DESC LIMIT 8000
         )`
      );
      this.run(
        `DELETE FROM game_logs WHERE id NOT IN (
           SELECT id FROM game_logs ORDER BY id DESC LIMIT 8000
         )`
      );
      this.run(
        `DELETE FROM audit_logs WHERE id NOT IN (
           SELECT id FROM audit_logs ORDER BY id DESC LIMIT 2000
         )`
      );
      this.run(
        `DELETE FROM noitu_matches WHERE id NOT IN (
           SELECT id FROM noitu_matches ORDER BY id DESC LIMIT 3000
         )`
      );
      this.run(
        `DELETE FROM noitu_rooms WHERE status NOT IN ('waiting', 'playing') AND room_id NOT IN (
           SELECT room_id FROM noitu_rooms WHERE status NOT IN ('waiting', 'playing') ORDER BY created_at DESC LIMIT 3000
         )`
      );
    });
  }

  async close() {
    await this.flush();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
