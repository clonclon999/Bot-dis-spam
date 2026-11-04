import { CURRENCY } from '../config/constants.js';

/**
 * Định dạng số nguyên sang tiền tệ VNĐ dễ đọc (ví dụ: `1.250.000 VNĐ`).
 * @param {number} amount
 * @returns {string}
 */
export function formatVnd(amount) {
  const safe = Math.trunc(Number(amount) || 0);
  const sign = safe < 0 ? '-' : '';
  const formatted = Math.abs(safe)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${formatted} ${CURRENCY.NAME}`;
}

/**
 * Vẽ thanh tiến trình trực quan cho Nhiệm vụ và Cấp độ.
 * @param {number} current
 * @param {number} total
 * @param {number} [size=10]
 * @returns {string}
 */
export function renderProgressBar(current, total, size = 10) {
  const safeTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * size);
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} ${Math.round(ratio * 100)}%`;
}

/**
 * Định dạng thời gian chờ còn lại sang tiếng Việt ngắn gọn.
 * @param {number} ms
 * @returns {string}
 */
export function formatRemainingMs(ms) {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  if (totalSec < 60) return `${totalSec} giây`;
  const mins = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (mins < 60) return remSec > 0 ? `${mins} phút ${remSec}s` : `${mins} phút`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) return remMin > 0 ? `${hours} giờ ${remMin}p` : `${hours} giờ`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days} ngày ${remH}h` : `${days} ngày`;
}

/**
 * Lấy mã ngày theo múi giờ Việt Nam (UTC+7) dạng `YYYY-MM-DD`.
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function getVnDateKey(now = Date.now()) {
  const vnTime = new Date(now + 7 * 3600 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

/**
 * Lấy mã tuần theo múi giờ Việt Nam (UTC+7) dạng `YYYY-Www`.
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function getVnWeekKey(now = Date.now()) {
  const d = new Date(now + 7 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
