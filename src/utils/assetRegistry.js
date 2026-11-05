import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { AttachmentBuilder } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.resolve(__dirname, '../../assets');

/**
 * Bộ nhớ đệm Buffer tài nguyên cục bộ (~550 KB tổng cộng, không bao giờ tải từ Internet).
 * @type {Map<string, Buffer>}
 */
const bufferCache = new Map();

/**
 * Bộ nhớ đệm LRU nhỏ cho ảnh kết quả 3 viên xúc xắc động (tối đa 48 tổ hợp ~ 180 KB RAM).
 * @type {Map<string, Buffer>}
 */
const dynamicDiceCache = new Map();
const MAX_DYNAMIC_CACHE = 48;

export const ASSET_PATHS = Object.freeze({
  GAME_CENTER_BANNER: 'banners/game_center.png',
  VICTORY_BANNER: 'banners/victory.png',
  DEFEAT_BANNER: 'banners/defeat.png',
  QUEST_BANNER: 'banners/quest_banner.png',
  SHOP_BANNER: 'banners/shop_banner.png',

  GAME_BAUCUA: 'games/baucua.png',
  GAME_TAIXIU: 'games/taixiu.png',
  GAME_NOITU: 'games/noitu.png',
  GAME_RPS: 'games/rps.png',
  GAME_GUESS: 'games/guess.png',
  GAME_COINFLIP: 'games/coinflip.png',
  GAME_RACE: 'games/race.png',

  BAUCUA_GRID: 'baucua/board_grid.png',
  BAUCUA_SHAKE_GIF: 'baucua/baucua_shake.gif',
  BAUCUA_MASCOT: Object.freeze({
    bau: 'baucua/bau.png',
    cua: 'baucua/cua.png',
    tom: 'baucua/tom.png',
    ca: 'baucua/ca.png',
    ga: 'baucua/ga.png',
    nai: 'baucua/nai.png',
  }),

  DICE_ROLL_GIF: 'dice/dice_roll.gif',
  DICE_FACE: Object.freeze({
    1: 'dice/dice_1.png',
    2: 'dice/dice_2.png',
    3: 'dice/dice_3.png',
    4: 'dice/dice_4.png',
    5: 'dice/dice_5.png',
    6: 'dice/dice_6.png',
  }),

  COIN_FLIP_GIF: 'coinflip/coin_flip.gif',
  COIN_SAP: 'coinflip/coin_sap.png',
  COIN_NGUA: 'coinflip/coin_ngua.png',

  RPS_COUNTDOWN_GIF: 'rps/rps_countdown.gif',
  RPS_HAND: Object.freeze({
    rock: 'rps/rock.png',
    paper: 'rps/paper.png',
    scissors: 'rps/scissors.png',
  }),

  GUESS_VAULT_GIF: 'guess/vault_open.gif',

  RACE_RUN_GIF: 'race/race_run.gif',
  RACE_ANIMAL: Object.freeze({
    horse: 'race/horse.png',
    cheetah: 'race/cheetah.png',
    eagle: 'race/eagle.png',
    wolf: 'race/wolf.png',
    tiger: 'race/tiger.png',
  }),
});

/**
 * Đọc Buffer ảnh/GIF từ thư mục cục bộ `assets/` (có cache RAM siêu nhẹ).
 */
export function loadAssetBuffer(relPath) {
  if (bufferCache.has(relPath)) {
    return bufferCache.get(relPath);
  }
  const fullPath = path.join(ASSETS_DIR, relPath);
  const buf = fs.readFileSync(fullPath);
  bufferCache.set(relPath, buf);
  return buf;
}

/**
 * Tạo Discord AttachmentBuilder + URL `attachment://...` để gắn vào Embed.
 */
export function buildAssetAttachment(relPath, overrideFileName = null) {
  const buf = loadAssetBuffer(relPath);
  const fileName = overrideFileName || path.basename(relPath);
  return {
    attachment: new AttachmentBuilder(buf, { name: fileName }),
    url: `attachment://${fileName}`,
    fileName,
  };
}

/**
 * Lấy đường dẫn ảnh đại diện tương ứng từng trò chơi trong 7 game hợp lệ.
 */
export function getGameBannerRelPath(gameId) {
  const map = {
    baucua: ASSET_PATHS.GAME_BAUCUA,
    taixiu: ASSET_PATHS.GAME_TAIXIU,
    noitu: ASSET_PATHS.GAME_NOITU,
    rps: ASSET_PATHS.GAME_RPS,
    guess: ASSET_PATHS.GAME_GUESS,
    coinflip: ASSET_PATHS.GAME_COINFLIP,
    race: ASSET_PATHS.GAME_RACE,
  };
  return map[gameId] || ASSET_PATHS.GAME_CENTER_BANNER;
}

// ==============================================================================
// Bộ Kết Xuất PNG Thuần Node.js (`node:zlib`) cho 3 Viên Xúc Xắc Thực Tế (< 1ms, 0 thư viện ngoài)
// ==============================================================================

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(typeStr, dataBuf) {
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);
  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

function encodeRgbPng(width, height, rgbBytes) {
  const rowStride = width * 3 + 1;
  const raw = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y += 1) {
    const outRow = y * rowStride;
    raw[outRow] = 0; // Filter None
    const srcOffset = y * width * 3;
    rgbBytes.copy(raw, outRow + 1, srcOffset, srcOffset + width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // RGB truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 3 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PIP_LAYOUT = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

/**
 * Sinh ảnh PNG 3 viên xúc xắc thực tế vừa mở bát (`[d1, d2, d3]`) siêu tốc (< 1ms).
 */
export function buildThreeDiceResultAttachment(dice, won = false) {
  const key = `${dice.join('-')}-${won ? 'w' : 'l'}`;
  let pngBuf = dynamicDiceCache.get(key);

  if (!pngBuf) {
    const W = 460;
    const H = 160;
    const pixels = Buffer.alloc(W * H * 3);

    const bgTop = won ? [18, 68, 46] : [58, 22, 32];
    const bgBot = won ? [10, 36, 26] : [28, 14, 24];
    const borderCol = won ? [241, 196, 15] : [231, 76, 60];

    for (let y = 0; y < H; y += 1) {
      const t = y / (H - 1);
      const r = Math.round(bgTop[0] * (1 - t) + bgBot[0] * t);
      const g = Math.round(bgTop[1] * (1 - t) + bgBot[1] * t);
      const b = Math.round(bgTop[2] * (1 - t) + bgBot[2] * t);
      for (let x = 0; x < W; x += 1) {
        const idx = (y * W + x) * 3;
        const isBorder = x < 4 || x >= W - 4 || y < 4 || y >= H - 4;
        pixels[idx] = isBorder ? borderCol[0] : r;
        pixels[idx + 1] = isBorder ? borderCol[1] : g;
        pixels[idx + 2] = isBorder ? borderCol[2] : b;
      }
    }

    const fillCircle = (cx, cy, radius, col) => {
      const r2 = radius * radius;
      const yMin = Math.max(0, Math.floor(cy - radius));
      const yMax = Math.min(H - 1, Math.ceil(cy + radius));
      const xMin = Math.max(0, Math.floor(cx - radius));
      const xMax = Math.min(W - 1, Math.ceil(cx + radius));
      for (let py = yMin; py <= yMax; py += 1) {
        for (let px = xMin; px <= xMax; px += 1) {
          const dx = px - cx;
          const dy = py - cy;
          if (dx * dx + dy * dy <= r2) {
            const p = (py * W + px) * 3;
            pixels[p] = col[0];
            pixels[p + 1] = col[1];
            pixels[p + 2] = col[2];
          }
        }
      }
    };

    const fillRoundRect = (rx, ry, rw, rh, rad, col) => {
      for (let py = ry; py < ry + rh; py += 1) {
        for (let px = rx; px < rx + rw; px += 1) {
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          let inside = true;
          const cx = px < rx + rad ? rx + rad : (px > rx + rw - 1 - rad ? rx + rw - 1 - rad : px);
          const cy = py < ry + rad ? ry + rad : (py > ry + rh - 1 - rad ? ry + rh - 1 - rad : py);
          if (cx !== px && cy !== py) {
            const dx = px - cx;
            const dy = py - cy;
            inside = dx * dx + dy * dy <= rad * rad;
          }
          if (inside) {
            const p = (py * W + px) * 3;
            pixels[p] = col[0];
            pixels[p + 1] = col[1];
            pixels[p + 2] = col[2];
          }
        }
      }
    };

    const dieSize = 108;
    const gap = 32;
    const startX = Math.floor((W - (3 * dieSize + 2 * gap)) / 2);
    const startY = Math.floor((H - dieSize) / 2);

    for (let i = 0; i < 3; i += 1) {
      const val = Number(dice[i]) || 1;
      const dx = startX + i * (dieSize + gap);
      const dy = startY;
      fillRoundRect(dx + 4, dy + 5, dieSize, dieSize, 18, [8, 12, 20]);
      fillRoundRect(dx - 2, dy - 2, dieSize + 4, dieSize + 4, 20, [241, 196, 15]);
      fillRoundRect(dx, dy, dieSize, dieSize, 18, [250, 250, 252]);

      const pipCol = (val === 1 || val === 4) ? [220, 38, 38] : [22, 32, 52];
      const pipRad = val === 1 ? 15 : 9.5;
      for (const [nx, ny] of (PIP_LAYOUT[val] || PIP_LAYOUT[1])) {
        fillCircle(dx + nx * dieSize, dy + ny * dieSize, pipRad, pipCol);
      }
    }

    pngBuf = encodeRgbPng(W, H, pixels);
    if (dynamicDiceCache.size >= MAX_DYNAMIC_CACHE) {
      const oldestKey = dynamicDiceCache.keys().next().value;
      dynamicDiceCache.delete(oldestKey);
    }
    dynamicDiceCache.set(key, pngBuf);
  }

    const fileName = 'taixiu_dice_result.png';
  return {
    attachment: new AttachmentBuilder(pngBuf, { name: fileName }),
    url: `attachment://${fileName}`,
    fileName,
  };
}

const dynamicBauCuaCache = new Map();

/**
 * Sinh ảnh PNG 3 viên xúc xắc linh vật Bầu Cua thực tế vừa mở bát (`[m1, m2, m3]`) siêu tốc (< 1ms).
 */
export function buildBauCuaResultAttachment(rolled, won = false) {
  const key = `${rolled.join('-')}-${won ? 'w' : 'l'}`;
  let pngBuf = dynamicBauCuaCache.get(key);

  if (!pngBuf) {
    const W = 460;
    const H = 160;
    const pixels = Buffer.alloc(W * H * 3);
    const bgTop = won ? [22, 74, 48] : [78, 20, 28];
    const bgBot = won ? [12, 38, 26] : [36, 12, 18];
    const borderCol = won ? [241, 196, 15] : [231, 76, 60];

    for (let y = 0; y < H; y += 1) {
      const t = y / (H - 1);
      const r = Math.round(bgTop[0] * (1 - t) + bgBot[0] * t);
      const g = Math.round(bgTop[1] * (1 - t) + bgBot[1] * t);
      const b = Math.round(bgTop[2] * (1 - t) + bgBot[2] * t);
      for (let x = 0; x < W; x += 1) {
        const idx = (y * W + x) * 3;
        const isBorder = x < 4 || x >= W - 4 || y < 4 || y >= H - 4;
        pixels[idx] = isBorder ? borderCol[0] : r;
        pixels[idx + 1] = isBorder ? borderCol[1] : g;
        pixels[idx + 2] = isBorder ? borderCol[2] : b;
      }
    }

    const fillCircle = (cx, cy, radius, col) => {
      const r2 = radius * radius;
      for (let py = Math.max(0, Math.floor(cy - radius)); py <= Math.min(H - 1, Math.ceil(cy + radius)); py += 1) {
        for (let px = Math.max(0, Math.floor(cx - radius)); px <= Math.min(W - 1, Math.ceil(cx + radius)); px += 1) {
          if ((px - cx) ** 2 + (py - cy) ** 2 <= r2) {
            const p = (py * W + px) * 3;
            pixels[p] = col[0];
            pixels[p + 1] = col[1];
            pixels[p + 2] = col[2];
          }
        }
      }
    };

    const fillRoundRect = (rx, ry, rw, rh, rad, col) => {
      for (let py = ry; py < ry + rh; py += 1) {
        for (let px = rx; px < rx + rw; px += 1) {
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          let inside = true;
          const cx = px < rx + rad ? rx + rad : (px > rx + rw - 1 - rad ? rx + rw - 1 - rad : px);
          const cy = py < ry + rad ? ry + rad : (py > ry + rh - 1 - rad ? ry + rh - 1 - rad : py);
          if (cx !== px && cy !== py) {
            inside = (px - cx) ** 2 + (py - cy) ** 2 <= rad * rad;
          }
          if (inside) {
            const p = (py * W + px) * 3;
            pixels[p] = col[0];
            pixels[p + 1] = col[1];
            pixels[p + 2] = col[2];
          }
        }
      }
    };

    const mascotTheme = {
      bau: [46, 204, 113],
      cua: [231, 76, 60],
      tom: [243, 156, 18],
      ca: [52, 152, 219],
      ga: [241, 196, 15],
      nai: [195, 118, 42],
    };

    const dieSize = 112;
    const gap = 28;
    const startX = Math.floor((W - (3 * dieSize + 2 * gap)) / 2);
    const startY = Math.floor((H - dieSize) / 2);

    for (let i = 0; i < 3; i += 1) {
      const m = rolled[i] || 'bau';
      const col = mascotTheme[m] || [241, 196, 15];
      const dx = startX + i * (dieSize + gap);
      const dy = startY;
      fillRoundRect(dx + 4, dy + 5, dieSize, dieSize, 18, [12, 14, 22]);
      fillRoundRect(dx - 3, dy - 3, dieSize + 6, dieSize + 6, 20, col);
      fillRoundRect(dx, dy, dieSize, dieSize, 18, [252, 248, 236]);

      const cx = dx + dieSize / 2;
      const cy = dy + dieSize / 2;
      if (m === 'bau') {
        fillCircle(cx, cy - 16, 17, col);
        fillCircle(cx, cy + 14, 25, col);
        fillRoundRect(cx - 16, cy - 5, 32, 6, 2, [231, 76, 60]);
      } else if (m === 'cua') {
        fillCircle(cx, cy + 4, 25, col);
        fillCircle(cx - 22, cy - 22, 11, col);
        fillCircle(cx + 22, cy - 22, 11, col);
      } else if (m === 'tom') {
        fillCircle(cx + 8, cy - 18, 15, col);
        fillCircle(cx + 12, cy + 2, 13, col);
        fillCircle(cx - 2, cy + 18, 11, col);
        fillCircle(cx - 16, cy + 22, 8, col);
      } else if (m === 'ca') {
        fillCircle(cx - 6, cy, 23, col);
        fillRoundRect(cx + 14, cy - 16, 18, 32, 4, [241, 196, 15]);
        fillCircle(cx - 14, cy - 4, 4, [255, 255, 255]);
      } else if (m === 'ga') {
        fillCircle(cx, cy + 12, 22, col);
        fillCircle(cx, cy - 14, 14, col);
        fillCircle(cx, cy - 28, 7, [231, 76, 60]);
      } else {
        fillCircle(cx, cy + 6, 22, col);
        fillRoundRect(cx - 22, cy - 28, 8, 22, 3, [120, 66, 18]);
        fillRoundRect(cx + 14, cy - 28, 8, 22, 3, [120, 66, 18]);
      }
    }

    pngBuf = encodeRgbPng(W, H, pixels);
    if (dynamicBauCuaCache.size >= MAX_DYNAMIC_CACHE) {
      const oldest = dynamicBauCuaCache.keys().next().value;
      dynamicBauCuaCache.delete(oldest);
    }
    dynamicBauCuaCache.set(key, pngBuf);
  }

  const fileName = 'baucua_dice_result.png';
  return {
    attachment: new AttachmentBuilder(pngBuf, { name: fileName }),
    url: `attachment://${fileName}`,
    fileName,
  };
}
