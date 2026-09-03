"""The app icon, drawn in code.

A broadcast mark - a dot with two rings - on the amber the player uses for its
transport controls. Generated rather than committed as binary so the palette
stays in one place, and rendered with pure zlib so nothing has to be installed.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

GROUND = (255, 201, 77)    # --accent-fill
INK = (11, 31, 36)         # --ground, dark theme
SUPERSAMPLE = 3


def _png(width: int, height: int, rows: list[bytes]) -> bytes:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    header = struct.pack(">2I5B", width, height, 8, 2, 0, 0, 0)  # 8-bit truecolour
    raw = b"".join(b"\x00" + row for row in rows)                # no per-row filter
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def _is_ink(x: float, y: float) -> bool:
    """Geometry of the mark, in a unit square centred on (0.5, 0.5)."""
    dx, dy = x - 0.5, y - 0.5
    distance = (dx * dx + dy * dy) ** 0.5
    if distance <= 0.085:                       # the transmitter
        return True
    # Arcs, not rings: open at top and bottom so it reads as sound leaving the
    # transmitter rather than as a target.
    if distance and abs(dy) / distance <= 0.72:
        for radius in (0.215, 0.335):           # the signal
            if abs(distance - radius) <= 0.030:
                return True
    return False


def _in_square(x: float, y: float, radius: float = 0.22) -> bool:
    """Rounded square, so the icon reads as an app tile rather than a sticker."""
    dx = abs(x - 0.5) - (0.5 - radius)
    dy = abs(y - 0.5) - (0.5 - radius)
    if dx <= 0 or dy <= 0:
        return True
    return (dx * dx + dy * dy) ** 0.5 <= radius


def render(size: int, background: tuple[int, int, int] | None = None) -> bytes:
    """A square PNG of `size` pixels. Pass a background for a full-bleed tile."""
    rows: list[bytes] = []
    step = 1.0 / (size * SUPERSAMPLE)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            ink_hits = square_hits = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = (px * SUPERSAMPLE + sx + 0.5) * step
                    y = (py * SUPERSAMPLE + sy + 0.5) * step
                    inside = _in_square(x, y)
                    square_hits += inside
                    ink_hits += inside and _is_ink(x, y)
            total = SUPERSAMPLE * SUPERSAMPLE
            outside = background or INK
            # blend: outside -> ground -> ink, by coverage
            tile = [
                outside[i] + (GROUND[i] - outside[i]) * square_hits / total
                for i in range(3)
            ]
            colour = [
                round(tile[i] + (INK[i] - tile[i]) * ink_hits / total)
                for i in range(3)
            ]
            row += bytes(colour)
        rows.append(bytes(row))
    return _png(size, size, rows)


def write_set(out_dir: Path) -> dict[str, Path]:
    """The icons a home screen actually asks for."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {}
    for name, size, background in (
        ("icon-192.png", 192, None),
        ("icon-512.png", 512, None),
        ("apple-touch-icon.png", 180, GROUND),  # iOS squares it off anyway
        ("favicon-32.png", 32, None),
    ):
        path = out_dir / name
        path.write_bytes(render(size, background))
        written[name] = path
    return written
