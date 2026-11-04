import { randomInt, randomBytes } from 'node:crypto';

/**
 * Bộ sinh số ngẫu nhiên an toàn mật mã học (Cryptographically Fair RNG) sử dụng `node:crypto.randomInt`.
 * Đảm bảo mọi kết quả xúc xắc, đồng xu, đua thú hoàn toàn công bằng và không thể đoán trước.
 */

/**
 * Sinh số nguyên ngẫu nhiên trong đoạn `[min, max]` (bao gồm cả `min` và `max`).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function secureInt(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (low === high) return low;
  return randomInt(low, high + 1);
}

/**
 * Tung `count` viên xúc xắc `sides` mặt (mặc định 6 mặt: 1..6).
 * @param {number} [count=3]
 * @param {number} [sides=6]
 * @returns {number[]}
 */
export function rollDice(count = 3, sides = 6) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(secureInt(1, sides));
  }
  return results;
}

/**
 * Chọn ngẫu nhiên 1 phần tử từ mảng bằng `crypto.randomInt`.
 * @template T
 * @param {readonly T[]} arr
 * @returns {T}
 */
export function pickOne(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('Không thể chọn phần tử từ mảng rỗng.');
  }
  return arr[randomInt(0, arr.length)];
}

/**
 * Kiểm tra xác suất phần trăm `[0..100]` bằng độ phân giải 10.000 bậc.
 * @param {number} percent
 * @returns {boolean}
 */
export function rollChancePct(percent) {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const threshold = Math.round(percent * 100);
  return randomInt(0, 10_000) < threshold;
}

/**
 * Sinh mã phiên ngắn (Session Nonce) chống giả mạo nút bấm tương tác.
 * @returns {string}
 */
export function createNonce() {
  return randomBytes(4).toString('hex');
}
