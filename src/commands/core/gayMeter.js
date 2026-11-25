import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  InteractionContextType,
} from 'discord.js';
import { HARDCODED_OWNER_ID } from '../../config/constants.js';
import {
  buildCv2Payload,
  createContainer,
  sectionWithThumbnail,
  separator,
  textDisplay,
} from '../../ui/componentsV2.js';
import { safeReplyV2, safeUpdateV2 } from '../../ui/interactionHelpers.js';
import { renderNeonBar, resolveUserAvatarUrl, THEME } from '../../ui/theme.js';
import { globalGuard } from '../../utils/locks.js';

/**
 * 🔮 MÁY ĐO ĐỘ GAY (Gay-o-meter) — chức năng giải trí thuần túy.
 *
 * Nguyên tắc:
 * - Kết quả là "trò vui", không mang tính thật: băm (hash) ID người chơi + độ lệch ngày
 *   để mỗi người ra một con số ổn định trong ngày (bấm lại không đổi), hôm sau mới đổi.
 * - 👑 OWNER (`HARDCODED_OWNER_ID`) LUÔN LUÔN 0% — khóa cứng trong code, không thể vượt.
 * - Mỗi mức có bộ câu bình luận hài hước riêng, chọn ngẫu nhiên theo seed.
 * - Không đụng tới tiền tệ, không ảnh hưởng gameplay, không ghi DB.
 */

/** Mốc phần trăm tuyệt đối dành riêng cho OWNER */
const OWNER_FIXED_PERCENT = 0;

/** Các mức đánh giá: [từ, đến, nhãn, emoji, màu] */
const GAY_TIERS = [
  {
    max: 0,
    label: 'TUYỆT ĐỐI DỊ TÍNH',
    emoji: '🗿',
    color: THEME.NEON_GOLD,
    lines: [
      '0% — Chỉ số gay thấp tới mức máy đo tưởng mình bị hỏng, phải khởi động lại 3 lần.',
      '0% — Bạn thẳng như cây thước kẻ của học sinh lớp 1, không cong một ly.',
      '0% — Máy đo vừa báo 0% xong tự áp lực, xin nghỉ phép 3 ngày.',
      '0% — Bạn không phải "trai thẳng", bạn là **nam châm cùng cực** với mọi thứ cong.',
      '0% — Đo xong máy in ra tờ giấy trắng, hỏi ra mới biết: không có gì để in.',
    ],
  },
  {
    max: 15,
    label: 'THẲNG TƯNG TƯNG',
    emoji: '😎',
    color: THEME.CYBER_EMERALD,
    lines: [
      'Chỉ hơi nghiêng khi ngồi lệch ghế, còn lại thẳng tắp — không sao cả.',
      'Mức này gọi là "thẳng nhưng vẫn biết phối đồ". Không tính là cong.',
      'Máy đo phải rặn thêm 2 lần mới ra được con số này, phần còn lại là bình thường.',
      'Bạn thuộc diện an toàn: đi chơi với hội bạn thân thoải mái, không cần đề phòng.',
      'Cảnh báo: nếu bạn còn tiếp tục khen tóc bạn cùng bàn, con số này sẽ tăng.',
    ],
  },
  {
    max: 35,
    label: 'HƠI NGHIÊNG',
    emoji: '🤨',
    color: THEME.NEON_CYAN,
    lines: [
      'Chưa cong hẳn, nhưng thước đo đã phải nghiêng người nhìn cho kỹ.',
      'Con số này tương đương "thích màu pastel nhưng vẫn chơi đá bóng".',
      'Máy đo đề nghị bạn giải thích vì sao story toàn ảnh hoàng hôn.',
      'Vẫn trong vùng an toàn, chỉ cần bớt dùng từ "dễ thương" 3 lần/ngày.',
      'Bạn đang ở ranh giới: một bên là bình thường, một bên là playlist nhạc buồn.',
    ],
  },
  {
    max: 55,
    label: 'NỬA NỬA',
    emoji: '🌈',
    color: THEME.NEON_PURPLE,
    lines: [
      'Đúng 50/50 — nửa muốn đi tập gym, nửa muốn đi cà phê check-in.',
      'Máy đo phải dùng đến 2 thước mới đo được, một cái đã cong theo bạn.',
      'Bạn ở giữa: ăn được cả bún chả lẫn bánh plan, không phân biệt gì cả.',
      'Tình trạng này gọi là "linh hoạt", các cụ hay nói là "tùy duyên".',
      'Con số này mà đem đi đá bóng thì đội bạn sẽ thắng vì ai cũng cười.',
    ],
  },
  {
    max: 75,
    label: 'KHÁ LÀ CĂNG',
    emoji: '💅',
    color: 0xff5fa2,
    lines: [
      'Máy đo vừa báo xong tự sơn móng tay màu hồng để ăn mừng.',
      'Bạn đã qua vùng "thẳng", giờ đang ở vùng "thẳng nhưng có gu".',
      'Cảnh báo: con số này tương đương "biết 3 kiểu buộc tóc".',
      'Máy đo khuyên bạn nên đăng ký lớp nhảy, đừng phí tài năng.',
      'Đo xong, thước kẻ trong cặp bạn tự động cong theo, không ai bảo.',
    ],
  },
  {
    max: 95,
    label: 'RẤT CHI LÀ GAY',
    emoji: '🏳️‍🌈',
    color: THEME.CRIMSON_NEON,
    lines: [
      'Máy đo vừa xong việc đã xin chuyển công tác, bảo là "quá tải cảm xúc".',
      'Bạn không cong, bạn là **đường cong parabol** có hệ số a âm.',
      'Con số này tương đương "biết hết lyric của 5 bài nhạc buồn".',
      'Máy đo phải gọi thêm 3 máy khác để xác nhận, cả 4 máy đều đồng ý.',
      'Cảnh báo đỏ: bạn vừa làm đổ ly nước của người bên cạnh vì mải ngắm.',
    ],
  },
  {
    max: 100,
    label: 'HUYỀN THOẠI CẦU VỒNG',
    emoji: '👑',
    color: THEME.NEON_GOLD,
    lines: [
      '100% — Máy đo cháy. Bảo hành từ chối vì "lỗi do người dùng quá cong".',
      '100% — Đây không còn là độ gay, đây là **bản sắc thương hiệu**.',
      '100% — Bạn là người duy nhất mà thước kẻ trong lớp học cong theo.',
      '100% — Máy đo vừa xin nghỉ hưu sớm, để lại di chúc: "tôi đã thấy tất cả".',
      '100% — Chúc mừng, bạn đạt điểm tuyệt đối ở bộ môn khó nhất.',
    ],
  },
];

/** Câu "cà khịa" chung, hiện thêm phía dưới kết quả */
const EXTRA_JOKES = [
  '📌 Kết quả mang tính giải trí, đừng đem đi kiện bot.',
  '📌 Nếu thấy sai, hãy đo lại vào 0 giờ — lúc đó máy đo cũng đang ngủ.',
  '📌 Máy đo dùng công nghệ "băm ID + ngày", nên bấm lại vẫn ra đúng số đó.',
  '📌 Bot không chịu trách nhiệm nếu bạn mang kết quả này đi khoe.',
  '📌 Sai số: ±0% với OWNER, ±100% với người còn lại.',
  '📌 Muốn giảm chỉ số? Đơn giản thôi: đừng bấm lệnh này nữa.',
];

/**
 * Băm ID + ngày thành số phần trăm 0–100 (ổn định trong ngày, đổi vào hôm sau).
 * @param {string} userId
 * @param {number} [now]
 * @returns {number}
 */
export function computeGayPercent(userId, now = Date.now()) {
  if (String(userId) === String(HARDCODED_OWNER_ID)) return OWNER_FIXED_PERCENT;

  const dayKey = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10); // theo giờ VN
  const digest = crypto.createHash('sha256').update(`${userId}:${dayKey}:gay-o-meter`).digest();
  return digest.readUInt32BE(0) % 101; // 0..100
}

/**
 * Tra cứu mức đánh giá theo phần trăm.
 * @param {number} percent
 */
export function getGayTier(percent) {
  return GAY_TIERS.find((t) => percent <= t.max) ?? GAY_TIERS[GAY_TIERS.length - 1];
}

/**
 * Chọn câu bình luận ổn định theo người chơi (cùng ngày bấm lại ra cùng câu).
 * @param {string} userId
 * @param {number} percent
 * @param {number} [now]
 */
export function pickGayComment(userId, percent, now = Date.now()) {
  const tier = getGayTier(percent);
  const dayKey = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const digest = crypto.createHash('md5').update(`${userId}:${percent}:${dayKey}:line`).digest();
  const line = tier.lines[digest.readUInt8(0) % tier.lines.length];
  const joke = EXTRA_JOKES[digest.readUInt8(1) % EXTRA_JOKES.length];
  return { tier, line, joke };
}

/**
 * Thanh hiển thị 0–100% (dùng lại renderNeonBar của theme để đồng bộ giao diện).
 * @param {number} percent
 */
function renderGayBar(percent) {
  return renderNeonBar(percent, 100, 14);
}

/**
 * Xây payload Components V2 cho kết quả đo.
 * @param {object} targetUser
 * @param {{ percent: number, isOwner: boolean, line: string, joke: string, tier: object, measuredBy?: object }} data
 */
export function buildGayMeterPayload(targetUser, data) {
  const { percent, isOwner, line, joke, tier } = data;
  const accent = isOwner ? THEME.NEON_GOLD : tier.color;
  // `resolveUserAvatarUrl(user, fallbackUrl)` — tham số thứ 2 là URL dự phòng (không phải kích thước)
  const avatar = resolveUserAvatarUrl(
    targetUser,
    targetUser?.id
      ? `https://cdn.discordapp.com/embed/avatars/${Number(String(targetUser.id).slice(-1)) % 5}.png`
      : null
  );

  const ownerBadge = isOwner
    ? '👑 **ĐẶC QUYỀN OWNER:** chỉ số này **khóa cứng 0%** trong mã nguồn, không máy đo nào lay chuyển được.'
    : null;

  const headTexts = [
    `## ${tier.emoji} MÁY ĐO ĐỘ GAY — ${String(targetUser.username || 'Người chơi').toUpperCase()}`,
    ownerBadge ?? '🔮 Đang phân tích dữ liệu sinh trắc học... xong rồi!',
  ];

  const children = [
    avatar
      ? sectionWithThumbnail({
          texts: headTexts,
          url: avatar,
          description: `Ảnh đại diện của ${targetUser.username || 'người chơi'}`,
        })
      : textDisplay(headTexts.join('\n')),
    separator(),
    textDisplay(
      [
        `### 📊 **KẾT QUẢ: ${percent}% — ${tier.emoji} ${tier.label}**`,
        `${renderGayBar(percent)}`,
        '',
        `💬 ${line}`,
      ].join('\n')
    ),
    separator(),
    textDisplay(`-# ${joke}`),
  ];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gaymeter:again:${targetUser.id}`)
      .setLabel('Đo Lại')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`gaymeter:close:${targetUser.id}`)
      .setLabel('Đóng')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary)
  );

  return buildCv2Payload({
    containers: [
      createContainer({
        accentColor: accent,
        children: [...children, row],
      }),
    ],
  });
}

/**
 * Lệnh `/gay` (alias `/dogay`): đo độ gay của một người (mặc định là chính mình).
 */
export const gayMeterCommand = {
  data: new SlashCommandBuilder()
    .setName('gay')
    .setDescription('🔮 Máy đo độ gay giải trí — kèm bình luận hài hước (ai cũng bấm được)')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o.setName('nguoi_dung').setDescription('Người muốn đo (bỏ trống = đo chính bạn)').setRequired(false)
    ),

  async execute(interaction, ctx) {
    const target = interaction.options?.getUser?.('nguoi_dung') ?? interaction.user;
    const percent = computeGayPercent(target.id);
    const isOwner = String(target.id) === String(HARDCODED_OWNER_ID);
    const { tier, line, joke } = pickGayComment(target.id, percent);

    const payload = buildGayMeterPayload(target, { percent, isOwner, line, joke, tier });
    await safeReplyV2(interaction, payload);
  },
};

/** Alias dễ nhớ cho người dùng Việt: `/dogay` */
export const gayMeterAliasCommand = {
  data: new SlashCommandBuilder()
    .setName('dogay')
    .setDescription('🔮 Đo độ gay (bí danh của /gay) — vui thôi, đừng tin 100%')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o.setName('nguoi_dung').setDescription('Người muốn đo (bỏ trống = đo chính bạn)').setRequired(false)
    ),

  async execute(interaction, ctx) {
    return gayMeterCommand.execute(interaction, ctx);
  },
};

/**
 * Định tuyến nút bấm của Máy Đo Độ Gay.
 * @param {any} interaction
 * @returns {Promise<boolean>} `true` nếu đã xử lý
 */
export async function handleGayMeterInteraction(interaction, ctx) {
  const customId = interaction?.customId || '';
  if (!customId.startsWith('gaymeter:')) return false;

  const [, action, ownerId] = customId.split(':');
  const targetId = ownerId || interaction.user.id;

  if (action === 'close') {
    await safeUpdateV2(
      interaction,
      buildCv2Payload({
        containers: [
          createContainer({
            accentColor: THEME.SLATE_DARK,
            children: [
              textDisplay('## ✖️ Đã đóng Máy Đo Độ Gay'),
              textDisplay(
                '-# Máy đo đã được cất vào tủ, hẹn gặp lại lần đo sau. Gõ `/gay` để mở lại nhé!'
              ),
            ],
          }),
        ],
      })
    );
    return true;
  }

  if (action === 'again') {
    const rl = globalGuard.checkRateLimit(`gaymeter:${interaction.user.id}`, 1_200);
    if (!rl.allowed) {
      await safeUpdateV2(interaction, interaction.message ? { components: interaction.message.components } : {});
      return true;
    }

    // 🪶 Tái sử dụng hồ sơ đã hiển thị trên bảng hiện tại: bấm "Đo lại" chỉ đổi câu bình luận,
    // avatar/tên không đổi => KHÔNG cần gọi API `users.fetch` (tiết kiệm 0.3–2 giây mỗi lần bấm).
    const cachedTarget = interaction.client?.users?.cache?.get(targetId) ?? null;
    const reused =
      cachedTarget ??
      ({
        id: targetId,
        username: 'Người chơi',
        displayAvatarURL: () => resolveUserAvatarUrl({ id: targetId }, null),
      });

    const target = reused;

    const percent = computeGayPercent(targetId);
    const isOwner = String(targetId) === String(HARDCODED_OWNER_ID);
    const { tier, line, joke } = pickGayComment(targetId, percent);
    await safeUpdateV2(interaction, buildGayMeterPayload(target, { percent, isOwner, line, joke, tier }));
    return true;
  }

  return false;
}
