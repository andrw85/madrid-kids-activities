#!/usr/bin/env python3
"""
Generate PWA PNG icons (192 and 512) with no external dependencies.

Chrome on Android refuses SVG icons for "Install". It needs raster PNGs at
192x192 and 512x512. This draws a purple rounded square with a simple white
theatre-mask shape, using only the Python standard library (zlib + struct).

Run:  python3 make_icons.py
Writes: icon-192.png, icon-512.png  (next to this script)
"""
import zlib, struct, os

PURPLE = (0x7b, 0x2d, 0x8e)   # #7b2d8e
WHITE  = (0xff, 0xff, 0xff)
BG     = (0xf6, 0xf3, 0xfa)   # page background, used for transparent-ish corners


def rounded_rect_mask(size, radius):
    """Return a function inside(x,y)->bool for a rounded square."""
    r = radius
    def inside(x, y):
        # corners
        if x < r and y < r:
            return (x - r) ** 2 + (y - r) ** 2 <= r * r
        if x >= size - r and y < r:
            return (x - (size - r - 1)) ** 2 + (y - r) ** 2 <= r * r
        if x < r and y >= size - r:
            return (x - r) ** 2 + (y - (size - r - 1)) ** 2 <= r * r
        if x >= size - r and y >= size - r:
            return (x - (size - r - 1)) ** 2 + (y - (size - r - 1)) ** 2 <= r * r
        return True
    return inside


def draw(size):
    radius = int(size * 0.22)
    inside = rounded_rect_mask(size, radius)
    cx, cy = size / 2.0, size / 2.0

    # Two simple white circles ("faces") + eyes to suggest theatre masks.
    face_r = size * 0.17
    eye_r = size * 0.025
    offset = size * 0.14
    faces = [(cx - offset, cy - size * 0.03), (cx + offset, cy + size * 0.03)]

    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # PNG filter byte (none)
        for x in range(size):
            if not inside(x, y):
                # outside rounded square -> background colour (opaque, simplest)
                row += bytes(BG)
                continue
            px = PURPLE
            for (fx, fy) in faces:
                d = ((x - fx) ** 2 + (y - fy) ** 2) ** 0.5
                if d <= face_r:
                    px = WHITE
                    # eyes
                    for ex in (-face_r * 0.4, face_r * 0.4):
                        ey = -face_r * 0.15
                        if ((x - (fx + ex)) ** 2 + (y - (fy + ey)) ** 2) ** 0.5 <= eye_r * 2:
                            px = PURPLE
                    # smile (lower arc)
                    sd = ((x - fx) ** 2 + (y - (fy + face_r * 0.35)) ** 2) ** 0.5
                    if face_r * 0.45 <= sd <= face_r * 0.55 and y > fy:
                        px = PURPLE
                    break
            row += bytes(px)
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size):
    raw = draw(size)
    comp = zlib.compress(raw, 9)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit, colour type 2 (RGB)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))
    print("wrote", path, size, "x", size)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    write_png(os.path.join(here, "icon-192.png"), 192)
    write_png(os.path.join(here, "icon-512.png"), 512)
    print("done")
