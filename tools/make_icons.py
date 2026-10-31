from PIL import Image, ImageDraw
import numpy as np
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

S = 512
SS = 2
W = S * SS
canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))

# diagonal gradient background
y, x = np.mgrid[0:W, 0:W]
t = ((x / W) * 0.58 + (y / W) * 0.42)
t = np.clip(t, 0, 1)
c1 = np.array([92, 108, 255], dtype=float)
c2 = np.array([149, 91, 226], dtype=float)
arr = c1[None, None, :] * (1 - t[:, :, None]) + c2[None, None, :] * t[:, :, None]
# subtle glow
glow = np.exp(-(((x / W - 0.18) ** 2 + (y / W - 0.12) ** 2) / 0.06))
arr = arr + glow[:, :, None] * np.array([32, 28, 50])[None, None, :]
arr = np.clip(arr, 0, 255).astype(np.uint8)
bg = Image.fromarray(np.dstack([arr, np.full((W, W), 255, dtype=np.uint8)]), 'RGBA')

mask = Image.new('L', (W, W), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle((8, 8, W - 8, W - 8), radius=int(W * 0.225), fill=255)
canvas.paste(bg, (0, 0), mask)

d = ImageDraw.Draw(canvas, 'RGBA')

# page shadow + page
page = (int(W * 0.255), int(W * 0.195), int(W * 0.745), int(W * 0.805))
shadow = (page[0] + 3, page[1] + 13, page[2] + 12, page[3] + 16)
d.rounded_rectangle(shadow, radius=int(W * 0.085), fill=(38, 26, 91, 48))
d.rounded_rectangle(page, radius=int(W * 0.085), fill=(255, 255, 255, 255))

# faint page tint on the lower half
d.rounded_rectangle(
    (page[0], int(W * 0.49), page[2], page[3]),
    radius=int(W * 0.085),
    fill=(246, 246, 255, 255),
)
# clip the tint's top corners back by redrawing a white strip
d.rectangle((page[0], int(W * 0.49), page[2], int(W * 0.56)), fill=(255, 255, 255, 255))

# list marks (multi-level feel)
line_color = (81, 97, 224, 255)
sub_color = (140, 147, 235, 255)
x0 = W * 0.34
for idx, (yy, xx, color) in enumerate([
    (0.345, 0.63, line_color),
    (0.465, 0.68, sub_color),
    (0.585, 0.59, line_color),
]):
    cy = W * yy
    # bullet
    d.ellipse((W * 0.305 - W * 0.018, cy - W * 0.018,
               W * 0.305 + W * 0.018, cy + W * 0.018), fill=color)
    # line
    d.rounded_rectangle(
        (W * 0.345, cy - W * 0.026, W * xx, cy + W * 0.026),
        radius=W * 0.026,
        fill=color,
    )

# annotation accent dot, bottom-right of page
dot = (int(W * 0.635), int(W * 0.670), int(W * 0.755), int(W * 0.790))
d.ellipse((dot[0] - 6, dot[1] + 7, dot[2] + 7, dot[3] + 11), fill=(84, 52, 140, 55))
d.ellipse(dot, fill=(255, 122, 165, 255))
d.ellipse((dot[0] + 13, dot[1] + 11, dot[2] - 17, dot[3] - 19), fill=(255, 190, 212, 175))

# subtle border
d.rounded_rectangle((8, 8, W - 8, W - 8), radius=int(W * 0.225), outline=(255, 255, 255, 55), width=4)

# Keep every drawn pixel inside the rounded-square silhouette.
r, g, b, a = canvas.split()
a = Image.composite(a, Image.new('L', (W, W), 0), mask)
canvas.putalpha(a)

icon = canvas.resize((S, S), Image.LANCZOS)
for size in (16, 32, 48, 128):
    icon.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'icon{size}.png'), optimize=True)

print('icons written to', os.path.abspath(OUT))
