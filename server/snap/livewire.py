"""경로 수렴(확률 맵 기반 livewire). server/docs/snap.md.

비전 모델이 내는 용접선 확률 맵(0~1, 프레임과 같은 비율) 위에서, 사람이 그린 선 둘레의 띠 안만 보고
양 끝을 잇는 가장 싼 길을 찾는다. 비용은 (1 - 확률)이라 용접선(확률이 높은 능선)을 따라간다.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np

from .geometry import Pt, length, resample, round1


@dataclass(frozen=True)
class SnapParams:
    corridor_px: float = 40.0  # 그린 선에서 이만큼 떨어진 곳까지 찾는다(원본 프레임 픽셀)
    end_radius_px: float = 40.0  # 끝점을 붙일 능선을 찾는 반경
    min_end_prob: float = 0.5  # 끝점 근처에 이만한 확률이 없으면 실패
    min_mean_prob: float = 0.6  # 찾은 길의 평균 확률이 이보다 낮으면 실패
    step_px: int = 2  # 확률 맵을 이 간격으로 본다(속도)
    points: int = 9  # 보낼 경로 점 수
    eps: float = 0.02  # 확률 1인 곳에서도 거리가 조금은 비용이 되게


@dataclass
class SnapResult:
    ok: bool
    path_px: list[Pt]
    score: float  # 길 위 평균 확률
    reason: str = ""


def _dist_to_polyline(xs: np.ndarray, ys: np.ndarray, line: list[Pt]) -> np.ndarray:
    d = np.full(xs.shape, np.inf)
    for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
        dx, dy = bx - ax, by - ay
        len2 = dx * dx + dy * dy
        t = np.clip(((xs - ax) * dx + (ys - ay) * dy) / len2, 0, 1) if len2 else np.zeros_like(xs)
        d = np.minimum(d, np.hypot(xs - (ax + t * dx), ys - (ay + t * dy)))
    return d


def snap(prob: np.ndarray, frame_size: tuple[int, int], drawn: list[Pt], p: SnapParams = SnapParams()) -> SnapResult:
    """prob: (h, w) 확률 맵. 프레임 크기와 다르면 비율로 맞춘다. drawn: 원본 프레임 픽셀 꺾은선"""
    fail = lambda why, score=0.0: SnapResult(False, [[round1(c) for c in q] for q in drawn], score, why)  # noqa: E731
    if len(drawn) < 2 or length(drawn) < 4:
        return fail("그린 선이 너무 짧다")
    W, Hh = frame_size
    ph, pw = prob.shape
    sx, sy = pw / W, ph / Hh
    step = p.step_px
    # 격자(원본 픽셀, step 간격) 위 확률
    gx = np.arange(0, W, step, dtype=float)
    gy = np.arange(0, Hh, step, dtype=float)
    X, Y = np.meshgrid(gx, gy)
    P = prob[np.clip((Y * sy).astype(int), 0, ph - 1), np.clip((X * sx).astype(int), 0, pw - 1)].astype(float)
    inside = _dist_to_polyline(X, Y, drawn) <= p.corridor_px

    def end_node(q: Pt) -> tuple[int, int] | None:
        near = (np.hypot(X - q[0], Y - q[1]) <= p.end_radius_px) & inside
        if not near.any():
            return None
        cand = np.where(near, P, -1)
        best = cand.max()
        if best < p.min_end_prob:
            return None
        # 확률이 가장 높은 곳들 중 그린 끝점에 가장 가까운 곳
        top = np.argwhere(cand >= best - 0.05)
        d = [math.hypot(gx[j] - q[0], gy[i] - q[1]) for i, j in top]
        i, j = top[int(np.argmin(d))]
        return int(i), int(j)

    a, b = end_node(drawn[0]), end_node(drawn[-1])
    if a is None or b is None:
        return fail("그린 선 끝 가까이에 용접선이 없다")
    if a == b:
        return fail("그린 선 양 끝이 용접선의 같은 곳에 붙는다")

    # 띠 안 Dijkstra(8방향)
    rows, cols = P.shape
    cost = 1.0 - np.clip(P, 0, 1) + p.eps
    dist = np.full(P.shape, np.inf)
    prev = -np.ones(P.shape + (2,), dtype=int)
    dist[a] = 0.0
    heap = [(0.0, a)]
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while heap:
        d0, (i, j) = heapq.heappop(heap)
        if (i, j) == b:
            break
        if d0 > dist[i, j]:
            continue
        for di, dj in nbrs:
            ni, nj = i + di, j + dj
            if not (0 <= ni < rows and 0 <= nj < cols) or not inside[ni, nj]:
                continue
            nd = d0 + (cost[i, j] + cost[ni, nj]) * 0.5 * (1.4142 if di and dj else 1.0)
            if nd < dist[ni, nj]:
                dist[ni, nj] = nd
                prev[ni, nj] = (i, j)
                heapq.heappush(heap, (nd, (ni, nj)))
    if not math.isfinite(dist[b]):
        return fail("띠 안에서 이어지는 길이 없다")
    cells = [b]
    while cells[-1] != a:
        i, j = prev[cells[-1]]
        cells.append((int(i), int(j)))
    cells.reverse()
    score = float(np.mean([P[c] for c in cells]))
    line = [[float(gx[j]), float(gy[i])] for i, j in cells]
    if score < p.min_mean_prob:
        return fail("그린 선이 용접선에서 멀다", score)
    # 그린 방향을 지킨다(시작 → 끝)
    return SnapResult(True, resample(line, p.points), score)
