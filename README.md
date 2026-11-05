# 🎮 DISCORD GAME BOT PRO — INTERACTIVE VISUAL GAME CENTER, ECONOMY & ANTI-SPAM

Hệ thống Bot Discord đa năng chuẩn Production phát triển bằng **Node.js (ES Modules)**, **discord.js v14** và **SQLite ACID (`sql.js` WASM)**, tích hợp **Trung Tâm Trò Chơi Tương Tác Trực Quan (`/games`)**, **Bộ 41 Tài Nguyên Hình Ảnh PNG & Animation GIF Cục Bộ (`assets/`)**, **Bảng Đặt Cược Tương Tác Chung**, **Kinh tế VNĐ, Ngân hàng sinh lãi, 7 Trò chơi chính thức công bằng (`crypto.randomInt`), Nhiệm vụ, Thú cưng, Cửa hàng, Truy nã, Sự kiện đua Top, Quản trị ADMIN PRO** cùng lá chắn **Anti-Spam `@Mention`**.

Được thiết kế và tối ưu hóa chuyên biệt cho gói **FREE trên `botkeep.cloud`** (`512 MB RAM` • `50% CPU` • `1 GB Disk`) — tiêu thụ chỉ **~95 MB RSS / ~23 MB Heap**, tải ảnh trực tiếp từ thư mục cục bộ `assets/` (`552 KB`, không gọi Internet mỗi lượt, không dùng thư viện đồ họa C++ nặng), tự động thu dọn bảng cũ & bảo toàn dữ liệu khi container khởi động lại.

---

## 🌟 Hệ Sinh Thái Tính Năng Chính (38 Slash Commands)

### 1. 👑 Phân Quyền 4 Cấp & Đặc Quyền OWNER Cố Định
- **`OWNER` (`1243061570247069696`)** được cố định cứng trực tiếp trong mã nguồn (`src/config/constants.js`), bất khả xâm phạm.
- Phân cấp chặt chẽ: `OWNER > ADMIN > MODERATOR > MEMBER`.
- Lệnh riêng `/owner` dành độc quyền cho `OWNER` và cơ chế **xác nhận 2 bước bằng nút bấm** cho mọi thao tác nhạy cảm.

### 2. 🎮 Trung Tâm Trò Chơi Hình Ảnh (`/games`) & 7 Trò Chơi Chính Thức (Không Đấu Boss)
- **`/games` Interactive Visual Game Center:** Hiển thị Banner Game Center cục bộ, danh sách đúng **7 trò chơi chính thức** (`Bầu Cua`, `Tài Xỉu`, `Nối Từ`, `Oẳn Tù Tì`, `Đoán Số`, `Tung Đồng Xu`, `Đua Thú`), hình ảnh riêng từng trò, trạng thái hoạt động, số người đang chơi, nút **Tham Gia Ngay** và **Xem Luật**.
- **Giao Diện Đặt Cược Chung Chuẩn Hóa:** Nút chọn nhanh `100 VNĐ`, `500 VNĐ`, `1.000 VNĐ`, `5.000 VNĐ`, `10.000 VNĐ`, `Tất cả`, `Modal nhập tùy chỉnh`, `Xác nhận`, `Hủy`, `Quay lại` — **chỉ trừ tiền sau khi xác nhận cược thành công** kèm khóa chống bấm đúp.
- **Ưu tiên #1 — Bầu Cua (`/baucua`) & Tài Xỉu Casino (`/taixiu`):**
  - **Bầu Cua:** Bàn lưới hình ảnh 6 linh vật (`Bầu, Cua, Tôm, Cá, Gà, Nai`), đặt tiền riêng từng cửa, hiển thị số dư dự kiến sau cược, GIF lắc 3 xúc xắc, ảnh kết quả 3 xúc xắc thực tế và bảng thanh toán `2x / 3x / 4x`.
  - **Tài Xỉu Casino:** Hai khu vực `TÀI (11–17)` & `XỈU (4–10)`, tổng `3` hoặc `18` Nhà cái thắng, GIF tung xúc xắc, ảnh 3 mặt xúc xắc thực tế và lịch sử cầu 10 phiên.
- **5 Trò Chơi Đồng Bộ Hình Ảnh & Hiệu Ứng:**
  - **Nối Từ Game Show (`/noitu`):** Đấu 2 người chơi với Banner Game Show, Avatar người chơi, thanh lượt chơi trực quan, từ điển cục bộ **3.708 từ ghép**, đếm ngược 30s, xử thắng ngay khi hết từ nối tiếp & thưởng chuỗi thắng VNĐ.
  - **Oẳn Tù Tì (`/rps`):** Hình Kéo • Búa • Bao, GIF đếm ngược mở kết quả đồng thời (PvE & PvP).
  - **Đoán Số (`/guess`):** Giới hạn lượt đoán kèm gợi ý **Lớn Hơn / Nhỏ Hơn** sau mỗi lượt và GIF mở két kết quả.
  - **Tung Đồng Xu (`/coinflip`):** Hình mặt Sấp / Ngửa, GIF đồng xu xoay trên không & trả thưởng 2x.
  - **Đua Thú (`/race`):** 5 chiến thú với diễn biến đường đua trực tiếp qua từng chặng tới vạch đích (thưởng 4.5x).

### 3. 📍 Bắt Buộc Cài Kênh Riêng Cho Từng Trò Chơi & Tự Động Xóa Bảng Cũ
- **100% trò chơi bắt buộc đúng kênh chat riêng (`/admin game setchannel`):** Cả **7 trò chơi** đều bắt buộc gán kênh riêng biệt trước khi chơi để giữ sạch kênh chat chung.
- **Tự động thu dọn bảng cũ (`PanelCleaner`) & Chỉnh sửa Embed tại chỗ:** Tối ưu số lần cập nhật tin nhắn tránh giới hạn Discord API.

### 4. 💰 Kinh Tế VNĐ, Ngân Hàng, 9 Nhiệm Vụ Ngày, Thú Cưng, Cửa Hàng & Sự Kiện
- **Kinh tế & Ngân hàng:** `/balance`, `/daily`, `/weekly`, `/monthly`, `/work`, `/beg`, `/pay`, `/deposit`, `/withdraw`, `/interest`, `/top`, `/history`.
- **Nhiệm vụ, Thú cưng, Cửa hàng, Giang hồ, Sự kiện & Chống Spam `@Mention`:** `/quest` (đủ 9 nhiệm vụ ngày cho Đăng nhập, Đi làm & cả 7 game + 4 nhiệm vụ tuần kèm Banner cục bộ), `/pet`, `/shop` (kèm Banner cửa hàng & Trứng Thú Cưng), `/buy`, `/inventory`, `/use`, `/sell`, `/profile`, `/rob` (chống farm lặp mục tiêu), `/protect`, `/bounty`, `/wanted`, `/event` (gồm cả Sự kiện Nối Từ), `/admin`, `/owner`, `/antispam`.

---

## 🚀 Hướng Dẫn Triển Khai Lên `botkeep.cloud` (Gói FREE)

1. Kết nối kho GitHub `https://github.com/clonclon999/Bot-dis-spam` (nhánh `main`) hoặc tải gói nén gốc lên Node.js Server Free (`512MB RAM / 1GB Disk`).
2. Điền biến môi trường (`DISCORD_TOKEN`, `CLIENT_ID`, `AUTO_DEPLOY_COMMANDS=true`, `DATA_DIR=./data`) và bật **Message Content Intent** trong Discord Developer Portal.
3. Sau khi Bot online, gán kênh riêng cho từng trò chơi để tránh loạn kênh chat chung:
   - `/admin game setchannel game:🔤 Nối Từ Tiếng Việt ch:#nối-từ`
   - `/admin game setchannel game:🦀 Bầu Cua ch:#bầu-cua`
   - `/admin game setchannel game:🎲 Tài Xỉu ch:#tài-xỉu` *(và tương tự cho các trò còn lại, kiểm tra bằng `/admin game channels`)*.

---

## 🧪 Kiểm Thử Tự Động

```bash
npm install
npm run check   # Kiểm tra cú pháp 71 tệp, giới hạn Discord API (<4000 chars) & quét chống lộ Token
npm test        # Chạy toàn bộ 40 bài kiểm thử tự động trên 16 bộ test chuyên sâu
```
