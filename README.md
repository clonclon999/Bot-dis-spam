# 🎮 DISCORD GAME BOT PRO MAX — MULTIPLAYER ROUND SYSTEM (PUBLIC START), PREMIUM 3D VISUALS, COMPONENTS V2 & ANTI-SPAM

Ứng dụng **Casino & Game Center 3D thu nhỏ bên trong Discord** chuẩn Production phát triển bằng **Node.js (ES Modules)**, **`discord.js@14.28.1` (Discord Components V2 bản gốc: `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `ThumbnailBuilder`, `MediaGalleryBuilder`, `SeparatorBuilder`, `ModalBuilder`)** và **SQLite ACID (`sql.js` WASM)**. Tích hợp **Hệ Thống Phiên Cược Chung Toàn Server (`/game start` — Public Start 100%)**, **GAME CENTER PRO MAX 7 Khu Vực (`/games`)**, **84 Tài Nguyên Đồ Họa Premium Gaming/Casino 3D Cục Bộ (`assets/` — 3.1 MB)**, **7 Trò Chơi Chính Thức** *(tuyệt đối không có Đấu Boss)*, **Kinh tế VNĐ, Ngân hàng sinh lãi, Nhiệm vụ, Thú cưng, Cửa hàng, Truy nã, Sự kiện đua Top, Quản trị ADMIN PRO** và **Anti-Spam `@Mention`**.

Tối ưu hóa chuyên biệt cho gói **FREE trên `botkeep.cloud`** (`512 MB RAM` • `50% CPU` • `1 GB Disk`) — tải 84 ảnh PNG/GIF 3D từ bộ đệm RAM cục bộ `assets/`, giới hạn luồng animation đồng thời (`AnimationManager`), sử dụng **DB Timestamp (`ends_at`)** làm nguồn chân lý thời gian và tự động phục hồi phiên đang dở sau mọi lần Bot restart mà không bao giờ quay lại hay trả thưởng kép.

---

## 🌟 Hệ Sinh Thái Tính Năng Chính (39 Slash Commands — Discord Components V2 + 3D Visuals)

### 1. 🚀 HỆ THỐNG PHIÊN CƯỢC CHUNG TOÀN SERVER — PUBLIC START (`/game`)
- **PUBLIC START 100% (Ưu tiên số 1):** BẤT KỲ thành viên thường nào trong Server *(không cần quyền `OWNER`, `ADMIN`, `MODERATOR` hay quyền quản trị Discord)* đều có thể mở phiên cược chung mới qua `/game start <tro_choi>` hoặc bấm nút công khai **`🚀 Mở phiên tiếp theo`** / **`🚀 Mở Phiên Chung`** trong `/games`.
- **Chống tạo trùng phiên tuyệt đối:** Khóa Mutex theo `(guildId, gameId)` + SQLite Transaction đảm bảo dù 10 thành viên bấm `START` cùng một micro-giây cũng chỉ tạo duy nhất **1 phiên đang mở** và hiển thị liên kết tới phiên đó. Người mở phiên được vinh danh trên bảng phiên nhưng **không có bất kỳ quyền can thiệp quản trị nào**.
- **3 Trò Chơi Phiên Chung Dùng Chung 1 Kết Quả Duy Nhất (`crypto.randomInt` lưu DB trước khi quay):**
  - **🦀 Bầu Cua 3D (`60s` mặc định):** 6 cửa (`Bầu, Cua, Tôm, Cá, Gà, Nai`), trả thưởng **`2x` (1 nháy) / `3x` (2 nháy) / `4x` (3 nháy đồng nhất)**.
  - **🎲 Tài Xỉu Casino 3D (`60s` mặc định):** 2 cửa (`TÀI 11–17`, `XỈU 4–10`), trả thưởng **`2x`**; công bố rõ luật **Bộ ba đồng nhất `3` (`1-1-1`) hoặc `18` (`6-6-6`) Nhà cái thắng**.
  - **🏇 Đua Thú 3D (`90s` mặc định):** 5 chiến thú tranh tài chung toàn phòng, chiến thú về hạng `#1` trả thưởng **`4.5x`**.
- **Vòng Đời Phiên Tự Động & Mốc Đếm Ngược:** `WAITING -> BETTING -> LOCKED -> DRAWING -> SETTLING -> COMPLETED / CANCELLED` với thông báo mốc `30s`, cảnh báo sắp khóa `10s`, hiệu ứng `5s` cuối và khóa sổ tức thì ở `0s` theo DB Timestamp (chỉnh sửa tin nhắn tại chỗ, không spam kênh).
- **Ma Trận Phân Quyền `/game` Rõ Ràng:**
  - **Mọi Thành Viên + ADMIN + OWNER:** `/game start`, đặt cược nhiều cửa, xem `/game status`, `/game history`, xem/sửa/hủy vé cược cá nhân khi phiên đang `BETTING` (theo cấu hình), xem biên lai & BXH phiên.
  - **Chỉ ADMIN / OWNER:** `/game stop` (hủy phiên khẩn cấp & hoàn tiền **100%** chống hoàn đúp + ghi `audit_logs`), `/game extend` (gia hạn thời gian đếm ngược), `/game settings` (chỉnh thời gian mở cược & hạn mức tối thiểu/tối đa).
  - **Chỉ OWNER (`1243061570247069696`):** Bật/tắt chế độ mở nhiều bàn song song (`multi_table`) và cấp/thu hồi `ADMIN`.

### 2. 🎨 Nâng Cấp Đồ Họa Premium Gaming / Casino 3D (`84` Tài Nguyên Cục Bộ)
- Phong cách **Dark Cinematic + Neon Cyan, Electric Purple & Gold + 3D Metallic / Glass / Glow** tối ưu hiển thị trên cả **Discord Android/iOS** lẫn **Desktop**:
  - **Bầu Cua 3D:** Banner 3D riêng, bàn sòng bài 3D, 6 linh vật 3D có chiều sâu, 6 viên xúc xắc 3D khối nghiêng, GIF lắc bát phát sáng, ảnh Thắng / Thua & Nổ Bão Bộ Ba riêng.
  - **Tài Xỉu 3D:** Banner 3D riêng, bàn xúc xắc 3D, 6 mặt xúc xắc số 3D, khu vực `TÀI` & `XỈU` phát sáng, GIF lăn xúc xắc, bảng kết quả & ảnh Thắng / Thua / Bão 3-18 riêng.
  - **Bộ Nghệ Thuật 3D Riêng Cho 5 Trò Chơi Còn Lại:** Nối Từ 1v1 (đồng hồ 30s GIF + vinh danh), Oẳn Tù Tì 3D (Kéo • Búa • Bao), Két Sắt Đoán Số 3D, Đồng Xu Hoàng Kim 3D & Trường Đua Thú 3D.

### 3. 🕹️ GAME CENTER PRO MAX (`/games`) & 7 Trò Chơi Chính Thức
- **7 Khu Vực Tương Tác Tại Chỗ:** `Trang chủ`, `Danh sách trò chơi` (hiển thị trực tiếp số người đang tham gia phiên chung + nút mở phiên ngay), `Ví tiền & Ngân hàng`, `Nhiệm vụ`, `Cửa hàng & Túi đồ`, `Hồ sơ cá nhân` & `Bảng xếp hạng`.
- Giữ nguyên trọn vẹn 100% tính năng chơi nhanh cá nhân (`/baucua`, `/taixiu`, `/rps`, `/guess`, `/coinflip`, `/race`), Game Show `/noitu` 1v1 (3.708 từ ghép Tiếng Việt), Kinh tế VNĐ, Ngân hàng sinh lãi, Thú cưng, Truy nã và hệ thống **Anti-Spam `@Mention`**.

---

## 🚀 Hướng Dẫn Triển Khai Lên `botkeep.cloud` (Gói FREE)

1. Kết nối kho GitHub `https://github.com/clonclon999/Bot-dis-spam` (nhánh `main`) hoặc tải gói nén gốc `/home/user/Bot-dis-spam-deploy.zip` lên Node.js Server Free (`512MB RAM / 1GB Disk`).
2. Điền biến môi trường (`DISCORD_TOKEN`, `CLIENT_ID`, `AUTO_DEPLOY_COMMANDS=true`, `DATA_DIR=./data`) và bật **Message Content Intent** trong Discord Developer Portal.
3. Gán kênh riêng cho từng trò chơi bằng `/admin game setchannel` — khi thành viên bấm `/game start` hoặc nút mở phiên từ bất kỳ đâu, bảng phiên chung sẽ tự động mở đúng kênh trò chơi đã cấu hình.

---

## 🧪 Kiểm Thử Tự Động

```bash
npm install
npm run check   # Kiểm tra cú pháp 81 tệp .js, 50 ES Modules, 39 Slash Commands (<4000 chars), OWNER ID & quét chống lộ Token
npm test        # Chạy toàn bộ 49 bài kiểm thử tự động trên 18 bộ test (bao gồm Multiplayer Public Start, ACID Concurrency, Restart Recovery & Components V2)
```
