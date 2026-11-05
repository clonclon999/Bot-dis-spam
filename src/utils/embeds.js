import { EmbedBuilder } from 'discord.js';
import { ESCALATION_LADDER, SYSTEM_LIMITS, VIOLATION_TYPES } from '../config/defaults.js';

export const COLORS = Object.freeze({
  SUCCESS: 0x2ecc71,
  WARNING: 0xf39c12,
  DANGER: 0xe74c3c,
  INFO: 0x3498db,
  PRIMARY: 0x5865f2,
  GOLD: 0xf1c40f,
  MUTED: 0x95a5a6,
});

const VIOLATION_LABELS = Object.freeze({
  [VIOLATION_TYPES.EVERYONE_HERE]: 'Spam ping @everyone / @here trái phép',
  [VIOLATION_TYPES.MASS_MENTION_SINGLE]: 'Mention quá nhiều thành viên/vai trò trong một tin nhắn',
  [VIOLATION_TYPES.MENTION_BURST_WINDOW]: 'Mention dồn dập vượt ngưỡng trong thời gian ngắn',
  [VIOLATION_TYPES.REPEATED_MENTION_MESSAGES]: 'Spam mention lặp đi lặp lại qua nhiều tin nhắn liên tiếp',
  [VIOLATION_TYPES.REPEATED_TARGET_HARASSMENT]: 'Mention quấy rối lặp lại cùng một mục tiêu liên tiếp',
});

/**
 * Định dạng thời lượng giây sang tiếng Việt dễ đọc.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDurationVi(seconds) {
  if (!seconds || seconds <= 0) return 'Không áp dụng';
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin > 0 ? `${hours} giờ ${remMin} phút` : `${hours} giờ`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} ngày ${remHours} giờ` : `${days} ngày`;
}

/**
 * Làm sạch nội dung vi phạm để hiển thị an toàn trong Embed (không kích hoạt mention, không vỡ khối mã).
 * @param {string} rawContent
 * @param {number} [maxLen]
 * @returns {string}
 */
export function sanitizeContentPreview(
  rawContent,
  maxLen = SYSTEM_LIMITS.CONTENT_PREVIEW_MAX_LENGTH
) {
  if (!rawContent || typeof rawContent !== 'string') {
    return '(Không có nội dung văn bản)';
  }
  const escaped = rawContent
    .replace(/`/g, 'ˋ')
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere')
    .replace(/\s+/g, ' ')
    .trim();

  if (!escaped) return '(Nội dung trống)';
  if (escaped.length <= maxLen) return escaped;
  return `${escaped.slice(0, maxLen - 3)}...`;
}

/**
 * Chuyển mã loại vi phạm sang mô tả tiếng Việt rõ ràng.
 * @param {string} type
 * @returns {string}
 */
export function getViolationLabel(type) {
  return VIOLATION_LABELS[type] ?? 'Vi phạm quy tắc chống spam mention';
}

/**
 * Tạo Embed thông báo cảnh cáo ngắn gọn tại kênh chat (tự xóa sau vài giây, tránh làm phiền).
 */
export function buildUserWarningEmbed({
  user,
  violation,
  strikeLevel,
  timeoutSeconds,
  autoDeleteSeconds,
}) {
  const isTimedOut = timeoutSeconds > 0;
  const embed = new EmbedBuilder()
    .setColor(isTimedOut ? COLORS.DANGER : COLORS.WARNING)
    .setTitle(
      isTimedOut
        ? '🚫 Phát hiện Spam Mention — Đã áp dụng Timeout'
        : '⚠️ Cảnh cáo Vi phạm Spam Mention'
    )
    .setDescription(
      `${user}, tin nhắn của bạn vừa bị xóa tự động bởi hệ thống chống spam.\n` +
        `**Lý do:** ${violation.reason}`
    )
    .addFields(
      {
        name: '📌 Loại vi phạm',
        value: getViolationLabel(violation.type),
        inline: true,
      },
      {
        name: '⚖️ Mức độ xử lý',
        value: isTimedOut
          ? `Mức ${strikeLevel} — Timeout **${formatDurationVi(timeoutSeconds)}**`
          : `Mức ${strikeLevel} — Cảnh cáo nhắc nhở`,
        inline: true,
      }
    )
    .setTimestamp();

  if (autoDeleteSeconds > 0) {
    embed.setFooter({
      text: `Thông báo này tự động thu hồi sau ${autoDeleteSeconds} giây để giữ sạch kênh chat.`,
    });
  } else {
    embed.setFooter({ text: 'Hệ thống Chống Spam Mention Tự Động' });
  }

  return embed;
}

/**
 * Tạo Embed chi tiết gửi vào kênh Log quản trị.
 */
export function buildModLogEmbed({
  user,
  channelId,
  violation,
  contentPreview,
  strikeLevel,
  actions,
  timestampIso,
}) {
  const isTimeout = actions.timeoutApplied;
  const actionLines = [
    actions.messageDeleted ? '✅ Đã xóa tin nhắn vi phạm' : '⚠️ Chưa xóa được tin nhắn (thiếu quyền hoặc đã bị xóa)',
    actions.warningSent ? '✅ Đã gửi cảnh cáo' : 'ℹ️ Bỏ qua gửi lặp cảnh cáo (chống tràn thông báo)',
    actions.timeoutApplied
      ? `🔇 Đã Timeout **${formatDurationVi(actions.timeoutSeconds)}**`
      : actions.timeoutSkippedReason
        ? `⚠️ Không thể Timeout: ${actions.timeoutSkippedReason}`
        : '📝 Chưa áp dụng Timeout (mức cảnh cáo đầu)',
  ];

  const unixTs = Math.floor(new Date(timestampIso || Date.now()).getTime() / 1000);

  return new EmbedBuilder()
    .setColor(isTimeout ? COLORS.DANGER : COLORS.WARNING)
    .setAuthor({
      name: `${user.tag || user.username} (${user.id})`,
      iconURL: typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : undefined,
    })
    .setTitle('🛡️ Nhật ký Xử lý Spam @Mention')
    .addFields(
      {
        name: '👤 Người vi phạm',
        value: `<@${user.id}> (\`${user.id}\`)`,
        inline: true,
      },
      {
        name: '💬 Kênh xảy ra',
        value: `<#${channelId}>`,
        inline: true,
      },
      {
        name: '🕒 Thời gian',
        value: `<t:${unixTs}:F> (<t:${unixTs}:R>)`,
        inline: false,
      },
      {
        name: '🚨 Hành vi & Lý do',
        value: `**${getViolationLabel(violation.type)}**\n${violation.reason}`,
        inline: false,
      },
      {
        name: '📝 Nội dung vi phạm (đã làm sạch)',
        value: `\`\`\`\n${sanitizeContentPreview(contentPreview)}\n\`\`\``,
        inline: false,
      },
      {
        name: `⚖️ Hành động thực hiện (Vi phạm mức ${strikeLevel})`,
        value: actionLines.join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: `Anti-Spam Audit Log • Mention Count: ${violation.mentionCount ?? 0}` })
    .setTimestamp(new Date(timestampIso || Date.now()));
}

/**
 * Tạo Embed hiển thị trạng thái tổng quan cho `/antispam status` và `/antispam config`.
 */
export function buildStatusEmbed({
  guild,
  config,
  botPerms,
  runtimeStats,
  title = '🛡️ Trạng thái Hệ thống Chống Spam @Mention',
}) {
  const permBadge = (ok) => (ok ? '✅' : '❌');
  const ladderText = ESCALATION_LADDER.map((step) => `• ${step.label}`).join('\n');

  const embed = new EmbedBuilder()
    .setColor(config.enabled ? COLORS.SUCCESS : COLORS.MUTED)
    .setTitle(title)
    .setDescription(
      `Máy chủ: **${guild.name}**\n` +
        `Trạng thái bảo vệ: ${config.enabled ? '🟢 **ĐANG BẬT**' : '🔴 **ĐANG TẮT**'}`
    )
    .addFields(
      {
        name: '⚙️ Giới hạn Mention',
        value: [
          `• Tối đa / 1 tin nhắn: **${config.maxMentionsPerMessage}** mention`,
          `• Tối đa / khoảng ngắn: **${config.maxMentionsWindow}** mention / **${config.timeWindowSeconds}s**`,
          `• Tin nhắn lặp mention: **${config.maxRepeatMessages}** tin / **${config.repeatWindowSeconds}s**`,
          `• Lặp cùng 1 mục tiêu: **${config.maxSameTargetMessages}** tin / **${config.repeatWindowSeconds}s**`,
          `• Chặn \`@everyone\` / \`@here\`: **${config.blockEveryoneHere ? 'Bật' : 'Tắt'}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🔧 Vận hành & Miễn trừ',
        value: [
          `• Kênh Log: ${config.logChannelId ? `<#${config.logChannelId}>` : '*Chưa cấu hình*'}`,
          `• Reset mức phạt sau: **${config.strikeResetMinutes} phút**`,
          `• Tự xóa cảnh cáo sau: **${config.autoDeleteWarnSeconds > 0 ? `${config.autoDeleteWarnSeconds}s` : 'Không tự xóa'}**`,
          `• Miễn trừ tùy chỉnh: **${config.whitelistRoles.length}** vai trò, **${config.whitelistUsers.length}** thành viên, **${config.whitelistChannels.length}** kênh`,
          `• Miễn trừ mặc định: **Owner, Admin, Moderator**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📈 Thang xử phạt tự động theo mức độ',
        value: ladderText,
        inline: false,
      },
      {
        name: '🔑 Kiểm tra Quyền của Bot',
        value: [
          `${permBadge(botPerms.ViewChannel)} Xem kênh`,
          `${permBadge(botPerms.SendMessages)} Gửi tin`,
          `${permBadge(botPerms.EmbedLinks)} Nhúng Embed`,
          `${permBadge(botPerms.ManageMessages)} Xóa tin nhắn`,
          `${permBadge(botPerms.ModerateMembers)} Timeout thành viên`,
        ].join('  |  '),
        inline: false,
      }
    )
    .setTimestamp();

  if (runtimeStats) {
    embed.addFields({
      name: '💻 Hiệu suất & Thống kê',
      value: [
        `• Đã chặn: **${config.stats?.totalViolations ?? 0}** vi phạm (Xóa: **${config.stats?.deletedMessages ?? 0}** | Timeout: **${config.stats?.timeoutsIssued ?? 0}**)`,
        `• RAM sử dụng: **${runtimeStats.heapUsedMb} MB** (RSS: ${runtimeStats.rssMb} MB) | Ping: **${runtimeStats.pingMs} ms**`,
        `• Bộ nhớ theo dõi tạm: **${runtimeStats.trackedUsers}** phiên hoạt động | Uptime: **${formatDurationVi(runtimeStats.uptimeSeconds)}**`,
      ].join('\n'),
      inline: false,
    });
  }

  return embed;
}

/**
 * Tạo Embed thông báo phản hồi chuẩn cho các lệnh quản trị.
 */
export function buildFeedbackEmbed({ color = COLORS.PRIMARY, title, description, fields = [] }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }
  return embed;
}

export function errorEmbed(title, description) {
  return buildFeedbackEmbed({
    color: COLORS.DANGER,
    title: `❌ ${title}`,
    description,
  });
}
