"""절차적 형상 도구. Blender 없이 베벨이 있는 형상을 만든다(spec 2절 형상: 박스 그대로인 에셋이 없다).

모든 함수는 (V: (n,3) float64, F: (m,3) int64)를 돌려준다. 좌표는 Z-up, m. 면은 바깥을 향한다(반시계).
"""
from __future__ import annotations

import math

import numpy as np

Mesh = tuple[np.ndarray, np.ndarray]


def _orient(V: np.ndarray, F: np.ndarray) -> Mesh:
    """닫힌 메시의 부호 있는 부피가 음수면 면 방향을 뒤집는다. 넓이 0인 삼각형은 버린다."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    F = F[area > 1e-12]
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    vol = np.einsum("ij,ij->i", a, np.cross(b, c)).sum()
    return (V, F[:, [0, 2, 1]]) if vol < 0 else (V, F)


def rounded_box(size, r: float = 0.0, k: int = 3) -> Mesh:
    """중심이 원점인 상자. r: 모서리 둥글림 반경, k: 둥근 구간 분할 수. r=0이면 삼각형 12개."""
    h = np.asarray(size, dtype=np.float64) / 2
    r = min(r, float(h.min()) * 0.999)
    V, F = [], []
    for axis in range(3):
        u, v = [a for a in range(3) if a != axis]
        for sign in (-1.0, 1.0):
            def coords(hh):
                if r <= 0:
                    return np.array([-hh, hh])
                ang = np.linspace(0, math.pi / 2, k + 1)
                edge = -(hh - r) - r * np.cos(ang)
                return np.concatenate([edge, -edge[::-1]])

            cu, cv = coords(h[u]), coords(h[v])
            base = len(V)
            for i in range(len(cu)):
                for j in range(len(cv)):
                    p = np.zeros(3)
                    p[axis], p[u], p[v] = sign * h[axis], cu[i], cv[j]
                    if r > 0:
                        inner = np.clip(p, -(h - r), h - r)
                        d = p - inner
                        p = inner + r * d / np.linalg.norm(d)
                    V.append(p)
            n = len(cv)
            # (i→i+1, j→j+1) 순서의 법선은 e_u × e_v. axis가 1(Y)이면 -e_axis 방향이라 부호를 맞춘다
            outward = sign * (-1 if axis == 1 else 1) > 0
            for i in range(len(cu) - 1):
                for j in range(n - 1):
                    a, b, c, d = base + i * n + j, base + (i + 1) * n + j, base + (i + 1) * n + j + 1, base + i * n + j + 1
                    F += [[a, b, c], [a, c, d]] if outward else [[a, c, b], [a, d, c]]
    return _orient(np.array(V), np.array(F, dtype=np.int64))


def lathe(profile, seg: int = 32) -> Mesh:
    """(r, z) 단면을 Z축으로 돌린다. 단면은 아래(r=0)에서 위(r=0)로."""
    prof = np.asarray(profile, dtype=np.float64)
    ang = np.linspace(0, 2 * math.pi, seg, endpoint=False)
    V = np.array([[r * math.cos(t), r * math.sin(t), z] for r, z in prof for t in ang])
    F = []
    for i in range(len(prof) - 1):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            c, d = (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j
            F += [[a, b, c], [a, c, d]]
    return _orient(V, np.array(F, dtype=np.int64))


def cylinder(r: float, h: float, bevel: float = 0.0, seg: int = 32, center: bool = False) -> Mesh:
    """Z축 원기둥(z 0~h). bevel: 위아래 모서리 모따기."""
    b = min(bevel, r * 0.5, h * 0.5)
    prof = [(0, 0), (r - b, 0), (r, b), (r, h - b), (r - b, h), (0, h)] if b > 0 else [(0, 0), (r, 0), (r, h), (0, h)]
    V, F = lathe(prof, seg)
    if center:
        V = V - [0, 0, h / 2]
    return V, F


def tube(path, radius: float, seg: int = 12) -> Mesh:
    """경로(점 배열)를 따라가는 관. 양 끝은 막는다. 평행 이동 프레임을 쓴다."""
    P = np.asarray(path, dtype=np.float64)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    n = np.cross(T[0], [0, 0, 1] if abs(T[0][2]) < 0.9 else [1, 0, 0])
    n /= np.linalg.norm(n)
    rings = []
    for i in range(len(P)):
        if i > 0:
            n = n - T[i] * np.dot(n, T[i])
            n /= np.linalg.norm(n)
        bvec = np.cross(T[i], n)
        ang = np.linspace(0, 2 * math.pi, seg, endpoint=False)
        rings.append(P[i] + radius * (np.outer(np.cos(ang), n) + np.outer(np.sin(ang), bvec)))
    V = list(np.concatenate(rings))
    F = []
    for i in range(len(P) - 1):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            c, d = (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j
            F += [[a, b, c], [a, c, d]]
    for end, idx in ((0, P[0]), (len(P) - 1, P[-1])):
        ci = len(V)
        V.append(idx)
        for j in range(seg):
            F.append([ci, end * seg + (j + 1) % seg, end * seg + j])
    return _orient(np.array(V), np.array(F, dtype=np.int64))


def catmull_rom(points, samples_per_seg: int = 8) -> np.ndarray:
    P = np.asarray(points, dtype=np.float64)
    P = np.vstack([P[0], P, P[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, samples_per_seg, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def plate_with_hole(w: float, h: float, t: float, hole_c, hole_r, seg: int = 40) -> Mesh:
    """구멍(타원) 뚫린 판. 판 평면 = XZ(가로 X: -w/2~w/2, 세로 Z: 0~h), 두께 Y(-t/2~t/2).
    hole_c = (x, z) 구멍 중심, hole_r = (가로 반경, 세로 반경). 늑판·거더의 맨홀(경량 구멍)에 쓴다.

    구멍 둘레 점마다 중심에서 바깥 사각형으로 쏜 반직선의 끝점과 잇는다. 사각형 네 모서리 방향을 각도에 넣어
    바깥 테두리가 사각형과 정확히 같게 한다."""
    cx, cz = hole_c
    a, b = hole_r
    hw = w / 2
    if not (-hw < cx - a and cx + a < hw and 0 < cz - b and cz + b < h):
        raise ValueError("구멍이 판 밖으로 나간다")
    corners = [math.atan2(zc - cz, xc - cx) % (2 * math.pi) for xc, zc in ((hw, 0), (hw, h), (-hw, h), (-hw, 0))]
    angles = sorted(set([2 * math.pi * i / seg for i in range(seg)] + corners))

    def ray(th: float):
        dx, dz = math.cos(th), math.sin(th)
        ts = []
        if dx > 1e-12:
            ts.append((hw - cx) / dx)
        if dx < -1e-12:
            ts.append((-hw - cx) / dx)
        if dz > 1e-12:
            ts.append((h - cz) / dz)
        if dz < -1e-12:
            ts.append((0 - cz) / dz)
        k = min(x for x in ts if x > 0)
        return cx + k * dx, cz + k * dz

    n = len(angles)
    inner = [(cx + a * math.cos(th), cz + b * math.sin(th)) for th in angles]
    outer = [ray(th) for th in angles]
    V: list[tuple[float, float, float]] = []
    for ring in (inner, outer):
        for y in (t / 2, -t / 2):
            V += [(x, y, z) for x, z in ring]
    fi, bi, fo, bo = 0, n, 2 * n, 3 * n  # 앞(+y)·뒤 안쪽, 앞·뒤 바깥 시작 번호
    F = []
    for i in range(n):
        j = (i + 1) % n
        F += [(fi + i, fo + i, fo + j), (fi + i, fo + j, fi + j)]  # 앞면
        F += [(bi + i, bo + j, bo + i), (bi + i, bi + j, bo + j)]  # 뒷면
        F += [(fi + i, fi + j, bi + j), (fi + i, bi + j, bi + i)]  # 구멍 안벽
        F += [(fo + i, bo + i, bo + j), (fo + i, bo + j, fo + j)]  # 바깥 테두리
    return _orient(np.array(V, dtype=np.float64), np.array(F, dtype=np.int64))


# 변환
def move(m: Mesh, t) -> Mesh:
    return m[0] + np.asarray(t, dtype=np.float64), m[1]


def rot(m: Mesh, axis: str, deg: float) -> Mesh:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    R = {"x": [[1, 0, 0], [0, c, -s], [0, s, c]], "y": [[c, 0, s], [0, 1, 0], [-s, 0, c]], "z": [[c, -s, 0], [s, c, 0], [0, 0, 1]]}[axis]
    return m[0] @ np.array(R).T, m[1]


def scale(m: Mesh, s) -> Mesh:
    return m[0] * np.asarray(s, dtype=np.float64), m[1]


class Model:
    """재질 이름별로 형상을 모은다."""

    def __init__(self) -> None:
        self.parts: dict[str, list[Mesh]] = {}
        # 형상 없는 기준점(강판 면 등). make_assets.to_usda가 prim으로 쓴다
        self.anchors: list[dict] = []

    def add(self, material: str, *meshes: Mesh) -> "Model":
        self.parts.setdefault(material, []).extend(meshes)
        return self

    def merged(self) -> dict[str, Mesh]:
        out = {}
        for mat, meshes in sorted(self.parts.items()):
            Vs, Fs, off = [], [], 0
            for V, F in meshes:
                Vs.append(V)
                Fs.append(F + off)
                off += len(V)
            out[mat] = (np.concatenate(Vs), np.concatenate(Fs))
        return out

    def triangles(self) -> int:
        return sum(len(F) for meshes in self.parts.values() for _, F in meshes)
