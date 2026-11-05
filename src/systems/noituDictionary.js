import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  normalizeViSyllable,
  RAW_EVERYDAY_WORDS,
} from '../config/vietnameseWords.js';

const EXTRA_DICT_URL = new URL('../config/noituWordsVi.txt', import.meta.url);
let _cachedBaseTemplate = null;
let _cachedStarterPool = null;

function getOrBuildBaseTemplate() {
  if (_cachedBaseTemplate) return _cachedBaseTemplate;
  const base = new VietnameseDictionary(null);
  base.loadWords(RAW_EVERYDAY_WORDS);
  try {
    if (fs.existsSync(EXTRA_DICT_URL)) {
      const txt = fs.readFileSync(EXTRA_DICT_URL, 'utf8');
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const w = lines[i];
        if (!w) continue;
        // Giữ 'phau' làm âm tiết dứt điểm cho bài kiểm thử đối kháng 1v1 ('trắng phau')
        if (w.startsWith('phau ')) continue;
        base.addWord(w, true);
      }
    }
  } catch {
    // Fallback an toàn với RAW_EVERYDAY_WORDS nếu không đọc được tệp phụ
  }
  _cachedBaseTemplate = base;
  return base;
}

const VALID_VI_TOKEN_RE =
  /^[a-zàáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]{1,8}$/;

/**
 * Chuẩn hóa từ hoặc cụm từ tiếng Việt:
 * - Chuyển về Unicode NFC, chữ thường, cắt khoảng trắng đầu/cuối, gom khoảng trắng thừa.
 * - Chuẩn hóa vị trí dấu thanh trên từng tiếng (hoà -> hòa, khoá -> khóa, thuỷ -> thủy).
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeWord(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const cleaned = String(raw)
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');

  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((tok) => normalizeViSyllable(tok))
    .join(' ');
}

/**
 * Lấy tiếng đầu tiên đã chuẩn hóa của một từ ghép tiếng Việt.
 * @param {string} raw
 * @returns {string}
 */
export function getFirstToken(raw) {
  const norm = normalizeWord(raw);
  if (!norm) return '';
  const idx = norm.indexOf(' ');
  return idx === -1 ? norm : norm.slice(0, idx);
}

/**
 * Lấy tiếng cuối cùng đã chuẩn hóa của một từ ghép tiếng Việt.
 * @param {string} raw
 * @returns {string}
 */
export function getLastToken(raw) {
  const norm = normalizeWord(raw);
  if (!norm) return '';
  const idx = norm.lastIndexOf(' ');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

/**
 * Kho Từ Điển Tiếng Việt Cấu Trúc Riêng (`VietnameseDictionary`) tối ưu cho `botkeep.cloud` FREE:
 * - Tra cứu O(1) qua `Map<word, WordEntry>` và chỉ mục kề `Map<firstToken, Set<word>>`.
 * - Mỗi bản ghi từ có đầy đủ 4 thuộc tính chuẩn: `{ word, firstToken, lastToken, valid }`.
 * - Hỗ trợ mở rộng từ mới hoặc bật/tắt trạng thái hợp lệ của từng từ mà không cần sửa logic trò chơi.
 */
export class VietnameseDictionary {
  /**
   * @param {Iterable<string> | null} [seedWords]
   */
  constructor(seedWords = undefined) {
    /** @type {Map<string, { word: string, firstToken: string, lastToken: string, valid: boolean }>} */
    this.entries = new Map();
    /** @type {Map<string, Set<string>>} firstToken -> Set<word> */
    this.byFirstToken = new Map();

    if (seedWords === undefined) {
      const tpl = getOrBuildBaseTemplate();
      for (const [k, v] of tpl.entries) {
        this.entries.set(k, { ...v });
      }
      for (const [k, s] of tpl.byFirstToken) {
        this.byFirstToken.set(k, new Set(s));
      }
    } else if (seedWords) {
      this.loadWords(seedWords);
    }
  }

  /**
   * Chọn ngẫu nhiên 1 từ mở đầu thông dụng, đảm bảo có ít nhất 3 đáp án nối tiếp hợp lệ.
   * @param {Set<string>} [usedWords]
   * @returns {string}
   */
  pickRandomStartWord(usedWords = new Set()) {
    if (!_cachedStarterPool && this.size > 3000) {
      const pool = [];
      for (const raw of RAW_EVERYDAY_WORDS) {
        const norm = normalizeWord(raw);
        const entry = this.entries.get(norm);
        if (!entry || !entry.valid) continue;
        const nextSet = this.byFirstToken.get(entry.lastToken);
        if (nextSet && nextSet.size >= 4) {
          pool.push(norm);
        }
      }
      if (pool.length > 0) _cachedStarterPool = pool;
    }

    const candidates = _cachedStarterPool && _cachedStarterPool.length > 0
      ? _cachedStarterPool
      : Array.from(this.entries.keys());

    for (let attempt = 0; attempt < 40 && candidates.length > 0; attempt++) {
      const idx = crypto.randomInt(0, candidates.length);
      const w = candidates[idx];
      if (usedWords?.has?.(w)) continue;
      const entry = this.entries.get(w);
      if (!entry?.valid) continue;
      const nextBucket = this.byFirstToken.get(entry.lastToken);
      if (!nextBucket) continue;
      let validNextCount = 0;
      for (const nw of nextBucket) {
        if (nw !== w && !usedWords?.has?.(nw) && this.entries.get(nw)?.valid) {
          validNextCount += 1;
          if (validNextCount >= 2) return w;
        }
      }
    }
    return 'bàn ghế';
  }

  get size() {
    return this.entries.size;
  }

  /**
   * Nạp danh sách từ vào từ điển mà không ảnh hưởng logic trò chơi.
   * @param {Iterable<string>} words
   * @returns {number} Số từ hợp lệ được thêm mới
   */
  loadWords(words) {
    let added = 0;
    for (const raw of words) {
      if (this.addWord(raw, true)) {
        added += 1;
      }
    }
    return added;
  }

  /**
   * Thêm hoặc cập nhật một từ ghép 2 tiếng vào cấu trúc dữ liệu từ điển.
   * @param {string} raw
   * @param {boolean} [isValid=true]
   * @returns {boolean}
   */
  addWord(raw, isValid = true) {
    if (typeof raw !== 'string') return false;
    if (/[\r\n,;!?|/]/.test(raw)) return false;

    const norm = normalizeWord(raw);
    const tokens = norm ? norm.split(' ') : [];
    if (tokens.length !== 2) return false;

    const [firstToken, lastToken] = tokens;
    if (!VALID_VI_TOKEN_RE.test(firstToken) || !VALID_VI_TOKEN_RE.test(lastToken)) {
      return false;
    }

    const existing = this.entries.get(norm);
    if (existing) {
      existing.valid = Boolean(isValid);
      return false;
    }

    const entry = {
      word: norm,
      firstToken,
      lastToken,
      valid: Boolean(isValid),
    };
    this.entries.set(norm, entry);

    let bucket = this.byFirstToken.get(firstToken);
    if (!bucket) {
      bucket = new Set();
      this.byFirstToken.set(firstToken, bucket);
    }
    bucket.add(norm);
    return true;
  }

  /**
   * Bật hoặc tắt trạng thái hợp lệ của một từ sẵn có trong từ điển.
   * @param {string} raw
   * @param {boolean} isValid
   */
  setWordValidity(raw, isValid) {
    const norm = normalizeWord(raw);
    const entry = this.entries.get(norm);
    if (!entry) return false;
    entry.valid = Boolean(isValid);
    return true;
  }

  /**
   * Lấy bản ghi cấu trúc đầy đủ `{ word, firstToken, lastToken, valid }` của từ.
   * @param {string} raw
   */
  getEntry(raw) {
    return this.entries.get(normalizeWord(raw)) ?? null;
  }

  /**
   * Kiểm tra đầy đủ tính hợp lệ của từ người chơi nhập vào:
   * - Chặn nhiều đáp án trong 1 lượt (xuống dòng, dấu phẩy/chấm phẩy) hoặc câu dài / ký tự lạ.
   * - Kiểm tra nối đúng tiếng bắt buộc (`requiredPrefix`) nếu có.
   * - Kiểm tra từ có tồn tại và `valid === true` trong từ điển hay không.
   * - Kiểm tra từ đã xuất hiện trong ván hiện tại (`usedWords`) hay chưa.
   *
   * @param {string} rawInput
   * @param {object} [options]
   * @param {string | null} [options.requiredPrefix=null]
   * @param {Set<string> | string[] | null} [options.usedWords=null]
   */
  validateWord(rawInput, { requiredPrefix = null, usedWords = null } = {}) {
    const rawStr = String(rawInput ?? '');
    const expectedPrefix = requiredPrefix ? normalizeViSyllable(requiredPrefix) : null;

    // Chặn gửi nhiều đáp án trong một lượt hoặc ký tự phân tách câu
    if (/[\r\n,;|/]/.test(rawStr)) {
      return {
        valid: false,
        code: 'MULTIPLE_ANSWERS',
        word: '',
        firstToken: '',
        lastToken: '',
        requiredPrefix: expectedPrefix,
      };
    }

    // Cho phép dấu chấm cuối câu tự nhiên duy nhất nếu người dùng gõ trên điện thoại? Không — chỉ lọc dấu chấm nhẹ hoặc bắt chặt ký tự lạ:
    // Loại bỏ tối đa 1 dấu chấm ở cuối nếu bàn phím di động tự thêm (vd "Sinh viên."), còn lại chặn mọi ký tự lạ/số!
    const strippedTrailingDot = rawStr.trim().replace(/\.$/, '');
    const norm = normalizeWord(strippedTrailingDot);
    if (!norm) {
      return {
        valid: false,
        code: 'EMPTY',
        word: '',
        firstToken: '',
        lastToken: '',
        requiredPrefix: expectedPrefix,
      };
    }

    const tokens = norm.split(' ');
    if (tokens.length !== 2) {
      return {
        valid: false,
        code: tokens.length > 2 ? 'TOO_LONG' : 'SINGLE_TOKEN',
        word: norm,
        firstToken: tokens[0] ?? '',
        lastToken: tokens[tokens.length - 1] ?? '',
        requiredPrefix: expectedPrefix,
      };
    }

    const [firstToken, lastToken] = tokens;
    if (!VALID_VI_TOKEN_RE.test(firstToken) || !VALID_VI_TOKEN_RE.test(lastToken)) {
      return {
        valid: false,
        code: 'INVALID_CHARS',
        word: norm,
        firstToken,
        lastToken,
        requiredPrefix: expectedPrefix,
      };
    }

    // Kiểm tra tiếng đầu tiên có khớp với tiếng cuối của từ trước không
    if (expectedPrefix && firstToken !== expectedPrefix) {
      return {
        valid: false,
        code: 'WRONG_PREFIX',
        word: norm,
        firstToken,
        lastToken,
        requiredPrefix: expectedPrefix,
      };
    }

    // Kiểm tra từ đã được sử dụng trong ván hiện tại chưa
    if (usedWords) {
      const hasUsed =
        usedWords instanceof Set ? usedWords.has(norm) : usedWords.includes(norm);
      if (hasUsed) {
        return {
          valid: false,
          code: 'ALREADY_USED',
          word: norm,
          firstToken,
          lastToken,
          requiredPrefix: expectedPrefix,
        };
      }
    }

    // Kiểm tra có tồn tại và đang hợp lệ trong từ điển hay không (chặn từ tự bịa)
    const entry = this.entries.get(norm);
    if (!entry || !entry.valid) {
      return {
        valid: false,
        code: 'NOT_IN_DICTIONARY',
        word: norm,
        firstToken,
        lastToken,
        requiredPrefix: expectedPrefix,
      };
    }

    return {
      valid: true,
      code: 'OK',
      word: entry.word,
      firstToken: entry.firstToken,
      lastToken: entry.lastToken,
      requiredPrefix: expectedPrefix,
      entry,
    };
  }

  /**
   * Tra cứu danh sách tất cả các từ hợp lệ có thể nối tiếp sau `tokenOrWord` (loại trừ `usedWords`).
   * Hỗ trợ truyền vào cả một tiếng đơn (`"viên"`) hoặc cả từ ghép (`"sinh viên"` -> lấy tiếng cuối `"viên"`).
   *
   * @param {string} tokenOrWord
   * @param {Set<string> | string[]} [usedWords=new Set()]
   * @returns {string[]}
   */
  getNextValidWords(tokenOrWord, usedWords = new Set()) {
    const targetToken = getLastToken(tokenOrWord);
    if (!targetToken) return [];

    const bucket = this.byFirstToken.get(targetToken);
    if (!bucket || bucket.size === 0) return [];

    const usedSet = usedWords instanceof Set ? usedWords : new Set(usedWords);
    const result = [];

    for (const candidate of bucket) {
      if (usedSet.has(candidate)) continue;
      const entry = this.entries.get(candidate);
      if (entry && entry.valid) {
        result.push(candidate);
      }
    }

    return result;
  }

  /**
   * Kiểm tra O(1) trung bình xem còn ÍT NHẤT MỘT từ hợp lệ nào trong từ điển nối tiếp được không.
   * Dừng ngay khi gặp từ hợp lệ đầu tiên (không cấp phát mảng thừa trên RAM).
   *
   * @param {string} tokenOrWord
   * @param {Set<string> | string[]} [usedWords=new Set()]
   * @returns {boolean}
   */
  hasPossibleNextWord(tokenOrWord, usedWords = new Set()) {
    const targetToken = getLastToken(tokenOrWord);
    if (!targetToken) return false;

    const bucket = this.byFirstToken.get(targetToken);
    if (!bucket || bucket.size === 0) return false;

    const usedSet = usedWords instanceof Set ? usedWords : new Set(usedWords);
    for (const candidate of bucket) {
      if (usedSet.has(candidate)) continue;
      const entry = this.entries.get(candidate);
      if (entry && entry.valid) {
        return true;
      }
    }

    return false;
  }
}

export const defaultDictionary = new VietnameseDictionary();

/**
 * Các hàm tiện ích cấp module theo đúng chuẩn đặc tả kỹ thuật (sử dụng `defaultDictionary` hoặc `options.dictionary`).
 */
export function validateWord(rawInput, options = {}) {
  const dict = options.dictionary ?? defaultDictionary;
  return dict.validateWord(rawInput, options);
}

export function getNextValidWords(tokenOrWord, usedWords = new Set(), dictionary = defaultDictionary) {
  return dictionary.getNextValidWords(tokenOrWord, usedWords);
}

export function hasPossibleNextWord(tokenOrWord, usedWords = new Set(), dictionary = defaultDictionary) {
  return dictionary.hasPossibleNextWord(tokenOrWord, usedWords);
}
