import { EmbedBuilder } from 'discord.js';
import { redactSecrets, logger } from '../utils/logger.js';
import { canBotSendEmbed } from '../utils/permissions.js';

const CATEGORY_META = Object.freeze({
  economy: { title: '💰 Nhật Ký Giao Dịch VNĐ', color: 0x2ecc71 },
  game: { title: '🎲 Nhật Ký Trò Chơi', color: 0x9b59b6 },
  admin: { title: '🛡️ Nhật Ký Quản Trị', color: 0xe67e22 },
  anticheat: { title: '🚨 Cảnh Báo Chống Gian Lận', color: 0xe74c3c },
  quest: { title: '📜 Nhật Ký Nhiệm Vụ', color: 0x3498db },
  event: { title: '🎉 Nhật Ký Sự Kiện', color: 0xf1c40f },
  error: { title: '⚠️ Nhật Ký Lỗi Hệ Thống', color: 0xc0392b },
});

/**
 * Hệ thống ghi Log đa kênh lên Discord (7 loại kênh riêng biệt do OWNER cấu hình).
 * Mọi thông tin gửi đi đều được lọc qua `redactSecrets` để tuyệt đối không lộ Token.
 */
export class LogSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   */
  constructor({ db }) {
    this.db = db;
    this.client = null;
  }

  attachClient(client) {
    this.client = client;
  }

  /**
   * Đặt kênh nhận log cho một danh mục cụ thể.
   * @param {string} category
   * @param {string | null} channelId
   */
  setLogChannel(category, channelId) {
    if (!CATEGORY_META[category]) {
      throw new Error(`Danh mục log không hợp lệ: ${category}`);
    }
    const current = { ...(this.db.getSetting('logChannels') || {}) };
    current[category] = channelId || null;
    this.db.setSetting('logChannels', current);
    return current;
  }

  /**
   * Gửi thông báo log không chặn luồng chính (fire-and-forget an toàn).
   * @param {keyof typeof CATEGORY_META} category
   * @param {string} description
   * @param {Array<{ name: string, value: string, inline?: boolean }>} [fields=[]]
   */
  async send(category, description, fields = []) {
    try {
      if (!this.client?.isReady?.()) return;
      const channels = this.db.getSetting('logChannels') || {};
      const channelId = channels[category];
      if (!channelId) return;

      let channel = this.client.channels?.cache?.get(channelId) ?? null;
      if (!channel && typeof this.client.channels?.fetch === 'function') {
        channel = await this.client.channels.fetch(channelId).catch(() => null);
      }
      if (!channel) return;

      const me = channel.guild?.members?.me ?? null;
      if (me && !canBotSendEmbed(channel, me)) return;

      const meta = CATEGORY_META[category] ?? CATEGORY_META.admin;
      const embed = new EmbedBuilder()
        .setColor(meta.color)
        .setTitle(meta.title)
        .setDescription(redactSecrets(description).slice(0, 3800))
        .setTimestamp();

      if (fields.length > 0) {
        embed.addFields(
          fields.slice(0, 10).map((f) => ({
            name: redactSecrets(f.name).slice(0, 250),
            value: redactSecrets(f.value).slice(0, 1000),
            inline: Boolean(f.inline),
          }))
        );
      }

      await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      logger.warn('LogSystem', `Không thể gửi log [${category}]: ${err.message}`);
    }
  }
}
