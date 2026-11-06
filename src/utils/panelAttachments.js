/**
 * Bộ nhớ đệm tên tệp đính kèm của từng tin nhắn bảng (panel) để **không tải lại ảnh** mỗi lần cập nhật.
 *
 * Vì sao cần: mỗi lần sửa bảng (bấm nút, gửi modal, đổi trạng thái), code cũ luôn đính kèm lại
 * ảnh/gif => Discord phải nhận upload lại toàn bộ (có bảng 5 ảnh ~250 KB). Trên VPS gói FREE,
 * mỗi tương tác mất 2–7 giây và dễ bị timeout. Discord GIỮ NGUYÊN tệp đính kèm cũ khi edit
 * và các URL dạng `attachment://ten-tep.png` vẫn trỏ đúng vào tệp cũ, nên chỉ cần:
 *   - Không gửi lại `files` nếu mọi tên tệp đã có sẵn trên tin nhắn.
 *   - Không xoá `attachments` khi bảng mới vẫn còn tham chiếu ảnh.
 *
 * @module utils/panelAttachments
 */

/** @type {Map<string, Set<string>>} messageId -> tên các tệp đính kèm hiện có */
const attachmentNamesByMessage = new Map();

/** Giới hạn bộ nhớ: chỉ giữ 300 tin nhắn gần nhất */
const MAX_ENTRIES = 300;

function touchEntry(messageId, names) {
  if (!messageId) return;
  if (attachmentNamesByMessage.has(messageId)) {
    attachmentNamesByMessage.delete(messageId);
  }
  attachmentNamesByMessage.set(messageId, names);
  while (attachmentNamesByMessage.size > MAX_ENTRIES) {
    const oldest = attachmentNamesByMessage.keys().next().value;
    attachmentNamesByMessage.delete(oldest);
  }
}

/**
 * Lấy tên các tệp đính kèm đã biết của tin nhắn (từ Discord hoặc từ bộ nhớ đệm).
 * @param {any} message
 * @returns {Set<string>}
 */
export function getKnownAttachmentNames(message) {
  const names = new Set();
  if (!message) return names;

  const id = message.id ? String(message.id) : null;
  const cached = id ? attachmentNamesByMessage.get(id) : null;
  if (cached) for (const n of cached) names.add(n);

  const attachments = message.attachments;
  if (attachments && typeof attachments.values === 'function') {
    for (const att of attachments.values()) {
      if (att?.name) names.add(String(att.name));
    }
  } else if (Array.isArray(attachments)) {
    for (const att of attachments) if (att?.name) names.add(String(att.name));
  }
  return names;
}

/**
 * Ghi nhớ tên tệp đính kèm sau khi ĐĂNG bảng mới để các lần cập nhật sau không phải tải lại.
 * @param {any} message Tin nhắn Discord vừa gửi (có `id`).
 * @param {object} payload Payload Components V2 đã gửi.
 */
export function rememberPanelAttachments(message, payload) {
  if (!message?.id) return;
  const names = getKnownAttachmentNames(message);
  for (const file of payload?.files ?? []) {
    const name = file?.name || file?.attachment?.name;
    if (name) names.add(String(name));
  }
  touchEntry(String(message.id), names);
}

/**
 * Trích các tên tệp mà payload đang tham chiếu qua `attachment://...`.
 * @param {object} payload
 * @returns {Set<string>}
 */
export function collectReferencedAttachmentNames(payload) {
  const names = new Set();
  if (!payload) return names;
  try {
    const json = JSON.stringify(payload.components ?? []);
    for (const m of json.matchAll(/attachment:\/\/([^"\\]+)/g)) {
      names.add(decodeURIComponent(m[1]));
    }
  } catch {
    // Bỏ qua: payload không tuần tự hoá được thì coi như không tham chiếu ảnh
  }
  return names;
}

/**
 * 🪶 LÀM NHẸ PAYLOAD KHI CẬP NHẬT BẢNG:
 * - Nếu mọi ảnh mà bảng mới tham chiếu đã có sẵn trên tin nhắn => bỏ `files` (không upload lại),
 *   đồng thời KHÔNG xoá `attachments` để các URL `attachment://...` cũ vẫn hiển thị.
 * - Nếu bảng mới không tham chiếu ảnh nào và không có file => xoá ảnh cũ như hành vi cũ.
 * - Nếu bảng mới cần ảnh MỚI (VD: banner thắng/thua khác tên) => giữ nguyên `files` để upload.
 *
 * @param {object} payload
 * @param {any} message Tin nhắn đang được chỉnh sửa (`interaction.message`).
 * @returns {object} Payload đã tối ưu (không sửa payload gốc).
 */
export function applySlimEdit(payload, message) {
  if (!payload || !message) return payload;

  const referenced = collectReferencedAttachmentNames(payload);
  const known = getKnownAttachmentNames(message);

  if (referenced.size > 0) {
    const allPresent = [...referenced].every((n) => known.has(n));
    if (allPresent) {
      const { files, attachments, ...rest } = payload;
      return rest; // Không gửi file, không xoá attachments => tái sử dụng ảnh đã có
    }
    return payload; // Cần ảnh mới: upload như bình thường
  }

  // Bảng mới không tham chiếu ảnh nào
  if (Array.isArray(payload.files) && payload.files.length > 0) return payload;
  return payload.attachments !== undefined ? payload : { ...payload, attachments: [] };
}

/**
 * Xoá dấu vết của một tin nhắn (VD: bảng đã bị xoá / phiên kết thúc).
 * @param {string} messageId
 */
export function forgetPanelAttachments(messageId) {
  if (!messageId) return;
  attachmentNamesByMessage.delete(String(messageId));
}

/** Xoá sạch bộ nhớ đệm (dùng khi shutdown/tests). */
export function resetPanelAttachmentCache() {
  attachmentNamesByMessage.clear();
}
