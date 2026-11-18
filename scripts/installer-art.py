"""Visuels de l'installateur NSIS (bandeau 150x57, colonne 164x314) à partir du logo actuel.

Usage (depuis la racine du projet) : python scripts/installer-art.py
Sources : src-tauri/icons/icon.png (boîte corail) et la police Cal Sans du projet.
Aucun texte en dehors de « iBox » : l'installateur est bilingue (français, anglais).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = Image.open(ROOT / "src-tauri/icons/icon.png").convert("RGBA")
FONT = ROOT / "src/assets/fonts/cal-sans/CalSans-Regular.ttf"
OUT = ROOT / "src-tauri/installer"

PAPER = (248, 247, 243)  # fond clair de la fenêtre iBox (#F8F7F3)
CORAL = (242, 105, 93)  # corail du logo (#F2695D)
INK = (52, 68, 89)  # encre de l'interface (#344459)
S = 4  # dessin en grand puis réduction : bords lisses


def canvas(w: int, h: int, glow_at: tuple[float, float], glow_r: float) -> Image.Image:
    """Fond papier avec un halo corail très léger derrière le logo."""
    im = Image.new("RGB", (w * S, h * S), PAPER)
    halo = Image.new("L", im.size, 0)
    cx, cy = glow_at[0] * S, glow_at[1] * S
    r = glow_r * S
    ImageDraw.Draw(halo).ellipse((cx - r, cy - r, cx + r, cy + r), fill=60)
    halo = halo.filter(ImageFilter.GaussianBlur(r * 0.45))
    return Image.composite(Image.new("RGB", im.size, CORAL), im, halo)


def paste_logo(im: Image.Image, size: int, center: tuple[float, float]) -> None:
    logo = LOGO.resize((size * S, size * S), Image.LANCZOS)
    im.paste(logo, (round(center[0] * S - size * S / 2), round(center[1] * S - size * S / 2)), logo)


def word(im: Image.Image, text: str, px: int, center: tuple[float, float], anchor: str = "mm") -> None:
    font = ImageFont.truetype(str(FONT), px * S)
    ImageDraw.Draw(im).text((center[0] * S, center[1] * S), text, font=font, fill=INK, anchor=anchor)


def save(im: Image.Image, name: str) -> None:
    w, h = im.size[0] // S, im.size[1] // S
    # NSIS (MUI2) attend un BMP 24 bits sans transparence
    im.resize((w, h), Image.LANCZOS).convert("RGB").save(OUT / name, format="BMP")
    print(f"{name} : {w}x{h}")


# Colonne de gauche (pages d'accueil et de fin) : 164 x 314
side = canvas(164, 314, (82, 122), 70)
paste_logo(side, 92, (82, 122))
word(side, "iBox", 34, (82, 204))
# trait corail discret sous le mot
ImageDraw.Draw(side).rounded_rectangle((70 * S, 228 * S, 94 * S, 231 * S), radius=2 * S, fill=CORAL)
save(side, "sidebar.bmp")

# Bandeau du haut (pages intermédiaires) : 150 x 57, logo à droite comme le veut NSIS
head = canvas(150, 57, (124, 28), 26)
paste_logo(head, 42, (124, 29))
word(head, "iBox", 22, (96, 30), anchor="rm")
save(head, "header.bmp")
