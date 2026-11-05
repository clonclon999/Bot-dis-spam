# 🎮 DISCORD GAME BOT PRO MAX — DISCORD COMPONENTS V2 GAME CENTER, ECONOMY & ANTI-SPAM

Ứng dụng **Game Center thu nhỏ bên trong Discord** chuẩn Production phát triển bằng **Node.js (ES Modules)**, **`discord.js@14.28.1` (Discord Components V2 bản gốc: `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `ThumbnailBuilder`, `MediaGalleryBuilder`, `SeparatorBuilder`, `ModalBuilder`)** và **SQLite ACID (`sql.js` WASM)**. Tích hợp đồng bộ **GAME CENTER PRO MAX 7 Khu Vực (`/games`)**, **44 Tài Nguyên Đồ Họa Dark-Mode Neon Cyan & Purple Cục Bộ (`assets/`)**, **7 Giao Diện Trò Chơi Độc Lập**, **Kinh tế VNĐ, Ngân hàng sinh lãi, Nhiệm vụ, Thú cưng, Cửa hàng, Truy nã, Sự kiện đua Top, Quản trị ADMIN PRO** và **Anti-Spam `@Mention`**.

Tối ưu hóa chuyên biệt cho gói **FREE trên `botkeep.cloud`** (`512 MB RAM` • `50% CPU` • `1 GB Disk`) — tiêu thụ chỉ **~109 MB RSS / ~22.5 MB Heap**, tải ảnh từ bộ đệm RAM cục bộ `assets/` (`572 KB`, không gọi Internet mỗi lượt), giới hạn số luồng animation đồng thời (`AnimationManager`) và bảo toàn dữ liệu qua mọi lần restart.

---

## 🌟 Hệ Sinh Thái Tính Năng Chính (38 Slash Commands — Discord Components V2)

### 1. 👑 Phân Quyền 4 Cấp & Đặc Quyền OWNER Cố Định
- **`OWNER` (`1243061570247069696`)** được cố định cứng trực tiếp trong mã nguồn (`src/config/constants.js` & `src/systems/permissionManager.js`).
- Phân cấp kiểm tra phía máy chủ: `OWNER > ADMIN > MODERATOR > MEMBER`; chỉ `OWNER` có quyền cấp hoặc thu hồi `ADMIN`.

### 2. 🕹️ GAME CENTER PRO MAX (`/games`) — 7 Khu Vực Tương Tác Tại Chỗ
- Đa tầng `ContainerBuilder` với thanh nhấn **Neon Cyan & Electric Purple**, hỗ trợ xem **Riêng tư (Ephemeral V2)** cho Ví tiền / Hồ sơ / Đặt cược:
  1. **`Trang chủ`:** Banner Game Center lớn, tóm tắt tài khoản, Avatar, số dư VNĐ, Cấp độ & thanh EXP, điểm danh & đi làm nhanh.
  2. **`Danh sách trò chơi` & `Chi tiết từng game`:** Bộ sưu tập `MediaGallery` 7 trò chơi chính thức (tuyệt đối không có Đấu Boss), trạng thái kênh & lượng người đang chơi.
  3. **`Ví tiền & Ngân hàng`:** Số dư Ví, Ngân hàng thường, Sổ tiết kiệm, gửi nhanh toàn bộ & **Modal Gửi/Rút VNĐ** trực tiếp.
  4. **`Nhiệm vụ`:** Chuyển tab Ngày / Tuần / Đặc biệt kèm nút **Nhận Thưởng Ngay**.
  5. **`Cửa hàng & Túi đồ`:** Mua nhanh vật phẩm và mở túi sử dụng vật phẩm bằng Select Menu ngay trên cùng giao diện.
  6. **`Hồ sơ cá nhân`:** Khung viền Cyber, thống kê thắng/thua, thú cưng đồng hành, buff đang bật & đổi Danh hiệu tức thì.
  7. **`Bảng xếp hạng`:** Top Đại Gia VNĐ, Top Cấp Độ, Top Thắng Trận & Top Nối Từ PRO.
- **9 Nút Điều Hướng Hoạt Động Thực 100%:** `Trang chủ`, `Chơi game`, `Ví tiền`, `Nhiệm vụ`, `Cửa hàng`, `Hồ sơ`, `Làm mới`, `Quay lại`, `Đóng giao diện` (chỉnh sửa tin nhắn hiện tại thay vì spam tin nhắn mới).

### 3. 🎲 7 Giao Diện Game Components V2 Độc Lập (Ưu Tiên #1: Bầu Cua & Tài Xỉu)
- **🦀 Bầu Cua PRO MAX (`/baucua`):** Bàn lưới `MediaGallery` 6 linh vật, đặt riêng từng cửa hoặc qua Modal, nút `Đặt lại cửa cũ` & `Xóa chọn`, khóa kết quả `crypto.randomInt` trước khi chạy GIF lắc xúc xắc, mở bát 3 linh vật và bảng thanh toán `2x / 3x / 4x`.
- **🎲 Tài Xỉu Casino VIP (`/taixiu`):** Banner riêng, hai khu vực `TÀI (11–17)` & `XỈU (4–10)` (tổng `3`/`18` Nhà cái thắng), bộ 3 xúc xắc `MediaGallery`, cầu lịch sử 10 phiên SQLite, nút `Cược Riêng Tư (Ephemeral)`, GIF tung xúc xắc & bảng thanh toán.
- **🔤 Nối Từ Game Show 1v1 (`/noitu`):** Hai khu vực `SectionBuilder` kèm Avatar từng tuyển thủ, thanh hiển thị lượt, từ cần nối, đồng hồ đếm ngược 30 giây, lịch sử từ, từ điển cục bộ **3.708 từ ghép** và bảng vinh danh người thắng.
- **✂️ Oẳn Tù Tì (`/rps`):** Bộ 3 lựa chọn Kéo • Búa • Bao minh họa, đếm ngược GIF và bảng đối đầu 2 người chơi (Bot & PvP).
- **🔢 Đoán Số Bí Ẩn (`/guess`):** Khoảng thu hẹp động `[low..high]`, tim lượt đoán, gợi ý **Lớn Hơn / Nhỏ Hơn**, nút đoán nhanh số giữa trên điện thoại + Modal nhập số & GIF mở két.
- **🪙 Tung Đồng Xu (`/coinflip`):** Đồng xu lớn Sấp / Ngửa, hiệu ứng xoay đồng xu GIF & bảng thưởng `2x`.
- **🐎 Đua Thú Tốc Độ (`/race`):** 5 chiến thú `MediaGallery`, đường đua 2 chặng tiến độ trực tiếp tới vạch đích và bảng xếp hạng `#1..#5` (thưởng `4.5x`).

### 4. 🧱 Kiến Trúc Tách Lớp Rõ Ràng
- `src/ui/` — **UI Components (`componentsV2.js`, `theme.js`, `navigation.js`)**, **Animation Manager (`animationManager.js`)** & **Interaction Responder (`interactionHelpers.js`)**
- `src/systems/gameSystem.js`, `wordChainSystem.js` — **Game Engine**
- `src/systems/economySystem.js`, `bankSystem.js`, `shopSystem.js` — **Economy Engine**
- `src/events/interactionCreate.js`, `src/commands/index.js` — **Interaction Handler**
- `src/database/db.js`, `schema.js` — **Database Layer (SQLite ACID)**
- `src/systems/permissionManager.js`, `src/utils/permissions.js` — **Permission Manager**

---

## 🚀 Hướng Dẫn Triển Khai Lên `botkeep.cloud` (Gói FREE)

1. Kết nối kho GitHub `https://github.com/clonclon999/Bot-dis-spam` (nhánh `main`) hoặc tải gói nén gốc `/home/user/Bot-dis-spam-deploy.zip` lên Node.js Server Free (`512MB RAM / 1GB Disk`).
2. Điền biến môi trường (`DISCORD_TOKEN`, `CLIENT_ID`, `AUTO_DEPLOY_COMMANDS=true`, `DATA_DIR=./data`) và bật **Message Content Intent** trong Discord Developer Portal.
3. Sau khi Bot online, gán kênh riêng cho từng trò chơi bằng `/admin game setchannel` để giữ sạch kênh chat chung.

---

## 🧪 Kiểm Thử Tự Động

```bash
npm install
npm run check   # Kiểm tra cú pháp 78 tệp .js, 38 Slash Commands (<4000 chars) & quét chống lộ Token
npm test        # Chạy toàn bộ 43 bài kiểm thử tự động trên 17 bộ test (bao gồm kiểm định nghiêm ngặt Components V2)
```
