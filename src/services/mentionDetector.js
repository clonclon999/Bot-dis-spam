import { SYSTEM_LIMITS, VIOLATION_TYPES } from '../config/defaults.js';

const CODE_BLOCK_REGEX = /```[\s\S]*?```|`[^`\n]+`/g;
const EVERYONE_HERE_REGEX = /(?:^|[^\w])@(?:everyone|here)\b/i;
const USER_MENTION_REGEX = /<@!?(\d{15,22})>/g;
const ROLE_MENTION_REGEX = /<@&(\d{15,22})>/g;

/**
 * Loại bỏ các đoạn mã (code block & inline code) để tránh bắt nhầm khi thành viên
 * thảo luận kỹ thuật hoặc trích dẫn cú pháp như `@everyone`.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripCodeSegments(content) {
  if (!content || typeof content !== 'string') return '';
  return content.replace(CODE_BLOCK_REGEX, ' ');
}

/**
 * Phân tích chi tiết các mention tường minh trong nội dung tin nhắn.
 * - Tự động bỏ qua mention ngầm định khi dùng tính năng "Reply" của Discord (tránh xử phạt nhầm).
 * - Đếm chính xác cả trường hợp spam lặp 1 người nhiều lần trong cùng 1 tin nhắn (`@A @A @A @A @A @A`).
 * - Bỏ qua tự mention chính mình (`authorId`).
 *
 * @param {object} params
 * @param {string} params.content
 * @param {string} params.authorId
 * @param {boolean} [params.mentionsEveryoneFlag=false]
 * @returns {{
 *   hasEveryoneOrHere: boolean,
 *   userMentionIds: string[],
 *   roleMentionIds: string[],
 *   uniqueTargets: string[],
 *   totalExplicitMentions: number
 * }}
 */
export function parseExplicitMentions({
  content,
  authorId,
  mentionsEveryoneFlag = false,
}) {
  const stripped = stripCodeSegments(content);
  const hasEveryoneOrHere =
    Boolean(mentionsEveryoneFlag) || EVERYONE_HERE_REGEX.test(stripped);

  const userMentionIds = [];
  for (const match of stripped.matchAll(USER_MENTION_REGEX)) {
    const targetId = match[1];
    if (targetId !== authorId) {
      userMentionIds.push(targetId);
    }
  }

  const roleMentionIds = [];
  for (const match of stripped.matchAll(ROLE_MENTION_REGEX)) {
    roleMentionIds.push(match[1]);
  }

  const uniqueTargets = [
    ...new Set([
      ...userMentionIds.map((id) => `u:${id}`),
      ...roleMentionIds.map((id) => `r:${id}`),
    ]),
  ];

  return {
    hasEveryoneOrHere,
    userMentionIds,
    roleMentionIds,
    uniqueTargets,
    totalExplicitMentions: userMentionIds.length + roleMentionIds.length,
  };
}

/**
 * Bộ máy phát hiện hành vi spam @mention theo thời gian thực với cơ chế cửa sổ trượt (Sliding Window).
 * Tối ưu RAM bằng cách chỉ lưu dấu thời gian & số lượng gọn nhẹ và tự động thu gom rác định kỳ.
 */
export class MentionDetector {
  constructor() {
    /**
     * Khóa: `${guildId}:${userId}`
     * Giá trị: `{ events: Array<{ ts: number, count: number, targets: string[], messageId: string }>, lastSeen: number }`
     * @type {Map<string, { events: Array<{ ts: number, count: number, targets: string[], messageId: string }>, lastSeen: number }>}
     */
    this.userTrackers = new Map();
  }

  /**
   * Kiểm tra một tin nhắn mới và trả về thông tin vi phạm (nếu có).
   *
   * @param {import('discord.js').Message} message
   * @param {object} config - Cấu hình chống spam của máy chủ
   * @param {number} [now=Date.now()] - Mốc thời gian hiện tại (hỗ trợ kiểm thử đơn vị chính xác)
   * @returns {object | null} Đối tượng vi phạm hoặc `null` nếu hợp lệ
   */
  inspectMessage(message, config, now = Date.now()) {
    if (!config?.enabled) return null;

    const guildId = message.guild?.id ?? message.guildId;
    const authorId = message.author?.id;
    if (!guildId || !authorId) return null;

    const parsed = parseExplicitMentions({
      content: message.content ?? '',
      authorId,
      mentionsEveryoneFlag: Boolean(message.mentions?.everyone),
    });

    // Nếu người dùng tắt ignoreImplicitReplies thì cộng thêm mention từ Reply ngầm định (nếu có)
    if (!config.ignoreImplicitReplies && message.mentions?.repliedUser) {
      const repliedId = message.mentions.repliedUser.id;
      if (
        repliedId &&
        repliedId !== authorId &&
        !parsed.userMentionIds.includes(repliedId)
      ) {
        parsed.userMentionIds.push(repliedId);
        parsed.uniqueTargets.push(`u:${repliedId}`);
        parsed.totalExplicitMentions += 1;
      }
    }

    return this._evaluateParsedMentions({
      guildId,
      authorId,
      messageId: message.id,
      parsed,
      config,
      now,
    });
  }

  /**
   * Kiểm tra trường hợp lách luật bằng cách chỉnh sửa (edit) tin nhắn cũ để chèn thêm hàng loạt mention.
   * Chỉ tính phần mention MỚI tăng thêm so với tin nhắn trước khi sửa để không bắt nhầm sửa lỗi chính tả.
   *
   * @param {import('discord.js').Message | import('discord.js').PartialMessage | null} oldMessage
   * @param {import('discord.js').Message} newMessage
   * @param {object} config
   * @param {number} [now=Date.now()]
   * @returns {object | null}
   */
  inspectEditedMessage(oldMessage, newMessage, config, now = Date.now()) {
    if (!config?.enabled) return null;

    const guildId = newMessage.guild?.id ?? newMessage.guildId;
    const authorId = newMessage.author?.id;
    if (!guildId || !authorId) return null;

    const oldParsed = oldMessage?.content
      ? parseExplicitMentions({
          content: oldMessage.content,
          authorId,
          mentionsEveryoneFlag: Boolean(oldMessage.mentions?.everyone),
        })
      : {
          hasEveryoneOrHere: false,
          userMentionIds: [],
          roleMentionIds: [],
          uniqueTargets: [],
          totalExplicitMentions: 0,
        };

    const newParsed = parseExplicitMentions({
      content: newMessage.content ?? '',
      authorId,
      mentionsEveryoneFlag: Boolean(newMessage.mentions?.everyone),
    });

    const newlyAddedEveryone = !oldParsed.hasEveryoneOrHere && newParsed.hasEveryoneOrHere;
    const addedCount = Math.max(
      0,
      newParsed.totalExplicitMentions - oldParsed.totalExplicitMentions
    );

    if (!newlyAddedEveryone && addedCount === 0) {
      return null;
    }

    // Kiểm tra tổng mention của tin nhắn sau khi sửa cho giới hạn 1 tin nhắn,
    // nhưng chỉ ghi nhận số lượng tăng thêm vào cửa sổ trượt.
    if (config.blockEveryoneHere && newlyAddedEveryone) {
      return {
        type: VIOLATION_TYPES.EVERYONE_HERE,
        severity: 'critical',
        mentionCount: Math.max(1, newParsed.totalExplicitMentions),
        reason: 'Chỉnh sửa tin nhắn để chèn mention @everyone / @here trái phép.',
      };
    }

    if (newParsed.totalExplicitMentions > config.maxMentionsPerMessage) {
      const isCritical =
        newParsed.totalExplicitMentions >= config.maxMentionsPerMessage * 2;
      return {
        type: VIOLATION_TYPES.MASS_MENTION_SINGLE,
        severity: isCritical ? 'critical' : 'normal',
        mentionCount: newParsed.totalExplicitMentions,
        reason: `Chỉnh sửa tin nhắn chứa ${newParsed.totalExplicitMentions} mention (vượt giới hạn tối đa ${config.maxMentionsPerMessage} mention/tin nhắn).`,
      };
    }

    const deltaTargets = newParsed.uniqueTargets.filter(
      (t) => !oldParsed.uniqueTargets.includes(t)
    );

    return this._evaluateParsedMentions({
      guildId,
      authorId,
      messageId: `${newMessage.id}:edit`,
      parsed: {
        hasEveryoneOrHere: false,
        userMentionIds: [],
        roleMentionIds: [],
        uniqueTargets: deltaTargets.length > 0 ? deltaTargets : newParsed.uniqueTargets,
        totalExplicitMentions: addedCount,
      },
      config,
      now,
    });
  }

  /**
   * Đánh giá các quy tắc phát hiện spam từ kết quả phân tích mention.
   */
  _evaluateParsedMentions({ guildId, authorId, messageId, parsed, config, now }) {
    // 1. Phát hiện @everyone và @here
    if (config.blockEveryoneHere && parsed.hasEveryoneOrHere) {
      return {
        type: VIOLATION_TYPES.EVERYONE_HERE,
        severity: 'critical',
        mentionCount: Math.max(1, parsed.totalExplicitMentions),
        reason: 'Sử dụng @everyone hoặc @here trái phép gây làm phiền toàn máy chủ.',
      };
    }

    // Không có bất kỳ mention nào -> hợp lệ ngay lập tức, không tốn bộ nhớ lưu trữ
    if (parsed.totalExplicitMentions === 0) {
      return null;
    }

    // Cập nhật bộ theo dõi cửa sổ trượt cho thành viên này
    const key = `${guildId}:${authorId}`;
    const maxRetentionMs =
      Math.max(config.timeWindowSeconds, config.repeatWindowSeconds) * 1000;
    const cutoffAll = now - maxRetentionMs;

    let tracker = this.userTrackers.get(key);
    if (!tracker) {
      if (this.userTrackers.size >= SYSTEM_LIMITS.MAX_TRACKED_USERS_PER_GUILD * 5) {
        this.sweepExpired(now, maxRetentionMs);
      }
      tracker = { events: [], lastSeen: now };
      this.userTrackers.set(key, tracker);
    }

    tracker.events = tracker.events.filter((ev) => ev.ts > cutoffAll);
    tracker.events.push({
      ts: now,
      count: parsed.totalExplicitMentions,
      targets: parsed.uniqueTargets,
      messageId,
    });
    tracker.lastSeen = now;

    // 2. Phát hiện mention quá nhiều thành viên/vai trò trong CÙNG MỘT tin nhắn
    if (parsed.totalExplicitMentions > config.maxMentionsPerMessage) {
      const isCritical =
        parsed.totalExplicitMentions >= config.maxMentionsPerMessage * 2;
      return {
        type: VIOLATION_TYPES.MASS_MENTION_SINGLE,
        severity: isCritical ? 'critical' : 'normal',
        mentionCount: parsed.totalExplicitMentions,
        reason: `Mention ${parsed.totalExplicitMentions} lần trong một tin nhắn (vượt giới hạn tối đa ${config.maxMentionsPerMessage}).`,
      };
    }

    // 3. Phát hiện mention quá nhiều thành viên trong THỜI GIAN NGẮN (Sliding Window Burst)
    const burstCutoff = now - config.timeWindowSeconds * 1000;
    let mentionsInWindow = 0;
    for (const ev of tracker.events) {
      if (ev.ts > burstCutoff) {
        mentionsInWindow += ev.count;
      }
    }

    if (mentionsInWindow > config.maxMentionsWindow) {
      const isCritical = mentionsInWindow >= config.maxMentionsWindow * 2;
      return {
        type: VIOLATION_TYPES.MENTION_BURST_WINDOW,
        severity: isCritical ? 'critical' : 'normal',
        mentionCount: mentionsInWindow,
        reason: `Mention tổng cộng ${mentionsInWindow} lần chỉ trong ${config.timeWindowSeconds} giây (giới hạn tối đa: ${config.maxMentionsWindow}).`,
      };
    }

    // 4. Phát hiện spam mention lặp lại CÙNG MỘT MỤC TIÊU trong nhiều tin nhắn
    const repeatCutoff = now - config.repeatWindowSeconds * 1000;
    const recentRepeatEvents = tracker.events.filter((ev) => ev.ts > repeatCutoff);

    const targetMessageCounts = new Map();
    for (const ev of recentRepeatEvents) {
      for (const target of ev.targets) {
        targetMessageCounts.set(target, (targetMessageCounts.get(target) ?? 0) + 1);
      }
    }

    for (const [, msgCount] of targetMessageCounts.entries()) {
      if (msgCount > config.maxSameTargetMessages) {
        return {
          type: VIOLATION_TYPES.REPEATED_TARGET_HARASSMENT,
          severity: 'normal',
          mentionCount: msgCount,
          reason: `Lặp lại hành vi mention cùng một thành viên/vai trò qua ${msgCount} tin nhắn liên tiếp trong ${config.repeatWindowSeconds} giây (tối đa: ${config.maxSameTargetMessages} tin).`,
        };
      }
    }

    // 5. Phát hiện gửi liên tiếp nhiều tin nhắn chứa mention (Multi-message Mention Spam)
    if (recentRepeatEvents.length > config.maxRepeatMessages) {
      return {
        type: VIOLATION_TYPES.REPEATED_MENTION_MESSAGES,
        severity: 'normal',
        mentionCount: recentRepeatEvents.length,
        reason: `Gửi liên tiếp ${recentRepeatEvents.length} tin nhắn có chứa mention trong ${config.repeatWindowSeconds} giây (tối đa: ${config.maxRepeatMessages} tin).`,
      };
    }

    return null;
  }

  /**
   * Xóa dữ liệu cửa sổ trượt của một thành viên (ví dụ sau khi quản trị viên reset hoặc sau xử phạt).
   * @param {string} guildId
   * @param {string} userId
   */
  clearUserWindow(guildId, userId) {
    this.userTrackers.delete(`${guildId}:${userId}`);
  }

  /**
   * Thu gom rác định kỳ để giải phóng bộ nhớ RAM cho các phiên không còn hoạt động.
   * @param {number} [now=Date.now()]
   * @param {number} [maxIdleMs=120000]
   * @returns {number} Số bản ghi đã dọn dẹp
   */
  sweepExpired(now = Date.now(), maxIdleMs = 120_000) {
    let removed = 0;
    for (const [key, tracker] of this.userTrackers.entries()) {
      if (now - tracker.lastSeen > maxIdleMs) {
        this.userTrackers.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Số lượng phiên người dùng đang được theo dõi tạm thời trong RAM.
   * @returns {number}
   */
  get activeTrackerCount() {
    return this.userTrackers.size;
  }
}
