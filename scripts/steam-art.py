"""Illustrations Steam du raccourci iBox (grille, large, héros, logo), aux couleurs d'iBox.

Usage : python scripts/steam-art.py . src-tauri/assets/steam   (Pillow requis)
Boîte corail (src-tauri/icons/icon.png), police Cal Sans (src/assets/fonts), bleu nuit du thème
sombre (--ibox-night #252b3b), lueurs corail et bleu ciel de l'interface.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

repo, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
ICON = Image.open(repo / "src-tauri/icons/icon.png").convert("RGBA")
FONT = str(repo / "src/assets/fonts/cal-sans/CalSans-Regular.ttf")

NIGHT = (37, 43, 59)
DEEP = (17, 20, 30)
CORAL = (242, 105, 93)
SKY = (140, 205, 241)
WHITE = (244, 244, 246)
SOFT = (167, 176, 195)


def background(w, h, seed, glows):
    """Dégradé bleu nuit, lueurs floues, étuis de jeux en filigrane."""
    img = Image.new("RGB", (w, h), DEEP)
    px = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(NIGHT[i] * (1 - t) + DEEP[i] * t) for i in range(3))
        px.line([(0, y), (w, y)], fill=c)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for (cx, cy, r, color, a) in glows:
        g.ellipse([cx * w - r, cy * h - r, cx * w + r, cy * h + r], fill=color + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18))
    img.paste(glow, (0, 0), glow)
    # étuis de jeux (rectangles arrondis) en filigrane, légèrement inclinés
    rnd = random.Random(seed)
    cases = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    unit = min(w, h) * 0.16
    for _ in range(int(w * h / (unit * unit) * 0.5)):
        cw, ch = unit * rnd.uniform(0.7, 1.0), unit * rnd.uniform(1.1, 1.4)
        tile = Image.new("RGBA", (int(cw) + 8, int(ch) + 8), (0, 0, 0, 0))
        d = ImageDraw.Draw(tile)
        d.rounded_rectangle([4, 4, cw + 3, ch + 3], radius=cw * 0.12, outline=(255, 255, 255, rnd.randint(10, 22)), width=max(2, int(unit * 0.025)))
        tile = tile.rotate(rnd.uniform(-14, 14), expand=True, resample=Image.BICUBIC)
        cases.paste(tile, (int(rnd.uniform(-cw, w)), int(rnd.uniform(-ch, h))), tile)
    img.paste(cases, (0, 0), cases)
    return img.convert("RGBA")


def logo(size):
    return ICON.resize((size, size), Image.LANCZOS)


def shadow(img, box, blur, alpha=150):
    """Ombre douce sous le logo."""
    s = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse(box, fill=(0, 0, 0, alpha))
    s = s.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(s)


def text(img, xy, s, size, color, anchor="mm"):
    d = ImageDraw.Draw(img)
    d.text(xy, s, font=ImageFont.truetype(FONT, size), fill=color, anchor=anchor)


def wordmark(size):
    """« iBox » en Cal Sans, blanc, fond transparent, recadré."""
    f = ImageFont.truetype(FONT, size)
    l, t, r, b = f.getbbox("iBox")
    im = Image.new("RGBA", (r - l + 20, b - t + 20), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((10 - l, 10 - t), "iBox", font=f, fill=WHITE)
    return im


# sous-titre de la grille et de la capsule, par langue (le héros, le logo et l'icône n'ont pas de texte)
SUBTITLES = {"": "Vos jeux PC et consoles", "_en": "Your PC and console games"}

for suffix, subtitle in SUBTITLES.items():
    # grille portrait 600×900
    p = background(600, 900, 1, [(0.5, 0.36, 260, CORAL, 120), (0.15, 0.95, 220, SKY, 70), (0.95, 0.05, 160, SKY, 50)])
    shadow(p, (150, 470, 450, 520), 22)
    p.alpha_composite(logo(340), (130, 150))
    text(p, (300, 640), "iBox", 150, WHITE)
    text(p, (300, 745), subtitle, 34, SOFT)
    p.convert("RGB").save(out / f"portrait{suffix}.jpg", quality=90, optimize=True)

    # capsule large 920×430
    wd = background(920, 430, 2, [(0.25, 0.5, 230, CORAL, 120), (0.95, 0.9, 200, SKY, 60)])
    shadow(wd, (90, 330, 370, 372), 18)
    wd.alpha_composite(logo(290), (85, 55))
    wm = wordmark(170)
    wd.alpha_composite(wm, (430, 215 - wm.height // 2 - 20))
    text(wd, (440, 320), subtitle, 34, SOFT, anchor="lm")
    wd.convert("RGB").save(out / f"wide{suffix}.jpg", quality=90, optimize=True)

# héros 1920×620 (Steam pose le logo par-dessus, à gauche) : décor seul
h = background(1920, 620, 3, [(0.72, 0.55, 420, CORAL, 110), (0.2, 0.1, 360, SKY, 55), (0.98, 0.95, 300, SKY, 45)])
big = logo(760).filter(ImageFilter.GaussianBlur(1))
fade = Image.new("L", big.size, 0)
fade.paste(int(255 * 0.55), (0, 0, big.width, big.height))
big.putalpha(Image.composite(big.getchannel("A"), Image.new("L", big.size, 0), fade).point(lambda a: int(a * 0.55)))
h.alpha_composite(big, (1180, -40))
h.convert("RGB").save(out / "hero.jpg", quality=88, optimize=True)

# logo transparent (posé par Steam sur le héros)
lg = Image.new("RGBA", (1000, 360), (0, 0, 0, 0))
lg.alpha_composite(logo(330), (10, 15))
wm = wordmark(230)
lg.alpha_composite(wm, (360, 180 - wm.height // 2))
lg = lg.crop(lg.getbbox())
lg.save(out / "logo.png", optimize=True)

# icône
logo(256).save(out / "icon.png", optimize=True)

for f in sorted(out.iterdir()):
    im = Image.open(f)
    print(f.name, im.size, f.stat().st_size // 1024, "Ko")
