#!/usr/bin/env python3
"""Draws a rooftop with solar panels and writes it as a short MJPEG clip for Chromium's fake camera, so the camera
scenes of the video guide show a roof (not a test pattern). No real photo or other app's content is used.
  python3 scripts/videos/make_camera.py <out.mjpeg>
"""
import io, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1280, 720
random.seed(7)


def scene():
    img = Image.new('RGB', (W, H))
    sky = np.zeros((H, W, 3), np.float32)
    t = np.linspace(0, 1, H)[:, None]
    sky[..., 0] = 120 + 70 * t
    sky[..., 1] = 170 + 50 * t
    sky[..., 2] = 225 + 20 * t
    img = Image.fromarray(sky.clip(0, 255).astype(np.uint8))
    clouds = Image.new('L', (W, H), 0)
    dc = ImageDraw.Draw(clouds)
    for _ in range(9):
        x, y = random.randint(0, W), random.randint(20, 230)
        for _ in range(6):
            r = random.randint(30, 70)
            dc.ellipse((x + random.randint(-80, 80) - r, y + random.randint(-20, 20) - r // 2, x + r, y + r // 2), fill=random.randint(120, 200))
    img.paste((250, 252, 255), (0, 0), clouds.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    # Panels in rows on a tilted structure (perspective: rows get bigger towards the camera).
    for row, (y0, h, scale) in enumerate([(330, 70, 0.72), (395, 95, 0.86), (470, 120, 1.0)]):
        n = 7
        w = int(150 * scale)
        x0 = W // 2 - n * (w + 6) // 2
        for i in range(n):
            x = x0 + i * (w + 6)
            poly = [(x + 10 * scale, y0), (x + w - 10 * scale, y0), (x + w, y0 + h), (x, y0 + h)]
            d.polygon(poly, fill=(28, 42, 78), outline=(200, 205, 215))
            for k in range(1, 6):  # cell lines
                xa = x + 10 * scale + (w - 20 * scale) * k / 6
                xb = x + w * k / 6
                d.line((xa, y0, xb, y0 + h), fill=(60, 80, 125), width=1)
            for k in range(1, 4):
                yy = y0 + h * k / 4
                d.line((x + 10 * scale * (1 - k / 4), yy, x + w - 10 * scale * (1 - k / 4), yy), fill=(60, 80, 125), width=1)
            d.line((x + w * 0.2, y0 + h, x + w * 0.2, y0 + h + 30 * scale), fill=(150, 155, 165), width=max(2, int(4 * scale)))
            d.line((x + w * 0.8, y0 + h, x + w * 0.8, y0 + h + 30 * scale), fill=(150, 155, 165), width=max(2, int(4 * scale)))
    # The parapet wall in front.
    wall = np.full((H - 600, W, 3), (178, 172, 160), np.float32)
    wall += np.random.default_rng(3).normal(0, 9, wall.shape)
    img.paste(Image.fromarray(wall.clip(0, 255).astype(np.uint8)), (0, 600))
    d.rectangle((0, 596, W, 604), fill=(150, 145, 135))
    return img


def main(out):
    base = scene()
    rng = np.random.default_rng(1)
    with open(out, 'wb') as f:
        for i in range(30):  # a little sensor noise and sway, so it looks live
            fr = np.asarray(base, np.float32) + rng.normal(0, 2.2, (H, W, 3))
            im = Image.fromarray(fr.clip(0, 255).astype(np.uint8)).rotate(0.25 * np.sin(i / 5), resample=Image.BILINEAR)
            b = io.BytesIO()
            im.save(b, 'JPEG', quality=88)
            f.write(b.getvalue())
    base.save(out.rsplit('.', 1)[0] + '.jpg', quality=90)


if __name__ == '__main__':
    main(sys.argv[1])
