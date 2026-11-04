# 🎮 DISCORD GAME BOT PRO — ADVANCED ECONOMY, GAMING & ANTI-SPAM SYSTEM

Hệ thống Bot Discord đa năng chuẩn Production phát triển bằng **Node.js (ES Modules)**, **discord.js v14** và **SQLite ACID (`sql.js` WASM)**, tích hợp trọn vẹn hệ sinh thái **Kinh tế VNĐ, Ngân hàng sinh lãi, 6 Trò chơi dân gian & đối kháng công bằng (`crypto.randomInt`), Nhiệm vụ, Thú cưng, Cửa hàng, Truy nã, Sự kiện đua Top, Quản trị ADMIN PRO** cùng lá chắn **Anti-Spam `@Mention`**.

Được thiết kế và tối ưu hóa chuyên biệt cho gói **FREE trên `botkeep.cloud`** (`512 MB RAM` • `50% CPU` • `1 GB Disk`) — tiêu thụ bộ nhớ cực thấp, không chạy vòng lặp ngầm gây nghẽn CPU, chống mất dữ liệu khi container khởi động lại.

---

## 🌟 Hệ Sinh Thái Tính Năng Chính (36 Slash Commands)

### 1. 👑 Phân Quyền 4 Cấp & Đặc Quyền OWNER Cố Định
- **`OWNER` (`1243061570247069696`)** được cố định cứng trực tiếp trong mã nguồn (`src/config/constants.js`), bất khả xâm phạm.
- Phân cấp chặt chẽ: `OWNER > ADMIN > MODERATOR > MEMBER`.
- Lệnh riêng `/owner` dành độc quyền cho `OWNER`: cấp/thu hồi `ADMIN` & `MODERATOR`, thu hồi toàn bộ `ADMIN`, đóng băng người chơi hoặc khóa toàn bộ giao dịch hệ thống, phát thưởng Airdrop toàn server, giám sát nhật ký thao tác của các `ADMIN`, cấu hình 7 kênh Log và quản lý danh sách Server.
- Mọi thao tác nhạy cảm (`resetuser`, `setmoney`, `ban`, `maintenance`, `restore`, `revokeall`, `freezeall`, `airdrop`, `event stop`) đều có **bước xác nhận 2 lớp bằng nút bấm (`✅ Xác nhận thực thi` / `❌ Hủy bỏ`)**.

### 2. 💰 Kinh Tế VNĐ & Ngân Hàng Lãi Kép An Toàn
- Tiền tệ ảo duy nhất trong game: **`VNĐ`** (`/balance`, `/daily`, `/weekly`, `/monthly`, `/work`, `/beg`, `/pay`, `/top`, `/history`).
- **Ngân hàng & Sổ tiết kiệm (`/deposit`, `/withdraw`, `/interest`):** Tính lãi suất tự động theo chu kỳ thời gian xác định (*Lazy Deterministic Accrual*) — khởi động lại Bot bao nhiêu lần hay gọi lệnh liên tiếp cũng **tuyệt đối không bao giờ cộng lãi trùng lặp**.
- Giao dịch nguyên tử SQLite Transaction + khóa đồng bộ `ConcurrencyGuard` chặn triệt để Race Condition, spam click và số âm.

### 3. 🎲 6 Trò Chơi Công Bằng Tuyệt Đối (`crypto.randomInt`)
- **Bầu Cua (`/baucua`):** 6 linh vật (Bầu, Cua, Tôm, Cá, Gà, Nai), bàn chơi tương tác bằng **Select Menu + Buttons + Modal** hỗ trợ đặt cược nhiều cửa cùng lúc trên 1 Embed duy nhất.
- **Tài Xỉu & Tài Xỉu Nâng Cao (`/taixiu`):** Lắc 3 xúc xắc trực quan, tự động xét Tài/Xỉu/Bão, kèm bảng thống kê tỷ lệ thắng cá nhân & lịch sử cầu gần nhất.
- **Tung Đồng Xu (`/coinflip`):** Sấp / Ngửa nhân đôi tiền thưởng kèm nút chơi lại nhanh.
- **Đoán Số (`/guess`):** 3 cấp độ khó (Dễ `1-5`, Trung bình `1-10`, Khó `1-25`) với hệ số thưởng tương ứng.
- **Đua Thú (`/race`):** Cập nhật diễn biến đường đua trực tiếp trên cùng một Embed.
- **Oẳn Tù Tì (`/rps`):** Đấu với Bot (PvE) hoặc **thách đấu trực tiếp người chơi khác (PvP)** ăn tiền VNĐ nguyên tử.

### 4. 📜 Nhiệm Vụ, 🐾 Thú Cưng, 🛒 Cửa Hàng, 🥷 Truy Nã & 🎉 Sự Kiện
- **Nhiệm vụ (`/quest daily|weekly|special|claim`):** 6 nhiệm vụ ngày, 4 nhiệm vụ tuần và nhiệm vụ đặc biệt kèm thanh tiến độ & nút nhận thưởng nhanh (chống nhận trùng).
- **Thú cưng (`/pet shop|buy|info|feed|upgrade|rename|equip|collection`):** 6 loài từ Common đến Secret (Kỳ Lân Tinh Tú mở từ Hộp Quà), cộng Bonus EXP & thưởng Nhiệm vụ (không can thiệp RNG trò chơi).
- **Cửa hàng (`/shop`, `/buy`, `/inventory`, `/use`, `/sell`):** Vé May Mắn, Thẻ x2 EXP, Bảo Hiểm Chống Cướp, Thức Ăn, Nước Tăng Lực, Khung Hồ Sơ, Danh Hiệu VIP và **Hộp Quà Bí Ẩn** mở thưởng thật.
- **Hồ sơ, Cấp độ & Giang hồ (`/profile`, `/rob`, `/protect`, `/bounty`, `/wanted`):** Hệ thống Cấp độ thưởng VNĐ, 12 Danh hiệu tự động mở khóa, cướp ví tiền mặt, bảo hiểm chống cướp & săn tiền thưởng Truy Nã.
- **Sự kiện Server (`/event list|leaderboard`):** 7 loại sự kiện đua Top & phát thưởng tự động Top 1/2/3.
- **Quản trị `/admin` & Chống Spam `/antispam`:** 42 lệnh con quản trị chia 6 nhóm + Bảng điều khiển tương tác `/admin system dashboard` + Sao lưu/Khôi phục SQLite ngay trên Discord + Hệ thống chống spam `@Mention` chuyên sâu.

---

## 🚀 Hướng Dẫn Cài Đặt Lên `botkeep.cloud` (Gói FREE)

1. **Chuẩn bị trên Discord Developer Portal:**
   - Truy cập [Discord Developer Portal](https://discord.com/developers/applications) → Chọn ứng dụng Bot của bạn.
   - Tại mục **General Information**, sao chép **Application ID** (`CLIENT_ID`).
   - Tại mục **Bot**:
     - Nhấn **Reset Token** để lấy `DISCORD_TOKEN`.
     - Kéo xuống phần **Privileged Gateway Intents**, bật **Message Content Intent** → Nhấn **Save Changes**.
   - Mời Bot vào Server với scopes `bot` + `applications.commands` (quyền khuyến nghị: `View Channels`, `Send Messages`, `Embed Links`, `Manage Messages`, `Moderate Members`).

2. **Triển khai trên `botkeep.cloud`:**
   - Đăng nhập [botkeep.cloud](https://botkeep.cloud) → Tạo Server **Node.js (Free Plan: 512MB RAM / 1GB Disk)**.
   - Kết nối trực tiếp kho GitHub `https://github.com/clonclon999/Bot-dis-spam` (nhánh `main`) hoặc tải lên gói mã nguồn gốc.
   - Mở tab **Variables / Startup Environment**, điền các biến môi trường sau (không cần đẩy file `.env` lên Git):
     ```env
     DISCORD_TOKEN=dan_bot_token_cua_ban_vao_day
     CLIENT_ID=dan_application_client_id_vao_day
     AUTO_DEPLOY_COMMANDS=true
     DATA_DIR=./data
     LOG_LEVEL=info
     ```
   - Đảm bảo lệnh khởi chạy (Startup Command) là `npm install && npm start` (hoặc `node src/index.js`).
   - Nhấn **Start**! Ngay khi trực tuyến, Bot sẽ tự động đồng bộ toàn bộ **36 Slash Commands** và khởi tạo cơ sở dữ liệu `./data/gamebot-pro.sqlite`.

3. **Kiểm tra nhanh trên Discord:**
   - Gõ `/menu` hoặc `/help` để mở trung tâm điều khiển tương tác.
   - Tài khoản OWNER (`1243061570247069696`) có thể gõ `/admin system dashboard` hoặc `/owner logchannel` để thiết lập các kênh nhận Log và vận hành máy chủ ngay lập tức.

---

## 🧪 Chạy Kiểm Thử Tự Động Cục Bộ

```bash
npm install
npm run check   # Kiểm tra cú pháp 60 tệp, giới hạn Discord API (<4000 chars) & quét chống lộ Token
npm test        # Chạy toàn bộ 29 bài kiểm thử tự động trên 13 bộ test chuyên sâu
```
