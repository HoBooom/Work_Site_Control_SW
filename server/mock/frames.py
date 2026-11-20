"""Mock 카메라 그림: 강판·용접선을 절차적으로 그린다(tools/mock/frames.mjs와 같은 그림). 저장소에 그림 파일을 두지 않는다.
종류마다 그림 위 용접선(픽셀 꺾은선)과 면 mm 대응점 4쌍으로 만든 호모그래피를 함께 돌려준다."""
from __future__ import annotations

import math
import struct
import zlib
from functools import lru_cache

import numpy as np

from snap.geometry import homography

FRAME_W, FRAME_H = 1280, 720
M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


def rng(seed: int):
    s = seed & M32

    def nxt() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & M32
        t = s
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & M32)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return nxt


def hash2(x, y, seed):
    n = np.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
    return n - np.floor(n)


def smooth_noise(x, y, scale, seed):
    fx, fy = x / scale, y / scale
    ix, iy = np.floor(fx), np.floor(fy)
    tx, ty = fx - ix, fy - iy
    s = lambda t: t * t * (3 - 2 * t)  # noqa: E731
    a, b = hash2(ix, iy, seed), hash2(ix + 1, iy, seed)
    c, d = hash2(ix, iy + 1, seed), hash2(ix + 1, iy + 1, seed)
    return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty)


def encode_png(rgb: np.ndarray) -> bytes:
    h, w, _ = rgb.shape
    raw = np.zeros((h, w * 3 + 1), dtype=np.uint8)
    raw[:, 1:] = rgb.reshape(h, w * 3)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & M32)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw.tobytes(), 6)) + chunk(b"IEND", b"")


def seam_line(a, b, bow, n=12):
    out = []
    for i in range(n):
        t = i / (n - 1)
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        nx, ny = -(b[1] - a[1]), b[0] - a[0]
        L = math.hypot(nx, ny)
        k = bow * math.sin(math.pi * t)
        out.append([math.floor((x + nx / L * k) * 10 + 0.5) / 10, math.floor((y + ny / L * k) * 10 + 0.5) / 10])
    return out


def side_of(line, X, Y):
    """꺾은선까지 부호 있는 거리(왼쪽 +). 가장 가까운 선분 기준"""
    best = np.full(X.shape, np.inf)
    sign = np.ones(X.shape)
    for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
        dx, dy = bx - ax, by - ay
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.hypot(X - (ax + t * dx), Y - (ay + t * dy))
        closer = d < best
        best = np.where(closer, d, best)
        sign = np.where(closer, np.where(dx * (Y - ay) - dy * (X - ax) > 0, 1.0, -1.0), sign)
    return best * sign


KINDS = {
    "fillet": dict(a=[110, 420], b=[1170, 380], bow=7, mm_offset=[0, -320], px_far=[[1270, 712], [12, 712]], upper=[148, 151, 155], lower=[120, 46, 34]),
    "vertical": dict(a=[655, 50], b=[628, 690], bow=-5, mm_offset=[700, 0], px_far=[[1268, 700], [1268, 30]], upper=[118, 44, 33], lower=[140, 144, 149]),
    "plate": dict(a=[140, 380], b=[1150, 340], bow=4, mm_offset=[0, -200], px_far=[[1220, 690], [80, 700]], upper=[150, 153, 157], lower=[146, 149, 153]),
}


@lru_cache(maxsize=16)
def _draw(kind: str, seam_mm: tuple, seed: int):
    k = KINDS.get(kind)
    if not k:
        raise ValueError(f"모르는 영상 종류: {kind}")
    seam_px = seam_line(k["a"], k["b"], k["bow"])
    m0, m1 = seam_mm
    off = k["mm_offset"]
    H = homography([(k["a"], list(m0)), (k["b"], list(m1)), (k["px_far"][0], [m1[0] + off[0], m1[1] + off[1]]), (k["px_far"][1], [m0[0] + off[0], m0[1] + off[1]])])
    rnd = rng(seed)
    spatter = []
    for _ in range(140):
        t = rnd()
        i = min(len(seam_px) - 2, math.floor(t * (len(seam_px) - 1)))
        p = seam_px[i]
        spatter.append((p[0] + (rnd() - 0.5) * 160, p[1] + (rnd() - 0.5) * 120, 1 + rnd() * 2.5))
    tacks = [seam_px[round(t * (len(seam_px) - 1))] for t in (0.12, 0.38, 0.63, 0.88)]
    dark = np.ones((FRAME_H, FRAME_W), dtype=np.float32)
    bead = np.zeros((FRAME_H, FRAME_W), dtype=np.float32)

    def stamp(cx, cy, rx, ry):
        y0, y1 = max(0, math.floor(cy - ry)), min(FRAME_H - 1, math.ceil(cy + ry))
        x0, x1 = max(0, math.floor(cx - rx)), min(FRAME_W - 1, math.ceil(cx + rx))
        if y1 < y0 or x1 < x0:
            return None
        yy, xx = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
        q = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
        return (slice(y0, y1 + 1), slice(x0, x1 + 1)), q

    for sx, sy, sr in spatter:
        r = stamp(sx, sy, sr, sr)
        if r:
            sl, q = r
            dark[sl][q < 1] = 0.55
    for tx, ty in tacks:
        r = stamp(tx, ty, 16, 6)
        if r:
            sl, q = r
            bead[sl] = np.where(q < 1, np.maximum(bead[sl], (1 - q).astype(np.float32)), bead[sl])
    Y, X = np.mgrid[0:FRAME_H, 0:FRAME_W].astype(float)
    d = side_of(seam_px, X, Y)
    upper = d > 0
    base = np.where(upper[..., None], np.array(k["upper"], float), np.array(k["lower"], float))
    vign = 1 - 0.35 * (((X - FRAME_W / 2) / FRAME_W) ** 2 + ((Y - FRAME_H / 2) / FRAME_H) ** 2) * 2
    corner = np.minimum(1, np.abs(d) / 40)
    shade = (0.72 + 0.28 * corner) * vign
    mottle = 0.86 + 0.22 * smooth_noise(X, Y, 60, seed) + 0.08 * smooth_noise(X, Y, 9, seed + 3)
    brushed = np.where(upper, 1.0, 0.97 + 0.06 * hash2(np.floor(Y / 2), 0, seed + 7))
    grain = 0.94 + 0.12 * hash2(X, Y, seed + 11)
    rgb = base * (shade * mottle * brushed * grain)[..., None]
    groove = np.exp(-(d * d) / 6)
    rgb *= (1 - 0.55 * groove)[..., None]
    hb = (0.62 + 0.38 * np.sqrt(bead)) * vign
    bmask = bead > 0
    for c, v in enumerate((168, 166, 160)):
        rgb[..., c] = np.where(bmask, rgb[..., c] * (1 - bead) + v * hb * bead, rgb[..., c])
    rgb[..., 0] *= dark
    rgb[..., 1] *= dark
    rgb[..., 2] *= dark * 1.05
    img = np.clip(rgb, 0, 255).astype(np.uint8)
    return img, seam_px, H


def make_frame(kind: str, seam_mm: list[list[float]], seed: int = 1):
    """(image (h, w, 3) uint8, seam_px, H, png)"""
    img, seam_px, H = _draw(kind, tuple(tuple(p) for p in seam_mm), seed)
    return img, [list(p) for p in seam_px], list(H), encode_png(img)
