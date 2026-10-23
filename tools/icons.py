#!/usr/bin/env python3
"""v2.48.0: app icons + splash screens generated from the approved brand artwork (2026-10-18:
interlocking speech-bubble «+» on the violet → magenta → coral squircle).

Sources (committed):
  assets/brand/logo-master.png    1024 squircle on transparent (any-purpose icons, in-app logo, splash)
  assets/brand/logo-maskable.png  1024 full-bleed, mark inside the 80% safe zone (maskable, apple-touch)
Output: public/icons/*.png (same file names/sizes as Phase 46, so the manifest and tests are unchanged)
plus public/icons/logo-mark-{64,128}.png for the in-app header logo.
Run: `npm run icons`  (needs Pillow).  Replaces the old procedural tools/icons.mjs.
"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "icons")
master = Image.open(os.path.join(ROOT, "assets/brand/logo-master.png")).convert("RGBA")
maskable = Image.open(os.path.join(ROOT, "assets/brand/logo-maskable.png")).convert("RGB")

ANY = [48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512]
SPLASH = [(640, 1136), (750, 1334), (828, 1792), (1080, 2340), (1125, 2436), (1170, 2532), (1179, 2556),
          (1206, 2622), (1242, 2688), (1284, 2778), (1290, 2796), (1320, 2868), (1536, 2048), (1668, 2388), (2048, 2732)]


def fit(img, s):
    return img.resize((s, s), Image.LANCZOS)


def padded(s, pad=0.04):
    c = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    k = round(s * (1 - 2 * pad))
    c.alpha_composite(fit(master, k), ((s - k) // 2, (s - k) // 2))
    return c


def save(img, name):
    img.save(os.path.join(OUT, name), optimize=True)


def mono(s=512):
    """white mark on transparent: keep the bright, unsaturated pixels of the master."""
    src = fit(master, s)
    px = src.load()
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    po = out.load()
    for y in range(s):
        for x in range(s):
            r, g, b, a = px[x, y]
            sat = max(r, g, b) - min(r, g, b)
            lum = (r + g + b) / 3
            v = 0 if a < 128 else max(0.0, min(1.0, (lum - 170) / 50)) * max(0.0, min(1.0, (90 - sat) / 40))
            if v > 0 and s * 0.06 < x < s * 0.94 and s * 0.06 < y < s * 0.94:
                po[x, y] = (255, 255, 255, round(255 * v))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    n = 0
    for s in ANY:
        save(padded(s), f"icon-{s}.png"); n += 1
    save(fit(master, 32), "favicon-32.png"); n += 1
    for s in (64, 128):
        save(fit(master, s), f"logo-mark-{s}.png"); n += 1
    for s in (192, 512):
        save(fit(maskable, s), f"maskable-{s}.png"); n += 1
    save(mono(512), "monochrome-512.png"); n += 1
    save(fit(maskable, 180), "apple-touch-icon-180.png"); n += 1
    for w, h in SPLASH:
        c = Image.new("RGB", (w, h), (0xFA, 0xF8, 0xFF))
        k = round(min(w, h) * 0.30)
        c.paste(fit(master, k), ((w - k) // 2, (h - k) // 2), fit(master, k))
        save(c, f"splash-{w}x{h}.png"); n += 1
    print(f"✓ {n} icons/splash → public/icons")


if __name__ == "__main__":
    main()
