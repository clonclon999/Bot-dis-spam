/**
 * Hằng số cốt lõi của hệ thống DISCORD GAME BOT PRO.
 * BẢO MẬT: HARDCODED_OWNER_ID được khóa cứng trực tiếp trong mã nguồn,
 * không thể bị ghi đè bởi biến môi trường, database hay đầu vào người dùng.
 */

export const HARDCODED_OWNER_ID = '1243061570247069696';

export const BOT_ROLES = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  MEMBER: 'MEMBER',
});

export const ROLE_WEIGHT = Object.freeze({
  [BOT_ROLES.OWNER]: 100,
  [BOT_ROLES.ADMIN]: 75,
  [BOT_ROLES.MODERATOR]: 50,
  [BOT_ROLES.MEMBER]: 10,
});

export const CURRENCY = Object.freeze({
  NAME: 'VNĐ',
  SYMBOL: '₫',
});

export const GAME_IDS = Object.freeze({
  BAUCUA: 'baucua',
  TAIXIU: 'taixiu',
  COINFLIP: 'coinflip',
  GUESS: 'guess',
  RACE: 'race',
  RPS: 'rps',
  NOITU: 'noitu',
});

/**
 * Thứ tự 7 trò chơi chính thức trong Game Center (/games) — TUYỆT ĐỐI KHÔNG CÓ ĐẤU BOSS.
 */
export const OFFICIAL_GAME_ORDER = Object.freeze([
  GAME_IDS.BAUCUA,
  GAME_IDS.TAIXIU,
  GAME_IDS.NOITU,
  GAME_IDS.RPS,
  GAME_IDS.GUESS,
  GAME_IDS.COINFLIP,
  GAME_IDS.RACE,
]);

export const QUICK_BET_AMOUNTS = Object.freeze([100, 500, 1_000, 5_000, 10_000]);

export const GAME_LABELS = Object.freeze({
  [GAME_IDS.BAUCUA]: '🎲 Bầu Cua',
  [GAME_IDS.TAIXIU]: '🎯 Tài Xỉu',
  [GAME_IDS.COINFLIP]: '🪙 Tung Đồng Xu',
  [GAME_IDS.GUESS]: '🔢 Đoán Số',
  [GAME_IDS.RACE]: '🏇 Đua Thú',
  [GAME_IDS.RPS]: '✂️ Oẳn Tù Tì',
  [GAME_IDS.NOITU]: '🔤 Nối Từ Tiếng Việt',
});

export const GAME_CATALOG = Object.freeze({
  baucua: Object.freeze({
    id: 'baucua',
    name: 'Bầu Cua Tôm Cá',
    emoji: '🦀',
    command: '/baucua',
    shortDesc: 'Đặt cược bàn lưới 6 linh vật dân gian, lắc 3 viên xúc xắc nhận thưởng 2x / 3x / 4x.',
    rules: [
      '• Chọn 1 hoặc nhiều linh vật trên bàn 6 cửa (`Bầu, Cua, Tôm, Cá, Gà, Nai`), có thể đặt tiền riêng cho từng linh vật.',
      '• Hệ thống khóa kết quả an toàn (`crypto.randomInt`) rồi chạy hiệu ứng lắc 3 xúc xắc.',
      '• **Thanh toán:** Xuất hiện **1 lần** nhận lại **2x** tiền cược | **2 lần** nhận lại **3x** | **3 lần** nhận lại **4x** | **0 lần** mất tiền cược.',
    ].join('\n'),
  }),
  taixiu: Object.freeze({
    id: 'taixiu',
    name: 'Tài Xỉu Casino',
    emoji: '🎲',
    command: '/taixiu',
    shortDesc: 'Sòng Casino hai khu vực TÀI (11–17) & XỈU (4–10) kèm hiệu ứng tung 3 xúc xắc.',
    rules: [
      '• Chọn khu vực **TÀI (11–17)** hoặc **XỈU (4–10)** và bấm **Xác nhận** mức cược VNĐ.',
      '• **Quy tắc:** Tổng **4–10** là **Xỉu** | Tổng **11–17** là **Tài** | Tổng **3 hoặc 18** là **Nhà cái thắng**.',
      '• **Thanh toán:** Thắng nhận lại **2 lần (2x)** tiền cược; thua mất tiền cược.',
    ].join('\n'),
  }),
  noitu: Object.freeze({
    id: 'noitu',
    name: 'Nối Từ Tiếng Việt (Game Show 1v1)',
    emoji: '🔤',
    command: '/noitu',
    shortDesc: 'Game Show đối kháng 2 người chơi với đồng hồ đếm ngược 30 giây và từ điển nội bộ tốc độ cao.',
    rules: [
      '• Hai người chơi đối đầu trực tiếp trong phòng riêng, hiển thị Avatar, thanh lượt chơi và lịch sử từ đã dùng.',
      '• Nhập từ ghép tiếng Việt 2 tiếng hợp lệ bắt đầu bằng tiếng cuối của từ hiện tại trong vòng **30 giây**.',
      '• Không được dùng lại từ đã xuất hiện; nếu đối thủ hết giờ hoặc từ khóa cuối không còn từ nối tiếp trong từ điển, bạn **Thắng Tuyệt Đối**!',
    ].join('\n'),
  }),
  rps: Object.freeze({
    id: 'rps',
    name: 'Oẳn Tù Tì',
    emoji: '✂️',
    command: '/rps',
    shortDesc: 'Đối đầu Kéo • Búa • Bao cùng Bot hoặc thách đấu người chơi khác với hiệu ứng đếm ngược mở kết quả.',
    rules: [
      '• Quy tắc: **Búa** thắng **Kéo**, **Kéo** thắng **Bao**, **Bao** thắng **Búa**.',
      '• Hỗ trợ cả đấu với **Bot** và thách đấu **Người chơi (PvP)** cược VNĐ trực tiếp.',
      '• Sau khi xác nhận cược, hệ thống chạy đếm ngược và mở kết quả đồng thời (thắng nhận **2x**, hòa hoàn tiền).',
    ].join('\n'),
  }),
  guess: Object.freeze({
    id: 'guess',
    name: 'Đoán Số Bí Ẩn',
    emoji: '🔢',
    command: '/guess',
    shortDesc: 'Giải mã con số ngẫu nhiên của Bot với giới hạn lượt đoán và gợi ý Lớn Hơn / Nhỏ Hơn.',
    rules: [
      '• Chọn độ khó và xác nhận mức cược VNĐ để Bot khởi tạo con số bí mật ngẫu nhiên.',
      '• Bạn có số lượt đoán giới hạn; mỗi lần đoán chưa trúng, Bot sẽ gợi ý con số bí mật **LỚN HƠN** hay **NHỎ HƠN**.',
      '• Đoán đúng trong giới hạn lượt sẽ chạy hiệu ứng mở két và trả thưởng VNĐ tự động!',
    ].join('\n'),
  }),
  coinflip: Object.freeze({
    id: 'coinflip',
    name: 'Tung Đồng Xu',
    emoji: '🪙',
    command: '/coinflip',
    shortDesc: 'Chọn mặt Sấp hoặc Ngửa với hiệu ứng xoay đồng xu Hoàng Kim nhận thưởng 2x VNĐ.',
    rules: [
      '• Chọn mặt **Sấp** hoặc **Ngửa**, chọn mức cược VNĐ trên bảng cược tương tác và bấm **Xác nhận**.',
      '• Đồng xu xoay trên không và mở mặt kết quả công bằng 50/50 (thắng nhận lại **2x** tiền cược).',
    ].join('\n'),
  }),
  race: Object.freeze({
    id: 'race',
    name: 'Đua Thú Tốc Độ',
    emoji: '🐎',
    command: '/race',
    shortDesc: 'Chọn chiến thú yêu thích và theo dõi đường đua nhiều chặng trực tiếp tới vạch đích.',
    rules: [
      '• Chọn 1 trong 5 chiến thú (`Chiến Mã`, `Báo Đốm`, `Đại Bàng`, `Sói Bạc`, `Hổ Trắng`) và xác nhận tiền cược VNĐ.',
      '• Cuộc đua diễn ra theo từng giai đoạn tăng tốc với thanh tiến trình trực tiếp (không hiện kết quả ngay lập tức).',
      '• Chiến thú bạn chọn cán đích **Hạng Nhất (#1)** nhận thưởng **4.5x** tiền cược!',
    ].join('\n'),
  }),
});

export const BAUCUA_MASCOTS = Object.freeze([
  Object.freeze({ id: 'bau', name: 'Bầu', emoji: '🍐' }),
  Object.freeze({ id: 'cua', name: 'Cua', emoji: '🦀' }),
  Object.freeze({ id: 'tom', name: 'Tôm', emoji: '🦐' }),
  Object.freeze({ id: 'ca', name: 'Cá', emoji: '🐟' }),
  Object.freeze({ id: 'ga', name: 'Gà', emoji: '🐓' }),
  Object.freeze({ id: 'nai', name: 'Nai', emoji: '🦌' }),
]);

export const DICE_FACES = Object.freeze(['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']);

export const RACE_ANIMALS = Object.freeze([
  Object.freeze({ id: 'horse', name: 'Chiến Mã', emoji: '🐎' }),
  Object.freeze({ id: 'cheetah', name: 'Báo Đốm', emoji: '🐆' }),
  Object.freeze({ id: 'eagle', name: 'Đại Bàng', emoji: '🦅' }),
  Object.freeze({ id: 'wolf', name: 'Sói Bạc', emoji: '🐺' }),
  Object.freeze({ id: 'tiger', name: 'Hổ Trắng', emoji: '🐅' }),
]);

export const RPS_CHOICES = Object.freeze({
  rock: Object.freeze({ id: 'rock', name: 'Búa', emoji: '✊', beats: 'scissors' }),
  paper: Object.freeze({ id: 'paper', name: 'Bao', emoji: '🖐️', beats: 'rock' }),
  scissors: Object.freeze({ id: 'scissors', name: 'Kéo', emoji: '✌️', beats: 'paper' }),
});

export const SHOP_ITEMS = Object.freeze({
  pet_food: Object.freeze({
    id: 'pet_food',
    name: 'Thức Ăn Thú Cưng Cao Cấp',
    emoji: '🍖',
    category: 'consumable',
    price: 2_500,
    sellPrice: 1_000,
    description: 'Cho thú cưng ăn hồi 40 độ no và nhận +60 EXP thú cưng.',
  }),
  energy_drink: Object.freeze({
    id: 'energy_drink',
    name: 'Nước Tăng Lực Siêu Cấp',
    emoji: '⚡',
    category: 'consumable',
    price: 5_000,
    sellPrice: 2_000,
    description: 'Xóa ngay thời gian hồi chiêu của lệnh /work để đi làm tiếp.',
  }),
  lucky_ticket: Object.freeze({
    id: 'lucky_ticket',
    name: 'Vé May Mắn',
    emoji: '🎟️',
    category: 'boost',
    price: 15_000,
    sellPrice: 6_000,
    description: 'Tăng +35% tiền thưởng khi Đi làm (/work) và nhận Nhiệm vụ trong 2 giờ (không can thiệp RNG trò chơi).',
  }),
  exp_card_2x: Object.freeze({
    id: 'exp_card_2x',
    name: 'Thẻ Nhân Đôi EXP (2h)',
    emoji: '✨',
    category: 'boost',
    price: 18_000,
    sellPrice: 7_200,
    description: 'Nhân đôi (x2) toàn bộ EXP nhận được từ hoạt động và nhiệm vụ trong 2 giờ.',
  }),
  rob_shield: Object.freeze({
    id: 'rob_shield',
    name: 'Bảo Hiểm Chống Cướp (24h)',
    emoji: '🛡️',
    category: 'protection',
    price: 20_000,
    sellPrice: 8_000,
    description: 'Bảo vệ ví tiền khỏi mọi vụ cướp (/rob) trong suốt 24 giờ.',
  }),
  mystery_box: Object.freeze({
    id: 'mystery_box',
    name: 'Hộp Quà Bí Ẩn',
    emoji: '🎁',
    category: 'box',
    price: 25_000,
    sellPrice: 10_000,
    description: 'Mở ngẫu nhiên nhận từ 10.000–80.000 VNĐ, vật phẩm tăng tốc hoặc mở khóa Thú Hiếm!',
  }),
  pet_egg: Object.freeze({
    id: 'pet_egg',
    name: 'Trứng Thú Cưng Ngẫu Nhiên',
    emoji: '🥚',
    category: 'pet',
    price: 45_000,
    sellPrice: 18_000,
    description: 'Ấp nở ngay 1 Thú Cưng ngẫu nhiên (Shiba, Mèo Thần Tài, Cáo Tuyết hoặc Rồng Ngọc) vào bộ sưu tập!',
  }),
  frame_gold: Object.freeze({
    id: 'frame_gold',
    name: 'Khung Hồ Sơ Hoàng Kim',
    emoji: '🖼️',
    category: 'frame',
    price: 120_000,
    sellPrice: 48_000,
    frameStyle: '╔═══👑 HOÀNG KIM 👑═══╗',
    description: 'Trang bị khung viền Hoàng Kim rực rỡ trên thẻ /profile của bạn.',
  }),
  frame_cyber: Object.freeze({
    id: 'frame_cyber',
    name: 'Khung Hồ Sơ Tinh Vân Cyber',
    emoji: '🌌',
    category: 'frame',
    price: 200_000,
    sellPrice: 80_000,
    frameStyle: '⚡⟦ CYBER NEON PRO ⟧⚡',
    description: 'Trang bị khung viền Cyber hiện đại trên thẻ /profile của bạn.',
  }),
  title_legend: Object.freeze({
    id: 'title_legend',
    name: 'Danh Hiệu: Huyền Thoại Viễn Chinh',
    emoji: '🏅',
    category: 'title',
    price: 250_000,
    sellPrice: 100_000,
    unlockTitleId: 'huyen_thoai',
    description: 'Mở khóa vĩnh viễn danh hiệu hiếm "Huyền Thoại Viễn Chinh".',
  }),
});

export const PET_SPECIES = Object.freeze({
  dog_shiba: Object.freeze({
    id: 'dog_shiba',
    name: 'Cún Shiba Vàng',
    emoji: '🐶',
    rarity: 'Common',
    price: 35_000,
    expBonusPct: 5,
    questBonusPct: 5,
    effectLabel: '🐾 Dấu Chân Trung Thành',
    unlockTitleId: null,
  }),
  cat_fortune: Object.freeze({
    id: 'cat_fortune',
    name: 'Mèo Thần Tài',
    emoji: '🐱',
    rarity: 'Common',
    price: 50_000,
    expBonusPct: 6,
    questBonusPct: 8,
    effectLabel: '🎐 Chuông Vàng Chiêu Tài',
    unlockTitleId: null,
  }),
  fox_snow: Object.freeze({
    id: 'fox_snow',
    name: 'Cáo Tuyết Cửu Vĩ',
    emoji: '🦊',
    rarity: 'Rare',
    price: 120_000,
    expBonusPct: 10,
    questBonusPct: 12,
    effectLabel: '❄️ Sương Băng Huyền Ảo',
    unlockTitleId: null,
  }),
  dragon_jade: Object.freeze({
    id: 'dragon_jade',
    name: 'Rồng Ngọc Bích',
    emoji: '🐉',
    rarity: 'Epic',
    price: 350_000,
    expBonusPct: 18,
    questBonusPct: 20,
    effectLabel: '🐲 Hào Quang Long Tộc',
    unlockTitleId: 'long_chu',
  }),
  phoenix_fire: Object.freeze({
    id: 'phoenix_fire',
    name: 'Phượng Hoàng Lửa',
    emoji: '🦅',
    rarity: 'Mythic',
    price: 750_000,
    expBonusPct: 25,
    questBonusPct: 25,
    effectLabel: '🔥 Cánh Lửa Bất Diệt',
    unlockTitleId: 'phuong_hoang',
  }),
  unicorn_star: Object.freeze({
    id: 'unicorn_star',
    name: 'Kỳ Lân Tinh Tú (Thú Hiếm Hộp Quà)',
    emoji: '🦄',
    rarity: 'Secret',
    price: 0, // Chỉ mở khóa từ Hộp Quà Bí Ẩn hoặc sự kiện
    boxOnly: true,
    expBonusPct: 30,
    questBonusPct: 30,
    effectLabel: '🌠 Tinh Hà Lấp Lánh',
    unlockTitleId: 'ky_lan_chu',
  }),
});

export const TITLES = Object.freeze({
  tan_thu: Object.freeze({ id: 'tan_thu', name: '🌱 Tân Thủ', desc: 'Danh hiệu khởi đầu của mọi người chơi.' }),
  dai_gia: Object.freeze({ id: 'dai_gia', name: '💼 Đại Gia', desc: 'Sở hữu tổng tài sản từ 1.000.000 VNĐ.' }),
  trieu_phu: Object.freeze({ id: 'trieu_phu', name: '💎 Triệu Phú', desc: 'Sở hữu tổng tài sản từ 10.000.000 VNĐ.' }),
  ty_phu: Object.freeze({ id: 'ty_phu', name: '👑 Tỷ Phú', desc: 'Sở hữu tổng tài sản từ 100.000.000 VNĐ.' }),
  than_may_man: Object.freeze({ id: 'than_may_man', name: '🍀 Thần May Mắn', desc: 'Chiến thắng tổng cộng 25 ván trò chơi.' }),
  vua_bau_cua: Object.freeze({ id: 'vua_bau_cua', name: '🦀 Vua Bầu Cua', desc: 'Thắng 15 ván Bầu Cua.' }),
  cao_thu_tai_xiu: Object.freeze({ id: 'cao_thu_tai_xiu', name: '🎲 Cao Thủ Tài Xỉu', desc: 'Thắng 15 ván Tài Xỉu.' }),
  vua_noi_tu: Object.freeze({ id: 'vua_noi_tu', name: '🔤 Vua Nối Từ', desc: 'Nối đúng từ 25 lượt trở lên trong trò Nối Từ.' }),
  nha_suu_tap: Object.freeze({ id: 'nha_suu_tap', name: '🐾 Nhà Sưu Tập', desc: 'Sở hữu từ 4 loài thú cưng trở lên.' }),
  huyen_thoai: Object.freeze({ id: 'huyen_thoai', name: '🏅 Huyền Thoại Viễn Chinh', desc: 'Mở khóa từ Cửa hàng.' }),
  long_chu: Object.freeze({ id: 'long_chu', name: '🐲 Kỵ Sĩ Rồng Ngọc', desc: 'Sở hữu thú cưng Rồng Ngọc Bích.' }),
  phuong_hoang: Object.freeze({ id: 'phuong_hoang', name: '🔥 Chúa Tể Phượng Hoàng', desc: 'Sở hữu thú cưng Phượng Hoàng Lửa.' }),
  ky_lan_chu: Object.freeze({ id: 'ky_lan_chu', name: '🦄 Người Gác Tinh Tú', desc: 'Mở khóa thú hiếm Kỳ Lân Tinh Tú.' }),
});

export const BUILTIN_QUESTS = Object.freeze([
  // Nhiệm vụ hằng ngày (đầy đủ Đăng nhập, Đi làm và cả 7 trò chơi chính thức — không có Đấu Boss)
  Object.freeze({
    id: 'daily_login_1',
    scope: 'daily',
    name: 'Điểm Danh Hằng Ngày',
    description: 'Đăng nhập nhận thưởng /daily trong ngày',
    metric: 'daily_claimed',
    target: 1,
    rewardVnd: 8_000,
    rewardExp: 50,
  }),
  Object.freeze({
    id: 'daily_work_5',
    scope: 'daily',
    name: 'Chăm Chỉ Lao Động',
    description: 'Đi làm (/work) đủ 5 lần trong ngày',
    metric: 'work_count',
    target: 5,
    rewardVnd: 15_000,
    rewardExp: 80,
  }),
  Object.freeze({
    id: 'daily_baucua_3',
    scope: 'daily',
    name: 'Khởi Động Bầu Cua',
    description: 'Chơi 3 ván Bầu Cua (/baucua)',
    metric: 'play_baucua',
    target: 3,
    rewardVnd: 12_000,
    rewardExp: 60,
  }),
  Object.freeze({
    id: 'daily_taixiu_5',
    scope: 'daily',
    name: 'Tay Chơi Tài Xỉu',
    description: 'Chơi 5 ván Tài Xỉu (/taixiu)',
    metric: 'play_taixiu',
    target: 5,
    rewardVnd: 15_000,
    rewardExp: 75,
  }),
  Object.freeze({
    id: 'daily_noitu_2',
    scope: 'daily',
    name: 'Tranh Tài Nối Từ',
    description: 'Hoàn thành hoặc thắng 2 trận Nối Từ (/noitu)',
    metric: 'play_noitu',
    target: 2,
    rewardVnd: 14_000,
    rewardExp: 75,
  }),
  Object.freeze({
    id: 'daily_rps_3',
    scope: 'daily',
    name: 'Cao Thủ Oẳn Tù Tì',
    description: 'Chơi 3 ván Oẳn Tù Tì (/rps)',
    metric: 'play_rps',
    target: 3,
    rewardVnd: 11_000,
    rewardExp: 55,
  }),
  Object.freeze({
    id: 'daily_guess_2',
    scope: 'daily',
    name: 'Thám Tử Đoán Số',
    description: 'Chơi 2 ván Đoán Số (/guess)',
    metric: 'play_guess',
    target: 2,
    rewardVnd: 11_000,
    rewardExp: 60,
  }),
  Object.freeze({
    id: 'daily_coinflip_3',
    scope: 'daily',
    name: 'Xoay Xu Thử Vận',
    description: 'Chơi 3 ván Tung Đồng Xu (/coinflip)',
    metric: 'play_coinflip',
    target: 3,
    rewardVnd: 10_000,
    rewardExp: 55,
  }),
  Object.freeze({
    id: 'daily_race_2',
    scope: 'daily',
    name: 'Đường Đua Rực Lửa',
    description: 'Chơi 2 chặng Đua Thú (/race)',
    metric: 'play_race',
    target: 2,
    rewardVnd: 12_000,
    rewardExp: 65,
  }),

  // Nhiệm vụ hằng tuần
  Object.freeze({
    id: 'weekly_games_50',
    scope: 'weekly',
    name: 'Chiến Thần Giải Trí',
    description: 'Hoàn thành tổng cộng 50 trận trò chơi trong tuần',
    metric: 'games_played',
    target: 50,
    rewardVnd: 100_000,
    rewardExp: 420,
  }),
  Object.freeze({
    id: 'weekly_wins_15',
    scope: 'weekly',
    name: 'Chuỗi Thắng Đỉnh Cao',
    description: 'Thắng tổng cộng 15 trận trò chơi trong tuần',
    metric: 'game_wins',
    target: 15,
    rewardVnd: 90_000,
    rewardExp: 380,
  }),
  Object.freeze({
    id: 'weekly_earn_50k',
    scope: 'weekly',
    name: 'Nhà Đầu Tư Tuần Lễ',
    description: 'Tích lũy 50.000 VNĐ từ làm việc & trò chơi trong tuần',
    metric: 'vnd_earned',
    target: 50_000,
    rewardVnd: 55_000,
    rewardExp: 300,
  }),
  Object.freeze({
    id: 'weekly_quests_30',
    scope: 'weekly',
    name: 'Bậc Thầy Nhiệm Vụ',
    description: 'Hoàn thành nhiệm vụ hằng ngày đạt mốc 30 lần nhận thưởng',
    metric: 'quests_claimed',
    target: 30,
    rewardVnd: 120_000,
    rewardExp: 500,
  }),

  // Nhiệm vụ đặc biệt (1 lần cho Tân thủ & Cấp cao)
  Object.freeze({
    id: 'special_newbie_start',
    scope: 'special',
    minLevel: 1,
    maxLevel: 999,
    name: '🌟 Hành Trình Tân Thủ',
    description: 'Nhận thưởng /daily lần đầu tiên để bắt đầu sự nghiệp',
    metric: 'daily_claimed',
    target: 1,
    rewardVnd: 30_000,
    rewardExp: 150,
  }),
  Object.freeze({
    id: 'special_veteran_lv10',
    scope: 'special',
    minLevel: 5,
    maxLevel: 999,
    name: '🔥 Thử Thách Cao Thủ (Cấp 5+)',
    description: 'Thắng 10 ván trò chơi khi đã đạt từ Cấp 5 trở lên',
    metric: 'veteran_wins',
    target: 10,
    rewardVnd: 150_000,
    rewardExp: 600,
  }),
]);

export const EVENT_TYPES = Object.freeze({
  RICH_RACE: 'rich_race',
  LEVEL_RACE: 'level_race',
  BAUCUA_EVENT: 'baucua_event',
  TAIXIU_EVENT: 'taixiu_event',
  NOITU_EVENT: 'noitu_event',
  QUEST_EVENT: 'quest_event',
  LOGIN_STREAK: 'login_streak',
  GLOBAL_AIRDROP: 'global_airdrop',
});

export const EVENT_TYPE_LABELS = Object.freeze({
  [EVENT_TYPES.RICH_RACE]: '💰 Đua Top Người Giàu',
  [EVENT_TYPES.LEVEL_RACE]: '⭐ Đua Top Cấp Độ',
  [EVENT_TYPES.BAUCUA_EVENT]: '🦀 Sự Kiện Bầu Cua',
  [EVENT_TYPES.TAIXIU_EVENT]: '🎲 Sự Kiện Tài Xỉu',
  [EVENT_TYPES.NOITU_EVENT]: '🔤 Sự Kiện Nối Từ',
  [EVENT_TYPES.QUEST_EVENT]: '📜 Sự Kiện Nhiệm Vụ',
  [EVENT_TYPES.LOGIN_STREAK]: '📅 Đăng Nhập Liên Tục',
  [EVENT_TYPES.GLOBAL_AIRDROP]: '🎉 Phát Thưởng Toàn Server',
});

export const LOG_CATEGORIES = Object.freeze({
  ECONOMY: 'economy',
  GAME: 'game',
  ADMIN: 'admin',
  ANTICHEAT: 'anticheat',
  QUEST: 'quest',
  EVENT: 'event',
  ERROR: 'error',
});
