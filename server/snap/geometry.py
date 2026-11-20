"""픽셀 ↔ 면 mm 변환(호모그래피)과 꺾은선 도구. tools/mock/geometry.mjs와 같은 계산이다."""
from __future__ import annotations

import math

import numpy as np

Pt = list[float]


def homography(pairs: list[tuple[Pt, Pt]]) -> list[float]:
    """대응점 4쌍 [(px, mm)]으로 px → mm 호모그래피(3x3, 행 우선 9개)"""
    if len(pairs) != 4:
        raise ValueError("대응점은 4쌍이다")
    A, b = [], []
    for (x, y), (u, v) in pairs:
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    M = np.array(A, dtype=float)
    if abs(np.linalg.det(M)) < 1e-9:
        raise ValueError("대응점이 한 직선 위에 있다")
    h = np.linalg.solve(M, np.array(b, dtype=float))
    return [*map(float, h), 1.0]


def apply(H: list[float], p: Pt) -> Pt:
    x, y = p
    w = H[6] * x + H[7] * y + H[8]
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]


def round1(v: float) -> float:
    return math.floor(v * 10 + 0.5) / 10  # JS Math.round와 같게(0.5는 올림)


def to_mm(H: list[float], pts: list[Pt]) -> list[Pt]:
    return [[round1(c) for c in apply(H, p)] for p in pts]


def length(line: list[Pt]) -> float:
    return sum(math.dist(line[i], line[i + 1]) for i in range(len(line) - 1))


def nearest_on_polyline(line: list[Pt], p: Pt) -> tuple[Pt, float, float]:
    """점 p에서 꺾은선까지 가장 가까운 점, 거리, 그 점의 호 길이"""
    x, y = p
    best = (line[0], math.inf, 0.0)
    acc = 0.0
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]
        dx, dy = bx - ax, by - ay
        len2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / len2)) if len2 else 0.0
        q = [ax + t * dx, ay + t * dy]
        d = math.hypot(x - q[0], y - q[1])
        seg = math.sqrt(len2)
        if d < best[1]:
            best = (q, d, acc + t * seg)
        acc += seg
    return best


def point_at(line: list[Pt], s: float) -> Pt:
    acc = 0.0
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if acc + seg >= s or i == len(line) - 2:
            t = max(0.0, min(1.0, (s - acc) / seg)) if seg else 0.0
            return [ax + t * (bx - ax), ay + t * (by - ay)]
        acc += seg
    return list(line[-1])


def resample(line: list[Pt], n: int, s0: float = 0.0, s1: float | None = None) -> list[Pt]:
    """호 길이 s0~s1 구간을 같은 간격 n점으로"""
    s1 = length(line) if s1 is None else s1
    return [[round1(c) for c in point_at(line, s0 + (s1 - s0) * i / (n - 1))] for i in range(n)]


def remaining(line: list[Pt], done: float) -> list[Pt]:
    """경로의 앞 done(0~1)을 이미 용접했을 때 남은 경로(점 수는 그대로)"""
    if done <= 0:
        return [list(p) for p in line]
    total = length(line)
    return resample(line, len(line), total * min(done, 1.0), total)


def snap_to_polyline(seam: list[Pt], drawn: list[Pt], max_mean_px: float = 40, n: int = 9) -> tuple[bool, list[Pt], float]:
    """확률 맵이 없을 때의 수렴: 그린 선의 양 끝을 알려진 용접선 위로 붙이고 그 사이를 n점으로(tools/mock/geometry.mjs snapToSeam)"""
    mean = sum(nearest_on_polyline(seam, p)[1] for p in drawn) / len(drawn)
    if mean > max_mean_px:
        return False, [[round1(c) for c in p] for p in drawn], mean
    s0 = nearest_on_polyline(seam, drawn[0])[2]
    s1 = nearest_on_polyline(seam, drawn[-1])[2]
    s0, s1 = min(s0, s1), max(s0, s1)
    return True, resample(seam, n, s0, s1), mean
