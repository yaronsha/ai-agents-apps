# Turns the AI sticker PNGs (<id>-idle.png / <id>-hit.png, painted checkerboard background) into
# game-ready <id>-idle.webp / <id>-hit.webp: transparent background, fresh white sticker border,
# 360x450 (3x the 120x150 slot), figure bottom-aligned. Both poses of a person share one crop so the head doesn't jump.
# Usage: python3 cutout.py [id ...]   (run from this folder; needs Pillow + numpy)
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 360, 450
BORDER = 9  # px of white sticker border at 1024px
IDS = sys.argv[1:] or 'netanyahu liberman eisenkot golan bennett bengvir smotrich lapid gantz'.split()


def mask(path):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(int)
    light = (rgb.min(2) >= 215) & (rgb.max(2) - rgb.min(2) <= 20)
    m = Image.fromarray((light * 255).astype(np.uint8)).copy()  # copy: floodfill is a no-op on array-backed images
    h, w = light.shape
    for x in range(0, w, 16):
        for y in (0, h - 1):
            if m.getpixel((x, y)) == 255: ImageDraw.floodfill(m, (x, y), 128)
    for y in range(0, h, 16):
        for x in (0, w - 1):
            if m.getpixel((x, y)) == 255: ImageDraw.floodfill(m, (x, y), 128)
    figure = Image.fromarray(((np.asarray(m) != 128) * 255).astype(np.uint8))
    # Drop specks (stray juice drops, noise): they'd grow into white blobs.
    figure = figure.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    return rgb, figure


def sticker(path):
    rgb, figure = mask(path)
    outer = figure
    for _ in range(BORDER // 2): outer = outer.filter(ImageFilter.MaxFilter(3))
    outer = outer.filter(ImageFilter.GaussianBlur(1))
    fig = np.asarray(figure) > 0
    out = np.where(fig[..., None], rgb, 255).astype(np.uint8)
    return Image.merge('RGBA', (*Image.fromarray(out).split(), outer))


for id in IDS:
    imgs = {v: sticker(f'{id}-{v}.png') for v in ('idle', 'hit')}
    boxes = [im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox() for im in imgs.values()]
    l, t = min(b[0] for b in boxes), min(b[1] for b in boxes)
    r, b = max(b[2] for b in boxes), max(b[3] for b in boxes)
    s = min(W / (r - l), H / (b - t))
    for v, im in imgs.items():
        part = im.crop((l, t, r, b)).resize((round((r - l) * s), round((b - t) * s)), Image.LANCZOS)
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(part, ((W - part.width) // 2, H - part.height))
        canvas.save(f'{id}-{v}.webp', quality=82, method=6)
    print(id)
