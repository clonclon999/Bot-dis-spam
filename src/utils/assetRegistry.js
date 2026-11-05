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
  WALLET_BANNER: 'banners/wallet_banner.png',
  PROFILE_BANNER: 'banners/profile_banner.png',
  LEADERBOARD_BANNER: 'banners/leaderboard_banner.png',

  GAME_BAUCUA: 'games/baucua.png',
  GAME_TAIXIU: 'games/taixiu.png',
  GAME_NOITU: 'games/noitu.png',
  GAME_RPS: 'games/rps.png',
  GAME_GUESS: 'games/guess.png',
  GAME_COINFLIP: 'games/coinflip.png',
  GAME_RACE: 'games/race.png',

  BAUCUA_BANNER_3D: 'baucua/banner_3d.png',
  BAUCUA_GRID: 'baucua/board_grid.png',
  BAUCUA_CASINO_TABLE: 'baucua/casino_table.png',
  BAUCUA_SHAKE_GIF: 'baucua/baucua_shake.gif',
  BAUCUA_WIN: 'baucua/win.png',
  BAUCUA_LOSE: 'baucua/lose.png',
  BAUCUA_SPECIAL_TRIPLE: 'baucua/special_triple.png',
  BAUCUA_MASCOT: Object.freeze({
    bau: 'baucua/bau.png',
    cua: 'baucua/cua.png',
    tom: 'baucua/tom.png',
    ca: 'baucua/ca.png',
    ga: 'baucua/ga.png',
    nai: 'baucua/nai.png',
  }),
  BAUCUA_DICE: Object.freeze({
    bau: 'baucua/dice_bau.png',
    cua: 'baucua/dice_cua.png',
    tom: 'baucua/dice_tom.png',
    ca: 'baucua/dice_ca.png',
    ga: 'baucua/dice_ga.png',
    nai: 'baucua/dice_nai.png',
  }),

  TAIXIU_BANNER_3D: 'taixiu/banner_3d.png',
  TAIXIU_TABLE_3D: 'taixiu/table_3d.png',
  TAIXIU_ZONE_TAI: 'taixiu/zone_tai.png',
  TAIXIU_ZONE_XIU: 'taixiu/zone_xiu.png',
  TAIXIU_WIN: 'taixiu/win.png',
  TAIXIU_LOSE: 'taixiu/lose.png',
  TAIXIU_RESULT_BOARD: 'taixiu/result_board.png',
  TAIXIU_SPECIAL_TRIPLE: 'taixiu/special_triple.png',

  DICE_ROLL_GIF: 'dice/dice_roll.gif',
  DICE_FACE: Object.freeze({
    1: 'dice/dice_1.png',
    2: 'dice/dice_2.png',
    3: 'dice/dice_3.png',
    4: 'dice/dice_4.png',
    5: 'dice/dice_5.png',
    6: 'dice/dice_6.png',
  }),

  NOITU_ICON: 'noitu/icon.png',
  NOITU_TIMER_GIF: 'noitu/noitu_timer.gif',
  NOITU_WIN: 'noitu/win.png',
  NOITU_LOSE: 'noitu/lose.png',

  COIN_ICON: 'coinflip/icon.png',
  COIN_FLIP_GIF: 'coinflip/coin_flip.gif',
  COIN_SAP: 'coinflip/coin_sap.png',
  COIN_NGUA: 'coinflip/coin_ngua.png',
  COIN_WIN: 'coinflip/win.png',
  COIN_LOSE: 'coinflip/lose.png',

  RPS_ICON: 'rps/icon.png',
  RPS_COUNTDOWN_GIF: 'rps/rps_countdown.gif',
  RPS_WIN: 'rps/win.png',
  RPS_LOSE: 'rps/lose.png',
  RPS_HAND: Object.freeze({
    rock: 'rps/rock.png',
    paper: 'rps/paper.png',
    scissors: 'rps/scissors.png',
  }),

  GUESS_ICON: 'guess/icon.png',
  GUESS_VAULT_GIF: 'guess/vault_open.gif',
  GUESS_WIN: 'guess/win.png',
  GUESS_LOSE: 'guess/lose.png',

  RACE_ICON: 'race/icon.png',
  RACE_BANNER_3D: 'race/banner_3d.png',
  RACE_RUN_GIF: 'race/race_run.gif',
  RACE_WIN: 'race/win.png',
  RACE_LOSE: 'race/lose.png',
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
 * 🚀 LÀM NÓNG BỘ NHỚ ĐỆM TÀI NGUYÊN NGAY KHI BOT KHỞI ĐỘNG.
 *
 * Trước đây ảnh chỉ được nạp từ đĩa ở lần chơi đầu tiên sau mỗi lần restart => lệnh đầu tiên
 * (`/baucua`, `/taixiu`...) có thể mất hơn 3 giây và Discord hiện "Ứng dụng không phản hồi".
 * Hàm này nạp sẵn toàn bộ PNG/GIF tĩnh vào RAM theo từng đợt nhỏ để không chặn sự kiện khác.
 *
 * @param {{ batchSize?: number, onBatch?: () => Promise<void> }} [options]
 * @returns {Promise<number>} Số tệp đã nạp vào bộ nhớ đệm.
 */
export async function warmUpAssetCache({ batchSize = 12, onBatch = null } = {}) {
  const relPaths = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      if (/\.(png|gif|jpg|jpeg)$/i.test(value)) relPaths.push(value);
      return;
    }
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) walk(child);
    }
  };
  walk(ASSET_PATHS);

  let loaded = 0;
  let inBatch = 0;
  for (const relPath of new Set(relPaths)) {
    try {
      loadAssetBuffer(relPath);
      loaded += 1;
    } catch {
      // Tệp thiếu sẽ được báo lỗi rõ ràng khi thực sự dùng tới
    }
    inBatch += 1;
    if (inBatch >= batchSize) {
      inBatch = 0;
      if (typeof onBatch === 'function') await onBatch();
      else await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return loaded;
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

/**
 * Tạo danh sách file đính kèm 6 linh vật Bầu Cua cho MediaGallery (lưới 3x2 native trên Discord).
 */
export function buildBauCuaMascotGalleryAssets(mascotBets = {}) {
  const order = [
    { id: 'bau', name: 'Bầu' },
    { id: 'cua', name: 'Cua' },
    { id: 'tom', name: 'Tôm' },
    { id: 'ca', name: 'Cá' },
    { id: 'ga', name: 'Gà' },
    { id: 'nai', name: 'Nai' },
  ];
  const files = [];
  const items = [];
  for (const m of order) {
    const fileName = `bc_${m.id}.png`;
    const att = buildAssetAttachment(ASSET_PATHS.BAUCUA_MASCOT[m.id], fileName);
    const staked = mascotBets[m.id] || 0;
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: staked > 0 ? `${m.name} • Đã đặt: ${staked.toLocaleString('vi-VN')} VNĐ` : `${m.name} • Chưa đặt cược`,
    });
  }
  return { files, items };
}

/**
 * Tạo 3 hình xúc xắc linh vật Bầu Cua vừa mở bát cho MediaGallery (hỗ trợ trùng linh vật như 2 Bầu + 1 Cua).
 */
export function buildBauCuaRollGalleryAssets(rolledMascots) {
  const files = [];
  const items = [];
  rolledMascots.forEach((m, idx) => {
    const id = typeof m === 'string' ? m : m.id;
    const label = typeof m === 'string' ? m.toUpperCase() : m.name;
    const fileName = `bc_rolled_${idx + 1}_${id}.png`;
    const att = buildAssetAttachment(
      ASSET_PATHS.BAUCUA_DICE[id] || ASSET_PATHS.BAUCUA_MASCOT[id] || ASSET_PATHS.BAUCUA_MASCOT.bau,
      fileName
    );
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: `Xúc xắc #${idx + 1}: ${label}`,
    });
  });
  return { files, items };
}

/**
 * Tạo 3 hình viên xúc xắc 1..6 riêng biệt cho MediaGallery Tài Xỉu (hỗ trợ bộ đôi / bộ ba trùng số).
 */
export function buildDiceGalleryAssets(diceValues, prefix = 'tx_die') {
  const files = [];
  const items = [];
  diceValues.forEach((v, idx) => {
    const face = Math.min(6, Math.max(1, Number(v) || 1));
    const fileName = `${prefix}_${idx + 1}_${face}.png`;
    const att = buildAssetAttachment(ASSET_PATHS.DICE_FACE[face], fileName);
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: `Viên xúc xắc #${idx + 1}: ${face} nút`,
    });
  });
  return { files, items };
}

/**
 * Tạo bộ ảnh 3 lựa chọn Kéo • Búa • Bao cho MediaGallery Oẳn Tù Tì.
 */
export function buildRpsChoicesGalleryAssets() {
  const specs = [
    { id: 'rock', label: 'Búa (Đập gãy Kéo)' },
    { id: 'paper', label: 'Bao (Bọc trọn Búa)' },
    { id: 'scissors', label: 'Kéo (Cắt đứt Bao)' },
  ];
  const files = [];
  const items = [];
  for (const s of specs) {
    const att = buildAssetAttachment(ASSET_PATHS.RPS_HAND[s.id], `rps_opt_${s.id}.png`);
    files.push(att.attachment);
    items.push({ url: att.url, description: s.label });
  }
  return { files, items };
}

/**
 * Tạo bộ 2 hình bàn tay đối đầu cho kết quả Oẳn Tù Tì (Người chơi 1 vs Đối thủ/Bot).
 */
export function buildRpsDuelGalleryAssets(move1, move2, label1 = 'Bạn', label2 = 'Đối thủ') {
  const a1 = buildAssetAttachment(ASSET_PATHS.RPS_HAND[move1.id], `rps_p1_${move1.id}.png`);
  const a2 = buildAssetAttachment(ASSET_PATHS.RPS_HAND[move2.id], `rps_p2_${move2.id}.png`);
  return {
    files: [a1.attachment, a2.attachment],
    items: [
      { url: a1.url, description: `${label1} ra: ${move1.name}` },
      { url: a2.url, description: `${label2} ra: ${move2.name}` },
    ],
  };
}

/**
 * Lấy đường dẫn ảnh Thắng / Thua / Đặc Biệt RIÊNG BIỆT theo từng trò chơi (không dùng chung 1 ảnh).
 */
export function getDedicatedOutcomeBannerRelPath(gameId, { won = true, special = false } = {}) {
  if (gameId === 'baucua') {
    if (special) return ASSET_PATHS.BAUCUA_SPECIAL_TRIPLE;
    return won ? ASSET_PATHS.BAUCUA_WIN : ASSET_PATHS.BAUCUA_LOSE;
  }
  if (gameId === 'taixiu') {
    if (special) return ASSET_PATHS.TAIXIU_SPECIAL_TRIPLE;
    return won ? ASSET_PATHS.TAIXIU_WIN : ASSET_PATHS.TAIXIU_LOSE;
  }
  if (gameId === 'race') {
    return won ? ASSET_PATHS.RACE_WIN : ASSET_PATHS.RACE_LOSE;
  }
  if (gameId === 'noitu') {
    return won ? ASSET_PATHS.NOITU_WIN : ASSET_PATHS.NOITU_LOSE;
  }
  if (gameId === 'rps') {
    return won ? ASSET_PATHS.RPS_WIN : ASSET_PATHS.RPS_LOSE;
  }
  if (gameId === 'guess') {
    return won ? ASSET_PATHS.GUESS_WIN : ASSET_PATHS.GUESS_LOSE;
  }
  if (gameId === 'coinflip') {
    return won ? ASSET_PATHS.COIN_WIN : ASSET_PATHS.COIN_LOSE;
  }
  return won ? ASSET_PATHS.VICTORY_BANNER : ASSET_PATHS.DEFEAT_BANNER;
}

/**
 * Tạo lưới 6 cửa Bầu Cua 3D cho phiên Multiplayer (kèm số người cược & tổng VNĐ từng cửa).
 */
export function buildMultiplayerBauCuaDoorsGallery(doorStats = {}) {
  const order = [
    { id: 'bau', name: 'Bầu' },
    { id: 'cua', name: 'Cua' },
    { id: 'tom', name: 'Tôm' },
    { id: 'ca', name: 'Cá' },
    { id: 'ga', name: 'Gà' },
    { id: 'nai', name: 'Nai' },
  ];
  const files = [];
  const items = [];
  for (const m of order) {
    const stat = doorStats[m.id] || { count: 0, total: 0 };
    const fileName = `mp_bc_${m.id}.png`;
    const att = buildAssetAttachment(ASSET_PATHS.BAUCUA_MASCOT[m.id], fileName);
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: `Cửa ${m.name} • ${stat.count} người • ${Number(stat.total || 0).toLocaleString('vi-VN')} VNĐ`,
    });
  }
  return { files, items };
}

/**
 * Tạo 3 viên xúc xắc 3D Bầu Cua vừa mở bát cho phiên Multiplayer / Solo.
 */
export function buildBauCua3dDiceRollGallery(rolledMascots) {
  const files = [];
  const items = [];
  rolledMascots.forEach((m, idx) => {
    const id = typeof m === 'string' ? m : m.id;
    const label = typeof m === 'string' ? m.toUpperCase() : m.name;
    const fileName = `bc_3ddie_${idx + 1}_${id}.png`;
    const rel = ASSET_PATHS.BAUCUA_DICE[id] || ASSET_PATHS.BAUCUA_MASCOT[id] || ASSET_PATHS.BAUCUA_MASCOT.bau;
    const att = buildAssetAttachment(rel, fileName);
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: `Xúc xắc 3D #${idx + 1}: ${label}`,
    });
  });
  return { files, items };
}

/**
 * Tạo bộ hình Khu vực TÀI + Bàn 3D + Khu vực XỈU cho phiên Tài Xỉu Multiplayer.
 */
export function buildMultiplayerTaiXiuDoorsGallery(doorStats = {}) {
  const tai = doorStats.tai || { count: 0, total: 0 };
  const xiu = doorStats.xiu || { count: 0, total: 0 };
  const aTai = buildAssetAttachment(ASSET_PATHS.TAIXIU_ZONE_TAI, 'mp_tx_zone_tai.png');
  const aXi = buildAssetAttachment(ASSET_PATHS.TAIXIU_ZONE_XIU, 'mp_tx_zone_xiu.png');
  return {
    files: [aTai.attachment, aXi.attachment],
    items: [
      {
        url: aTai.url,
        description: `Cửa TÀI (11–17) • ${tai.count} người • ${Number(tai.total || 0).toLocaleString('vi-VN')} VNĐ`,
      },
      {
        url: aXi.url,
        description: `Cửa XỈU (4–10) • ${xiu.count} người • ${Number(xiu.total || 0).toLocaleString('vi-VN')} VNĐ`,
      },
    ],
  };
}

/**
 * Tạo bộ 5 làn Chiến Thú 3D cho phiên Đua Thú Multiplayer (90s).
 */
export function buildMultiplayerRaceDoorsGallery(doorStats = {}) {
  const specs = [
    { id: 'horse', name: 'Chiến Mã Xích Thố' },
    { id: 'cheetah', name: 'Báo Đốm Tia Chớp' },
    { id: 'eagle', name: 'Đại Bàng Kim Dực' },
    { id: 'wolf', name: 'Sói Bạc Bắc Cực' },
    { id: 'tiger', name: 'Hổ Trắng Sơn Lâm' },
  ];
  const files = [];
  const items = [];
  for (const s of specs) {
    const stat = doorStats[s.id] || { count: 0, total: 0 };
    const att = buildAssetAttachment(ASSET_PATHS.RACE_ANIMAL[s.id], `mp_race_${s.id}.png`);
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: `${s.name} • ${stat.count} người • ${Number(stat.total || 0).toLocaleString('vi-VN')} VNĐ`,
    });
  }
  return { files, items };
}

/**
 * Tạo bộ 5 hình chiến thú cho MediaGallery Đua Thú.
 */
export function buildRaceRosterGalleryAssets(selectedId = 'horse') {
  const specs = [
    { id: 'horse', name: 'Chiến Mã Xích Thố' },
    { id: 'cheetah', name: 'Báo Đốm Tia Chớp' },
    { id: 'eagle', name: 'Đại Bàng Kim Dực' },
    { id: 'wolf', name: 'Sói Bạc Bắc Cực' },
    { id: 'tiger', name: 'Hổ Trắng Sơn Lâm' },
  ];
  const files = [];
  const items = [];
  for (const s of specs) {
    const att = buildAssetAttachment(ASSET_PATHS.RACE_ANIMAL[s.id], `race_opt_${s.id}.png`);
    files.push(att.attachment);
    items.push({
      url: att.url,
      description: s.id === selectedId ? `⭐ ĐANG CHỌN: ${s.name}` : s.name,
    });
  }
  return { files, items };
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
