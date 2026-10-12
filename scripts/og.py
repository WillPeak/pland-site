#!/usr/bin/env python3
"""1200x630 Open Graph card. Colours from the site; Nunito Sans is the free stand-in for Avenir Next."""

from PIL import Image, ImageDraw, ImageFont

SCALE = 2
W, H = 1200 * SCALE, 630 * SCALE
BG_TOP = (0x26, 0x2B, 0x33)
BG_BOTTOM = (0x0F, 0x12, 0x14)
ACCENT = (0xF2, 0x6E, 0x1F)
TEXT = (255, 255, 255)
MUTED = (0xA1, 0xA1, 0xA6)
TRACK = (0x38, 0x3D, 0x47)
PHYSICAL = (0x33, 0xB3, 0x6B)
MENTAL = (0x38, 0x73, 0xD6)
FINANCIAL = (0xF5, 0xC7, 0x29)

FONT = "/tmp/fonts"
bold = ImageFont.truetype(f"{FONT}/NunitoSans-Bold.ttf", 78 * SCALE)
bold_sm = ImageFont.truetype(f"{FONT}/NunitoSans-Bold.ttf", 34 * SCALE)
semi = ImageFont.truetype(f"{FONT}/NunitoSans-Semi.ttf", 28 * SCALE)
label = ImageFont.truetype(f"{FONT}/NunitoSans-Semi.ttf", 18 * SCALE)

img = Image.new("RGB", (W, H), BG_BOTTOM)
px = img.load()
for y in range(H):
    t = y / (H - 1)
    colour = tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
    for x in range(W):
        px[x, y] = colour

draw = ImageDraw.Draw(img)
draw.text((76 * SCALE, 78 * SCALE), "Pland", font=bold_sm, fill=ACCENT)
draw.text((76 * SCALE, 168 * SCALE), "Healthier, wealthier,", font=bold, fill=TEXT)
draw.text((76 * SCALE, 258 * SCALE), "happier.", font=bold, fill=TEXT)
draw.text(
    (76 * SCALE, 390 * SCALE),
    "The whole household's week.\nThree dials: physical, mental, financial.",
    font=semi,
    fill=MUTED,
    spacing=8 * SCALE,
)


def dial(cx, cy, r, colour, sweep):
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, start=0, end=360, fill=TRACK, width=12 * SCALE)
    # 12 o'clock, clockwise. PIL degrees run clockwise from 3 o'clock.
    start = -90
    draw.arc(box, start=start, end=start + sweep, fill=colour, width=12 * SCALE)


dials = [
    (860 * SCALE, 430 * SCALE, PHYSICAL, 250, "Physical"),
    (980 * SCALE, 430 * SCALE, MENTAL, 210, "Mental"),
    (1100 * SCALE, 430 * SCALE, FINANCIAL, 280, "Financial"),
]
for cx, cy, colour, sweep, name in dials:
    dial(cx, cy, 42 * SCALE, colour, sweep)
    tw = draw.textlength(name, font=label)
    draw.text((cx - tw / 2, cy + 58 * SCALE), name, font=label, fill=MUTED)

img = img.resize((1200, 630), Image.Resampling.LANCZOS)
img.save("/workspace/og.png", "PNG", optimize=True)
print("wrote /workspace/og.png", img.size)
