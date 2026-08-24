#!/usr/bin/env python3
"""Generate build/icon.png, the source icon for all platforms. Pure stdlib
(zlib), no Pillow. A navy rounded square, a blue coin, a white bolt: fast
mining. Run: python3 build/make-icon.py"""
import os, struct, zlib

S = 1024
BG = (23, 35, 59)       # navy  #17233b
COIN = (43, 107, 243)   # blue  #2b6bf3
BOLT = (255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

cx, cy = S / 2, S / 2
radius = S * 0.30          # coin radius
corner = S * 0.22          # rounded square corner radius
margin = S * 0.06

# lightning bolt as a polygon (clockwise), normalized to the icon center
bolt = [
    (0.56, 0.24), (0.40, 0.54), (0.50, 0.54),
    (0.44, 0.76), (0.62, 0.46), (0.52, 0.46), (0.58, 0.24),
]
bolt = [(x * S, y * S) for x, y in bolt]


def in_rounded_square(x, y):
    lo, hi = margin, S - margin
    if x < lo or x > hi or y < lo or y > hi:
        return False
    # rounded corners
    for ox, oy in ((lo + corner, lo + corner), (hi - corner, lo + corner),
                   (lo + corner, hi - corner), (hi - corner, hi - corner)):
        cornerzone = (x < lo + corner or x > hi - corner) and (y < lo + corner or y > hi - corner)
        if cornerzone:
            # only test the nearest corner
            pass
    # simpler: distance to inner rect clamped
    ix = min(max(x, lo + corner), hi - corner)
    iy = min(max(y, lo + corner), hi - corner)
    dx, dy = x - ix, y - iy
    return dx * dx + dy * dy <= corner * corner


def in_circle(x, y):
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


rows = []
for y in range(S):
    row = bytearray()
    row.append(0)  # PNG filter type 0
    for x in range(S):
        px = py = None
        if in_poly(x + 0.5, y + 0.5, bolt):
            px = BOLT
        elif in_circle(x + 0.5, y + 0.5):
            px = COIN
        elif in_rounded_square(x + 0.5, y + 0.5):
            px = BG
        if px is None:
            row += bytes(TRANSPARENT)
        else:
            row += bytes((px[0], px[1], px[2], 255))
    rows.append(bytes(row))

raw = b"".join(rows)


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(raw, 9))
png += chunk(b"IEND", b"")

out = os.path.join(os.path.dirname(__file__), "icon.png")
with open(out, "wb") as f:
    f.write(png)
print("wrote", out, len(png), "bytes")
