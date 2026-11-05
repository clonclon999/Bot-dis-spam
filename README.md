# 🎮 DISCORD GAME BOT PRO — ADVANCED ECONOMY, GAMING & ANTI-SPAM SYSTEM

Hệ thống Bot Discord đa năng chuẩn Production phát triển bằng **Node.js (ES Modules)**, **discord.js v14** và **SQLite ACID (`sql.js` WASM)**, tích hợp trọn vẹn hệ sinh thái **Kinh tế VNĐ, Ngân hàng sinh lãi, 7 Trò chơi dân gian & ngôn ngữ đối kháng công bằng (`crypto.randomInt` + Nối Từ Tiếng Việt PRO 2 người chơi), Nhiệm vụ, Thú cưng, Cửa hàng, Truy nã, Sự kiện đua Top, Quản trị ADMIN PRO** cùng lá chắn **Anti-Spam `@Mention`**.

Được thiết kế và tối ưu hóa chuyên biệt cho gói **FREE trên `botkeep.cloud`** (`512 MB RAM` • `50% CPU` • `1 GB Disk`) — tiêu thụ bộ nhớ cực thấp, tự động thu dọn bảng giao diện cũ & chỉnh sửa Embed trực tiếp chống spam, không dùng vòng lặp ngầm gây nghẽn CPU và bảo toàn dữ liệu khi container khởi động lại.

---

## 🌟 Hệ Sinh Thái Tính Năng Chính (37 Slash Commands)

### 1. 👑 Phân Quyền 4 Cấp & Đặc Quyền OWNER Cố Định
- **`OWNER` (`1243061570247069696`)** được cố định cứng trực tiếp trong mã nguồn (`src/config/constants.js`), bất khả xâm phạm.
- Phân cấp chặt chẽ: `OWNER > ADMIN > MODERATOR > MEMBER`.
- Lệnh riêng `/owner` dành độc quyền cho `OWNER` và cơ chế **xác nhận 2 bước bằng nút bấm** cho mọi thao tác nhạy cảm.

### 2. 📍 Bắt Buộc Cài Kênh Riêng Cho Từng Trò Chơi & Tự Động Xóa Bảng Cũ
- **100% trò chơi bắt buộc đúng kênh chat riêng (`/admin game setchannel`):**
  - Cả **7 trò chơi** (`baucua`, `taixiu`, `coinflip`, `guess`, `race`, `rps`, `noitu`) đều bắt buộc được gán kênh riêng biệt trước khi chơi.
  - Gọi lệnh hoặc bấm nút cũ ở nhầm kênh chat chung sẽ bị chặn bằng tin nhắn ẩn (*Ephemeral*) và dẫn thẳng sang `#kênh` đúng của trò đó.
- **Tự động thu dọn bảng cũ (`PanelCleaner`) & Chỉnh sửa Embed tại chỗ:** Mở bảng mới tự động xóa bảng trước đó; bàn chơi Nối Từ PRO tự chỉnh sửa trực tiếp trên cùng một Embed để kênh chat luôn gọn sạch.

### 3. 🔤 Module Nâng Cấp: Trò Chơi Nối Từ Tiếng Việt PRO (`/noitu`)
- **Đối kháng 2 người chơi theo phòng (`Room System`):**
  - Lệnh đầy đủ: `/noitu lobby`, `/noitu create [invite]`, `/noitu join [room]`, `/noitu start [room]`, `/noitu surrender`, `/noitu stats [user]`, `/noitu leaderboard [type]`, `/noitu rules`.
  - Hỗ trợ mời đích danh bạn bè, chạy **nhiều phòng thi đấu song song**, khóa chủ phòng (`start`/`cancel`) và chặn tuyệt đối người ngoài can thiệp vào trận đấu.
- **Kho Từ Điển Tiếng Việt Cấu Trúc Riêng (`VietnameseDictionary`):**
  - Hơn **3.700+ từ ghép 2 tiếng tiếng Việt** tra cứu cục bộ O(1) bằng `Map`/`Set` (không gọi AI/API ngoài), chuẩn hóa hoa/thường, khoảng trắng và dấu thanh (`hoà` = `hòa`, `khoá` = `khóa`).
  - Bộ hàm chuẩn: `normalizeWord()`, `validateWord()`, `getFirstToken()`, `getLastToken()`, `getNextValidWords()`, `hasPossibleNextWord()`.
  - **Cơ chế tìm từ cuối cùng:** Nếu từ hợp lệ vừa nối khiến tiếng cuối không còn bất kỳ từ hợp lệ nào trong từ điển nối tiếp được, người vừa đưa ra từ đó **lập tức chiến thắng**.
- **Đếm ngược chống AFK & Thưởng Chuỗi Thắng VNĐ:**
  - Mặc định **30 giây/lượt** (tự động nhắc khi còn **10 giây** và xử thua khi hết giờ bằng `setTimeout` đơn lẻ, giải phóng sạch timer sau trận).
  - Thưởng mặc định: **+1.000 VNĐ/trận**, chuỗi thắng **3 trận (+1.000 VNĐ)**, **5 trận (+3.000 VNĐ)**, **10 trận (+10.000 VNĐ)** — chống trả thưởng trùng 2 lần 100%.
  - Quản trị viên điều chỉnh qua `/admin noitu reward`, `/admin noitu cooldown`, `/admin noitu timeout` *(chỉ OWNER)*, `/admin noitu enable`, `/admin noitu disable`, `/admin noitu addword`.
  - Lưu trữ SQLite bền vững (`noitu_rooms`, `noitu_matches`, `noitu_stats`) kèm chính sách phục hồi an toàn `aborted_restart` bảo toàn chuỗi thắng khi Bot khởi động lại giữa trận.

### 4. 💰 Kinh Tế VNĐ, Ngân Hàng Lãi Kép & 6 Sòng Minigame (`crypto.randomInt`)
- **Kinh tế & Ngân hàng:** `/balance`, `/daily`, `/weekly`, `/monthly`, `/work`, `/beg`, `/pay`, `/deposit`, `/withdraw`, `/interest`, `/top`, `/history` (chống cộng lãi trùng tuyệt đối khi restart).
- **6 Trò chơi cá cược công bằng:** Bầu Cua (`/baucua`), Tài Xỉu (`/taixiu`), Tung Đồng Xu (`/coinflip`), Đoán Số (`/guess`), Đua Thú (`/race`), Oẳn Tù Tì PvE & PvP (`/rps`).
- **Nhiệm vụ, Thú cưng, Cửa hàng, Giang hồ, Sự kiện & Chống Spam `@Mention`:** `/quest`, `/pet`, `/shop`, `/buy`, `/inventory`, `/use`, `/sell`, `/profile`, `/rob`, `/protect`, `/bounty`, `/wanted`, `/event`, `/admin`, `/owner`, `/antispam`.

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
npm run check   # Kiểm tra cú pháp 67 tệp, giới hạn Discord API (<4000 chars) & quét chống lộ Token
npm test        # Chạy toàn bộ 36 bài kiểm thử tự động trên 15 bộ test chuyên sâu
```
