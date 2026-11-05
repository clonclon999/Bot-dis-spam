import {
  ComponentType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import { THEME } from './theme.js';

export const CV2_LIMITS = Object.freeze({
  MAX_TOTAL_COMPONENTS: 40,
  MAX_TOP_LEVEL_COMPONENTS: 10,
  MAX_SHARED_TEXT_LENGTH: 4000,
  MAX_TOTAL_TEXT_LENGTH: 4000,
  MAX_SECTION_TEXTS: 3,
  MAX_GALLERY_ITEMS: 10,
  MAX_BUTTONS_PER_ROW: 5,
  MAX_CUSTOM_ID_LENGTH: 100,
});

/**
 * Sinh cờ chuẩn cho tin nhắn Discord Components V2 (kết hợp Ephemeral khi cần riêng tư).
 */
export function cv2Flags({ ephemeral = false } = {}) {
  return ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;
}

/**
 * Tạo TextDisplayBuilder an toàn (tự cắt bảo vệ giới hạn ký tự).
 */
export function textDisplay(markdown) {
  const str = String(markdown ?? '').trim() || '\u200b';
  return new TextDisplayBuilder().setContent(str.slice(0, 3900));
}

/**
 * Tạo đường phân cách SeparatorBuilder cho Container.
 */
export function separator({ divider = true, large = false } = {}) {
  return new SeparatorBuilder()
    .setDivider(Boolean(divider))
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/**
 * Tạo SectionBuilder kèm ảnh Thumbnail (1–3 TextDisplay + 1 ThumbnailAccessory theo chuẩn Discord API).
 */
export function sectionWithThumbnail({ texts, url, description = 'Hình minh họa' }) {
  const cleanTexts = (Array.isArray(texts) ? texts : [texts])
    .filter(Boolean)
    .slice(0, CV2_LIMITS.MAX_SECTION_TEXTS)
    .map((t) => (t instanceof TextDisplayBuilder ? t : textDisplay(t)));

  if (cleanTexts.length === 0) {
    cleanTexts.push(textDisplay('\u200b'));
  }

  const thumb = new ThumbnailBuilder().setURL(url);
  if (description) {
    thumb.setDescription(String(description).slice(0, 250));
  }

  return new SectionBuilder()
    .addTextDisplayComponents(...cleanTexts)
    .setThumbnailAccessory(thumb);
}

/**
 * Tạo SectionBuilder kèm 1 Nút tương tác bên phải (1–3 TextDisplay + 1 ButtonAccessory).
 */
export function sectionWithButton({ texts, button }) {
  const cleanTexts = (Array.isArray(texts) ? texts : [texts])
    .filter(Boolean)
    .slice(0, CV2_LIMITS.MAX_SECTION_TEXTS)
    .map((t) => (t instanceof TextDisplayBuilder ? t : textDisplay(t)));

  if (cleanTexts.length === 0) {
    cleanTexts.push(textDisplay('\u200b'));
  }

  return new SectionBuilder()
    .addTextDisplayComponents(...cleanTexts)
    .setButtonAccessory(button);
}

/**
 * Tạo MediaGalleryBuilder (1–10 hình ảnh PNG/GIF/URL).
 * @param {Array<{ url: string, description?: string, spoiler?: boolean }>} items
 */
export function mediaGallery(items) {
  const validItems = (items || [])
    .slice(0, CV2_LIMITS.MAX_GALLERY_ITEMS)
    .map((item) => {
      const builder = new MediaGalleryItemBuilder().setURL(item.url);
      if (item.description) {
        builder.setDescription(String(item.description).slice(0, 250));
      }
      if (item.spoiler) {
        builder.setSpoiler(true);
      }
      return builder;
    });

  return new MediaGalleryBuilder().addItems(...validItems);
}

/**
 * Tạo ContainerBuilder có thanh màu nhấn Neon và nạp linh hoạt các Component con hợp lệ.
 */
export function createContainer({ accentColor = THEME.NEON_CYAN, children = [] } = {}) {
  const container = new ContainerBuilder();
  if (typeof accentColor === 'number') {
    container.setAccentColor(accentColor);
  }

  for (const child of children) {
    if (!child) continue;
    const type = child.data?.type;
    if (type === ComponentType.TextDisplay || child instanceof TextDisplayBuilder) {
      container.addTextDisplayComponents(child);
    } else if (type === ComponentType.Section || child instanceof SectionBuilder) {
      container.addSectionComponents(child);
    } else if (type === ComponentType.MediaGallery || child instanceof MediaGalleryBuilder) {
      container.addMediaGalleryComponents(child);
    } else if (type === ComponentType.Separator || child instanceof SeparatorBuilder) {
      container.addSeparatorComponents(child);
    } else if (type === ComponentType.ActionRow || typeof child.addComponents === 'function') {
      container.addActionRowComponents(child);
    }
  }

  return container;
}

/**
 * Đóng gói Payload Discord Components V2 chuẩn API v10:
 * - Luôn gắn `MessageFlags.IsComponentsV2` (không bao giờ gửi `content` hay `embeds`).
 * - Tự động đặt `attachments: []` khi cập nhật khung không đính kèm file để xóa sạch ảnh cũ.
 */
export function buildCv2Payload({
  containers,
  files = [],
  ephemeral = false,
  clearAttachments = false,
  allowedMentions,
}) {
  const payload = {
    flags: cv2Flags({ ephemeral }),
    components: Array.isArray(containers) ? containers : [containers],
  };

  if (files && files.length > 0) {
    payload.files = files;
  } else if (clearAttachments) {
    payload.attachments = [];
  }

  if (allowedMentions) {
    payload.allowedMentions = allowedMentions;
  }

  return payload;
}

/**
 * Tạo thẻ thông báo nhanh (Cảnh báo / Thành công / Lỗi / Hệ thống) bằng Components V2.
 */
export function buildCv2NoticePayload({
  title,
  body,
  accentColor = THEME.NEON_CYAN,
  ephemeral = false,
  actionRows = [],
  thumbnailUrl = null,
  files = [],
  clearAttachments = false,
  allowedMentions,
}) {
  const children = [];
  if (thumbnailUrl) {
    children.push(
      sectionWithThumbnail({
        texts: [`### ${title}`, body],
        url: thumbnailUrl,
        description: title,
      })
    );
  } else {
    children.push(textDisplay(`### ${title}\n${body}`));
  }

  if (actionRows.length > 0) {
    children.push(separator());
    children.push(...actionRows);
  }

  const card = createContainer({ accentColor, children });
  return buildCv2Payload({
    containers: [card],
    files,
    ephemeral,
    clearAttachments,
    allowedMentions,
  });
}

/**
 * Trích xuất toàn bộ nội dung chữ trong một Payload (hỗ trợ cả Components V2 lẫn Legacy Embed cho kiểm thử).
 */
export function extractPayloadText(payload) {
  if (!payload) return '';
  const chunks = [];

  if (typeof payload.content === 'string') {
    chunks.push(payload.content);
  }

  if (Array.isArray(payload.embeds)) {
    for (const emb of payload.embeds) {
      const d = typeof emb.toJSON === 'function' ? emb.toJSON() : emb.data || emb;
      if (d.author?.name) chunks.push(d.author.name);
      if (d.title) chunks.push(d.title);
      if (d.description) chunks.push(d.description);
      if (Array.isArray(d.fields)) {
        for (const f of d.fields) chunks.push(`${f.name}: ${f.value}`);
      }
      if (d.footer?.text) chunks.push(d.footer.text);
    }
  }

  const walk = (node) => {
    if (!node) return;
    const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
    if (typeof json.content === 'string') chunks.push(json.content);
    if (Array.isArray(json.components)) {
      for (const child of json.components) walk(child);
    }
    if (json.accessory) walk(json.accessory);
  };

  if (Array.isArray(payload.components)) {
    for (const c of payload.components) walk(c);
  }

  return chunks.join('\n');
}

export const extractCv2Text = extractPayloadText;

/**
 * Bộ kiểm định nghiêm ngặt giới hạn chính thức của Discord API v10 cho Components V2:
 * - Có cờ `MessageFlags.IsComponentsV2`
 * - Không tồn tại `content` hoặc `embeds`
 * - Tổng component lồng nhau <= 40, top-level <= 10
 * - Tổng ký tự TextDisplay <= 4000
 * - Section có 1..3 TextDisplay + 1 Accessory; MediaGallery có 1..10 items; custom_id duy nhất <= 100 ký tự
 */
export function validateCv2Payload(payload) {
  const errors = [];
  const flags = Number(payload?.flags ?? 0);

  if ((flags & MessageFlags.IsComponentsV2) !== MessageFlags.IsComponentsV2) {
    errors.push('Thiếu cờ bắt buộc MessageFlags.IsComponentsV2.');
  }
  if (payload?.content !== undefined) {
    errors.push('Components V2 không được phép chứa trường content.');
  }
  if (payload?.embeds !== undefined) {
    errors.push('Components V2 không được phép chứa trường embeds.');
  }

  const top = payload?.components ?? [];
  if (!Array.isArray(top) || top.length < 1 || top.length > CV2_LIMITS.MAX_TOP_LEVEL_COMPONENTS) {
    errors.push(`Số lượng component cấp cao nhất không hợp lệ: ${top?.length}`);
  }

  let totalComponents = 0;
  let totalTextChars = 0;
  const seenCustomIds = new Set();

  const visit = (raw) => {
    const node = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
    if (!node || typeof node !== 'object') {
      errors.push('Phát hiện component rỗng hoặc không hợp lệ.');
      return;
    }

    totalComponents += 1;

    if (node.custom_id) {
      if (node.custom_id.length > CV2_LIMITS.MAX_CUSTOM_ID_LENGTH) {
        errors.push(`custom_id vượt quá 100 ký tự: ${node.custom_id}`);
      }
      if (seenCustomIds.has(node.custom_id)) {
        errors.push(`Trùng lặp custom_id trong cùng tin nhắn: ${node.custom_id}`);
      }
      seenCustomIds.add(node.custom_id);
    }

    if (node.type === ComponentType.TextDisplay) {
      totalTextChars += String(node.content ?? '').length;
    } else if (node.type === ComponentType.Section) {
      const sub = node.components ?? [];
      if (sub.length < 1 || sub.length > CV2_LIMITS.MAX_SECTION_TEXTS) {
        errors.push(`Section phải chứa 1..3 TextDisplay (hiện có ${sub.length}).`);
      }
      if (!node.accessory) {
        errors.push('Section thiếu accessory bắt buộc (Thumbnail hoặc Button).');
      }
      for (const c of sub) visit(c);
      if (node.accessory) visit(node.accessory);
      return;
    } else if (node.type === ComponentType.MediaGallery) {
      const items = node.items ?? [];
      if (items.length < 1 || items.length > CV2_LIMITS.MAX_GALLERY_ITEMS) {
        errors.push(`MediaGallery phải có 1..10 items (hiện có ${items.length}).`);
      }
      return;
    } else if (node.type === ComponentType.ActionRow) {
      const rowChildren = node.components ?? [];
      if (rowChildren.length < 1 || rowChildren.length > CV2_LIMITS.MAX_BUTTONS_PER_ROW) {
        errors.push(`ActionRow có số lượng phần tử không hợp lệ: ${rowChildren.length}`);
      }
      const hasSelect = rowChildren.some((c) => c.type >= 3 && c.type <= 8 && c.type !== 4);
      if (hasSelect && rowChildren.length > 1) {
        errors.push('ActionRow chứa SelectMenu chỉ được phép có đúng 1 phần tử.');
      }
      for (const c of rowChildren) visit(c);
      return;
    }

    if (Array.isArray(node.components)) {
      for (const c of node.components) visit(c);
    }
  };

  for (const rootComp of top) {
    visit(rootComp);
  }

  if (totalComponents > CV2_LIMITS.MAX_TOTAL_COMPONENTS) {
    errors.push(`Vượt trần 40 component của Discord API (hiện có ${totalComponents}).`);
  }
  if (totalTextChars > CV2_LIMITS.MAX_SHARED_TEXT_LENGTH) {
    errors.push(`Vượt trần 4000 ký tự TextDisplay (hiện có ${totalTextChars}).`);
  }

  return {
    valid: errors.length === 0,
    totalComponents,
    componentCount: totalComponents,
    totalTextChars,
    totalTextLength: totalTextChars,
    errors,
    reason: errors.join('; '),
  };
}
