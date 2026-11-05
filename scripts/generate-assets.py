#!/usr/bin/env python3
"""
Trình tạo Bộ Tài Nguyên Hình Ảnh & Animation 3D Casino/Gaming Cục Bộ (`assets/`)
cho DISCORD GAME BOT PRO MAX (UPDATE MULTIPLAYER ROUND SYSTEM & PREMIUM VISUALS).

Phong cách thiết kế thống nhất:
- Dark Cinematic (Obsidian / Midnight Navy / Deep Violet)
- Neon Cyan (#00F5D4), Electric Purple (#9B5DE5 / #C77DFF) & Royal Gold (#FFD166 / #F59E0B)
- Hiệu ứng ánh sáng Radial Spotlight, đổ bóng Drop Shadow, viền phát sáng Gaussian Glow
- Hình khối 3D vát cạnh, chất liệu Kim loại phay xước & Kính mờ phản quang (Glassmorphism)
- Mỗi trò chơi trong 7 trò chơi chính thức có bộ Banner, Icon, Kết quả Thắng/Thua và Animation RIÊNG BIỆT.
- TUYỆT ĐỐI KHÔNG TẠO BẤT KỲ HÌNH ẢNH ĐẤU BOSS (BOSS FIGHT) NÀO.
"""

import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent / "assets"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# Bảng màu chuẩn Premium Gaming / Casino 3D
COL_BG_TOP = (8, 11, 24)
COL_BG_BOT = (20, 11, 40)
COL_CYAN = (0, 245, 212)
COL_SKY = (56, 189, 248)
COL_PURPLE = (155, 93, 229)
COL_VIOLET = (199, 125, 255)
COL_GOLD = (255, 209, 102)
COL_AMBER = (245, 158, 11)
COL_CRIMSON = (255, 59, 107)
COL_EMERALD = (16, 185, 129)
COL_WHITE = (248, 250, 255)
COL_MUTED = (182, 196, 226)


def get_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


# ==============================================================================
# Công cụ Kết xuất Ánh sáng 3D, Kính mờ, Kim loại & Đổ bóng (RGBA Compositing)
# ==============================================================================

def make_cinematic_canvas(
    w: int,
    h: int,
    top_rgb: tuple = COL_BG_TOP,
    bot_rgb: tuple = COL_BG_BOT,
    spot_rgb: tuple = COL_PURPLE,
    spot2_rgb: tuple = COL_CYAN,
) -> Image.Image:
    base = Image.new("RGBA", (w, h), (*top_rgb, 255))
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top_rgb[0] * (1 - t) + bot_rgb[0] * t)
        g = int(top_rgb[1] * (1 - t) + bot_rgb[1] * t)
        b = int(top_rgb[2] * (1 - t) + bot_rgb[2] * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b, 255))

    # Lưới ánh sáng cyber mảnh chìm phía sau
    grid_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid_layer)
    step = 44
    for gx in range(0, w, step):
        gd.line([(gx, 0), (gx, h)], fill=(255, 255, 255, 9), width=1)
    for gy in range(0, h, step):
        gd.line([(0, gy), (w, gy)], fill=(255, 255, 255, 9), width=1)
    base = Image.alpha_composite(base, grid_layer)

    # Hai luồng Spotlight 3D mềm bằng GaussianBlur
    spot = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spot)
    rx1, ry1 = int(w * 0.34), int(h * 0.55)
    sd.ellipse([int(w * 0.16) - rx1, int(h * 0.18) - ry1, int(w * 0.16) + rx1, int(h * 0.18) + ry1], fill=(*spot_rgb, 68))
    rx2, ry2 = int(w * 0.36), int(h * 0.55)
    sd.ellipse([int(w * 0.84) - rx2, int(h * 0.80) - ry2, int(w * 0.84) + rx2, int(h * 0.80) + ry2], fill=(*spot2_rgb, 56))
    sd.ellipse([int(w * 0.50) - int(w * 0.28), -int(h * 0.25), int(w * 0.50) + int(w * 0.28), int(h * 0.48)], fill=(*COL_GOLD, 36))
    spot = spot.filter(ImageFilter.GaussianBlur(radius=max(18, min(w, h) // 7)))
    return Image.alpha_composite(base, spot)


def draw_neon_metallic_frame(
    img: Image.Image,
    neon_col: tuple = COL_CYAN,
    metal_col: tuple = COL_GOLD,
    pad: int = 10,
    radius: int = 22,
) -> Image.Image:
    w, h = img.size
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(
        [pad, pad, w - pad - 1, h - pad - 1],
        radius=radius,
        outline=(*neon_col, 195),
        width=5,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=6))
    out = Image.alpha_composite(img, glow)

    d = ImageDraw.Draw(out)
    # Viền ngoài Neon sắc nét
    d.rounded_rectangle(
        [pad, pad, w - pad - 1, h - pad - 1],
        radius=radius,
        outline=(*neon_col, 255),
        width=3,
    )
    # Viền trong Kim loại (Metallic Gold / Platinum)
    d.rounded_rectangle(
        [pad + 6, pad + 6, w - pad - 7, h - pad - 7],
        radius=max(8, radius - 5),
        outline=(*metal_col, 190),
        width=2,
    )
    # Lằn phản quang kính trên đỉnh
    d.line(
        [(pad + radius, pad + 2), (w - pad - radius, pad + 2)],
        fill=(255, 255, 255, 190),
        width=2,
    )
    # Đinh tán kim loại 4 góc
    for cx, cy in [
        (pad + 16, pad + 16),
        (w - pad - 17, pad + 16),
        (pad + 16, h - pad - 17),
        (w - pad - 17, h - pad - 17),
    ]:
        d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(*metal_col, 255), outline=(255, 255, 255, 180), width=1)
    return out


def draw_glass_panel(
    img: Image.Image,
    box: list,
    accent: tuple,
    fill_rgba: tuple = (14, 20, 42, 212),
    radius: int = 18,
    border_w: int = 3,
) -> Image.Image:
    w, h = img.size
    x1, y1, x2, y2 = box
    # Đổ bóng 3D xuống dưới + phát sáng viền nhẹ
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x1 + 4, y1 + 7, x2 + 4, y2 + 7], radius=radius, fill=(0, 0, 0, 155))
    sd.rounded_rectangle([x1 - 1, y1 - 1, x2 + 1, y2 + 1], radius=radius + 1, outline=(*accent, 110), width=border_w + 2)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=5))
    out = Image.alpha_composite(img, shadow)

    panel = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle(box, radius=radius, fill=fill_rgba)
    # Lớp kính bóng nửa trên (Glass Specular Highlight)
    mid_y = y1 + int((y2 - y1) * 0.42)
    pd.rounded_rectangle(
        [x1 + 3, y1 + 3, x2 - 3, mid_y],
        radius=max(6, radius - 3),
        fill=(255, 255, 255, 22),
    )
    pd.rounded_rectangle(box, radius=radius, outline=(*accent, 245), width=border_w)
    pd.rounded_rectangle(
        [x1 + 4, y1 + 4, x2 - 4, y2 - 4],
        radius=max(6, radius - 4),
        outline=(255, 255, 255, 50),
        width=1,
    )
    return Image.alpha_composite(out, panel)


def glow_text(
    img: Image.Image,
    cx: int,
    cy: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple = COL_WHITE,
    glow_col: tuple | None = None,
    shadow: bool = True,
) -> Image.Image:
    d_tmp = ImageDraw.Draw(img)
    bbox = d_tmp.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = cx - tw // 2 - bbox[0]
    y = cy - th // 2 - bbox[1]

    if glow_col is not None:
        gl = Image.new("RGBA", img.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(gl)
        gd.text((x, y + 3), text, font=font, fill=(0, 0, 0, 210))
        gd.text((x, y), text, font=font, fill=(*glow_col, 165))
        gl = gl.filter(ImageFilter.GaussianBlur(radius=4))
        img = Image.alpha_composite(img, gl)

    d = ImageDraw.Draw(img)
    if shadow and sum(fill[:3]) >= 180:
        d.text((x + 2, y + 3), text, font=font, fill=(0, 0, 0, 215))
    d.text((x, y), text, font=font, fill=(*fill[:3], 255))
    return img


def save_png(img: Image.Image, rel_path: str):
    out_path = ROOT / rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rgb = img.convert("RGB")
    quant = rgb.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    quant.save(out_path, format="PNG", optimize=True)


def save_gif(frames: list[Image.Image], rel_path: str, duration_ms: int = 115):
    out_path = ROOT / rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    p_frames = [f.convert("RGB").quantize(colors=128, method=Image.Quantize.MEDIANCUT) for f in frames]
    p_frames[0].save(
        out_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
    )


# ==============================================================================
# Vẽ 6 Linh Vật Bầu Cua 3D (Đổ bóng + Specular Highlight + Chi tiết sắc nét)
# ==============================================================================

MASCOT_META = [
    ("bau", "BẦU", (16, 219, 152)),
    ("cua", "CUA", (255, 77, 109)),
    ("tom", "TÔM", (255, 159, 28)),
    ("ca", "CÁ", (56, 189, 248)),
    ("ga", "GÀ", (255, 209, 102)),
    ("nai", "NAI", (232, 146, 73)),
]


def draw_3d_sphere(draw: ImageDraw.ImageDraw, box: list, base_col: tuple, outline_col: tuple, width: int = 3):
    x1, y1, x2, y2 = box
    # Bóng nền dưới
    dark = (max(0, base_col[0] - 55), max(0, base_col[1] - 55), max(0, base_col[2] - 55), 255)
    bright = (min(255, base_col[0] + 65), min(255, base_col[1] + 65), min(255, base_col[2] + 65), 215)
    draw.ellipse([x1, y1, x2, y2], fill=dark, outline=(*outline_col[:3], 255), width=width)
    inset_x = max(2, int((x2 - x1) * 0.07))
    inset_y = max(2, int((y2 - y1) * 0.07))
    draw.ellipse([x1 + inset_x, y1 + inset_y, x2 - inset_x, y2 - int(inset_y * 1.4)], fill=(*base_col[:3], 255))
    # Đốm phản quang 3D góc trên trái
    hx1 = x1 + int((x2 - x1) * 0.20)
    hy1 = y1 + int((y2 - y1) * 0.16)
    hx2 = x1 + int((x2 - x1) * 0.52)
    hy2 = y1 + int((y2 - y1) * 0.42)
    draw.ellipse([hx1, hy1, hx2, hy2], fill=bright)


def draw_baucua_3d_mascot(img: Image.Image, mascot_id: str, cx: int, cy: int, r: int) -> Image.Image:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.ellipse([cx - int(r * 0.72), cy + int(r * 0.56), cx + int(r * 0.72), cy + int(r * 0.88)], fill=(0, 0, 0, 145))
    sh = sh.filter(ImageFilter.GaussianBlur(radius=max(3, r // 10)))
    img = Image.alpha_composite(img, sh)

    draw = ImageDraw.Draw(layer)
    if mascot_id == "bau":
        draw.arc([cx - 8, cy - int(r * 1.02), cx + 22, cy - int(r * 0.66)], 150, 345, fill=(212, 163, 73, 255), width=max(3, r // 11))
        draw_3d_sphere(draw, [cx - int(r * 0.46), cy - int(r * 0.76), cx + int(r * 0.46), cy - int(r * 0.06)], (34, 211, 153), COL_GOLD, 3)
        draw_3d_sphere(draw, [cx - int(r * 0.68), cy - int(r * 0.16), cx + int(r * 0.68), cy + int(r * 0.78)], (16, 185, 129), COL_GOLD, 3)
        # Dải lụa đỏ thắt nơ vàng
        draw.rounded_rectangle([cx - int(r * 0.44), cy - int(r * 0.17), cx + int(r * 0.44), cy - int(r * 0.02)], radius=5, fill=(244, 63, 94, 255), outline=(*COL_GOLD, 255), width=2)
    elif mascot_id == "cua":
        for side in (-1, 1):
            for leg in range(3):
                ly = cy - int(r * 0.08) + leg * int(r * 0.25)
                draw.line([cx + side * int(r * 0.48), ly, cx + side * int(r * 0.92), ly + int(r * 0.18)], fill=(225, 29, 72, 255), width=max(3, r // 11))
            claw_x = cx + side * int(r * 0.56)
            claw_y = cy - int(r * 0.56)
            draw_3d_sphere(draw, [claw_x - int(r * 0.28), claw_y - int(r * 0.26), claw_x + int(r * 0.28), claw_y + int(r * 0.26)], (251, 113, 133), COL_GOLD, 2)
        draw_3d_sphere(draw, [cx - int(r * 0.68), cy - int(r * 0.34), cx + int(r * 0.68), cy + int(r * 0.56)], (244, 63, 94), COL_GOLD, 3)
        for ex in (-int(r * 0.22), int(r * 0.22)):
            draw.ellipse([cx + ex - int(r * 0.11), cy - int(r * 0.32), cx + ex + int(r * 0.11), cy - int(r * 0.10)], fill=(255, 255, 255, 255))
            draw.ellipse([cx + ex - int(r * 0.05), cy - int(r * 0.26), cx + ex + int(r * 0.05), cy - int(r * 0.16)], fill=(15, 23, 42, 255))
    elif mascot_id == "tom":
        draw.arc([cx - int(r * 0.92), cy - int(r * 0.88), cx + int(r * 0.35), cy + int(r * 0.05)], 185, 352, fill=(*COL_GOLD, 255), width=max(2, r // 14))
        draw.arc([cx - int(r * 0.78), cy - int(r * 0.72), cx + int(r * 0.42), cy + int(r * 0.12)], 190, 345, fill=(251, 146, 60, 255), width=max(2, r // 16))
        for seg in range(5):
            ang = -0.55 + seg * 0.44
            sx = cx + int(math.cos(ang) * r * 0.36) - int(r * 0.10)
            sy = cy + int(math.sin(ang) * r * 0.44)
            rad = int(r * (0.37 - seg * 0.045))
            draw_3d_sphere(draw, [sx - rad, sy - rad, sx + rad, sy + rad], (249, 115, 22), COL_GOLD, 2)
        draw.ellipse([cx - int(r * 0.08), cy - int(r * 0.34), cx + int(r * 0.08), cy - int(r * 0.18)], fill=(15, 23, 42, 255), outline=(255, 255, 255, 220), width=1)
    elif mascot_id == "ca":
        draw.polygon(
            [(cx + int(r * 0.38), cy), (cx + int(r * 0.92), cy - int(r * 0.48)), (cx + int(r * 0.78), cy), (cx + int(r * 0.92), cy + int(r * 0.48))],
            fill=(*COL_GOLD, 255),
            outline=(56, 189, 248, 255),
        )
        draw_3d_sphere(draw, [cx - int(r * 0.78), cy - int(r * 0.46), cx + int(r * 0.52), cy + int(r * 0.46)], (14, 165, 233), COL_GOLD, 3)
        draw.ellipse([cx - int(r * 0.50), cy - int(r * 0.16), cx - int(r * 0.28), cy + int(r * 0.06)], fill=(255, 255, 255, 255))
        draw.ellipse([cx - int(r * 0.44), cy - int(r * 0.10), cx - int(r * 0.34), cy], fill=(10, 15, 30, 255))
    elif mascot_id == "ga":
        draw.polygon(
            [(cx - int(r * 0.22), cy - int(r * 0.66)), (cx - int(r * 0.08), cy - int(r * 0.96)), (cx + int(r * 0.04), cy - int(r * 0.72)), (cx + int(r * 0.18), cy - int(r * 0.92)), (cx + int(r * 0.22), cy - int(r * 0.62))],
            fill=(244, 63, 94, 255),
        )
        draw_3d_sphere(draw, [cx - int(r * 0.56), cy - int(r * 0.22), cx + int(r * 0.56), cy + int(r * 0.66)], (245, 158, 11), COL_GOLD, 3)
        draw_3d_sphere(draw, [cx - int(r * 0.34), cy - int(r * 0.68), cx + int(r * 0.30), cy - int(r * 0.06)], (251, 191, 36), COL_GOLD, 3)
        draw.polygon([(cx + int(r * 0.26), cy - int(r * 0.44)), (cx + int(r * 0.58), cy - int(r * 0.33)), (cx + int(r * 0.26), cy - int(r * 0.22))], fill=(249, 115, 22, 255))
        draw.ellipse([cx + int(r * 0.02), cy - int(r * 0.48), cx + int(r * 0.14), cy - int(r * 0.36)], fill=(15, 23, 42, 255))
    elif mascot_id == "nai":
        for side in (-1, 1):
            draw.line([cx + side * int(r * 0.24), cy - int(r * 0.40), cx + side * int(r * 0.54), cy - int(r * 0.92)], fill=(*COL_GOLD, 255), width=max(4, r // 10))
            draw.line([cx + side * int(r * 0.38), cy - int(r * 0.68), cx + side * int(r * 0.70), cy - int(r * 0.74)], fill=(*COL_GOLD, 255), width=max(3, r // 12))
        draw_3d_sphere(draw, [cx - int(r * 0.52), cy - int(r * 0.46), cx + int(r * 0.52), cy + int(r * 0.60)], (217, 119, 6), COL_GOLD, 3)
        for ex in (-int(r * 0.22), int(r * 0.22)):
            draw.ellipse([cx + ex - int(r * 0.09), cy - int(r * 0.14), cx + ex + int(r * 0.09), cy + int(r * 0.04)], fill=(15, 23, 42, 255))
            draw.ellipse([cx + ex - int(r * 0.05), cy - int(r * 0.12), cx + ex, cy - int(r * 0.06)], fill=(255, 255, 255, 235))
        draw.ellipse([cx - int(r * 0.16), cy + int(r * 0.18), cx + int(r * 0.16), cy + int(r * 0.38)], fill=(120, 53, 15, 255))

    return Image.alpha_composite(img, layer)


# ==============================================================================
# Vẽ Xúc Xắc 3D Chân Thực (Khối lập phương vát cạnh + Nút lõm bóng kính)
# ==============================================================================

PIP_COORDS = {
    1: [(0.5, 0.5)],
    2: [(0.28, 0.28), (0.72, 0.72)],
    3: [(0.26, 0.26), (0.5, 0.5), (0.74, 0.74)],
    4: [(0.28, 0.28), (0.72, 0.28), (0.28, 0.72), (0.72, 0.72)],
    5: [(0.26, 0.26), (0.74, 0.26), (0.5, 0.5), (0.26, 0.74), (0.74, 0.74)],
    6: [(0.28, 0.23), (0.72, 0.23), (0.28, 0.50), (0.72, 0.50), (0.28, 0.77), (0.72, 0.77)],
}


def draw_3d_die_cube(img: Image.Image, x: int, y: int, size: int, val: int, glow_col: tuple = COL_GOLD) -> Image.Image:
    rad = int(size * 0.22)
    depth = max(5, int(size * 0.09))

    # Đổ bóng 3D mềm
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([x + depth + 3, y + depth + 5, x + size + depth + 3, y + size + depth + 5], radius=rad, fill=(0, 0, 0, 175))
    sd.rounded_rectangle([x - 2, y - 2, x + size + depth + 1, y + size + depth + 1], radius=rad + 2, outline=(*glow_col, 130), width=3)
    sh = sh.filter(ImageFilter.GaussianBlur(radius=5))
    out = Image.alpha_composite(img, sh)

    d = ImageDraw.Draw(out)
    # Cạnh khối 3D bên phải-dưới (Ngà sẫm + viền kim loại vàng)
    d.rounded_rectangle(
        [x + depth, y + depth, x + size + depth, y + size + depth],
        radius=rad,
        fill=(196, 203, 222, 255),
        outline=(*COL_GOLD, 235),
        width=2,
    )
    # Mặt chính ngà sứ cao cấp
    d.rounded_rectangle(
        [x, y, x + size, y + size],
        radius=rad,
        fill=(248, 250, 255, 255),
        outline=(*COL_GOLD, 255),
        width=3,
    )
    # Phản quang mặt kính trên của xúc xắc
    d.rounded_rectangle(
        [x + 5, y + 5, x + size - 5, y + int(size * 0.42)],
        radius=max(4, rad - 4),
        fill=(255, 255, 255, 190),
    )

    pip_main = (225, 29, 72) if val in (1, 4) else (17, 24, 39)
    pip_hi = (255, 140, 160) if val in (1, 4) else (100, 116, 139)
    pr = int(size * (0.145 if val == 1 else 0.088))
    for px, py in PIP_COORDS[val]:
        cx = x + int(px * size)
        cy = y + int(py * size)
        # Viền lõm 3D của nút xúc xắc
        d.ellipse([cx - pr - 2, cy - pr - 2, cx + pr + 2, cy + pr + 2], fill=(203, 213, 225, 255))
        d.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=(*pip_main, 255))
        hr = max(2, pr // 3)
        d.ellipse([cx - pr // 2, cy - pr // 2, cx - pr // 2 + hr, cy - pr // 2 + hr], fill=(*pip_hi, 230))
    return out


def draw_3d_mascot_die_cube(img: Image.Image, x: int, y: int, size: int, mascot_id: str, accent: tuple) -> Image.Image:
    rad = int(size * 0.22)
    depth = max(5, int(size * 0.09))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([x + depth + 3, y + depth + 5, x + size + depth + 3, y + size + depth + 5], radius=rad, fill=(0, 0, 0, 175))
    sh = sh.filter(ImageFilter.GaussianBlur(radius=5))
    out = Image.alpha_composite(img, sh)

    cube_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(cube_layer)
    d.rounded_rectangle([x + depth, y + depth, x + size + depth, y + size + depth], radius=rad, fill=(26, 32, 62, 255), outline=(*COL_GOLD, 220), width=2)
    d.rounded_rectangle([x, y, x + size, y + size], radius=rad, fill=(18, 24, 48, 255), outline=(*accent, 255), width=3)
    d.rounded_rectangle([x + 4, y + 4, x + size - 4, y + int(size * 0.38)], radius=max(4, rad - 4), fill=(255, 255, 255, 26))
    out = Image.alpha_composite(out, cube_layer)
    return draw_baucua_3d_mascot(out, mascot_id, x + size // 2, y + size // 2 + 2, int(size * 0.36))


# ==============================================================================
# Helper tạo Banner Thắng / Thua chuyên biệt cho từng trò chơi
# ==============================================================================

def build_dedicated_outcome_banner(
    rel_path: str,
    game_tag: str,
    headline: str,
    subtitle: str,
    is_win: bool = True,
    is_special: bool = False,
):
    if is_special:
        c = make_cinematic_canvas(840, 260, (24, 12, 48), (48, 18, 28), COL_GOLD, COL_PURPLE)
        c = draw_neon_metallic_frame(c, COL_GOLD, COL_CYAN, pad=10, radius=22)
        badge_col = COL_GOLD
    elif is_win:
        c = make_cinematic_canvas(840, 250, (8, 30, 38), (16, 14, 44), COL_CYAN, COL_GOLD)
        c = draw_neon_metallic_frame(c, COL_CYAN, COL_GOLD, pad=10, radius=22)
        badge_col = COL_CYAN
    else:
        c = make_cinematic_canvas(840, 250, (36, 10, 28), (14, 10, 32), COL_CRIMSON, COL_PURPLE)
        c = draw_neon_metallic_frame(c, COL_CRIMSON, COL_PURPLE, pad=10, radius=22)
        badge_col = COL_CRIMSON

    c = draw_glass_panel(c, [250, 28, 590, 74], badge_col, (12, 18, 38, 225), radius=14, border_w=2)
    c = glow_text(c, 420, 51, game_tag, get_font(18), badge_col, badge_col)
    c = glow_text(c, 420, 130, headline, get_font(34), COL_GOLD if (is_win or is_special) else (255, 160, 185), badge_col)
    c = glow_text(c, 420, 192, subtitle, get_font(16, False), COL_WHITE, None)
    save_png(c, rel_path)


# ==============================================================================
# 1. Banners Hệ Thống Game Center, Hồ Sơ, Ví, Nhiệm Vụ, Shop, BXH
# ==============================================================================

def generate_core_banners():
    gc = make_cinematic_canvas(900, 340, (6, 10, 24), (24, 10, 48), COL_CYAN, COL_PURPLE)
    gc = draw_neon_metallic_frame(gc, COL_CYAN, COL_GOLD, pad=10, radius=24)
    gc = glow_text(gc, 450, 56, "GAME CENTER PRO MAX 3D", get_font(40), COL_CYAN, COL_CYAN)
    gc = glow_text(gc, 450, 104, "MULTIPLAYER CASINO ROUNDS • DISCORD COMPONENTS V2 • KINH TẾ VNĐ", get_font(17), COL_GOLD, COL_PURPLE)

    badges = ["BẦU CUA", "TÀI XỈU", "ĐUA THÚ", "NỐI TỪ", "OẲN TÙ TÌ", "ĐOÁN SỐ", "ĐỒNG XU"]
    cols = [COL_CYAN, COL_GOLD, COL_EMERALD, COL_SKY, COL_VIOLET, COL_PURPLE, COL_AMBER]
    bw, gap = 108, 12
    sx = (900 - (len(badges) * bw + (len(badges) - 1) * gap)) // 2
    for idx, (lbl, col) in enumerate(zip(badges, cols)):
        bx, by = sx + idx * (bw + gap), 146
        gc = draw_glass_panel(gc, [bx, by, bx + bw, by + 112], col, (14, 20, 44, 225), radius=16, border_w=2)
        d = ImageDraw.Draw(gc)
        d.ellipse([bx + 34, by + 14, bx + 74, by + 54], fill=(*col, 240), outline=(255, 255, 255, 200), width=2)
        gc = glow_text(gc, bx + bw // 2, by + 34, f"#{idx + 1}", get_font(18), (8, 12, 24), None)
        gc = glow_text(gc, bx + bw // 2, by + 84, lbl, get_font(13), COL_WHITE, None)

    gc = glow_text(gc, 450, 296, "MỌI THÀNH VIÊN ĐỀU MỞ ĐƯỢC PHIÊN • CÙNG CƯỢC TRÊN 1 BÀN • MINH BẠCH 100%", get_font(15, False), COL_MUTED, None)
    save_png(gc, "banners/game_center.png")

    build_dedicated_outcome_banner(
        "banners/victory.png",
        "CASINO VIP PRO MAX",
        "CHIẾN THẮNG RỰC RỠ!",
        "TIỀN THƯỞNG VNĐ ĐÃ CỘNG TRỰC TIẾP VÀO VÍ CỦA BẠN",
        is_win=True,
    )
    build_dedicated_outcome_banner(
        "banners/defeat.png",
        "CASINO VIP PRO MAX",
        "CHƯA TRÚNG PHIÊN NÀY!",
        "BÁM CẦU NGAY Ở PHIÊN TIẾP THEO • CHÚC BẠN ĐẠI THẮNG",
        is_win=False,
    )

    for rel, title, sub, accent, metal in [
        ("banners/quest_banner.png", "TRUNG TÂM NHIỆM VỤ PRO MAX", "9 NHIỆM VỤ NGÀY • 4 NHIỆM VỤ TUẦN • NHẬN VNĐ & EXP TỨC THÌ", COL_CYAN, COL_GOLD),
        ("banners/shop_banner.png", "CỬA HÀNG CYBER & HỘP BÍ ẨN", "VÉ MAY MẮN • THẺ X2 EXP • BẢO HIỂM • TRỨNG THÚ CƯNG • KHUNG VIP", COL_PURPLE, COL_GOLD),
        ("banners/wallet_banner.png", "VÍ ĐIỆN TỬ & NGÂN HÀNG VNĐ", "QUẢN LÝ TIỀN MẶT • TIẾT KIỆM SINH LÃI TỰ ĐỘNG • ĐIỂM DANH NHANH", COL_CYAN, COL_PURPLE),
        ("banners/profile_banner.png", "HỒ SƠ CHIẾN BINH & DANH HIỆU", "CẤP ĐỘ EXP • THÚ CƯNG ĐỒNG HÀNH • HUY HIỆU & BUFF ĐANG BẬT", COL_VIOLET, COL_GOLD),
        ("banners/leaderboard_banner.png", "BẢNG VÀNG ĐẠI GIA SERVER", "TOP ĐẠI GIA VNĐ • TOP CẤP ĐỘ • TOP THẮNG PHIÊN • TOP NỐI TỪ", COL_GOLD, COL_CYAN),
    ]:
        b = make_cinematic_canvas(840, 230, (8, 12, 28), (24, 12, 48), accent, metal)
        b = draw_neon_metallic_frame(b, accent, metal, pad=10, radius=22)
        b = draw_glass_panel(b, [46, 36, 794, 194], accent, (12, 18, 40, 190), radius=18, border_w=2)
        b = glow_text(b, 420, 86, title, get_font(31), accent, accent)
        b = glow_text(b, 420, 146, sub, get_font(16, False), COL_WHITE, None)
        save_png(b, rel)


# ==============================================================================
# 2. Bộ Tài Nguyên 3D Riêng Cho BẦU CUA (Multiplayer Casino Round)
# ==============================================================================

def generate_baucua_3d_pack():
    # 6 thẻ linh vật 3D (260x260) + 6 viên xúc xắc linh vật 3D (200x200)
    for m_id, m_name, accent in MASCOT_META:
        card = make_cinematic_canvas(260, 260, (10, 14, 30), (22, 12, 46), accent, COL_GOLD)
        card = draw_neon_metallic_frame(card, accent, COL_GOLD, pad=8, radius=22)
        card = draw_glass_panel(card, [24, 24, 236, 188], accent, (14, 20, 44, 210), radius=18, border_w=2)
        card = draw_baucua_3d_mascot(card, m_id, 130, 108, 66)
        card = draw_glass_panel(card, [32, 196, 228, 238], COL_GOLD, (10, 14, 30, 235), radius=12, border_w=2)
        card = glow_text(card, 130, 217, m_name, get_font(24), accent, accent)
        save_png(card, f"baucua/{m_id}.png")

        die_img = make_cinematic_canvas(200, 200, (8, 12, 26), (18, 12, 40), accent, COL_PURPLE)
        die_img = draw_3d_mascot_die_cube(die_img, 30, 24, 132, m_id, accent)
        die_img = glow_text(die_img, 100, 180, f"XÚC XẮC {m_name}", get_font(15), COL_GOLD, None)
        save_png(die_img, f"baucua/dice_{m_id}.png")

    # Banner Bầu Cua 3D Hero (880x360)
    hero = make_cinematic_canvas(880, 360, (8, 12, 28), (28, 10, 46), COL_CYAN, COL_GOLD)
    hero = draw_neon_metallic_frame(hero, COL_GOLD, COL_CYAN, pad=10, radius=24)
    hero = glow_text(hero, 440, 50, "SÒNG BẦU CUA 3D HOÀNG GIA", get_font(34), COL_GOLD, COL_GOLD)
    hero = glow_text(hero, 440, 90, "PHIÊN CƯỢC CHUNG SERVER • ĐẶT NHIỀU CỬA • NHẬN X2 • X3 • X4", get_font(16), COL_CYAN, None)
    hero = draw_glass_panel(hero, [48, 116, 832, 294], COL_PURPLE, (12, 18, 40, 205), radius=20, border_w=2)
    hero = draw_3d_mascot_die_cube(hero, 150, 138, 124, "cua", (255, 77, 109))
    hero = draw_3d_mascot_die_cube(hero, 374, 132, 132, "bau", (16, 219, 152))
    hero = draw_3d_mascot_die_cube(hero, 604, 138, 124, "tom", (255, 159, 28))
    hero = glow_text(hero, 440, 324, "1 TRÙNG = X2 HOÀN TRẢ  •  2 TRÙNG = X3 HOÀN TRẢ  •  3 TRÙNG = X4 ĐẠI BÃO", get_font(15, False), COL_WHITE, None)
    save_png(hero, "baucua/banner_3d.png")

    # Bàn Cược Casino Bầu Cua 6 Cửa (880x500)
    table = make_cinematic_canvas(880, 500, (8, 14, 30), (24, 10, 44), COL_PURPLE, COL_CYAN)
    table = draw_neon_metallic_frame(table, COL_CYAN, COL_GOLD, pad=10, radius=24)
    table = glow_text(table, 440, 46, "BÀN CƯỢC CASINO BẦU CUA 3D (6 CỬA)", get_font(28), COL_GOLD, COL_GOLD)
    cw, ch = 250, 184
    gx0, gy0, x_gap, y_gap = 44, 84, 21, 18
    for idx, (m_id, m_name, accent) in enumerate(MASCOT_META):
        col, row = idx % 3, idx // 3
        x = gx0 + col * (cw + x_gap)
        y = gy0 + row * (ch + y_gap)
        table = draw_glass_panel(table, [x, y, x + cw, y + ch], accent, (14, 22, 46, 222), radius=18, border_w=3)
        table = draw_baucua_3d_mascot(table, m_id, x + cw // 2, y + 78, 52)
        table = draw_glass_panel(table, [x + 24, y + ch - 44, x + cw - 24, y + ch - 10], COL_GOLD, (8, 12, 26, 240), radius=10, border_w=1)
        table = glow_text(table, x + cw // 2, y + ch - 27, f"CỬA {m_name}", get_font(18), accent, None)
    save_png(table, "baucua/board_grid.png")
    save_png(table, "baucua/casino_table.png")
    save_png(hero, "games/baucua.png")

    # Banner Thắng / Thua / Bão Đồng Nhất X4 riêng của Bầu Cua
    build_dedicated_outcome_banner(
        "baucua/win.png",
        "BẦU CUA CASINO 3D",
        "TRÚNG LỚN BẦU CUA!",
        "LINH VẬT BẠN CHỌN ĐÃ NỔ • TIỀN THƯỞNG VNĐ CỘNG TỨC THÌ",
        is_win=True,
    )
    build_dedicated_outcome_banner(
        "baucua/lose.png",
        "BẦU CUA CASINO 3D",
        "TRƯỢT CỬA BẦU CUA!",
        "3 XÚC XẮC CHƯA VỀ CỬA BẠN ĐẶT • MỞ PHIÊN MỚI PHỤC THÙ NGAY",
        is_win=False,
    )
    build_dedicated_outcome_banner(
        "baucua/special_triple.png",
        "SIÊU BÃO ĐỒNG NHẤT 3 XÚC XẮC!",
        "NỔ BỘ BA LINH VẬT X4!",
        "CẢ 3 VIÊN XÚC XẮC CÙNG MỘT MẶT • NHÂN 4 TỔNG TIỀN HOÀN TRẢ",
        is_win=True,
        is_special=True,
    )

    # Animation GIF Lắc 3 Xúc Xắc Bầu Cua 3D (600x270)
    frames = []
    for f in range(8):
        fr = make_cinematic_canvas(600, 270, (10, 12, 30), (30, 10, 50), COL_CYAN if f % 2 == 0 else COL_PURPLE, COL_GOLD)
        fr = draw_neon_metallic_frame(fr, COL_GOLD if f % 2 == 0 else COL_CYAN, COL_PURPLE, pad=8, radius=20)
        fr = glow_text(fr, 300, 42, "ĐANG LẮC 3 XÚC XẮC BẦU CUA 3D...", get_font(22), COL_GOLD, COL_GOLD)
        dx = int(math.sin(f * math.pi / 2) * 16)
        dy = int(math.cos(f * math.pi / 2) * 9)
        for slot in range(3):
            m_id, _mn, accent = MASCOT_META[(f + slot * 2) % 6]
            sx = 82 + slot * 156 + dx
            sy = 78 + (dy if slot % 2 == 0 else -dy)
            fr = draw_3d_mascot_die_cube(fr, sx, sy, 106, m_id, accent)
        fr = glow_text(fr, 300, 234, "KẾT QUẢ CHUNG CHO TOÀN BỘ NGƯỜI CHƠI TRONG PHIÊN", get_font(14, False), COL_CYAN, None)
        frames.append(fr)
    save_gif(frames, "baucua/baucua_shake.gif", duration_ms=110)


# ==============================================================================
# 3. Bộ Tài Nguyên 3D Riêng Cho TÀI XỈU (Multiplayer Casino Round)
# ==============================================================================

def generate_taixiu_3d_pack():
    # 6 mặt xúc xắc 3D riêng (200x200)
    for v in range(1, 7):
        glow_c = COL_CRIMSON if v in (1, 4) else COL_CYAN
        img = make_cinematic_canvas(200, 200, (8, 12, 26), (18, 12, 42), glow_c, COL_GOLD)
        img = draw_neon_metallic_frame(img, glow_c, COL_GOLD, pad=6, radius=20)
        img = draw_3d_die_cube(img, 30, 26, 130, v, glow_c)
        img = glow_text(img, 100, 178, f"MẶT {v} NÚT", get_font(15), COL_GOLD, None)
        save_png(img, f"dice/dice_{v}.png")

    # Thẻ Khu vực Cửa TÀI & Cửa XỈU 3D (360x260)
    for side, title, pts, accent, sub_col in [
        ("tai", "CỬA TÀI", "11 – 17 ĐIỂM", COL_CRIMSON, COL_GOLD),
        ("xiu", "CỬA XỈU", "4 – 10 ĐIỂM", COL_CYAN, COL_VIOLET),
    ]:
        z = make_cinematic_canvas(360, 260, (10, 14, 30), (26, 10, 44), accent, sub_col)
        z = draw_neon_metallic_frame(z, accent, COL_GOLD, pad=8, radius=22)
        z = draw_glass_panel(z, [24, 24, 336, 236], accent, (14, 18, 40, 215), radius=18, border_w=3)
        z = glow_text(z, 180, 76, title, get_font(44), accent, accent)
        z = glow_text(z, 180, 142, pts, get_font(26), COL_WHITE, None)
        z = draw_glass_panel(z, [34, 178, 326, 220], COL_GOLD, (8, 12, 26, 235), radius=12, border_w=2)
        z = glow_text(z, 180, 199, "THẮNG NHẬN X2 HOÀN TRẢ", get_font(15), COL_GOLD, None)
        save_png(z, f"taixiu/zone_{side}.png")

    # Bàn Xúc Xắc Tài Xỉu 3D & Hero Banner (880x380)
    tx = make_cinematic_canvas(880, 380, (8, 12, 26), (22, 10, 44), COL_CRIMSON, COL_CYAN)
    tx = draw_neon_metallic_frame(tx, COL_GOLD, COL_CYAN, pad=10, radius=24)
    tx = glow_text(tx, 440, 48, "SÒNG TÀI XỈU 3D HOÀNG GIA", get_font(33), COL_GOLD, COL_GOLD)

    # Cửa TÀI bên trái
    tx = draw_glass_panel(tx, [40, 86, 316, 314], COL_CRIMSON, (36, 12, 28, 222), radius=20, border_w=3)
    tx = glow_text(tx, 178, 144, "TÀI", get_font(54), COL_CRIMSON, COL_CRIMSON)
    tx = glow_text(tx, 178, 214, "11 – 17 ĐIỂM", get_font(23), COL_WHITE, None)
    tx = glow_text(tx, 178, 266, "NHẬN X2 TIỀN CƯỢC", get_font(16), COL_GOLD, None)

    # Mâm kính 3 viên xúc xắc 3D ở giữa
    tx = draw_glass_panel(tx, [334, 86, 546, 314], COL_GOLD, (14, 20, 44, 228), radius=24, border_w=3)
    tx = draw_3d_die_cube(tx, 360, 112, 68, 6, COL_GOLD)
    tx = draw_3d_die_cube(tx, 446, 112, 68, 5, COL_GOLD)
    tx = draw_3d_die_cube(tx, 403, 194, 68, 4, COL_CRIMSON)
    tx = glow_text(tx, 440, 290, "3 XÚC XẮC CHUNG", get_font(14), COL_GOLD, None)

    # Cửa XỈU bên phải
    tx = draw_glass_panel(tx, [564, 86, 840, 314], COL_CYAN, (10, 24, 46, 222), radius=20, border_w=3)
    tx = glow_text(tx, 702, 144, "XỈU", get_font(54), COL_CYAN, COL_CYAN)
    tx = glow_text(tx, 702, 214, "4 – 10 ĐIỂM", get_font(23), COL_WHITE, None)
    tx = glow_text(tx, 702, 266, "NHẬN X2 TIỀN CƯỢC", get_font(16), COL_GOLD, None)

    tx = glow_text(tx, 440, 346, "LUẬT CHUẨN CASINO: BỘ BA TỔNG 3 HOẶC 18 => NHÀ CÁI THẮNG", get_font(15, False), COL_MUTED, None)
    save_png(tx, "games/taixiu.png")
    save_png(tx, "taixiu/banner_3d.png")
    save_png(tx, "taixiu/table_3d.png")

    # Banner Thắng / Thua / Bảng Kết Quả Cao Cấp / Bộ Ba 3-18 riêng của Tài Xỉu
    build_dedicated_outcome_banner(
        "taixiu/win.png",
        "TÀI XỈU CASINO 3D",
        "THẮNG PHIÊN TÀI XỈU (X2)!",
        "DỰ ĐOÁN CHÍNH XÁC TỔNG 3 XÚC XẮC • ĐÃ TRẢ THƯỞNG X2 VNĐ",
        is_win=True,
    )
    build_dedicated_outcome_banner(
        "taixiu/lose.png",
        "TÀI XỈU CASINO 3D",
        "CHƯA TRÚNG CỬA TÀI XỈU!",
        "XEM LỊCH SỬ CẦU & VÀO PHIÊN MỚI ĐỂ GỠ NGAY",
        is_win=False,
    )
    build_dedicated_outcome_banner(
        "taixiu/result_board.png",
        "KẾT QUẢ CHÍNH THỨC PHIÊN TÀI XỈU",
        "MỞ BÁT 3 XÚC XẮC CÔNG KHAI",
        "100% NGƯỜI CHƠI TRONG PHIÊN NHẬN CÙNG MỘT KẾT QUẢ MINH BẠCH",
        is_win=True,
    )
    build_dedicated_outcome_banner(
        "taixiu/special_triple.png",
        "BỘ BA ĐỒNG NHẤT (TỔNG 3 / 18)",
        "BÃO TAM HOA — NHÀ CÁI THẮNG!",
        "THEO LUẬT CÔNG BỐ TRƯỚC PHIÊN: TỔNG 3 HOẶC 18 THUỘC VỀ NHÀ CÁI",
        is_win=False,
        is_special=True,
    )

    # Animation GIF Tung 3 Viên Xúc Xắc 3D với hào quang Neon (600x260)
    frames = []
    combos = [(1, 4, 6), (3, 5, 2), (6, 2, 4), (2, 6, 1), (5, 3, 6), (4, 1, 5), (2, 4, 3), (6, 5, 1)]
    for idx, (d1, d2, d3) in enumerate(combos):
        g_col = COL_CYAN if idx % 2 == 0 else COL_CRIMSON
        fr = make_cinematic_canvas(600, 260, (8, 12, 28), (26, 10, 48), g_col, COL_GOLD)
        fr = draw_neon_metallic_frame(fr, g_col, COL_GOLD, pad=8, radius=20)
        fr = glow_text(fr, 300, 40, "ĐANG TUNG 3 XÚC XẮC 3D...", get_font(23), COL_GOLD, g_col)
        jit = -10 if idx % 2 == 0 else 10
        fr = draw_3d_die_cube(fr, 108, 78 + jit, 98, d1, COL_CYAN)
        fr = draw_3d_die_cube(fr, 248, 78 - jit, 98, d2, COL_GOLD)
        fr = draw_3d_die_cube(fr, 388, 78 + jit, 98, d3, COL_CRIMSON)
        fr = glow_text(fr, 300, 224, "TÀI (11–17)  •  XỈU (4–10)  •  3/18 NHÀ CÁI THẮNG", get_font(14), COL_WHITE, None)
        frames.append(fr)
    save_gif(frames, "dice/dice_roll.gif", duration_ms=105)


# ==============================================================================
# 4. Bộ Tài Nguyên 3D Riêng Cho 5 Trò Chơi Còn Lại (Đua Thú, Nối Từ, RPS, Đoán Số, Đồng Xu)
# ==============================================================================

def make_game_icon_tile(rel_path: str, symbol_txt: str, label: str, accent: tuple):
    ic = make_cinematic_canvas(240, 240, (8, 12, 28), (22, 12, 46), accent, COL_GOLD)
    ic = draw_neon_metallic_frame(ic, accent, COL_GOLD, pad=8, radius=22)
    ic = draw_glass_panel(ic, [28, 28, 212, 174], accent, (14, 20, 44, 220), radius=18, border_w=2)
    ic = glow_text(ic, 120, 100, symbol_txt, get_font(44), accent, accent)
    ic = glow_text(ic, 120, 204, label, get_font(20), COL_GOLD, None)
    save_png(ic, rel_path)


def generate_remaining_5_games_packs():
    # --- A. ĐUA THÚ 3D (Multiplayer 90s Round + Solo) ---
    racers = [
        ("horse", "CHIẾN MÃ", "MÃ", (251, 146, 60)),
        ("cheetah", "BÁO ĐỐM", "BÁO", (255, 209, 102)),
        ("eagle", "ĐẠI BÀNG", "ƯNG", (56, 189, 248)),
        ("wolf", "SÓI BẠC", "SÓI", (196, 181, 253)),
        ("tiger", "HỔ TRẮNG", "HỔ", (16, 219, 152)),
    ]
    for a_id, a_name, badge, col in racers:
        ac = make_cinematic_canvas(240, 240, (8, 14, 28), (18, 12, 42), col, COL_GOLD)
        ac = draw_neon_metallic_frame(ac, col, COL_GOLD, pad=8, radius=20)
        ac = draw_glass_panel(ac, [26, 26, 214, 172], col, (14, 22, 44, 220), radius=18, border_w=2)
        d = ImageDraw.Draw(ac)
        draw_3d_sphere(d, [64, 44, 176, 156], col, COL_GOLD, 3)
        ac = glow_text(ac, 120, 100, badge, get_font(28), (10, 14, 26), None)
        ac = glow_text(ac, 120, 202, a_name, get_font(20), col, col)
        save_png(ac, f"race/{a_id}.png")

    make_game_icon_tile("race/icon.png", "X4.5", "ĐUA THÚ 3D", COL_EMERALD)
    rc_b = make_cinematic_canvas(880, 350, (8, 16, 28), (18, 12, 44), COL_EMERALD, COL_CYAN)
    rc_b = draw_neon_metallic_frame(rc_b, COL_EMERALD, COL_GOLD, pad=10, radius=24)
    rc_b = glow_text(rc_b, 440, 44, "TRƯỜNG ĐUA THÚ CYBER 3D (THƯỞNG X4.5)", get_font(29), COL_GOLD, COL_EMERALD)
    for idx, (_aid, a_name, _bdg, col) in enumerate(racers):
        ly = 82 + idx * 44
        rc_b = draw_glass_panel(rc_b, [48, ly, 832, ly + 34], col, (12, 20, 38, 215), radius=10, border_w=1)
        d = ImageDraw.Draw(rc_b)
        pos_x = 220 + (idx * 115) % 520
        d.rounded_rectangle([54, ly + 5, pos_x, ly + 29], radius=7, fill=(*col, 235))
        rc_b = glow_text(rc_b, 138, ly + 17, f"LÀN {idx + 1}: {a_name}", get_font(14), (10, 14, 24), None)
    rc_b = glow_text(rc_b, 440, 318, "5 CHIẾN THÚ TRANH TÀI • ĐẶT CƯỢC CHUNG TOÀN SERVER • VỀ NHẤT NHẬN X4.5", get_font(15, False), COL_MUTED, None)
    save_png(rc_b, "games/race.png")
    save_png(rc_b, "race/banner_3d.png")
    build_dedicated_outcome_banner("race/win.png", "TRƯỜNG ĐUA THÚ 3D", "CHIẾN THÚ VỀ ĐÍCH HẠNG #1!", "XUẤT SẮC ĐOÁN ĐÚNG QUÁN QUÂN ĐƯỜNG ĐUA • NHẬN THƯỞNG X4.5 VNĐ", is_win=True)
    build_dedicated_outcome_banner("race/lose.png", "TRƯỜNG ĐUA THÚ 3D", "CHIẾN THÚ CHƯA CÁN ĐÍCH ĐẦU!", "XEM BẢNG XẾP HẠNG VỀ ĐÍCH #1–#5 & CHỌN LẠI Ở PHIÊN KẾ TIẾP", is_win=False)

    race_frames = []
    offsets = [
        [110, 130, 95, 120, 105],
        [195, 175, 215, 185, 200],
        [290, 315, 275, 300, 265],
        [385, 370, 415, 390, 400],
        [470, 505, 455, 485, 475],
        [540, 515, 560, 525, 545],
    ]
    for step_idx, lane_xs in enumerate(offsets):
        fr = make_cinematic_canvas(620, 270, (8, 16, 28), (20, 12, 44), COL_EMERALD if step_idx % 2 == 0 else COL_CYAN, COL_GOLD)
        fr = draw_neon_metallic_frame(fr, COL_GOLD, COL_EMERALD, pad=8, radius=20)
        fr = glow_text(fr, 310, 34, f"ĐƯỜNG ĐUA TĂNG TỐC CHẶNG {step_idx + 1}/6...", get_font(19), COL_GOLD, COL_EMERALD)
        d = ImageDraw.Draw(fr)
        for i, (_aid, a_name, _b, col) in enumerate(racers):
            ly = 62 + i * 35
            d.rounded_rectangle([34, ly, 586, ly + 26], radius=7, fill=(14, 22, 40, 230), outline=(*col, 160), width=1)
            d.rounded_rectangle([38, ly + 3, lane_xs[i], ly + 23], radius=5, fill=(*col, 245))
            d.text((46, ly + 4), a_name, font=get_font(13), fill=(10, 14, 24, 255))
        race_frames.append(fr)
    save_gif(race_frames, "race/race_run.gif", duration_ms=130)

    # --- B. NỐI TỪ 3D (1v1 Game Show) ---
    make_game_icon_tile("noitu/icon.png", "A➔B", "NỐI TỪ PRO", COL_CYAN)
    nt = make_cinematic_canvas(880, 330, (8, 16, 34), (20, 12, 48), COL_CYAN, COL_PURPLE)
    nt = draw_neon_metallic_frame(nt, COL_CYAN, COL_GOLD, pad=10, radius=24)
    nt = glow_text(nt, 440, 52, "GAME SHOW NỐI TỪ TIẾNG VIỆT 3D (1v1)", get_font(30), COL_CYAN, COL_CYAN)
    nt = draw_glass_panel(nt, [74, 104, 378, 214], COL_CYAN, (14, 24, 48, 225), radius=18, border_w=3)
    nt = glow_text(nt, 226, 159, "HỌC SINH", get_font(31), COL_WHITE, COL_CYAN)
    nt = glow_text(nt, 440, 159, "➔", get_font(44), COL_GOLD, COL_GOLD)
    nt = draw_glass_panel(nt, [502, 104, 806, 214], COL_GOLD, (24, 18, 48, 225), radius=18, border_w=3)
    nt = glow_text(nt, 654, 159, "SINH VIÊN", get_font(31), COL_GOLD, COL_GOLD)
    nt = glow_text(nt, 440, 274, "ĐẤU TRÍ 2 NGƯỜI • 30 GIÂY MỖI LƯỢT • THƯỞNG VNĐ CHUỖI THẮNG", get_font(16, False), COL_MUTED, None)
    save_png(nt, "games/noitu.png")
    save_png(nt, "noitu/banner_3d.png")
    build_dedicated_outcome_banner("noitu/win.png", "GAME SHOW NỐI TỪ 1v1", "CHIẾN THẮNG ĐẤU TRÍ NỐI TỪ!", "ĐỐI THỦ ĐÃ BÍ TỪ / HẾT GIỜ • TIỀN THƯỞNG ĐÃ CỘNG VÀO VÍ", is_win=True)
    build_dedicated_outcome_banner("noitu/lose.png", "GAME SHOW NỐI TỪ 1v1", "DỪNG BƯỚC TẠI VÒNG NỐI TỪ!", "MỞ PHÒNG MỚI ĐỂ TÁI ĐẤU & PHÁ KỶ LỤC CHUỖI TỪ DÀI NHẤT", is_win=False)

    nt_frames = []
    for sec_lbl, col in [("30s", COL_CYAN), ("20s", COL_SKY), ("10s", COL_GOLD), ("05s!", COL_CRIMSON)]:
        fr = make_cinematic_canvas(540, 230, (8, 16, 34), (24, 12, 48), col, COL_PURPLE)
        fr = draw_neon_metallic_frame(fr, col, COL_GOLD, pad=8, radius=20)
        fr = glow_text(fr, 270, 52, "ĐỒNG HỒ LƯỢT NỐI TỪ TRỰC TIẾP", get_font(20), COL_WHITE, None)
        fr = glow_text(fr, 270, 134, sec_lbl, get_font(52), col, col)
        nt_frames.append(fr)
    save_gif(nt_frames, "noitu/noitu_timer.gif", duration_ms=180)

    # --- C. TUNG ĐỒNG XU 3D (Sấp / Ngửa) ---
    make_game_icon_tile("coinflip/icon.png", "VNĐ", "ĐỒNG XU 3D", COL_GOLD)
    for side, title, sub, ring, core in [
        ("sap", "MẶT SẤP", "HOÀNG KIM BẢO", COL_GOLD, (245, 158, 11)),
        ("ngua", "MẶT NGỬA", "CYBER PLATINUM", COL_CYAN, (14, 165, 233)),
    ]:
        cimg = make_cinematic_canvas(260, 260, (10, 14, 30), (24, 12, 46), ring, COL_PURPLE)
        cimg = draw_neon_metallic_frame(cimg, ring, COL_GOLD, pad=8, radius=22)
        dc = ImageDraw.Draw(cimg)
        draw_3d_sphere(dc, [40, 28, 220, 208], core, ring, 4)
        dc.ellipse([56, 44, 204, 192], outline=(255, 255, 255, 190), width=2)
        cimg = glow_text(cimg, 130, 108, "VNĐ" if side == "sap" else "★", get_font(42), COL_WHITE, ring)
        cimg = glow_text(cimg, 130, 154, title, get_font(17), COL_WHITE, None)
        cimg = glow_text(cimg, 130, 230, sub, get_font(14), ring, None)
        save_png(cimg, f"coinflip/coin_{side}.png")

    cfb = make_cinematic_canvas(880, 330, (10, 14, 28), (28, 14, 42), COL_GOLD, COL_CYAN)
    cfb = draw_neon_metallic_frame(cfb, COL_GOLD, COL_CYAN, pad=10, radius=24)
    cfb = glow_text(cfb, 440, 50, "TUNG ĐỒNG XU 3D HOÀNG KIM (SẤP / NGỬA)", get_font(29), COL_GOLD, COL_GOLD)
    dcf = ImageDraw.Draw(cfb)
    draw_3d_sphere(dcf, [206, 90, 368, 252], (245, 158, 11), COL_GOLD, 4)
    draw_3d_sphere(dcf, [512, 90, 674, 252], (14, 165, 233), COL_CYAN, 4)
    cfb = glow_text(cfb, 287, 171, "SẤP", get_font(34), COL_WHITE, COL_GOLD)
    cfb = glow_text(cfb, 593, 171, "NGỬA", get_font(30), COL_WHITE, COL_CYAN)
    cfb = glow_text(cfb, 440, 286, "XÁC SUẤT 50/50 CÔNG BẰNG • NHÂN ĐÔI TIỀN CƯỢC VNĐ TỨC THÌ", get_font(16, False), COL_MUTED, None)
    save_png(cfb, "games/coinflip.png")
    save_png(cfb, "coinflip/banner_3d.png")
    build_dedicated_outcome_banner("coinflip/win.png", "TUNG ĐỒNG XU 3D", "ĐỒNG XU NỔ ĐÚNG MẶT BẠN CHỌN!", "NHÂN ĐÔI TIỀN CƯỢC VNĐ THÀNH CÔNG", is_win=True)
    build_dedicated_outcome_banner("coinflip/lose.png", "TUNG ĐỒNG XU 3D", "ĐỒNG XU LẬT SANG MẶT CÒN LẠI!", "THỬ LẠI VẬN MAY 50/50 NGAY LƯỢT TIẾP THEO", is_win=False)

    coin_frames = []
    widths = [152, 112, 62, 20, 62, 112, 152, 112, 62, 20]
    for idx, w_coin in enumerate(widths):
        col = COL_GOLD if idx < 5 else COL_CYAN
        fr = make_cinematic_canvas(540, 240, (10, 14, 30), (24, 12, 46), col, COL_PURPLE)
        fr = draw_neon_metallic_frame(fr, col, COL_GOLD, pad=8, radius=20)
        fr = glow_text(fr, 270, 40, "ĐỒNG XU 3D ĐANG XOAY TRÊN KHÔNG...", get_font(20), COL_GOLD, col)
        df = ImageDraw.Draw(fr)
        cx, cy = 270, 136
        df.ellipse([cx - w_coin // 2, cy - 70, cx + w_coin // 2, cy + 70], fill=(*col, 245), outline=(255, 255, 255, 220), width=4)
        if w_coin >= 90:
            fr = glow_text(fr, cx, cy, "SẤP" if idx < 5 else "NGỬA", get_font(22), (10, 14, 26), None)
        coin_frames.append(fr)
    save_gif(coin_frames, "coinflip/coin_flip.gif", duration_ms=95)

    # --- D. OẲN TÙ TÌ 3D (Kéo • Búa • Bao) ---
    make_game_icon_tile("rps/icon.png", "VS", "OẲN TÙ TÌ 3D", COL_VIOLET)
    rps_specs = [
        ("rock", "BÚA", COL_CRIMSON),
        ("paper", "BAO", COL_CYAN),
        ("scissors", "KÉO", COL_GOLD),
    ]
    for r_id, r_name, col in rps_specs:
        rc = make_cinematic_canvas(240, 240, (10, 12, 30), (26, 12, 48), col, COL_PURPLE)
        rc = draw_neon_metallic_frame(rc, col, COL_GOLD, pad=8, radius=20)
        rc = draw_glass_panel(rc, [28, 28, 212, 172], col, (16, 20, 44, 220), radius=18, border_w=2)
        dr = ImageDraw.Draw(rc)
        if r_id == "rock":
            draw_3d_sphere(dr, [66, 52, 174, 152], col, COL_GOLD, 3)
        elif r_id == "paper":
            dr.rounded_rectangle([74, 46, 166, 154], radius=16, fill=(*col, 245), outline=(255, 255, 255, 220), width=3)
            for lx in (96, 120, 144):
                dr.line([lx, 48, lx, 96], fill=(10, 14, 28, 220), width=3)
        else:
            dr.line([82, 150, 154, 52], fill=(*col, 255), width=13)
            dr.line([158, 150, 86, 52], fill=(*col, 255), width=13)
            dr.ellipse([68, 132, 104, 166], outline=(255, 255, 255, 240), width=4)
            dr.ellipse([136, 132, 172, 166], outline=(255, 255, 255, 240), width=4)
        rc = glow_text(rc, 120, 202, r_name, get_font(26), col, col)
        save_png(rc, f"rps/{r_id}.png")

    rps_b = make_cinematic_canvas(880, 330, (12, 12, 32), (30, 12, 54), COL_VIOLET, COL_CYAN)
    rps_b = draw_neon_metallic_frame(rps_b, COL_VIOLET, COL_GOLD, pad=10, radius=24)
    rps_b = glow_text(rps_b, 440, 50, "ĐẤU TRƯỜNG OẲN TÙ TÌ 3D (KÉO • BÚA • BAO)", get_font(28), COL_GOLD, COL_VIOLET)
    for i, (_r_id, r_name, col) in enumerate(rps_specs):
        bx = 118 + i * 226
        rps_b = draw_glass_panel(rps_b, [bx, 94, bx + 192, 246], col, (16, 20, 46, 225), radius=18, border_w=3)
        rps_b = glow_text(rps_b, bx + 96, 170, r_name, get_font(36), col, col)
    rps_b = glow_text(rps_b, 440, 286, "ĐẤU VỚI BOT HOẶC THÁCH ĐẤU PVP TRỰC TIẾP CƯỢC VNĐ", get_font(16, False), COL_MUTED, None)
    save_png(rps_b, "games/rps.png")
    save_png(rps_b, "rps/banner_3d.png")
    build_dedicated_outcome_banner("rps/win.png", "ĐẤU TRƯỜNG OẲN TÙ TÌ 3D", "RA ĐÒN ÁP ĐẢO — CHIẾN THẮNG!", "KHẮC CHẾ HOÀN HẢO NƯỚC ĐI ĐỐI THỦ • NHẬN THƯỞNG VNĐ", is_win=True)
    build_dedicated_outcome_banner("rps/lose.png", "ĐẤU TRƯỜNG OẲN TÙ TÌ 3D", "BỊ BẮT BÀI NƯỚC ĐI!", "ĐỔI CHIẾN THUẬT KÉO • BÚA • BAO Ở VÁN TIẾP THEO", is_win=False)

    rps_frames = []
    for step_txt, col in [("3...", COL_GOLD), ("2...", COL_PURPLE), ("1...", COL_CRIMSON), ("RA TAY!", COL_CYAN)]:
        fr = make_cinematic_canvas(540, 230, (12, 12, 32), (28, 12, 52), col, COL_VIOLET)
        fr = draw_neon_metallic_frame(fr, col, COL_GOLD, pad=8, radius=20)
        fr = glow_text(fr, 270, 52, "CHUẨN BỊ SO GĂNG ĐỒNG THỜI", get_font(20), COL_WHITE, None)
        fr = glow_text(fr, 270, 136, step_txt, get_font(48), col, col)
        rps_frames.append(fr)
    save_gif(rps_frames, "rps/rps_countdown.gif", duration_ms=175)

    # --- E. ĐOÁN SỐ BÍ MẬT 3D ---
    make_game_icon_tile("guess/icon.png", "?99", "ĐOÁN SỐ 3D", COL_SKY)
    gs = make_cinematic_canvas(880, 330, (8, 16, 36), (18, 12, 48), COL_SKY, COL_PURPLE)
    gs = draw_neon_metallic_frame(gs, COL_SKY, COL_GOLD, pad=10, radius=24)
    gs = glow_text(gs, 440, 50, "KÉT SẮT MẬT MÃ ĐOÁN SỐ 3D PRO", get_font(30), COL_GOLD, COL_SKY)
    gs = draw_glass_panel(gs, [280, 94, 600, 236], COL_CYAN, (12, 22, 46, 230), radius=22, border_w=3)
    gs = glow_text(gs, 440, 165, "[ ? ? ? ]", get_font(50), COL_CYAN, COL_CYAN)
    gs = glow_text(gs, 440, 284, "GỢI Ý LỚN HƠN / NHỎ HƠN THEO LƯỢT • MỞ KÉT NỔ THƯỞNG VNĐ", get_font(16, False), COL_MUTED, None)
    save_png(gs, "games/guess.png")
    save_png(gs, "guess/banner_3d.png")
    build_dedicated_outcome_banner("guess/win.png", "KÉT SẮT ĐOÁN SỐ 3D", "PHÁ MÃ KÉT SẮT THÀNH CÔNG!", "TÌM ĐÚNG CON SỐ BÍ MẬT • NHẬN TRỌN TIỀN THƯỞNG VNĐ", is_win=True)
    build_dedicated_outcome_banner("guess/lose.png", "KÉT SẮT ĐOÁN SỐ 3D", "KÉT SẮT ĐÃ KHÓA MẬT MÃ!", "HẾT LƯỢT DỰ ĐOÁN • MỞ KÉT MỚI ĐỂ THỬ TRÍ SUY LUẬN", is_win=False)

    vault_frames = []
    for k in range(6):
        col = COL_CYAN if k % 2 == 0 else COL_GOLD
        fr = make_cinematic_canvas(540, 230, (8, 16, 36), (18, 12, 48), col, COL_PURPLE)
        fr = draw_neon_metallic_frame(fr, col, COL_GOLD, pad=8, radius=20)
        fr = glow_text(fr, 270, 48, "ĐANG QUÉT MẬT MÃ KÉT SẮT 3D...", get_font(20), COL_GOLD, None)
        fr = glow_text(fr, 270, 136, f"[ {(k * 17 + 9) % 99:02d} ]", get_font(48), col, col)
        vault_frames.append(fr)
    save_gif(vault_frames, "guess/vault_open.gif", duration_ms=110)


if __name__ == "__main__":
    generate_core_banners()
    generate_baucua_3d_pack()
    generate_taixiu_3d_pack()
    generate_remaining_5_games_packs()
    print("✅ Đã tạo hoàn chỉnh bộ tài nguyên 3D Casino/Gaming Premium trong assets/!")
