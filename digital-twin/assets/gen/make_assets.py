"""에셋 생성기(M3-b 조선소, M4 공장). 절차적 형상(meshkit)으로 USD 에셋을 만든다. 손으로 고치지 말고 이 파일을 고친다.

    uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_assets.py           생성
    uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_assets.py --check   파일이 생성기와 다르면 실패(L1)

에셋은 재질 라이브러리(assets/materials/library.json)의 이름만 쓴다(AS-04). 좌표: Z-up, m.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from pxr import Sdf, Usd, UsdGeom, Vt

import meshkit as mk
from meshkit import Model, cylinder, lathe, move, rot, rounded_box, tube

HERE = Path(__file__).resolve().parent
PROPS = HERE.parent / "props"


def box(size, r=0.006, at=(0, 0, 0)):
    return move(rounded_box(size, r), at)


# ---------- 셀 에셋 ----------

def weld_table() -> Model:
    """용접 테이블 + 작업판 지그(AS-05). 원점: 테이블 중심 바닥. 윗면 0.78m. 작업판(1000x500)은 x -0.5~0.5, y -0.25~0.25에 놓인다."""
    m = Model()
    m.add("bare_steel", box((1.3, 0.8, 0.05), 0.008, (0, 0, 0.755)))
    m.add("painted_steel_dark", box((1.22, 0.72, 0.08), 0.005, (0, 0, 0.69)))
    for x in (-0.56, 0.56):
        for y in (-0.31, 0.31):
            m.add("painted_steel_dark", box((0.07, 0.07, 0.62), 0.006, (x, y, 0.34)))
            m.add("rubber_black", move(cylinder(0.04, 0.03, 0.004, 20), (x, y, 0.0)))
    for y in (-0.31, 0.31):
        m.add("painted_steel_dark", box((1.08, 0.05, 0.05), 0.005, (0, y, 0.16)))
    for x in (-0.56, 0.56):
        m.add("painted_steel_dark", box((0.05, 0.58, 0.05), 0.005, (x, 0, 0.16)))
    # 지그: 토글 클램프 4개(판 긴 변 바깥), 끝 멈춤 블록 2개
    for x in (-0.38, 0.38):
        for sy in (-1, 1):
            y = sy * 0.3
            m.add("machine_blue", box((0.08, 0.05, 0.04), 0.006, (x, y, 0.80)))
            m.add("machine_blue", box((0.05, 0.08, 0.014), 0.004, (x, y - sy * 0.03, 0.827)))
            m.add("rubber_black", move(cylinder(0.012, 0.012, 0.002, 16), (x, y - sy * 0.06, 0.806)))
            handle = rot(cylinder(0.007, 0.11, 0.002, 12), "x", -sy * 120)
            m.add("rubber_black", move(handle, (x, y + sy * 0.02, 0.82)))
    for x in (-0.535, 0.535):
        m.add("machine_blue", box((0.03, 0.12, 0.035), 0.004, (x, 0, 0.7975)))
    return m


def robot_pedestal() -> Model:
    """로봇 받침대. 원점: 바닥 중심. 윗면 0.30m."""
    m = Model()
    m.add("painted_steel_dark", box((0.7, 0.7, 0.025), 0.006, (0, 0, 0.0125)))
    m.add("painted_steel_gray", box((0.44, 0.44, 0.255), 0.02, (0, 0, 0.1525)))
    m.add("galvanized_steel", box((0.5, 0.5, 0.02), 0.004, (0, 0, 0.29)))
    for x in (-0.29, 0.29):
        for y in (-0.29, 0.29):
            m.add("bare_steel", move(cylinder(0.018, 0.022, 0.003, 12), (x, y, 0.025)))
    for i in range(8):
        a = i * np.pi / 4 + np.pi / 8
        m.add("bare_steel", move(cylinder(0.01, 0.012, 0.002, 10), (0.2 * np.cos(a), 0.2 * np.sin(a), 0.3)))
    return m


def fence_panel(m: Model, a, b, z0=0.15, z1=1.75, pitch=0.06):
    """두 점(바닥) 사이 펜스 패널: 노란 기둥 + 검은 철망."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    length = float(np.linalg.norm(d))
    ang = float(np.degrees(np.arctan2(d[1], d[0])))
    mid = (a + b) / 2

    def place(mesh, local):
        return move(rot(mesh, "z", ang), (mid[0], mid[1], 0) + rot((np.array([local]), None), "z", ang)[0][0])

    for x in (-length / 2, length / 2):
        m.add("safety_yellow", place(rounded_box((0.06, 0.06, 1.9), 0.006), (x, 0, 0.95)))
    w = length - 0.08
    for z in (z0, z1):
        m.add("painted_steel_dark", place(rounded_box((w, 0.03, 0.03), 0.004), (0, 0, z)))
    for x in np.arange(-w / 2 + pitch, w / 2, pitch):
        m.add("painted_steel_dark", place(rounded_box((0.005, 0.005, z1 - z0)), (x, 0, (z0 + z1) / 2)))
    for z in np.arange(z0 + pitch, z1, pitch):
        m.add("painted_steel_dark", place(rounded_box((w, 0.005, 0.005)), (0, 0, z)))


def welder(m: Model, wx: float, wy: float) -> None:
    """용접 전원(바퀴 달린 본체 + 송급기)."""
    m.add("machine_blue", box((0.55, 0.32, 0.62), 0.025, (wx, wy, 0.38)))
    m.add("painted_steel_dark", box((0.02, 0.26, 0.25), 0.004, (wx + 0.28, wy, 0.5)))
    m.add("painted_steel_gray", box((0.4, 0.22, 0.22), 0.02, (wx, wy, 0.80)))
    m.add("painted_steel_dark", box((0.01, 0.16, 0.14), 0.003, (wx + 0.2, wy, 0.80)))
    for x in (-0.2, 0.2):
        for y in (-0.17, 0.17):
            m.add("rubber_black", move(rot(cylinder(0.05, 0.03, 0.006, 20, center=True), "x", 90), (wx + x, wy + y, 0.05)))
    m.add("painted_steel_dark", tube(mk.catmull_rom([[wx - 0.2, wy - 0.13, 0.69], [wx - 0.2, wy - 0.13, 0.95], [wx - 0.2, wy + 0.13, 0.95], [wx - 0.2, wy + 0.13, 0.69]], 6), 0.012, 10))


def gas_cylinder(m: Model, gx: float, gy: float) -> None:
    prof = [(0, 0), (0.1, 0), (0.11, 0.012), (0.11, 1.05)] + [
        (0.11 * np.cos(t), 1.05 + 0.15 * np.sin(t)) for t in np.linspace(0.25, np.pi / 2 - 0.25, 6)
    ] + [(0.03, 1.22), (0.03, 1.27), (0, 1.27)]
    m.add("cylinder_green", move(lathe(prof, 28), (gx, gy, 0)))
    m.add("bare_steel", move(cylinder(0.035, 0.08, 0.008, 16), (gx, gy, 1.27)))


def weld_cell_kit() -> Model:
    """셀 주변 장비. 원점: 셀 원점. 용접기, 가스통, 케이블, 안전 펜스(+X, +Y 두 변. 작업자 쪽은 열어 둔다)."""
    m = Model()
    # 용접기·가스통은 셀 뒤쪽(-X,+Y) 모서리. 작업자 쪽 카메라와 로봇 사이를 가리지 않는다
    wx, wy = -0.75, 1.05
    welder(m, wx, wy)
    gas_cylinder(m, -1.08, 1.05)
    # 케이블: 송급기 → 바닥 → 로봇 베이스
    path = mk.catmull_rom([[wx + 0.2, wy - 0.05, 0.8], [wx + 0.42, wy - 0.15, 0.45], [-0.35, 0.75, 0.015], [-0.15, 0.35, 0.015], [0, 0.2, 0.08]], 10)
    m.add("rubber_black", tube(path, 0.014, 12))
    # 안전 펜스
    xs = [-1.2, 0.27, 1.73, 2.6]
    for a, b in zip(xs[:-1], xs[1:]):
        fence_panel(m, (a, 1.65), (b, 1.65))
    ys = [1.65, 0.6, -0.45, -1.5]
    for a, b in zip(ys[:-1], ys[1:]):
        fence_panel(m, (2.6, a), (2.6, b))
    return m


def weld_booth_kit() -> Model:
    """공장 용접 부스(AS-07). 원점: 셀 원점. 세 변 펜스(작업자 쪽 -Y는 열고 라이트 커튼), 테이블 위 흄 후드와 덕트,
    부스 밖 집진기·로봇 제어반, 부스 안 용접기·가스통."""
    m = Model()
    # 펜스: +Y, +X, -X. 작업자 쪽(-Y)은 연다
    xs = [-1.2, 0.27, 1.73, 2.6]
    for a, b in zip(xs[:-1], xs[1:]):
        fence_panel(m, (a, 1.65), (b, 1.65))
    ys = [1.65, 0.6, -0.45, -1.5]
    for a, b in zip(ys[:-1], ys[1:]):
        fence_panel(m, (2.6, a), (2.6, b))
        fence_panel(m, (-1.2, a), (-1.2, b))
    # 라이트 커튼(작업자 쪽 양 끝): 검은 기둥 + 노란 머리
    for x in (-1.05, 2.45):
        m.add("safety_black", box((0.05, 0.05, 1.5), 0.006, (x, -1.5, 0.9)))
        m.add("safety_yellow", box((0.06, 0.06, 0.06), 0.006, (x, -1.5, 1.68)))
        m.add("painted_steel_dark", box((0.16, 0.16, 0.015), 0.003, (x, -1.5, 0.0075)))
    # 흄 후드: 테이블(셀 x 0.95) 위 캐노피 → 덕트 → 부스 뒤 집진기
    hx, hz = 0.95, 2.3
    m.add("galvanized_steel", box((1.4, 0.9, 0.18), 0.01, (hx, 0, hz)))
    m.add("galvanized_steel", box((1.0, 0.6, 0.14), 0.01, (hx, 0, hz + 0.16)))
    m.add("galvanized_steel", box((0.55, 0.4, 0.12), 0.01, (hx, 0, hz + 0.29)))
    m.add("painted_steel_dark", box((1.36, 0.86, 0.02), 0.004, (hx, 0, hz - 0.1)))  # 필터 망
    duct = mk.catmull_rom([[hx, 0, hz + 0.3], [hx, 0, 3.05], [hx, 0.6, 3.3], [hx, 1.6, 3.3], [hx, 2.3, 3.1], [hx, 2.45, 2.2], [hx, 2.45, 1.45]], 10)
    m.add("galvanized_steel", tube(duct, 0.13, 20))
    # 집진기(부스 뒤, +Y 펜스 바깥)
    ex, ey = hx, 2.45
    m.add("machine_blue", box((0.9, 0.7, 1.3), 0.03, (ex, ey, 0.75)))
    m.add("painted_steel_dark", box((0.9, 0.7, 0.1), 0.01, (ex, ey, 0.05)))
    m.add("galvanized_steel", box((0.6, 0.02, 0.5), 0.004, (ex, ey - 0.36, 0.8)))
    m.add("painted_steel_gray", move(cylinder(0.17, 0.08, 0.01, 24), (ex, ey, 1.4)))
    # 로봇 제어반(부스 밖 -X)
    cx, cy = -1.75, 0.5
    m.add("painted_steel_gray", box((0.6, 0.5, 1.5), 0.02, (cx, cy, 0.85)))
    m.add("painted_steel_dark", box((0.62, 0.52, 0.1), 0.01, (cx, cy, 0.05)))
    m.add("painted_steel_dark", box((0.02, 0.2, 0.14), 0.003, (cx + 0.31, cy + 0.05, 1.25)))
    m.add("primer_red", move(rot(cylinder(0.03, 0.025, 0.004, 16), "y", 90), (cx + 0.3, cy - 0.12, 1.25)))
    m.add("rubber_black", tube(mk.catmull_rom([[cx + 0.15, cy - 0.1, 0.1], [cx + 0.3, cy - 0.3, 0.015], [-0.6, -0.1, 0.015], [-0.2, -0.15, 0.08]], 10), 0.018, 12))
    # 용접기·가스통(부스 안 뒤쪽 모서리)
    wx, wy = -0.55, 1.25
    welder(m, wx, wy)
    gas_cylinder(m, -0.98, 1.32)
    path = mk.catmull_rom([[wx + 0.2, wy - 0.05, 0.8], [wx + 0.4, wy - 0.2, 0.45], [-0.2, 0.7, 0.015], [-0.05, 0.35, 0.015], [0, 0.2, 0.08]], 10)
    m.add("rubber_black", tube(path, 0.014, 12))
    return m


# ---------- 조선소 배경 ----------

def platen() -> Model:
    """정반. 원점: 중심 바닥. 윗면 0.25m. T홈 줄."""
    m = Model()
    m.add("painted_steel_dark", box((8, 6, 0.25), 0.02, (0, 0, 0.125)))
    for y in np.arange(-2.75, 2.76, 0.5):
        m.add("safety_black", box((7.9, 0.04, 0.004), 0, (0, y, 0.252)))
    return m


def hull_block() -> Model:
    """선체 이중저 블록(조립 중). 원점: 중심 바닥(정반 위에 놓는다)."""
    m = Model()
    L, B = 5.6, 3.6
    m.add("primer_red", box((L, B, 0.03), 0.005, (0, 0, 0.015)))
    for y in np.arange(-1.5, 1.51, 0.6):  # 종방향 T형 보강재
        m.add("primer_red", box((L - 0.2, 0.015, 0.25), 0.003, (0, y, 0.155)))
        m.add("primer_red", box((L - 0.2, 0.12, 0.015), 0.003, (0, y, 0.2875)))
    for x in np.arange(-2.1, 2.11, 1.4):  # 늑판
        m.add("primer_red", box((0.015, B - 0.2, 0.7), 0.003, (x, 0, 0.38)))
        m.add("primer_red", box((0.12, B - 0.2, 0.015), 0.003, (x, 0, 0.7375)))
    for y in (-B / 2, B / 2):  # 측거더
        m.add("primer_red", box((L, 0.02, 0.9), 0.004, (0, y, 0.48)))
    m.add("primer_red", box((2.6, B, 0.02), 0.004, (-1.5, 0, 0.94)))  # 내저판 일부
    return m


def crane_runway() -> Model:
    """천장 크레인 주행로와 갠트리. 원점: 사이트 원점(사이트 전용).
    주행로는 Y 방향으로 x=-8, x=18에 둔다. 키 라이트(-X,-Y 위에서)의 그림자가 +X,+Y로 떨어지므로 셀(x -1.2~2.6)에 닿지 않는다."""
    m = Model()
    xs = (-8.0, 18.0)
    y0, y1 = -6.0, 12.0
    for x in xs:
        for y in np.arange(y0, y1 + 0.1, 6.0):
            m.add("painted_steel_gray", box((0.4, 0.4, 8.6), 0.012, (x, y, 4.3)))
        cy, ly = (y0 + y1) / 2, y1 - y0 + 1
        m.add("crane_yellow", box((0.4, ly, 0.03), 0.004, (x, cy, 8.615)))
        m.add("crane_yellow", box((0.02, ly, 0.6), 0.003, (x, cy, 8.9)))
        m.add("crane_yellow", box((0.4, ly, 0.03), 0.004, (x, cy, 9.185)))
    span = xs[1] - xs[0]
    cx = (xs[0] + xs[1]) / 2
    by = 9.0  # 갠트리는 셀 뒤쪽에 세워 둔다
    for dy in (-0.4, 0.4):
        m.add("crane_yellow", box((span + 0.4, 0.5, 1.0), 0.03, (cx, by + dy, 9.8)))
    for x in xs:
        m.add("crane_yellow", box((0.7, 2.4, 0.6), 0.03, (x, by, 9.5)))
    tx = 9.0
    m.add("painted_steel_dark", box((1.2, 1.6, 0.6), 0.03, (tx, by, 10.6)))
    for dx in (-0.12, 0.12):
        m.add("safety_black", tube([[tx + dx, by, 10.3], [tx + dx, by, 5.6]], 0.015, 8))
    m.add("crane_yellow", box((0.45, 0.3, 0.5), 0.03, (tx, by, 5.35)))
    return m


# ---------- 공장 배경 ----------

def h_column(m: Model, x: float, y: float, h: float = 7.5, along_x: bool = True) -> None:
    """H형강 기둥 + 바닥 보호대(노랑·검정 띠)."""
    fw, d, t = 0.3, 0.3, 0.02
    if along_x:
        m.add("painted_steel_gray", box((fw, t, h), 0.003, (x, y - d / 2 + t / 2, h / 2)), box((fw, t, h), 0.003, (x, y + d / 2 - t / 2, h / 2)), box((0.014, d, h), 0.002, (x, y, h / 2)))
    else:
        m.add("painted_steel_gray", box((t, fw, h), 0.003, (x - d / 2 + t / 2, y, h / 2)), box((t, fw, h), 0.003, (x + d / 2 - t / 2, y, h / 2)), box((d, 0.014, h), 0.002, (x, y, h / 2)))
    for i in range(4):
        m.add("safety_yellow" if i % 2 == 0 else "safety_black", box((0.42, 0.42, 0.25), 0.01, (x, y, 0.125 + 0.25 * i)))


def pallet_rack(m: Model, x0: float, y: float, bays: int = 3, bay_w: float = 2.7, depth: float = 1.0, levels=(0.0, 1.5, 3.0)) -> None:
    """팔레트 랙(파랑 기둥, 주황 빔). 칸마다 강판 묶음."""
    top = levels[-1] + 1.4
    for i in range(bays + 1):
        x = x0 + i * bay_w
        for dy in (-depth / 2, depth / 2):
            m.add("machine_blue", box((0.09, 0.07, top), 0.006, (x, y + dy, top / 2)))
        for z in np.arange(0.4, top, 0.9):
            m.add("machine_blue", box((0.03, depth, 0.03), 0, (x, y, z)))
    for i in range(bays):
        cx = x0 + (i + 0.5) * bay_w
        for z in levels[1:]:
            for dy in (-depth / 2, depth / 2):
                m.add("primer_red", box((bay_w - 0.09, 0.05, 0.12), 0.006, (cx, y + dy, z)))
        for k, z in enumerate(levels):
            base = z + (0.06 if k else 0.0)
            n = (i + k) % 3 + 2
            for j in range(n):
                m.add("bare_steel", box((1.1, 0.8, 0.025), 0, (cx - 0.6, y, base + 0.0125 + j * 0.03)))
            if (i + k) % 2 == 0:
                m.add("painted_steel_dark", box((1.0, 0.8, 0.6), 0.02, (cx + 0.6, y, base + 0.3)))


def factory_hall() -> Model:
    """공장 건물 일부와 바닥 마킹(AS-07). 원점: 사이트 원점(사이트 전용). 셀은 원점에 있고 작업자는 +X 통로에서 접근한다.
    벽·기둥은 +X, +Y 쪽과 -X 멀리(x=-11)에 둔다. 키 라이트(-X,-Y 위에서)의 그림자가 +X,+Y로 떨어지므로 셀에 닿지 않는다."""
    m = Model()
    x0, x1, y0, y1 = -11.0, 14.0, -9.0, 9.5
    # 벽: 뒤(+Y), 오른쪽(+X), 왼쪽(-X). 아연 강판 골판 + 아래 콘크리트 턱.
    # 왼쪽 벽은 x=-11. 더 가까우면 벽·기둥 그림자 끝이 키 라이트 그림자 범위(셀 주변) 가장자리에 걸려 잘린 조각으로 보인다
    H = 7.0
    m.add("galvanized_steel", box((x1 - x0, 0.06, H), 0.004, ((x0 + x1) / 2, y1, H / 2)))
    for wx, inward in ((x1, -1), (x0, 1)):
        m.add("galvanized_steel", box((0.06, y1 - y0, H), 0.004, (wx, (y0 + y1) / 2, H / 2)))
        for y in np.arange(y0 + 0.25, y1, 0.5):
            m.add("galvanized_steel", box((0.05, 0.06, H - 0.6), 0, (wx + inward * 0.055, y, 0.6 + (H - 0.6) / 2)))
        m.add("painted_steel_gray", box((0.2, y1 - y0, 0.6), 0.01, (wx + inward * 0.13, (y0 + y1) / 2, 0.3)))
    for x in np.arange(x0 + 0.25, x1, 0.5):
        m.add("galvanized_steel", box((0.06, 0.05, H - 0.6), 0, (x, y1 - 0.055, 0.6 + (H - 0.6) / 2)))
    m.add("painted_steel_gray", box((x1 - x0, 0.2, 0.6), 0.01, ((x0 + x1) / 2, y1 - 0.13, 0.3)))
    # 셔터 문(오른쪽 벽)
    m.add("painted_steel_dark", box((0.08, 4.2, 4.6), 0.01, (x1 - 0.08, -4.0, 2.3)))
    for z in np.arange(0.2, 4.6, 0.15):
        m.add("painted_steel_gray", box((0.1, 4.0, 0.02), 0, (x1 - 0.13, -4.0, z)))
    # 기둥: 벽을 따라 6m마다
    for x in np.arange(-6.0, x1 - 1, 6.0):
        h_column(m, x, y1 - 0.35)
    for y in np.arange(-6.0, y1 - 1, 6.0):
        h_column(m, x1 - 0.35, y, along_x=False)
        h_column(m, x0 + 0.35, y, along_x=False)
    # 바닥 마킹: 작업자 통로(+X, Y 방향), 부스 앞 정지선, 적치 구역 모서리
    for x in (3.0, 5.4):
        m.add("safety_yellow", box((0.1, y1 - y0 - 1.2, 0.004), 0, (x, (y0 + y1) / 2 - 0.4, 0.002)))
    for y in np.arange(-8.0, 8.5, 1.2):  # 통로 안 보행 화살표 대신 점선
        m.add("safety_yellow", box((0.5, 0.08, 0.004), 0, (4.2, y, 0.002)))
    for x, y in ((7.2, -3.4), (7.2, 1.2), (10.4, -3.4), (10.4, 1.2)):  # 적치 구역 2칸
        for sx in (-1, 1):
            for sy in (-1, 1):
                cx, cy = x + sx * 1.3, y + sy * 1.0
                m.add("safety_yellow", box((0.5, 0.07, 0.004), 0, (cx - sx * 0.215, cy, 0.002)))
                m.add("safety_yellow", box((0.07, 0.5, 0.004), 0, (cx, cy - sy * 0.215, 0.002)))
    # 빗금 구역: 셔터 문 앞(적치 금지). 노란 테두리 + 검은 빗금
    zx, zy, zw, zh = x1 - 1.1, -4.0, 1.6, 4.0
    for dx in (-zw / 2, zw / 2):
        m.add("safety_yellow", box((0.08, zh, 0.004), 0, (zx + dx, zy, 0.002)))
    for dy in (-zh / 2, zh / 2):
        m.add("safety_yellow", box((zw, 0.08, 0.004), 0, (zx, zy + dy, 0.002)))
    for y in np.arange(zy - zh / 2 + 0.45, zy + zh / 2 - 0.3, 0.4):
        m.add("safety_yellow", move(rot(rounded_box((0.07, 1.0, 0.004)), "z", 45), (zx, y, 0.002)))
    # 적치 구역의 팔레트와 판재
    for x, y, n in ((7.2, -3.4, 6), (10.4, 1.2, 3)):
        for px in (-0.55, 0.55):
            m.add("painted_steel_dark", box((1.0, 1.2, 0.14), 0.01, (x + px, y, 0.07)))
            for j in range(n):
                m.add("bare_steel", box((0.98, 1.18, 0.02), 0, (x + px, y, 0.15 + j * 0.022)))
    # 뒤 벽 앞 팔레트 랙
    pallet_rack(m, 1.5, y1 - 1.3)
    return m


ASSETS = {
    "weld_table": (weld_table, "WeldTable"),
    "robot_pedestal": (robot_pedestal, "RobotPedestal"),
    "weld_cell_kit": (weld_cell_kit, "WeldCellKit"),
    "platen": (platen, "Platen"),
    "hull_block": (hull_block, "HullBlock"),
    "crane_runway": (crane_runway, "CraneRunway"),
    "weld_booth_kit": (weld_booth_kit, "WeldBoothKit"),
    "factory_hall": (factory_hall, "FactoryHall"),
}


def to_usda(model: Model, prim: str, doc: str) -> str:
    stage = Usd.Stage.CreateInMemory()
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    root = UsdGeom.Xform.Define(stage, f"/{prim}").GetPrim()
    Usd.ModelAPI(root).SetKind("component")
    stage.SetDefaultPrim(root)
    stage.GetRootLayer().documentation = doc
    for mat, (V, F) in model.merged().items():
        name = "".join(p.capitalize() for p in mat.split("_"))
        mesh = UsdGeom.Mesh.Define(stage, f"/{prim}/{name}")
        pts = np.round(V, 5).astype(np.float32)
        mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(pts))
        mesh.CreateFaceVertexCountsAttr(Vt.IntArray([3] * len(F)))
        mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(F.astype(np.int32).ravel()))
        mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
        mesh.CreateExtentAttr(Vt.Vec3fArray.FromNumpy(np.stack([pts.min(axis=0), pts.max(axis=0)])))
        mesh.GetPrim().CreateAttribute("innoworks:material", Sdf.ValueTypeNames.Token).Set(mat)
    return stage.GetRootLayer().ExportToString()


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for name, (make, prim) in ASSETS.items():
        model = make()
        doc = f"생성 파일(digital-twin/assets/gen/make_assets.py). 직접 고치지 않는다. {make.__doc__.strip().splitlines()[0]}"
        text = to_usda(model, prim, doc)
        path = PROPS / f"{name}.usda"
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(path.name)
            continue
        path.write_text(text, encoding="utf-8")
        print(f"{path.name}: 삼각형 {model.triangles()}")
    if check:
        if stale:
            print("생성기와 다른 에셋: " + ", ".join(stale) + ". make_assets.py를 실행한다.", file=sys.stderr)
            return 1
        print(f"에셋 {len(ASSETS)}개 최신")
    return 0


if __name__ == "__main__":
    sys.exit(main())
