#!/usr/bin/env python3
"""
Trình tạo Bộ Tài Nguyên Hình Ảnh & Animation Cục Bộ (`assets/`) cho DISCORD GAME BOT PRO.
Tạo đầy đủ PNG sắc nét (khử răng cưa 2x) và GIF chuyển động nhiều khung hình, dung lượng siêu gọn
cho gói FREE của BotKeep.cloud (không dùng thư viện nặng lúc chạy Node.js, không gọi Internet).
TUYỆT ĐỐI KHÔNG TẠO BẤT KỲ HÌNH ẢNH ĐẤU BOSS NÀO.
"""

import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent / "assets"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def get_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def make_gradient(w: int, h: int, top_rgb: tuple, bot_rgb: tuple) -> Image.Image:
    base = Image.new("RGB", (w, h), top_rgb)
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top_rgb[0] * (1 - t) + bot_rgb[0] * t)
        g = int(top_rgb[1] * (1 - t) + bot_rgb[1] * t)
        b = int(top_rgb[2] * (1 - t) + bot_rgb[2] * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    return base


def draw_glow_frame(img: Image.Image, accent: tuple, border_w: int = 4):
    w, h = img.size
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [10, 10, w - 11, h - 11],
        radius=22,
        outline=accent,
        width=border_w,
    )
    draw.rounded_rectangle(
        [18, 18, w - 19, h - 19],
        radius=16,
        outline=(255, 255, 255),
        width=1,
    )
    # Điểm nhấn góc sang trọng không bao giờ đè lên chữ
    for cx, cy in [(28, 28), (w - 29, 28), (28, h - 29), (w - 29, h - 29)]:
        draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=accent)


def save_png(img: Image.Image, rel_path: str):
    out_path = ROOT / rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    quant = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    quant.save(out_path, format="PNG", optimize=True)


def save_gif(frames: list[Image.Image], rel_path: str, duration_ms: int = 120):
    out_path = ROOT / rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    p_frames = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT) for f in frames]
    p_frames[0].save(
        out_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
    )


def centered_text(draw: ImageDraw.ImageDraw, cx: int, cy: int, text: str, font, fill, shadow=(0, 0, 0)):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = cx - tw // 2, cy - th // 2
    if shadow:
        draw.text((x + 2, y + 3), text, font=font, fill=shadow)
    draw.text((x, y), text, font=font, fill=fill)


# ==============================================================================
# Vẽ biểu tượng đồ họa Vector cho 6 Linh Vật Bầu Cua
# ==============================================================================

def draw_baucua_icon(draw: ImageDraw.ImageDraw, mascot_id: str, cx: int, cy: int, r: int):
    if mascot_id == "bau":
        # Trái bầu hồ lô xanh ngọc thắt nơ đỏ
        draw.ellipse([cx - int(r * 0.48), cy - int(r * 0.75), cx + int(r * 0.48), cy - int(r * 0.05)], fill=(88, 214, 141), outline=(30, 132, 73), width=4)
        draw.ellipse([cx - int(r * 0.68), cy - int(r * 0.15), cx + int(r * 0.68), cy + int(r * 0.78)], fill=(46, 204, 113), outline=(30, 132, 73), width=4)
        draw.arc([cx - 10, cy - int(r * 0.98), cx + 22, cy - int(r * 0.65)], 160, 340, fill=(147, 81, 22), width=5)
        draw.rectangle([cx - int(r * 0.42), cy - int(r * 0.15), cx + int(r * 0.42), cy - int(r * 0.03)], fill=(231, 76, 60))
    elif mascot_id == "cua":
        # Cua đỏ rực càng lớn
        draw.ellipse([cx - int(r * 0.68), cy - int(r * 0.35), cx + int(r * 0.68), cy + int(r * 0.52)], fill=(231, 76, 60), outline=(146, 43, 33), width=4)
        for side in (-1, 1):
            draw.ellipse([cx + side * int(r * 0.55) - 22, cy - int(r * 0.78), cx + side * int(r * 0.55) + 22, cy - int(r * 0.32)], fill=(241, 148, 138), outline=(146, 43, 33), width=4)
            for leg in range(3):
                ly = cy - 5 + leg * 18
                draw.line([cx + side * int(r * 0.55), ly, cx + side * int(r * 0.92), ly + 14], fill=(192, 57, 43), width=5)
        draw.ellipse([cx - 22, cy - int(r * 0.3), cx - 8, cy - int(r * 0.14)], fill=(255, 255, 255))
        draw.ellipse([cx + 8, cy - int(r * 0.3), cx + 22, cy - int(r * 0.14)], fill=(255, 255, 255))
    elif mascot_id == "tom":
        # Tôm cam uốn cong kèm râu dài
        for seg in range(5):
            ang = -0.5 + seg * 0.42
            sx = cx + int(math.cos(ang) * r * 0.35) - 10
            sy = cy + int(math.sin(ang) * r * 0.42)
            rad = int(r * (0.36 - seg * 0.04))
            draw.ellipse([sx - rad, sy - rad, sx + rad, sy + rad], fill=(243, 156, 18), outline=(186, 74, 0), width=3)
        draw.arc([cx - int(r * 0.85), cy - int(r * 0.85), cx + int(r * 0.3), cy], 190, 350, fill=(230, 126, 34), width=3)
        draw.ellipse([cx - 6, cy - int(r * 0.32), cx + 6, cy - int(r * 0.20)], fill=(20, 20, 20))
    elif mascot_id == "ca":
        # Cá chép xanh lam vây vàng
        draw.polygon([(cx + int(r * 0.42), cy), (cx + int(r * 0.88), cy - int(r * 0.45)), (cx + int(r * 0.88), cy + int(r * 0.45))], fill=(241, 196, 15), outline=(41, 128, 185), width=3)
        draw.ellipse([cx - int(r * 0.78), cy - int(r * 0.45), cx + int(r * 0.52), cy + int(r * 0.45)], fill=(52, 152, 219), outline=(27, 79, 114), width=4)
        draw.ellipse([cx - int(r * 0.48), cy - 12, cx - int(r * 0.30), cy + 6], fill=(255, 255, 255))
        draw.ellipse([cx - int(r * 0.43), cy - 7, cx - int(r * 0.34), cy + 2], fill=(15, 15, 15))
    elif mascot_id == "ga":
        # Gà trống vàng mào đỏ
        draw.ellipse([cx - int(r * 0.55), cy - int(r * 0.25), cx + int(r * 0.55), cy + int(r * 0.62)], fill=(244, 208, 63), outline=(183, 149, 11), width=4)
        draw.ellipse([cx - int(r * 0.32), cy - int(r * 0.68), cx + int(r * 0.28), cy - int(r * 0.08)], fill=(249, 231, 159), outline=(183, 149, 11), width=4)
        draw.polygon([(cx - 16, cy - int(r * 0.66)), (cx, cy - int(r * 0.92)), (cx + 16, cy - int(r * 0.66))], fill=(231, 76, 60))
        draw.polygon([(cx + int(r * 0.26), cy - int(r * 0.42)), (cx + int(r * 0.54), cy - int(r * 0.32)), (cx + int(r * 0.26), cy - int(r * 0.24))], fill=(230, 126, 34))
        draw.ellipse([cx + 2, cy - int(r * 0.48), cx + 12, cy - int(r * 0.38)], fill=(20, 20, 20))
    elif mascot_id == "nai":
        # Nai vàng sừng nhánh nâu
        draw.line([cx - 18, cy - int(r * 0.42), cx - 38, cy - int(r * 0.88)], fill=(120, 66, 18), width=6)
        draw.line([cx - 28, cy - int(r * 0.68), cx - 48, cy - int(r * 0.72)], fill=(120, 66, 18), width=5)
        draw.line([cx + 18, cy - int(r * 0.42), cx + 38, cy - int(r * 0.88)], fill=(120, 66, 18), width=6)
        draw.line([cx + 28, cy - int(r * 0.68), cx + 48, cy - int(r * 0.72)], fill=(120, 66, 18), width=5)
        draw.ellipse([cx - int(r * 0.50), cy - int(r * 0.46), cx + int(r * 0.50), cy + int(r * 0.58)], fill=(211, 136, 56), outline=(120, 66, 18), width=4)
        draw.ellipse([cx - 22, cy - 10, cx - 10, cy + 2], fill=(20, 20, 20))
        draw.ellipse([cx + 10, cy - 10, cx + 22, cy + 2], fill=(20, 20, 20))
        draw.ellipse([cx - 14, cy + 16, cx + 14, cy + 36], fill=(93, 50, 15))


# ==============================================================================
# Vẽ mặt Xúc Xắc 1..6 chuẩn Casino Châu Á (1 & 4 đỏ, còn lại đen xanh)
# ==============================================================================

PIP_COORDS = {
    1: [(0.5, 0.5)],
    2: [(0.28, 0.28), (0.72, 0.72)],
    3: [(0.26, 0.26), (0.5, 0.5), (0.74, 0.74)],
    4: [(0.28, 0.28), (0.72, 0.28), (0.28, 0.72), (0.72, 0.72)],
    5: [(0.26, 0.26), (0.74, 0.26), (0.5, 0.5), (0.26, 0.74), (0.74, 0.74)],
    6: [(0.28, 0.24), (0.72, 0.24), (0.28, 0.5), (0.72, 0.5), (0.28, 0.76), (0.72, 0.76)],
}


def draw_die_face(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, val: int):
    # Bóng đổ nhẹ
    draw.rounded_rectangle([x + 5, y + 6, x + size + 5, y + size + 6], radius=int(size * 0.22), fill=(15, 20, 35))
    draw.rounded_rectangle([x, y, x + size, y + size], radius=int(size * 0.22), fill=(250, 250, 252), outline=(212, 172, 13), width=3)
    pip_color = (220, 40, 40) if val in (1, 4) else (25, 35, 55)
    pr = int(size * (0.14 if val == 1 else 0.085))
    for px, py in PIP_COORDS[val]:
        cx = x + int(px * size)
        cy = y + int(py * size)
        draw.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=pip_color)


# ==============================================================================
# 1. Tạo Banners Chính & Kết Quả
# ==============================================================================

def generate_banners():
    # Game Center PRO MAX Banner (900x340 — Dark Mode + Neon Cyan & Purple)
    gc = make_gradient(900, 340, (10, 14, 28), (28, 12, 54))
    draw_glow_frame(gc, (0, 245, 212), 4)
    d = ImageDraw.Draw(gc)
    d.rounded_rectangle([24, 24, 876, 316], radius=14, outline=(155, 93, 229), width=2)
    centered_text(d, 450, 64, "GAME CENTER PRO MAX", get_font(40), (0, 245, 212))
    centered_text(d, 450, 114, "DISCORD COMPONENTS V2 • HỆ SINH THÁI 7 GAME & KINH TẾ VNĐ", get_font(19), (230, 236, 255))

    badges = ["BẦU CUA", "TÀI XỈU", "NỐI TỪ", "OẲN TÙ TÌ", "ĐOÁN SỐ", "ĐỒNG XU", "ĐUA THÚ"]
    colors = [
        (0, 245, 212),
        (155, 93, 229),
        (0, 229, 255),
        (199, 125, 255),
        (56, 189, 248),
        (255, 209, 102),
        (52, 211, 153),
    ]
    bw = 108
    gap = 12
    start_x = (900 - (len(badges) * bw + (len(badges) - 1) * gap)) // 2
    for idx, (label, col) in enumerate(zip(badges, colors)):
        bx = start_x + idx * (bw + gap)
        by = 166
        d.rounded_rectangle([bx, by, bx + bw, by + 98], radius=14, fill=(16, 20, 42), outline=col, width=3)
        d.ellipse([bx + 36, by + 14, bx + 72, by + 50], fill=col)
        centered_text(d, bx + bw // 2, by + 32, str(idx + 1), get_font(20), (10, 12, 24), shadow=None)
        centered_text(d, bx + bw // 2, by + 74, label, get_font(14), (245, 248, 255), shadow=None)

    centered_text(d, 450, 296, "DARK GAMING UI • 100% NGẪU NHIÊN CÔNG BẰNG • TỐI ƯU MOBILE & DESKTOP", get_font(15, False), (165, 243, 252))
    save_png(gc, "banners/game_center.png")

    # Victory Banner (800x250)
    vic = make_gradient(800, 250, (10, 48, 42), (16, 20, 44))
    draw_glow_frame(vic, (0, 245, 212), 4)
    dv = ImageDraw.Draw(vic)
    dv.polygon([(365, 42), (435, 42), (422, 102), (378, 102)], fill=(255, 209, 102), outline=(0, 245, 212), width=3)
    dv.rectangle([392, 102, 408, 122], fill=(212, 172, 13))
    dv.rectangle([372, 122, 428, 134], fill=(255, 209, 102))
    centered_text(dv, 400, 168, "CHIẾN THẮNG RỰC RỠ!", get_font(36), (0, 245, 212))
    centered_text(dv, 400, 210, "TIỀN THƯỞNG VNĐ ĐÃ CỘNG TRỰC TIẾP VÀO VÍ CỦA BẠN", get_font(17, False), (224, 242, 254))
    save_png(vic, "banners/victory.png")

    # Defeat Banner (800x250)
    lose = make_gradient(800, 250, (48, 14, 34), (16, 12, 32))
    draw_glow_frame(lose, (255, 51, 102), 4)
    dl = ImageDraw.Draw(lose)
    dl.ellipse([370, 42, 430, 102], fill=(255, 51, 102), outline=(199, 125, 255), width=3)
    centered_text(dl, 400, 72, "!", get_font(40), (255, 255, 255), shadow=None)
    centered_text(dl, 400, 158, "CHƯA TRÚNG LƯỢT NÀY!", get_font(32), (255, 143, 171))
    centered_text(dl, 400, 204, "PHỤC THÙ NGAY Ở VÁN TIẾP THEO • CHÚC BẠN ĐẠI THẮNG", get_font(17, False), (235, 222, 255))
    save_png(lose, "banners/defeat.png")

    # Quest Banner (840x240)
    qb = make_gradient(840, 240, (12, 22, 48), (28, 14, 56))
    draw_glow_frame(qb, (0, 245, 212), 4)
    dq = ImageDraw.Draw(qb)
    centered_text(dq, 420, 82, "TRUNG TÂM NHIỆM VỤ PRO MAX", get_font(32), (0, 245, 212))
    centered_text(dq, 420, 134, "9 NHIỆM VỤ NGÀY • 4 NHIỆM VỤ TUẦN • NHẬN VNĐ & EXP TỨC THÌ", get_font(17, False), (224, 231, 255))
    dq.rounded_rectangle([200, 170, 640, 198], radius=12, fill=(18, 24, 48), outline=(155, 93, 229), width=2)
    dq.rounded_rectangle([204, 174, 535, 194], radius=10, fill=(0, 245, 212))
    save_png(qb, "banners/quest_banner.png")

    # Shop Banner (840x240)
    sb = make_gradient(840, 240, (28, 12, 54), (12, 18, 40))
    draw_glow_frame(sb, (155, 93, 229), 4)
    ds = ImageDraw.Draw(sb)
    centered_text(ds, 420, 86, "CỬA HÀNG CYBER & HỘP QUÀ BÍ ẨN", get_font(32), (199, 125, 255))
    centered_text(ds, 420, 140, "VÉ MAY MẮN • THẺ X2 EXP • BẢO HIỂM • TRỨNG THÚ CƯNG • KHUNG VIP", get_font(16, False), (165, 243, 252))
    save_png(sb, "banners/shop_banner.png")

    # Wallet Banner (840x220)
    wb = make_gradient(840, 220, (10, 26, 42), (24, 14, 48))
    draw_glow_frame(wb, (0, 245, 212), 4)
    dw = ImageDraw.Draw(wb)
    centered_text(dw, 420, 78, "VÍ ĐIỆN TỬ & NGÂN HÀNG VNĐ", get_font(32), (0, 245, 212))
    centered_text(dw, 420, 132, "QUẢN LÝ TIỀN MẶT • TIẾT KIỆM SINH LÃI TỰ ĐỘNG • ĐIỂM DANH NHANH", get_font(16, False), (224, 231, 255))
    save_png(wb, "banners/wallet_banner.png")

    # Profile Banner (840x220)
    pb = make_gradient(840, 220, (24, 12, 52), (10, 22, 44))
    draw_glow_frame(pb, (155, 93, 229), 4)
    dp = ImageDraw.Draw(pb)
    centered_text(dp, 420, 78, "HỒ SƠ CHIẾN BINH & DANH HIỆU", get_font(32), (199, 125, 255))
    centered_text(dp, 420, 132, "CẤP ĐỘ EXP • THÚ CƯNG ĐỒNG HÀNH • HUY HIỆU & BUFF ĐANG BẬT", get_font(16, False), (165, 243, 252))
    save_png(pb, "banners/profile_banner.png")

    # Leaderboard Banner (840x220)
    lb = make_gradient(840, 220, (14, 18, 46), (34, 14, 58))
    draw_glow_frame(lb, (255, 209, 102), 4)
    dlb = ImageDraw.Draw(lb)
    centered_text(dlb, 420, 78, "BẢNG VÀNG XẾP HẠNG SERVER", get_font(32), (255, 209, 102))
    centered_text(dlb, 420, 132, "TOP ĐẠI GIA VNĐ • TOP CẤP ĐỘ • TOP THẮNG GAME • TOP NỐI TỪ", get_font(16, False), (0, 245, 212))
    save_png(lb, "banners/leaderboard_banner.png")


# ==============================================================================
# 2. Tạo Bộ Bầu Cua (6 ảnh linh vật riêng + Bàn lưới 6 cửa + GIF lắc bát)
# ==============================================================================

MASCOT_META = [
    ("bau", "BẦU", (46, 204, 113)),
    ("cua", "CUA", (231, 76, 60)),
    ("tom", "TÔM", (243, 156, 18)),
    ("ca", "CÁ", (52, 152, 219)),
    ("ga", "GÀ", (241, 196, 15)),
    ("nai", "NAI", (211, 136, 56)),
]


def generate_baucua_assets():
    # Ảnh riêng từng linh vật (240x240)
    for m_id, m_name, accent in MASCOT_META:
        card = make_gradient(240, 240, (24, 30, 56), (14, 18, 36))
        draw_glow_frame(card, accent, 4)
        dc = ImageDraw.Draw(card)
        draw_baucua_icon(dc, m_id, 120, 108, 64)
        centered_text(dc, 120, 200, m_name, get_font(28), accent)
        save_png(card, f"baucua/{m_id}.png")

    # Bàn lưới 6 linh vật (840x480)
    grid = make_gradient(840, 480, (110, 22, 28), (58, 12, 18))
    draw_glow_frame(grid, (241, 196, 15), 5)
    dg = ImageDraw.Draw(grid)
    centered_text(dg, 420, 46, "BÀN ĐẶT CƯỢC BẦU CUA TÔM CÁ PRO (X2 • X3 • X4)", get_font(25), (241, 196, 15))

    cw, ch = 240, 175
    gx0, gy0 = 42, 82
    x_gap, y_gap = 18, 18
    for idx, (m_id, m_name, accent) in enumerate(MASCOT_META):
        col = idx % 3
        row = idx // 3
        x = gx0 + col * (cw + x_gap)
        y = gy0 + row * (ch + y_gap)
        dg.rounded_rectangle([x, y, x + cw, y + ch], radius=18, fill=(252, 246, 232), outline=accent, width=4)
        draw_baucua_icon(dg, m_id, x + cw // 2, y + 76, 52)
        dg.rounded_rectangle([x + 30, y + ch - 42, x + cw - 30, y + ch - 10], radius=10, fill=(32, 24, 28))
        centered_text(dg, x + cw // 2, y + ch - 26, m_name, get_font(20), accent, shadow=None)

    save_png(grid, "baucua/board_grid.png")
    save_png(grid, "games/baucua.png")

    # GIF lắc bát Bầu Cua 8 khung hình (560x260)
    frames = []
    for f in range(8):
        fr = make_gradient(560, 260, (92, 18, 28), (36, 12, 22))
        draw_glow_frame(fr, (241, 196, 15), 3)
        df = ImageDraw.Draw(fr)
        dx = int(math.sin(f * math.pi / 2) * 18)
        dy = int(math.cos(f * math.pi / 2) * 8)
        centered_text(df, 280, 44, "ĐANG LẮC 3 XÚC XẮC BẦU CUA...", get_font(22), (241, 196, 15))
        # Đĩa & Bát úp rung lắc + 3 bóng linh vật xoay
        for slot in range(3):
            sx = 135 + slot * 145 + dx
            sy = 142 + (dy if slot % 2 == 0 else -dy)
            df.rounded_rectangle([sx - 52, sy - 52, sx + 52, sy + 52], radius=16, fill=(252, 248, 236), outline=(241, 196, 15), width=3)
            m_id = MASCOT_META[(f + slot * 2) % 6][0]
            draw_baucua_icon(df, m_id, sx, sy, 36)
        centered_text(df, 280, 226, "CHỜ MỞ BÁT NHẬN THƯỞNG VNĐ!", get_font(15, False), (250, 219, 216))
        frames.append(fr)
    save_gif(frames, "baucua/baucua_shake.gif", duration_ms=110)


# ==============================================================================
# 3. Tạo Bộ Tài Xỉu Casino & 6 Mặt Xúc Xắc + GIF Tung Xúc Xắc
# ==============================================================================

def generate_taixiu_and_dice():
    for v in range(1, 7):
        img = make_gradient(180, 180, (24, 32, 54), (14, 18, 32))
        d = ImageDraw.Draw(img)
        draw_die_face(d, 25, 25, 130, v)
        save_png(img, f"dice/dice_{v}.png")

    # Banner Bàn Casino Tài Xỉu (840x380)
    tx = make_gradient(840, 380, (14, 62, 44), (8, 32, 24))
    draw_glow_frame(tx, (241, 196, 15), 5)
    dt = ImageDraw.Draw(tx)
    centered_text(dt, 420, 48, "SÒNG TÀI XỈU HOÀNG GIA PRO", get_font(30), (241, 196, 15))

    # Khu vực TÀI (trái)
    dt.rounded_rectangle([42, 88, 315, 315], radius=20, fill=(120, 24, 32), outline=(241, 196, 15), width=4)
    centered_text(dt, 178, 150, "TÀI", get_font(54), (255, 235, 150))
    centered_text(dt, 178, 222, "11 – 17 ĐIỂM", get_font(22), (255, 255, 255))
    centered_text(dt, 178, 268, "THẮNG NHẬN X2", get_font(17), (249, 231, 159))

    # Khu vực Xúc xắc trung tâm
    dt.ellipse([330, 105, 510, 285], fill=(22, 42, 36), outline=(241, 196, 15), width=4)
    draw_die_face(dt, 355, 132, 56, 6)
    draw_die_face(dt, 425, 132, 56, 5)
    draw_die_face(dt, 390, 200, 56, 4)

    # Khu vực XỈU (phải)
    dt.rounded_rectangle([525, 88, 798, 315], radius=20, fill=(20, 58, 118), outline=(241, 196, 15), width=4)
    centered_text(dt, 661, 150, "XỈU", get_font(54), (174, 214, 241))
    centered_text(dt, 661, 222, "4 – 10 ĐIỂM", get_font(22), (255, 255, 255))
    centered_text(dt, 661, 268, "THẮNG NHẬN X2", get_font(17), (214, 234, 248))

    centered_text(dt, 420, 344, "TỔNG 3 HOẶC 18: NHÀ CÁI THẮNG • LẮC XÚC XẮC NGẪU NHIÊN 100%", get_font(16, False), (236, 240, 241))
    save_png(tx, "games/taixiu.png")

    # GIF tung 3 viên xúc xắc (560x250)
    frames = []
    combos = [(1, 4, 6), (3, 5, 2), (6, 2, 4), (2, 6, 1), (5, 3, 6), (4, 1, 5), (2, 4, 3), (6, 5, 1)]
    for idx, (d1, d2, d3) in enumerate(combos):
        fr = make_gradient(560, 250, (14, 58, 42), (8, 28, 22))
        draw_glow_frame(fr, (241, 196, 15), 3)
        df = ImageDraw.Draw(fr)
        centered_text(df, 280, 44, "ĐANG TUNG 3 VIÊN XÚC XẮC...", get_font(23), (241, 196, 15))
        jitter = -10 if idx % 2 == 0 else 10
        draw_die_face(df, 105, 86 + jitter, 92, d1)
        draw_die_face(df, 234, 86 - jitter, 92, d2)
        draw_die_face(df, 363, 86 + jitter, 92, d3)
        centered_text(df, 280, 216, "TÀI (11–17)  •  XỈU (4–10)", get_font(17), (212, 239, 223))
        frames.append(fr)
    save_gif(frames, "dice/dice_roll.gif", duration_ms=105)


# ==============================================================================
# 4. Tạo Bộ Nối Từ Game Show, Đồng Xu, Oẳn Tù Tì, Đoán Số & Đua Thú
# ==============================================================================

def generate_other_games():
    # --- Nối Từ Game Show Banner (840x320) ---
    nt = make_gradient(840, 320, (18, 56, 78), (12, 28, 48))
    draw_glow_frame(nt, (46, 204, 113), 4)
    dn = ImageDraw.Draw(nt)
    centered_text(dn, 420, 54, "GAME SHOW NỐI TỪ TIẾNG VIỆT PRO (1v1)", get_font(29), (46, 204, 113))
    dn.rounded_rectangle([85, 108, 365, 205], radius=18, fill=(28, 48, 76), outline=(46, 204, 113), width=3)
    centered_text(dn, 225, 156, "HỌC SINH", get_font(30), (255, 255, 255))
    centered_text(dn, 420, 156, "➔", get_font(42), (241, 196, 15), shadow=None)
    dn.rounded_rectangle([475, 108, 755, 205], radius=18, fill=(28, 76, 58), outline=(241, 196, 15), width=3)
    centered_text(dn, 615, 156, "SINH VIÊN", get_font(30), (241, 196, 15))
    centered_text(dn, 420, 260, "ĐẤU PHÒNG 2 NGƯỜI • 30 GIÂY/LƯỢT • THƯỞNG CHUỖI THẮNG VNĐ", get_font(17, False), (214, 234, 248))
    save_png(nt, "games/noitu.png")

    # --- Tung Đồng Xu (coin_sap, coin_ngua, banner & GIF xoay đồng xu) ---
    for side, title, sub, ring in [
        ("sap", "MẶT SẤP", "HOÀNG KIM BẢO", (241, 196, 15)),
        ("ngua", "MẶT NGỬA", "NGÔI SAO ĐẠI CÁT", (243, 156, 18)),
    ]:
        cimg = make_gradient(260, 260, (26, 24, 48), (14, 14, 28))
        draw_glow_frame(cimg, ring, 3)
        dc = ImageDraw.Draw(cimg)
        dc.ellipse([38, 30, 222, 214], fill=(241, 196, 15), outline=(183, 149, 11), width=6)
        dc.ellipse([52, 44, 208, 200], fill=(247, 220, 111), outline=(212, 172, 13), width=3)
        centered_text(dc, 130, 112, "VNĐ" if side == "sap" else "★", get_font(44), (147, 81, 22), shadow=None)
        centered_text(dc, 130, 156, title, get_font(18), (120, 66, 18), shadow=None)
        centered_text(dc, 130, 232, sub, get_font(14), (249, 231, 159), shadow=None)
        save_png(cimg, f"coinflip/coin_{side}.png")

    cfb = make_gradient(840, 320, (44, 34, 14), (22, 18, 12))
    draw_glow_frame(cfb, (241, 196, 15), 4)
    dcf = ImageDraw.Draw(cfb)
    centered_text(dcf, 420, 52, "TUNG ĐỒNG XU HOÀNG KIM (SẤP / NGỬA)", get_font(30), (241, 196, 15))
    dcf.ellipse([205, 92, 365, 252], fill=(241, 196, 15), outline=(255, 235, 150), width=5)
    centered_text(dcf, 285, 172, "SẤP", get_font(34), (120, 66, 18), shadow=None)
    dcf.ellipse([475, 92, 635, 252], fill=(243, 156, 18), outline=(255, 235, 150), width=5)
    centered_text(dcf, 555, 172, "NGỬA", get_font(30), (120, 66, 18), shadow=None)
    centered_text(dcf, 420, 282, "TỶ LỆ 50/50 CÔNG BẰNG • NHÂN ĐÔI TIỀN CƯỢC VNĐ", get_font(17, False), (252, 243, 207))
    save_png(cfb, "games/coinflip.png")

    coin_frames = []
    widths = [150, 110, 60, 20, 60, 110, 150, 110, 60, 20]
    for idx, w_coin in enumerate(widths):
        fr = make_gradient(520, 240, (36, 28, 16), (18, 14, 12))
        draw_glow_frame(fr, (241, 196, 15), 3)
        df = ImageDraw.Draw(fr)
        centered_text(df, 260, 42, "ĐỒNG XU ĐANG XOAY TRÊN KHÔNG...", get_font(21), (241, 196, 15))
        cx, cy = 260, 132
        df.ellipse([cx - w_coin // 2, cy - 68, cx + w_coin // 2, cy + 68], fill=(244, 208, 63), outline=(183, 149, 11), width=4)
        if w_coin >= 90:
            lbl = "SẤP" if idx < 5 else "NGỬA"
            centered_text(df, cx, cy, lbl, get_font(22), (120, 66, 18), shadow=None)
        coin_frames.append(fr)
    save_gif(coin_frames, "coinflip/coin_flip.gif", duration_ms=95)

    # --- Oẳn Tù Tì (rock, paper, scissors, banner & countdown GIF) ---
    rps_specs = [
        ("rock", "BÚA", (231, 76, 60)),
        ("paper", "BAO", (52, 152, 219)),
        ("scissors", "KÉO", (46, 204, 113)),
    ]
    for r_id, r_name, col in rps_specs:
        rc = make_gradient(240, 240, (28, 24, 52), (16, 14, 30))
        draw_glow_frame(rc, col, 4)
        dr = ImageDraw.Draw(rc)
        if r_id == "rock":
            dr.rounded_rectangle([68, 62, 172, 156], radius=34, fill=col, outline=(255, 255, 255), width=4)
        elif r_id == "paper":
            dr.rounded_rectangle([72, 48, 168, 162], radius=16, fill=col, outline=(255, 255, 255), width=4)
            for lx in (96, 120, 144):
                dr.line([lx, 48, lx, 95], fill=(255, 255, 255), width=3)
        else:
            dr.line([82, 154, 152, 54], fill=col, width=14)
            dr.line([158, 154, 88, 54], fill=col, width=14)
            dr.ellipse([70, 138, 106, 172], outline=(255, 255, 255), width=4)
            dr.ellipse([134, 138, 170, 172], outline=(255, 255, 255), width=4)
        centered_text(dr, 120, 200, r_name, get_font(28), col)
        save_png(rc, f"rps/{r_id}.png")

    rps_b = make_gradient(840, 320, (48, 22, 68), (20, 14, 38))
    draw_glow_frame(rps_b, (187, 143, 206), 4)
    drb = ImageDraw.Draw(rps_b)
    centered_text(drb, 420, 52, "ĐẤU TRƯỜNG OẲN TÙ TÌ (KÉO • BÚA • BAO)", get_font(29), (241, 196, 15))
    for i, (r_id, r_name, col) in enumerate(rps_specs):
        bx = 115 + i * 215
        drb.rounded_rectangle([bx, 95, bx + 180, 245], radius=18, fill=(32, 28, 58), outline=col, width=4)
        centered_text(drb, bx + 90, 170, r_name, get_font(34), col)
    centered_text(drb, 420, 282, "ĐẤU VỚI BOT HOẶC THÁCH ĐẤU NGƯỜI CHƠI KHÁC CƯỢC VNĐ", get_font(17, False), (235, 222, 240))
    save_png(rps_b, "games/rps.png")

    rps_frames = []
    for step_txt, col in [("3...", (241, 196, 15)), ("2...", (230, 126, 34)), ("1...", (231, 76, 60)), ("OẲN TÙ TÌ!", (46, 204, 113))]:
        fr = make_gradient(520, 230, (42, 20, 62), (20, 12, 34))
        draw_glow_frame(fr, col, 3)
        df = ImageDraw.Draw(fr)
        centered_text(df, 260, 54, "CHUẨN BỊ RA TAY ĐỒNG THỜI", get_font(20), (235, 222, 240))
        centered_text(df, 260, 134, step_txt, get_font(48), col)
        rps_frames.append(fr)
    save_gif(rps_frames, "rps/rps_countdown.gif", duration_ms=180)

    # --- Đoán Số (banner & GIF mở két số bí mật) ---
    gs = make_gradient(840, 320, (16, 48, 86), (10, 24, 48))
    draw_glow_frame(gs, (52, 152, 219), 4)
    dgs = ImageDraw.Draw(gs)
    centered_text(dgs, 420, 54, "GIẢI MÃ CON SỐ BÍ MẬT PRO", get_font(31), (241, 196, 15))
    dgs.rounded_rectangle([290, 96, 550, 232], radius=22, fill=(22, 38, 68), outline=(52, 152, 219), width=4)
    centered_text(dgs, 420, 164, "? ? ?", get_font(54), (93, 173, 226))
    centered_text(dgs, 420, 276, "GỢI Ý LỚN HƠN / NHỎ HƠN THEO LƯỢT • ĐOÁN ĐÚNG NỔ THƯỞNG VNĐ", get_font(17, False), (214, 234, 248))
    save_png(gs, "games/guess.png")

    vault_frames = []
    for k in range(6):
        fr = make_gradient(520, 230, (16, 46, 82), (10, 22, 44))
        draw_glow_frame(fr, (52, 152, 219), 3)
        df = ImageDraw.Draw(fr)
        centered_text(df, 260, 48, "ĐANG MỞ KÉT SỐ BÍ MẬT...", get_font(21), (241, 196, 15))
        centered_text(df, 260, 134, f"[ {(k * 17 + 9) % 99:02d} ]", get_font(46), (93, 173, 226))
        vault_frames.append(fr)
    save_gif(vault_frames, "guess/vault_open.gif", duration_ms=110)

    # --- Đua Thú (5 ảnh thú riêng, banner trường đua & GIF đua) ---
    racers = [
        ("horse", "CHIẾN MÃ", (230, 126, 34)),
        ("cheetah", "BÁO ĐỐM", (241, 196, 15)),
        ("eagle", "ĐẠI BÀNG", (52, 152, 219)),
        ("wolf", "SÓI BẠC", (174, 182, 191)),
        ("tiger", "HỔ TRẮNG", (46, 204, 113)),
    ]
    for a_id, a_name, col in racers:
        ac = make_gradient(220, 220, (22, 38, 32), (12, 22, 18))
        draw_glow_frame(ac, col, 4)
        da = ImageDraw.Draw(ac)
        da.ellipse([55, 42, 165, 152], fill=(28, 48, 42), outline=col, width=4)
        centered_text(da, 110, 97, a_name.split()[0], get_font(22), col)
        centered_text(da, 110, 182, a_name, get_font(20), (255, 255, 255))
        save_png(ac, f"race/{a_id}.png")

    rc_b = make_gradient(840, 340, (16, 62, 36), (10, 32, 20))
    draw_glow_frame(rc_b, (46, 204, 113), 4)
    drc = ImageDraw.Draw(rc_b)
    centered_text(drc, 420, 46, "TRƯỜNG ĐUA THÚ TỐC ĐỘ PRO (X4.5)", get_font(30), (241, 196, 15))
    for idx, (_aid, a_name, col) in enumerate(racers):
        ly = 84 + idx * 42
        drc.rounded_rectangle([55, ly, 785, ly + 32], radius=8, fill=(22, 46, 30), outline=(88, 214, 141), width=1)
        pos_x = 180 + (idx * 95) % 450
        drc.rounded_rectangle([60, ly + 4, pos_x, ly + 28], radius=6, fill=col)
        drc.text((70, ly + 6), f"Làn {idx + 1}: {a_name}", font=get_font(15), fill=(15, 20, 15))
    centered_text(drc, 420, 310, "DIỄN BIẾN ĐƯỜNG ĐUA TRỰC TIẾP TỪNG CHẶNG • KHÔNG HIỆN KẾT QUẢ NGAY", get_font(15, False), (213, 245, 227))
    save_png(rc_b, "games/race.png")

    race_frames = []
    offsets = [
        [90, 110, 85, 105, 95],
        [170, 155, 190, 160, 175],
        [260, 285, 250, 275, 245],
        [350, 340, 375, 355, 360],
        [430, 455, 420, 445, 435],
        [490, 470, 505, 480, 495],
    ]
    for step_idx, lane_xs in enumerate(offsets):
        fr = make_gradient(600, 260, (16, 62, 36), (10, 32, 20))
        draw_glow_frame(fr, (241, 196, 15), 3)
        df = ImageDraw.Draw(fr)
        centered_text(df, 300, 34, f"CHẶNG ĐUA ĐANG TĂNG TỐC ({step_idx + 1}/6)...", get_font(19), (241, 196, 15))
        for i, (_aid, a_name, col) in enumerate(racers):
            ly = 62 + i * 34
            df.rounded_rectangle([36, ly, 564, ly + 26], radius=6, fill=(22, 46, 30), outline=(88, 214, 141), width=1)
            df.rounded_rectangle([40, ly + 3, lane_xs[i], ly + 23], radius=5, fill=col)
            df.text((48, ly + 4), a_name, font=get_font(13), fill=(15, 15, 15))
        race_frames.append(fr)
    save_gif(race_frames, "race/race_run.gif", duration_ms=135)


if __name__ == "__main__":
    generate_banners()
    generate_baucua_assets()
    generate_taixiu_and_dice()
    generate_other_games()
    print("✅ Đã tạo hoàn chỉnh toàn bộ tài nguyên PNG & GIF trong assets/!")
