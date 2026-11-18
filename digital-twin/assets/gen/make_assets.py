"""에셋 생성기(M3-b 조선소, M4 공장). 절차적 형상(meshkit)으로 USD 에셋을 만든다. 손으로 고치지 말고 이 파일을 고친다.

    uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_assets.py           생성
    uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_assets.py --check   파일이 생성기와 다르면 실패(L1)

에셋은 재질 라이브러리(assets/materials/library.json)의 이름만 쓴다(AS-04). 좌표: Z-up, m.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, Vt

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


# ---------- 조선소 블록 내부(ADR 0003) ----------

BLOCK_L, BLOCK_B = 9.6, 6.4  # 블록 길이(X), 폭(Y)
SHELL_TOP_Z = 0.32  # 외판(바닥) 윗면 높이. 받침 위에 놓인다
WEB_H = 1.5  # 늑판·거더 높이(외판 윗면부터)
FLOOR_XS = (-4.8, -1.6, 1.6, 4.8)  # 늑판(횡방향) 위치
LONGI_YS = (-2.4, -1.6, -0.8, 0.8, 1.6, 2.4)  # 론지(종방향 보강재) 위치. y=0은 중심 거더
SIDE_Y = 3.2  # 측면 외판 위치. -Y 쪽은 열어 둔다(카메라가 들여다보는 쪽)
WEB_T = 0.014


def double_bottom_block() -> Model:
    """이중저 블록(조립 중, 내저판 아직 없음). 원점: 블록 중심 바닥. 4족 이동 용접 로봇이 안에서 일한다(ADR 0003).
    외판(바닥) 위에 론지, 늑판(맨홀), 중심 거더(맨홀), 측면 외판. 용접선이 놓이는 면을 surface 기준점으로 함께 쓴다."""
    m = Model()
    hl, hb = BLOCK_L / 2, BLOCK_B / 2
    z0 = SHELL_TOP_Z
    # 받침(스툴)
    for x in (-4.2, -1.4, 1.4, 4.2):
        for y in (-2.4, 0.0, 2.4):
            m.add("painted_steel_dark", box((0.4, 0.4, z0 - 0.02), 0.01, (x, y, (z0 - 0.02) / 2)))
    # 외판(바닥)
    m.add("bare_steel", box((BLOCK_L, BLOCK_B, 0.02), 0.004, (0, 0, z0 - 0.01)))
    # 론지: T형(웹 + 면재), 블록 길이 전체
    for y in LONGI_YS:
        m.add("primer_red", box((BLOCK_L - 0.02, 0.012, 0.2), 0.002, (0, y, z0 + 0.1)))
        m.add("primer_red", box((BLOCK_L - 0.02, 0.09, 0.012), 0.002, (0, y, z0 + 0.206)))
    # 늑판: 중심 거더 양쪽 패널. 안쪽 늑판은 맨홀
    for x in FLOOR_XS:
        for y0, y1 in ((-hb, 0.0), (0.0, hb)):
            w, yc = y1 - y0 - WEB_T, (y0 + y1) / 2
            if abs(x) < hl - 0.01:
                panel = mk.plate_with_hole(w, WEB_H, WEB_T, (0.0, 0.78), (0.3, 0.42))
                m.add("primer_red", move(rot(panel, "z", 90), (x, yc, z0)))
            else:
                m.add("primer_red", box((WEB_T, w, WEB_H), 0.002, (x, yc, z0 + WEB_H / 2)))
    # 중심 거더: 늑판 사이 칸마다 맨홀
    for x0, x1 in zip(FLOOR_XS[:-1], FLOOR_XS[1:]):
        w, xc = x1 - x0 - WEB_T, (x0 + x1) / 2
        m.add("primer_red", move(mk.plate_with_hole(w, WEB_H, WEB_T, (0.0, 0.78), (0.42, 0.3)), (xc, 0.0, z0)))
    # 측면 외판(+Y)
    m.add("bare_steel", box((BLOCK_L, WEB_T, WEB_H), 0.003, (0, SIDE_Y, z0 + WEB_H / 2)))
    # 늑판 위 면재(보강 플랜지)
    for x in FLOOR_XS:
        m.add("primer_red", box((0.1, BLOCK_B - 0.02, 0.012), 0.002, (x, 0, z0 + WEB_H + 0.006)))
    m.add("primer_red", box((BLOCK_L - 0.02, 0.1, 0.012), 0.002, (0, 0, z0 + WEB_H + 0.006)))
    # 용접선이 놓이는 면(surfaces). 원점 = 면 모서리, +Z = 로봇이 붙는 쪽
    m.anchors.append({"name": "BottomShell", "title": "외판(바닥) 윗면", "size_mm": (BLOCK_L * 1000, BLOCK_B * 1000), "translate": (-hl, -hb, z0), "rotate": (0, 0, 0)})
    m.anchors.append({"name": "SideShell", "title": "측면 외판 안쪽 면", "size_mm": (BLOCK_L * 1000, WEB_H * 1000), "translate": (-hl, SIDE_Y - WEB_T / 2, z0), "rotate": (90, 0, 0)})
    return m


def _barrier(m: Model, x: float, y: float, along_x: bool = True) -> None:
    """노랑·검정 이동식 안전 펜스 한 칸(2m)"""
    w = (2.0, 0.05) if along_x else (0.05, 2.0)
    for k in range(4):
        m.add("safety_yellow" if k % 2 == 0 else "safety_black", box((w[0], w[1], 0.22), 0, (x, y, 0.25 + 0.22 * k)))
    for d in (-0.95, 0.95):
        px, py = (x + d, y) if along_x else (x, y + d)
        m.add("safety_black", box((0.5 if not along_x else 0.08, 0.08 if not along_x else 0.5, 0.06), 0, (px, py, 0.03)))


def _spool(m: Model, x: float, y: float, z: float, r: float = 0.15, h: float = 0.1) -> None:
    m.add("galvanized_steel", move(cylinder(r, h, 0.005, 20), (x, y, z)))
    m.add("primer_red", move(cylinder(r * 0.85, h * 0.8, 0, 20), (x, y, z + h * 0.1)))


def _fan(m: Model, x: float, y: float, duct) -> None:
    """이동식 송풍기(축류 팬, 노란 틀) + 노란 주름 덕트"""
    m.add("crane_yellow", box((0.7, 0.6, 0.06), 0.01, (x, y, 0.03)))
    m.add("machine_blue", move(rot(cylinder(0.26, 0.5, 0.02, 24, center=True), "x", 90), (x, y, 0.36)))
    m.add("painted_steel_dark", move(rot(cylinder(0.27, 0.04, 0, 24, center=True), "x", 90), (x, y - 0.27, 0.36)))
    m.add("safety_yellow", tube(mk.catmull_rom(duct, 8), 0.14, 14))


def block_yard_kit() -> Model:
    """블록 주변 작업 환경(사이트 전용, 원점 사이트 원점). 블록 바로 옆 도크 바닥의 장비.
    -Y(열린 쪽): HITL 운영자 책상, 로봇 투입 카트, 송풍기·덕트, 조명탑, 케이블 릴, 안전 펜스.
    +Y(측면 외판 뒤): 가스 용기 랙, 분전반, 송풍기(덕트가 외판을 넘어 들어간다).
    -X(뒤): 용접 전원·가스통, 강판·형강 적치, 소모품 팔레트, 공구 컨테이너. +X(선체 쪽): 이동식 비계 타워, 고소 작업대.
    높은 것도 6m 이하. 키 라이트 그림자 범위(블록 ±7m) 안에서 그림자가 온전하다."""
    m = Model()
    # 용접 전원·가스통(이동 로봇 송급용)과 케이블
    for y in (-1.6, 1.2):
        welder(m, -6.0, y)
        gas_cylinder(m, -6.45, y + 0.05)
        m.add("rubber_black", tube(mk.catmull_rom([[-5.8, y - 0.05, 0.8], [-5.55, y - 0.15, 0.4], [-5.2, y * 0.6, 0.015], [-4.9, y * 0.3, 0.015]], 10), 0.014, 12))
    m.add("primer_red", box((0.6, 0.45, 0.9), 0.02, (-6.1, -3.6, 0.45)))
    m.add("painted_steel_dark", box((0.62, 0.47, 0.03), 0.005, (-6.1, -3.6, 0.915)))
    # 접근 사다리(-Y 열린 쪽, 블록 위로)
    lx, ly = -3.0, -3.75
    for dx in (-0.22, 0.22):
        m.add("safety_yellow", tube([[lx + dx, ly - 0.45, 0.0], [lx + dx, ly + 0.25, 1.85]], 0.018, 10))
    for k in range(1, 7):
        z = k * 0.27
        yy = ly - 0.45 + 0.7 * z / 1.85
        m.add("galvanized_steel", tube([[lx - 0.22, yy, z], [lx + 0.22, yy, z]], 0.012, 8))

    # --- -Y: HITL 운영자 책상(노트북, 모니터) ---
    dx_, dy_ = -1.6, -6.3
    m.add("painted_steel_gray", box((1.6, 0.8, 0.04), 0.008, (dx_, dy_, 0.74)))
    for sx in (-0.72, 0.72):
        for sy in (-0.32, 0.32):
            m.add("painted_steel_dark", box((0.04, 0.04, 0.72), 0, (dx_ + sx, dy_ + sy, 0.36)))
    m.add("painted_steel_dark", box((0.36, 0.25, 0.02), 0.004, (dx_ - 0.3, dy_ - 0.1, 0.77)))
    m.add("safety_black", move(rot(box((0.36, 0.01, 0.24), 0.003), "x", -15), (dx_ - 0.3, dy_ + 0.04, 0.9)))
    m.add("painted_steel_dark", box((0.06, 0.06, 0.25), 0, (dx_ + 0.35, dy_ + 0.2, 0.89)))
    m.add("safety_black", box((0.6, 0.03, 0.36), 0.005, (dx_ + 0.35, dy_ + 0.18, 1.18)))
    # 로봇 투입 카트(탯줄 드럼, 운반 케이스)
    cx, cy = 1.9, -6.2
    m.add("machine_blue", box((1.2, 0.7, 0.5), 0.02, (cx, cy, 0.45)))
    for sx in (-0.5, 0.5):
        for sy in (-0.28, 0.28):
            m.add("rubber_black", move(rot(cylinder(0.09, 0.05, 0.01, 16, center=True), "x", 90), (cx + sx, cy + sy, 0.09)))
    m.add("galvanized_steel", move(rot(cylinder(0.32, 0.5, 0.01, 28, center=True), "x", 90), (cx - 0.15, cy, 1.02)))
    m.add("rubber_black", move(rot(cylinder(0.27, 0.46, 0, 28, center=True), "x", 90), (cx - 0.15, cy, 1.02)))
    m.add("painted_steel_dark", box((0.55, 0.4, 0.28), 0.03, (cx + 0.75, cy - 0.9, 0.14)))
    m.add("rubber_black", tube(mk.catmull_rom([[cx - 0.15, cy + 0.28, 0.75], [cx - 0.3, cy + 0.9, 0.05], [cx - 0.6, -4.2, 0.015], [cx - 1.0, -3.4, 0.015]], 10), 0.02, 10))
    # 케이블 릴
    m.add("primer_red", move(rot(lathe([(0.0, -0.22), (0.42, -0.22), (0.42, -0.18), (0.22, -0.18), (0.22, 0.18), (0.42, 0.18), (0.42, 0.22), (0.0, 0.22)], 28), "x", 90), (0.2, -5.4, 0.42)))
    m.add("rubber_black", move(rot(cylinder(0.33, 0.34, 0, 28, center=True), "x", 90), (0.2, -5.4, 0.42)))
    # 송풍기 1: 덕트가 열린 쪽으로 빈 칸(-Y 칸)에 들어간다
    _fan(m, 3.6, -5.3, [[3.6, -5.05, 0.36], [3.5, -4.3, 0.3], [3.3, -3.4, 0.5], [3.1, -2.4, 0.45], [2.9, -1.4, 0.4]])
    # 조명탑(트레일러 + 마스트 + 등 4개)
    tx, ty = -8.8, -7.6
    m.add("crane_yellow", box((2.0, 1.2, 0.9), 0.04, (tx, ty, 0.75)))
    for sx in (-0.6, 0.6):
        m.add("rubber_black", move(rot(cylinder(0.25, 0.15, 0.02, 20, center=True), "x", 90), (tx + sx, ty - 0.65, 0.25)))
    m.add("galvanized_steel", tube([[tx, ty, 1.2], [tx, ty, 5.2]], 0.07, 12))
    m.add("galvanized_steel", box((1.4, 0.1, 0.1), 0, (tx, ty, 5.25)))
    for sx in (-0.55, -0.18, 0.18, 0.55):
        m.add("painted_steel_dark", move(rot(box((0.3, 0.12, 0.24), 0.02), "x", 30), (tx + sx, ty + 0.08, 5.45)))
    # 안전 펜스(작업 구역 경계, 가운데 출입구)
    for x in (-6.0, -4.0, -2.0, 2.0, 4.0, 6.0):
        _barrier(m, x, -9.4)
    for y in (-8.4, -6.4):
        _barrier(m, -7.0, y, along_x=False)
        _barrier(m, 7.0, y, along_x=False)
    for x in (-0.6, 0.6):
        m.add("safety_yellow", move(lathe([(0, 0), (0.17, 0), (0.17, 0.03), (0.13, 0.03), (0.03, 0.7), (0, 0.7)], 20), (x, -9.6, 0)))

    # --- +Y: 가스 용기 랙, 분전반, 송풍기 2 ---
    gx, gy = -2.6, 5.0
    m.add("galvanized_steel", box((2.0, 0.6, 0.05), 0, (gx, gy, 0.025)))
    for sx in (-0.98, 0.98):
        for sy in (-0.28, 0.28):
            m.add("galvanized_steel", box((0.05, 0.05, 1.5), 0, (gx + sx, gy + sy, 0.75)))
    for z in (0.6, 1.2):
        m.add("galvanized_steel", box((2.0, 0.04, 0.04), 0, (gx, gy - 0.3, z)))
        m.add("galvanized_steel", box((2.0, 0.04, 0.04), 0, (gx, gy + 0.3, z)))
    for i, x in enumerate(np.linspace(gx - 0.75, gx + 0.75, 5)):
        if i == 2:
            m.add("primer_red", move(cylinder(0.11, 1.3, 0.03, 20), (x, gy, 0.05)))
        else:
            gas_cylinder(m, x, gy)
    px, py = 1.4, 4.9
    m.add("painted_steel_gray", box((0.8, 0.35, 1.0), 0.02, (px, py, 1.0)))
    for sx in (-0.3, 0.3):
        m.add("painted_steel_dark", box((0.05, 0.3, 0.5), 0, (px + sx, py, 0.25)))
    m.add("primer_red", box((0.08, 0.02, 0.08), 0, (px + 0.25, py - 0.18, 1.3)))
    m.add("rubber_black", tube(mk.catmull_rom([[px - 0.2, py - 0.1, 0.5], [px - 0.4, py - 0.5, 0.015], [-1.0, 4.3, 0.015], [-4.5, 4.3, 0.015], [-5.6, 2.0, 0.015]], 10), 0.022, 10))
    _fan(m, 4.3, 5.4, [[4.3, 5.15, 0.36], [4.3, 4.4, 0.8], [4.3, 3.7, 2.05], [4.3, 3.0, 2.15], [4.3, 2.4, 1.2], [4.3, 2.2, 0.6]])

    # --- -X: 강판·형강 적치, 소모품 팔레트, 공구 컨테이너 ---
    sx_, sy_ = -9.0, 2.5
    for dx in (-1.1, 0.0, 1.1):
        m.add("timber", box((0.12, 1.6, 0.12), 0, (sx_ + dx, sy_, 0.06)))
    for k in range(8):
        m.add("bare_steel", box((3.0, 1.5, 0.016), 0, (sx_, sy_, 0.128 + k * 0.018)))
    bx, by = -9.0, -2.6
    for dx in (-1.6, 0.0, 1.6):
        m.add("timber", box((0.12, 0.8, 0.1), 0, (bx + dx, by, 0.05)))
    for k in range(3):
        for j in range(4):
            m.add("primer_red", box((4.0, 0.012, 0.18), 0, (bx, by - 0.24 + j * 0.16, 0.19 + k * 0.19)))
            m.add("primer_red", box((4.0, 0.04, 0.02), 0, (bx, by - 0.24 + j * 0.16 + 0.014, 0.27 + k * 0.19)))
    for i, (ox, oy) in enumerate(((-7.3, -4.8), (-8.6, -4.8))):
        m.add("timber", box((1.2, 1.0, 0.14), 0, (ox, oy, 0.07)))
        if i == 0:
            for a in (-0.3, 0.3):
                for b in (-0.25, 0.25):
                    _spool(m, ox + a, oy + b, 0.14, 0.16, 0.12)
                    _spool(m, ox + a, oy + b, 0.26, 0.16, 0.12)
        else:
            m.add("painted_steel_dark", box((1.1, 0.9, 0.5), 0.01, (ox, oy, 0.39)))
    cx2, cy2 = -10.0, 9.4
    m.add("machine_blue", box((6.06, 2.44, 2.59), 0.03, (cx2, cy2, 1.295)))
    for x in np.arange(cx2 - 2.9, cx2 + 2.95, 0.3):
        m.add("machine_blue", box((0.08, 2.48, 2.3), 0, (x, cy2, 1.3)))
    m.add("painted_steel_dark", box((0.04, 2.3, 2.4), 0, (cx2 + 3.04, cy2, 1.3)))

    # --- +X(선체 쪽): 이동식 비계 타워, 고소 작업대 ---
    vx, vy = 6.0, -4.0
    for sx in (-0.65, 0.65):
        for sy in (-1.2, 1.2):
            m.add("galvanized_steel", tube([[vx + sx, vy + sy, 0.15], [vx + sx, vy + sy, 5.4]], 0.025, 8))
            m.add("rubber_black", move(cylinder(0.07, 0.12, 0.01, 12), (vx + sx, vy + sy, 0.0)))
    for z in (1.8, 3.6, 5.2):
        m.add("timber", box((1.3, 2.4, 0.05), 0, (vx, vy, z)))
        for sy in (-1.2, 1.2):
            m.add("galvanized_steel", tube([[vx - 0.65, vy + sy, z + 0.5], [vx + 0.65, vy + sy, z + 0.5]], 0.02, 8))
        for sx in (-0.65, 0.65):
            m.add("galvanized_steel", tube([[vx + sx, vy - 1.2, z + 0.5], [vx + sx, vy + 1.2, z + 0.5]], 0.02, 8))
    lx2, ly2 = 5.9, 4.7
    m.add("crane_yellow", box((2.0, 1.0, 0.45), 0.03, (lx2, ly2, 0.33)))
    for sx in (-0.8, 0.8):
        for sy in (-0.4, 0.4):
            m.add("rubber_black", move(rot(cylinder(0.12, 0.1, 0.01, 16, center=True), "x", 90), (lx2 + sx, ly2 + sy, 0.12)))
    for k in range(3):
        z0, z1 = 0.55 + k * 0.85, 0.55 + (k + 1) * 0.85
        for sy in (-0.42, 0.42):
            m.add("painted_steel_dark", tube([[lx2 - 0.85, ly2 + sy, z0], [lx2 + 0.85, ly2 + sy, z1]], 0.035, 8))
            m.add("painted_steel_dark", tube([[lx2 + 0.85, ly2 + sy, z0], [lx2 - 0.85, ly2 + sy, z1]], 0.035, 8))
    zt = 0.55 + 3 * 0.85
    m.add("crane_yellow", box((2.2, 1.1, 0.12), 0.02, (lx2, ly2, zt + 0.06)))
    for sx in (-1.05, 1.05):
        for sy in (-0.5, 0.5):
            m.add("crane_yellow", box((0.04, 0.04, 1.1), 0, (lx2 + sx, ly2 + sy, zt + 0.6)))
    m.add("crane_yellow", box((2.2, 0.04, 0.04), 0, (lx2, ly2 - 0.5, zt + 1.15)))
    m.add("crane_yellow", box((2.2, 0.04, 0.04), 0, (lx2, ly2 + 0.5, zt + 1.15)))
    return m


# ---------- 건조 도크(ADR 0003, ship-block 주변) ----------
# 키 라이트 그림자는 셀·면 주변(블록 ±7m)에서만 계산된다. 높은 구조물은 그림자가 떨어지는 +X·+Y 쪽(카메라가 보는 쪽)에 두고,
# -X·-Y 쪽에는 낮은 것만 둔다(그림자 끝이 잘린 조각으로 보이지 않게, docs/README.md "사이트 추가하기").

DOCK_X = (-34.0, 110.0)  # 도크 바닥 길이(X). +X 쪽은 안개 속으로 이어진다
DOCK_Y = (-24.0, 22.0)  # 도크 벽 위치(Y)
QUAY_Z = 12.0  # 안벽(부두) 높이


def plate_strip(m: Model, mat: str, pts, x0: float, x1: float, t: float) -> None:
    """YZ 평면의 꺾은선(pts)을 X 방향(x0~x1)으로 늘린 두께 t의 판. 선체 외판·내판 단면에 쓴다."""
    for (y0, z0), (y1, z1) in zip(pts[:-1], pts[1:]):
        L = math.hypot(y1 - y0, z1 - z0)
        b = rot(rounded_box((x1 - x0, L + t, t), 0), "x", math.degrees(math.atan2(z1 - z0, y1 - y0)))
        m.add(mat, move(b, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)))


def dry_dock() -> Model:
    """건조 도크(사이트 전용, 원점 사이트 원점): 도크 바닥, 계단식 도크 벽, 안벽, 반목(킬 블록) 줄, 계선주, 난간, 사다리."""
    m = Model()
    x0, x1 = DOCK_X
    ys, yn = DOCK_Y
    xc, lx = (x0 + x1) / 2, x1 - x0
    m.add("concrete_floor", box((lx, yn - ys, 0.4), 0, (xc, (ys + yn) / 2, -0.2)))
    # 배수로(바닥 양쪽)
    for y in (ys + 1.2, yn - 1.2):
        m.add("painted_steel_dark", box((lx, 0.6, 0.02), 0, (xc, y, 0.005)))
    # 도크 벽: 3단 계단(알타), 위가 안벽
    steps = [(0.0, 4.0, 2.0), (4.0, 8.0, 1.5), (8.0, QUAY_Z, 1.2)]  # (아래 z, 위 z, 계단 폭)
    for side, y_wall in ((1, yn), (-1, ys)):
        off = 0.0
        for z_lo, z_hi, w in steps:
            yc = y_wall + side * (off + w / 2)
            m.add("concrete_floor", box((lx, w, z_hi), 0.02, (xc, yc, z_hi / 2)))
            off += w
        # 안벽 윗면(멀리까지)
        m.add("concrete_light", box((lx + 80, 70.0, 0.6), 0, (xc, y_wall + side * (off + 35.0), QUAY_Z - 0.3)))
        # 안벽 가장자리 난간·계선주
        ye = y_wall + side * (off + 0.4)
        for x in np.arange(x0 + 2, min(x1, 60.0), 2.5):
            m.add("safety_yellow", box((0.06, 0.06, 1.1), 0, (x, ye, QUAY_Z + 0.55)))
        for z in (QUAY_Z + 0.55, QUAY_Z + 1.05):
            m.add("safety_yellow", box((min(x1, 60.0) - x0 - 2, 0.05, 0.05), 0, ((x0 + 2 + min(x1, 60.0)) / 2, ye, z)))
        for x in np.arange(x0 + 8, min(x1, 60.0), 16.0):
            m.add("painted_steel_dark", move(cylinder(0.25, 0.7, 0.04, 20), (x, ye + side * 1.4, QUAY_Z)))
        # 벽 사다리
        for x in (-20.0, 4.0, 28.0):
            yl = y_wall + side * 0.15
            for dx in (-0.25, 0.25):
                m.add("safety_yellow", box((0.05, 0.05, 4.0), 0, (x + dx, yl, 2.0)))
            for z in np.arange(0.3, 4.0, 0.3):
                m.add("galvanized_steel", box((0.5, 0.03, 0.03), 0, (x, yl, z)))
    # 도크 머리 벽(-X 끝)
    m.add("concrete_floor", box((4.0, yn - ys + 9.4, QUAY_Z), 0.02, (x0 - 2.0, (ys + yn) / 2, QUAY_Z / 2)))
    m.add("concrete_light", box((60.0, yn - ys + 150, 0.6), 0, (x0 - 34.0, (ys + yn) / 2, QUAY_Z - 0.3)))
    # 반목(킬 블록): 중심선과 좌우 줄. 블록·선체가 그 위에 놓인다
    for y in (-6.0, 0.0, 6.0):
        for x in np.arange(-30.0, 60.0, 1.6):
            if -5.2 < x < 5.2:
                continue  # 작업 블록 자리(블록 자체 받침이 있다)
            m.add("concrete_light", box((0.8, 1.2, 0.22), 0, (x, y, 0.11)))
            m.add("timber", box((0.8, 1.2, 0.08), 0, (x, y, 0.26)))
    return m


HULL_HALF_B = 14.0  # 선체 반폭
HULL_DECK_Z = 16.0
HULL_LEN = 40.0


def _hull_profile(half: float = HULL_HALF_B, flat: float = 10.0, bilge_r: float = 4.0, z0: float = 0.31) -> list:
    """선체 단면(외판, YZ): 좌현 갑판 → 빌지 → 평저 → 빌지 → 우현 갑판"""
    arc = [(flat + bilge_r * math.cos(a), z0 + bilge_r + bilge_r * math.sin(a)) for a in np.linspace(-math.pi / 2, 0, 7)]
    right = arc + [(half, HULL_DECK_Z)]
    left = [(-y, z) for y, z in reversed(right)]
    return left + right[1:]


def hull_section() -> Model:
    """도크에 이미 탑재된 선체 일부(원점: 선체 뒤 끝 단면 중심 바닥, +X로 HULL_LEN). 열린 단면으로 이중저·빌지·측면 탱크·갑판이 보인다.
    사이트에서 작업 블록(+X 끝 4.8) 앞(+X)에 둔다."""
    m = Model()
    L = HULL_LEN
    plate_strip(m, "painted_steel_gray", _hull_profile(), 0.0, L, 0.022)
    inner = [(-11.6, HULL_DECK_Z), (-11.6, 4.0), (-10.0, 1.82), (10.0, 1.82), (11.6, 4.0), (11.6, HULL_DECK_Z)]
    plate_strip(m, "painted_steel_gray", inner, 0.0, L, 0.016)
    # 측면 탱크 스트링거(수평 판)와 갑판
    for z in (6.0, 10.0, 14.0):
        for s in (-1, 1):
            plate_strip(m, "primer_red", [(s * 11.6, z), (s * 14.0, z)], 0.0, L, 0.014)
    for s in (-1, 1):
        plate_strip(m, "painted_steel_gray", [(s * 11.6, HULL_DECK_Z), (s * 14.0, HULL_DECK_Z)], 0.0, L, 0.018)
    m.add("painted_steel_gray", box((L - 16.0, 23.2, 0.018), 0, (16.0 + (L - 16.0) / 2, 0, HULL_DECK_Z)))  # 앞쪽은 갑판까지 덮였다
    m.add("painted_steel_gray", box((L - 16.0, 0.4, 1.4), 0.02, (16.0 + (L - 16.0) / 2, -11.6, HULL_DECK_Z + 0.7)))  # 해치 코밍
    # 열린 끝과 다음 칸의 늑판·웹 프레임(맨홀)
    for x in (0.3, 3.5):
        for y0, y1 in ((-10.0, -3.2), (-3.2, 3.2), (3.2, 10.0)):
            w, yc = y1 - y0 - 0.014, (y0 + y1) / 2
            m.add("primer_red", move(rot(mk.plate_with_hole(w, 1.5, 0.014, (0.0, 0.78), (min(0.3, w / 4), 0.42)), "z", 90), (x, yc, 0.32)))
        for s in (-1, 1):
            for z0, z1 in ((4.0, 6.0), (6.0, 10.0), (10.0, 14.0), (14.0, HULL_DECK_Z)):
                m.add("primer_red", move(rot(mk.plate_with_hole(2.4 - 0.02, z1 - z0, 0.014, (0.0, (z1 - z0) / 2), (0.5, min(0.7, (z1 - z0) / 2 - 0.3))), "z", 90), (x, s * 12.8, z0)))
    # 이중저 거더(종방향)
    for y in (-6.4, -3.2, 0.0, 3.2, 6.4):
        m.add("primer_red", box((L, 0.014, 1.5), 0.002, (L / 2, y, 1.07)))
    # 좌현(-Y, 카메라 쪽) 비계: 기둥·띠장·발판
    ys = -HULL_HALF_B - 0.9
    for x in np.arange(1.0, L, 2.0):
        for dy in (0.0, -1.0):
            m.add("galvanized_steel", tube([[x, ys + dy, 0.0], [x, ys + dy, HULL_DECK_Z + 1.0]], 0.024, 8))
    for z in np.arange(2.0, HULL_DECK_Z + 0.1, 2.0):
        for dy in (0.0, -1.0):
            m.add("galvanized_steel", tube([[1.0, ys + dy, z + 0.9], [L - 1.0, ys + dy, z + 0.9]], 0.02, 8))
        m.add("timber", box((L - 2.0, 1.0, 0.05), 0, (L / 2, ys - 0.5, z)))
        m.add("safety_yellow", box((L - 2.0, 0.03, 0.15), 0, (L / 2, ys - 1.0, z + 0.1)))
    return m


def goliath_crane() -> Model:
    """골리앗 크레인(도크를 가로지른다). 원점: 크레인 중심 바닥(z=0). 다리는 양쪽 안벽(z=QUAY_Z) 위 레일에."""
    m = Model()
    yl = 28.0  # 다리 위치(±Y)
    zt = 40.0  # 거더 아래
    for s in (-1, 1):
        y = s * yl
        for dx in (-7.0, 7.0):
            m.add("crane_yellow", tube([[dx, y, QUAY_Z], [dx * 0.25, y, zt]], 0.6, 16))
        m.add("crane_yellow", box((16.0, 1.6, 1.4), 0.05, (0, y, QUAY_Z + 0.7)))  # 주행대차
        m.add("painted_steel_dark", box((60.0, 0.2, 0.2), 0, (0, y - 1.0, QUAY_Z + 0.1)))  # 레일
        m.add("painted_steel_dark", box((60.0, 0.2, 0.2), 0, (0, y + 1.0, QUAY_Z + 0.1)))
    for dx in (-1.6, 1.6):
        m.add("crane_yellow", box((1.4, 2 * yl + 6.0, 3.6), 0.06, (dx, 0, zt + 1.8)))
    m.add("painted_steel_gray", box((5.0, 6.0, 3.0), 0.08, (0, 6.0, zt + 5.1)))  # 트롤리
    for dx in (-0.3, 0.3):
        m.add("safety_black", tube([[dx, 6.0, zt + 3.6], [dx, 6.0, 24.0]], 0.05, 8))
    m.add("crane_yellow", box((1.6, 1.2, 1.6), 0.1, (0, 6.0, 23.2)))  # 훅 블록
    m.add("painted_steel_gray", box((3.0, 3.0, 2.6), 0.06, (0, -yl + 3.0, zt + 1.3)))  # 운전실
    return m


def quay_structures() -> Model:
    """+Y 안벽 위 구조물(사이트 전용): 지브 크레인, 공장 건물. 안개 속 실루엣."""
    m = Model()
    z = QUAY_Z
    # 지브(러핑) 크레인: 문형 받침 + 타워 + 비스듬한 지브
    cx, cy = -6.0, 30.0
    for dx in (-2.5, 2.5):
        for dy in (-2.5, 2.5):
            m.add("crane_yellow", box((0.6, 0.6, 6.0), 0.03, (cx + dx, cy + dy, z + 3.0)))
    m.add("crane_yellow", box((6.0, 6.0, 1.0), 0.05, (cx, cy, z + 6.5)))
    m.add("crane_yellow", box((2.2, 2.2, 14.0), 0.05, (cx, cy, z + 14.0)))
    m.add("painted_steel_gray", box((4.0, 3.0, 3.0), 0.08, (cx + 0.5, cy, z + 22.5)))
    m.add("crane_yellow", tube([[cx + 1.5, cy, z + 22.0], [cx + 20.0, cy - 9.0, z + 34.0]], 0.45, 12))
    m.add("safety_black", tube([[cx + 20.0, cy - 9.0, z + 34.0], [cx + 20.0, cy - 9.0, z + 16.0]], 0.05, 8))
    # 공장 건물(조립 공장)
    bx, by, L, W, H = -10.0, 52.0, 70.0, 24.0, 20.0
    m.add("galvanized_steel", box((L, W, H), 0.05, (bx, by, z + H / 2)))
    m.add("painted_steel_gray", box((L + 1.0, W + 1.0, 1.2), 0.05, (bx, by, z + H + 0.6)))
    for x in np.arange(bx - L / 2 + 6, bx + L / 2 - 4, 12.0):
        m.add("painted_steel_dark", box((8.0, 0.2, 10.0), 0.02, (x, by - W / 2 - 0.1, z + 5.0)))  # 대형 문
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
    "double_bottom_block": (double_bottom_block, "DoubleBottomBlock"),
    "block_yard_kit": (block_yard_kit, "BlockYardKit"),
    "dry_dock": (dry_dock, "DryDock"),
    "hull_section": (hull_section, "HullSection"),
    "goliath_crane": (goliath_crane, "GoliathCrane"),
    "quay_structures": (quay_structures, "QuayStructures"),
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
    if model.anchors:
        UsdGeom.Xform.Define(stage, f"/{prim}/Surfaces")
    for a in model.anchors:
        x = UsdGeom.Xform.Define(stage, f"/{prim}/Surfaces/{a['name']}")
        x.AddTranslateOp().Set(Gf.Vec3d(*a["translate"]))
        if any(a["rotate"]):
            x.AddRotateXYZOp().Set(Gf.Vec3f(*a["rotate"]))
        p = x.GetPrim()
        p.SetCustomData({"innoworks:role": "surface"})  # SetCustomDataByKey는 ":"를 중첩 경로로 쓴다
        p.CreateAttribute("innoworks:name", Sdf.ValueTypeNames.String).Set(a["title"])
        p.CreateAttribute("innoworks:sizeMm", Sdf.ValueTypeNames.Float2).Set(Gf.Vec2f(*a["size_mm"]))
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
