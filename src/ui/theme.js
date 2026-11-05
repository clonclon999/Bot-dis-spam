/**
 * Hệ thống Thiết kế Giao diện PRO MAX (Dark Gaming UI – Neon Cyan & Electric Purple).
 * Tối ưu đồng thời cho Discord Mobile (Android / iOS màn hình hẹp) và Discord Desktop.
 */
export const THEME = Object.freeze({
  NEON_CYAN: 0x00f5d4,
  CYAN_BRIGHT: 0x00e5ff,
  NEON_PURPLE: 0x9b5de5,
  PURPLE_DEEP: 0x7c3aed,
  CYBER_EMERALD: 0x00f59b,
  NEON_GOLD: 0xffd166,
  CRIMSON_NEON: 0xff3366,
  AMBER_PULSE: 0xff9f1c,
  SLATE_DARK: 0x334155,
});

/**
 * Thanh tiến trình gọn sắc nét chuẩn Mobile (mặc định 10 khối, không bị gãy dòng trên điện thoại).
 */
export function renderNeonBar(current, total, length = 10) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const ratio = Math.min(1, Math.max(0, (Number(current) || 0) / safeTotal));
  const filled = Math.round(ratio * length);
  return `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, length - filled))}`;
}

/**
 * Chuỗi hiển thị số lượt còn lại trực quan cho trò Đoán Số.
 */
export function renderAttemptHearts(remaining, used) {
  const r = Math.max(0, Math.trunc(remaining));
  const u = Math.max(0, Math.trunc(used));
  return `${'💎'.repeat(r)}${'▫️'.repeat(u)}`;
}

/**
 * Trích xuất URL Avatar hợp lệ cho ThumbnailBuilder (hỗ trợ cả user thật trên Discord và mock user trong Test).
 */
export function resolveUserAvatarUrl(user, fallbackUrl = null) {
  if (typeof user?.displayAvatarURL === 'function') {
    const u = user.displayAvatarURL({ extension: 'png', size: 128 });
    if (typeof u === 'string' && (u.startsWith('https://') || u.startsWith('http://'))) {
      return u;
    }
  }
  if (typeof user?.avatarURL === 'string' && user.avatarURL.startsWith('http')) {
    return user.avatarURL;
  }
  return fallbackUrl;
}
