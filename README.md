# 🛡️ Bot-dis-spam — Discord Anti-Spam @Mention Bot

Hệ thống Discord Bot chuyên dụng xây dựng bằng **Node.js (ES Modules)** và **discord.js v14**, tập trung phát hiện và ngăn chặn tức thì mọi hành vi **spam `@mention`** (`@everyone`, `@here`, mention hàng loạt, mention dồn dập và mention lặp đi lặp lại) một cách chính xác, tiết kiệm bộ nhớ RAM và an toàn trên môi trường Cloud.

---

## ✨ Chức năng chính

- **Phát hiện `@everyone` & `@here` trái phép:** Chặn cả cờ mention thực tế lẫn văn bản thô `@everyone` / `@here` (tự động bỏ qua cú pháp nằm trong cặp dấu code `` `@everyone` `` hoặc email để tránh bắt nhầm).
- **Chặn Mass Mention trong 1 tin nhắn:** Phát hiện khi người dùng tag vượt quá số lượng thành viên/vai trò cho phép hoặc cố tình tag lặp đi lặp lại cùng một người nhiều lần trong một tin nhắn.
- **Chặn Mention dồn dập trong thời gian ngắn (Sliding Window Burst):** Theo dõi tổng số lượt mention trong cửa sổ trượt (mặc định `8` mention / `10` giây).
- **Chặn Spam Mention lặp lại qua nhiều tin nhắn:** Phát hiện cả hành vi quấy rối tag cùng 1 mục tiêu liên tiếp nhiều tin nhắn lẫn rải mention qua nhiều tin nhắn ngắn.
- **Chặn lách luật qua chỉnh sửa tin nhắn (`messageUpdate`):** Tự động kiểm tra khi người dùng gửi tin nhắn thường rồi sửa thành hàng loạt `@mention` hoặc `@everyone`.
- **Tránh xử phạt nhầm thông minh:**
  - Không tính mention ngầm định khi người dùng trả lời tin nhắn bằng nút **Reply** của Discord.
  - Tự động miễn trừ **Server Owner, Administrator, Moderator** (`ManageGuild`, `ModerateMembers`, `ManageMessages`) và danh sách **Whitelist** tùy chỉnh (Vai trò, Thành viên, Kênh/Thread).
- **Xử phạt lũy tiến tự động & chống tràn thông báo:**
  - Tự động xóa tin nhắn vi phạm.
  - Gửi Embed cảnh cáo nêu rõ lý do (có **cooldown chống spam ngược kênh chat** và **tự động thu hồi** sau vài giây để giữ sạch kênh).
  - Thang xử phạt tăng dần: **Mức 1 (Cảnh cáo)** → **Mức 2 (Timeout 5 phút)** → **Mức 3 (Timeout 30 phút)** → **Mức 4 (Timeout 2 giờ)** → **Mức 5 (Timeout 24 giờ)** *(các đợt raid `@everyone` nghiêm trọng được áp dụng Timeout ngay từ lần đầu)*.
- **Lưu trữ bền vững & Nhật ký chi tiết:** Cấu hình máy chủ và lịch sử xử lý được ghi nguyên tử (atomic write) xuống tệp JSON, không mất dữ liệu khi khởi động lại, đồng thời xuất báo cáo chi tiết ra kênh Log quản trị.
- **Tối ưu hiệu năng & Cloud-Ready:** Giới hạn bộ đệm Discord (`makeCache` + `sweepers`), tự dọn RAM định kỳ, chống crash toàn cục và tích hợp sẵn cổng HTTP Healthcheck (`PORT`) kèm `Dockerfile`.

---

## 📂 Cấu trúc dự án

```text
Bot-dis-spam/
├── src/
│   ├── index.js                  # Điểm khởi chạy chính, chống crash & Graceful Shutdown
│   ├── client.js                 # Khởi tạo Discord Client tối ưu RAM (Cache & Sweepers)
│   ├── deploy-commands.js        # Công cụ đăng ký Slash Commands qua Discord REST API
│   ├── config/
│   │   ├── defaults.js           # Ngưỡng chống spam mặc định & thang độ Timeout
│   │   └── env.js                # Kiểm tra tính hợp lệ của biến môi trường (.env)
│   ├── storage/
│   │   └── guildStore.js         # Lưu trữ cấu hình & log bền vững (RAM cache + Atomic JSON)
│   ├── services/
│   │   ├── mentionDetector.js    # Bộ phân tích & phát hiện spam mention cửa sổ trượt
│   │   ├── punishmentService.js  # Xóa tin, cảnh cáo chống tràn, Timeout lũy tiến & gửi Log
│   │   └── whitelistService.js   # Kiểm tra miễn trừ Admin/Mod & Whitelist tùy chỉnh
│   ├── commands/
│   │   └── antispam.js           # Toàn bộ 7 Slash Subcommands (/antispam ...)
│   ├── events/
│   │   ├── ready.js              # Sự kiện đăng nhập & tự đồng bộ Slash Commands
│   │   ├── messageCreate.js      # Kiểm duyệt tin nhắn mới & tin nhắn chỉnh sửa
│   │   └── interactionCreate.js  # Điều phối Slash Command an toàn
│   └── utils/
│       ├── embeds.js             # Trình tạo giao diện Discord Embed đồng nhất
│       ├── permissions.js        # Kiểm tra quyền hạn & thứ bậc vai trò (Role Hierarchy)
│       ├── logger.js             # Ghi log định dạng chuẩn kèm bộ lọc ẩn Token
│       └── healthServer.js       # HTTP Healthcheck nhẹ dành cho Cloud PaaS
├── tests/                        # Bộ kiểm thử tự động toàn diện (node:test)
├── scripts/
│   └── syntax-check.js           # Kiểm tra cú pháp, ES Modules import & quét rò rỉ Secret
├── data/                         # Thư mục lưu dữ liệu bền vững khi chạy (được .gitignore bảo vệ)
├── .env.example                  # Mẫu cấu hình biến môi trường
├── Dockerfile                    # Đóng gói Container chạy trên Cloud / VPS
└── package.json
```

---

## 🤖 Danh sách Slash Commands

| Lệnh | Chức năng |
| :--- | :--- |
| `/help [topic] [public]` | Xem hướng dẫn tổng quan, chi tiết lệnh hoặc quy tắc xử phạt (hỗ trợ mọi thành viên). |
| `/antispam on [log_channel]` | Bật hệ thống chống spam (tùy chọn gán nhanh kênh ghi log). |
| `/antispam off` | Tạm tắt hệ thống chống spam trên máy chủ. |
| `/antispam config [...]` | Tùy chỉnh giới hạn mention/tin, tổng mention/khoảng ngắn, thời gian kiểm tra, chặn `@everyone`, kênh log, thời gian reset mức phạt... |
| `/antispam whitelist` | Quản lý danh sách miễn trừ (`list`, `add`, `remove`, `clear`) cho **Vai trò**, **Thành viên** hoặc **Kênh**. |
| `/antispam logs [user] [limit] [reset_strikes]` | Xem lịch sử xử lý vi phạm gần đây và đặt lại mức cảnh cáo của thành viên nếu cần. |
| `/antispam status` | Xem trạng thái bảo vệ, kiểm tra quyền Discord của Bot và thông số RAM / Ping / Uptime. |
| `/antispam reset [keep_logs]` | Khôi phục toàn bộ cấu hình máy chủ về mặc định ban đầu. |

---

## ⚙️ Hướng dẫn cài đặt & Thiết lập biến môi trường

### Bước 1: Yêu cầu hệ thống
- **Node.js** phiên bản `>= 18.18.0` (khuyên dùng Node.js 20 LTS).

### Bước 2: Cài đặt thư viện
```bash
git clone https://github.com/clonclon999/Bot-dis-spam.git
cd Bot-dis-spam
npm install
```

### Bước 3: Thiết lập tệp `.env`
Sao chép tệp mẫu `.env.example` thành `.env`:
```bash
cp .env.example .env
```
Mở tệp `.env` và điền thông tin của bạn:
```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_application_client_id_here
DEV_GUILD_ID=
AUTO_DEPLOY_COMMANDS=true
DATA_DIR=./data
LOG_LEVEL=info
PORT=
```

---

## 🔗 Hướng dẫn cấu hình Discord Portal & Mời Bot vào Server

1. Truy cập [Discord Developer Portal](https://discord.com/developers/applications) → Chọn ứng dụng của bạn (hoặc nhấn **New Application**).
2. Vào tab **Bot**:
   - Sao chép **Token** dán vào `DISCORD_TOKEN` trong `.env`.
   - Cuộn xuống phần **Privileged Gateway Intents** → **BẮT BUỘC BẬT `Message Content Intent`** → Nhấn **Save Changes**.
3. Vào tab **General Information**:
   - Sao chép **Application ID** dán vào `CLIENT_ID` trong `.env`.
4. **Mời Bot vào máy chủ Discord** bằng đường dẫn chuẩn quyền tối thiểu sau (thay `YOUR_CLIENT_ID` bằng Application ID của bạn):
   ```text
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1374389627904&scope=bot%20applications.commands
   ```
   *(Mã quyền `1374389627904` cấp vừa đủ: View Channels, Send Messages, Send Messages in Threads, Manage Messages, Embed Links, Read Message History và Moderate Members / Timeout Members).*
5. **Lưu ý phân cấp vai trò (Role Hierarchy):** Trong phần *Server Settings → Roles* của Discord, hãy kéo **vai trò của Bot nằm cao hơn** vai trò của các thành viên thông thường để Bot có quyền thực thi Timeout.

---

## 🚀 Hướng dẫn khởi chạy & Kiểm thử

```bash
# Kiểm tra cú pháp, import ES Modules và quét an toàn bảo mật
npm run check

# Chạy toàn bộ bộ kiểm thử tự động (Unit + Integration Tests)
npm test

# (Tùy chọn) Đăng ký Slash Commands thủ công qua REST API
npm run deploy

# Khởi chạy Bot ở chế độ Production
npm start

# Khởi chạy ở chế độ phát triển (tự khởi động lại khi sửa code)
npm run dev
```

### Chạy bằng Docker / Cloud
```bash
docker build -t discord-antispam-bot .
docker run -d --name antispam-bot --restart unless-stopped --env-file .env -v $(pwd)/data:/app/data discord-antispam-bot
```
*(Nếu triển khai trên Render / Koyeb / Railway dạng Web Service, chỉ cần đặt biến môi trường `PORT=3000`, Bot sẽ tự mở endpoint kiểm tra sức khỏe `GET /health`).*
