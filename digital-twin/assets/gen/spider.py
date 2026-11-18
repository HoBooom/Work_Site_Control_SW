"""4족 자석발 이동 용접 로봇 대역(ADR 0003). make_robot.py가 불러 STL + URDF로 쓴다.

참고한 형태: 조선소 블록 안을 걷고 수직벽·곡면 강판에 자석발로 붙어 다니는 4족 작업 로봇 위에 협동 용접 로봇을 얹은 구성.
치수는 공개 사진으로 어림했다(공개 사양: 로봇 약 15kg, 가반하중 30kg, 전자영구자석 발). 실제 기종 CAD가 오면 관절 이름을 맞춰 바꾼다.

좌표: Z-up, m. base_link 원점 = 몸통 중심. 몸통 앞 = +X.
관절 0°가 서 있는 자세다: 네 발판이 몸통 중심 아래 STAND_HEIGHT_M 평면에 평평하게 닿는다(L3 robot.spec이 확인한다).

다리(fl, fr, rl, rr)마다 hip_yaw(Z) → hip_pitch(Y) → knee(Y) → ankle_pitch(Y) → ankle_roll(X).
발목 두 축은 수동 관절(자석발이 면에 맞춰 눕는다)이지만 자세를 보이려고 revolute로 둔다.
팔: arm_1(Z) → arm_2(Y) → arm_3(Y) → arm_4(X) → arm_5(Y) → arm_6(X) → torch(고정). 0°: 상완 수직, 전완 +X 수평.
"""
from __future__ import annotations

import math

import numpy as np

import meshkit as mk
from meshkit import Model, cylinder, lathe, move, rot, rounded_box, tube

NAME = "spider-welder"
COMMENT = (
    "  4족 자석발 이동 용접 로봇 대역(ADR 0003, digital-twin/assets/gen/spider.py).\n"
    "  좌표: Z-up, m. base_link = 몸통 중심. 관절 0° = 서 있는 자세(발판 바닥이 base_link 아래 0.14m)."
)

# 재질 이름은 frontend/src/scene/Robot.tsx의 ROBOT_PBR 표와 같아야 금속·거칠기가 들어간다. 색은 linear RGB
COLORS = {
    "aluminum": "0.56 0.58 0.60 1",
    "carbon": "0.035 0.037 0.04 1",
    "graphite": "0.10 0.105 0.11 1",
    "cobot": "0.70 0.71 0.72 1",
    "brass": "0.75 0.52 0.25 1",
    "lens": "0.01 0.01 0.012 1",
}

# ---------- 치수 ----------
STAND_HEIGHT_M = 0.14  # 서 있을 때 몸통 중심 높이(발판 바닥 기준)
BODY = (0.40, 0.36, 0.12)
CORNER = (0.15, 0.13)  # 고관절 요(yaw) 축의 몸통 위 위치(±x, ±y)
LEG_YAW_DEG = {"fl": 55.0, "rl": 125.0, "rr": -125.0, "fr": -55.0}  # 다리가 뻗는 방향(몸통 기준)
LEG_SIGN = {"fl": (1, 1), "rl": (-1, 1), "rr": (-1, -1), "fr": (1, -1)}
PITCH_OFFSET = (0.025, 0.0, 0.11)  # 요 축 → 피치 축(다리 좌표계)
THIGH_M, THIGH_UP_DEG = 0.36, 40.0
SHIN_M = 0.50
ANKLE_ABOVE_FLOOR_M = 0.075  # 발목 축 → 발판 바닥


def _shin_angle_deg() -> float:
    """발목이 바닥에서 ANKLE_ABOVE_FLOOR_M 위에 오도록 정강이 각을 계산한다(0° = 서 있는 자세가 되게)."""
    z_pitch = BODY[2] / 2 + PITCH_OFFSET[2]
    z_knee = z_pitch + THIGH_M * math.sin(math.radians(THIGH_UP_DEG))
    z_ankle = -STAND_HEIGHT_M + ANKLE_ABOVE_FLOOR_M
    return math.degrees(math.asin((z_ankle - z_knee) / SHIN_M))


SHIN_DEG = _shin_angle_deg()


def _dir(deg: float) -> np.ndarray:
    a = math.radians(deg)
    return np.array([math.cos(a), 0.0, math.sin(a)])


def ycyl(r, length, bevel=0.0, seg=32):
    """Y축 방향 원기둥(가운데 원점)"""
    return rot(cylinder(r, length, bevel, seg, center=True), "x", 90)


def xcyl(r, length, bevel=0.0, seg=32, start=0.0):
    """X축 방향 원기둥(x = start ~ start+length)"""
    return move(rot(cylinder(r, length, bevel, seg), "y", 90), (start, 0, 0))


def seg(d: np.ndarray, t0: float, t1: float, r: float, n: int = 18):
    """원점에서 d 방향 t0~t1 구간의 관"""
    return tube([d * t0, d * t1], r, n)


def drum(m: Model, r: float, length: float, cap_side: int = 1, at=(0, 0, 0)):
    """Y축 액추에이터: 알루미늄 몸체 + 한쪽 어두운 덮개 + 반대쪽 플랜지"""
    m.add("aluminum", move(ycyl(r, length, 0.006, 40), at))
    m.add("graphite", move(ycyl(r * 0.9, 0.01, 0.002, 40), (at[0], at[1] + cap_side * (length / 2 + 0.004), at[2])))
    m.add("aluminum", move(ycyl(r * 0.62, 0.012, 0.002, 32), (at[0], at[1] - cap_side * (length / 2 + 0.005), at[2])))
    for i in range(8):
        a = i * math.pi / 4
        m.add("graphite", move(ycyl(0.0045, 0.004, 0, 8), (at[0] + r * 0.78 * math.cos(a), at[1] - cap_side * (length / 2 + 0.002), at[2] + r * 0.78 * math.sin(a))))


# ---------- 링크 ----------

def body() -> Model:
    m = Model()
    bx, by, bz = BODY
    m.add("aluminum", rounded_box((bx, by, bz), 0.022))
    m.add("graphite", move(rounded_box((bx - 0.03, by - 0.03, 0.006), 0.003), (0, 0, bz / 2 + 0.002)))
    # 앞·뒤·옆 센서 띠(카메라 창)
    for sx in (1, -1):
        m.add("lens", move(rounded_box((0.006, 0.15, 0.03), 0.003), (sx * (bx / 2 + 0.001), 0, 0.005)))
        for y in (-0.04, 0.0, 0.04):
            m.add("graphite", move(xcyl(0.008, 0.004, 0, 16, start=0), (sx * (bx / 2 + 0.002) - (0.004 if sx < 0 else 0), y, 0.005)))
    for sy in (1, -1):
        m.add("lens", move(rounded_box((0.12, 0.006, 0.03), 0.003), (0.03, sy * (by / 2 + 0.001), 0.005)))
    # 옆면 볼트 줄
    for sx in (1, -1):
        for y in np.linspace(-0.13, 0.13, 5):
            for z in (-0.035, 0.035):
                m.add("graphite", move(xcyl(0.004, 0.003, 0, 8, start=0), (sx * (bx / 2 + 0.0015) - (0.003 if sx < 0 else 0), y, z)))
    # 몸통 아래 원통(배터리·자석 받침)
    for x in (-0.11, 0.11):
        for y in (-0.09, 0.09):
            m.add("aluminum", move(cylinder(0.04, 0.05, 0.004, 32), (x, y, -bz / 2 - 0.05)))
    # 팔 받침
    m.add("aluminum", move(cylinder(0.068, 0.03, 0.003, 40), (0, 0, bz / 2)))
    m.add("graphite", move(cylinder(0.072, 0.008, 0.002, 40), (0, 0, bz / 2)))
    return m


def hip() -> Model:
    """요 축 하우징 + 피치 액추에이터(다리 좌표계: +X가 바깥)"""
    m = Model()
    m.add("aluminum", lathe([(0, 0), (0.05, 0), (0.05, 0.06), (0.044, 0.068), (0, 0.068)], 36))
    m.add("graphite", move(cylinder(0.052, 0.008, 0.002, 36), (0, 0, 0.0)))
    m.add("aluminum", move(rounded_box((0.05, 0.05, 0.05), 0.01), (0.012, 0, 0.085)))
    drum(m, 0.062, 0.08, 1, PITCH_OFFSET)
    return m


def thigh() -> Model:
    """허벅지(피치 축 원점): 카본 관 + 양 끝 알루미늄 칼라"""
    m = Model()
    d = _dir(THIGH_UP_DEG)
    m.add("carbon", seg(d, 0.05, THIGH_M - 0.05, 0.023))
    for t0, t1 in ((0.05, 0.09), (THIGH_M - 0.1, THIGH_M - 0.06)):
        m.add("aluminum", seg(d, t0, t1, 0.029))
    return m


def shin() -> Model:
    """정강이(무릎 축 원점): 무릎 액추에이터 + 카본 관 + 아래 알루미늄 하우징 + 발목 포크"""
    m = Model()
    drum(m, 0.074, 0.088, 1)
    d = _dir(SHIN_DEG)
    m.add("carbon", seg(d, 0.07, SHIN_M - 0.19, 0.023))
    m.add("aluminum", seg(d, 0.065, 0.105, 0.029))
    m.add("aluminum", seg(d, SHIN_M - 0.215, SHIN_M - 0.085, 0.033, 24))
    m.add("graphite", seg(d, SHIN_M - 0.165, SHIN_M - 0.155, 0.0335, 24))
    m.add("aluminum", seg(d, SHIN_M - 0.085, SHIN_M - 0.03, 0.019))
    end = d * SHIN_M
    for sy in (-1, 1):
        m.add("aluminum", move(rounded_box((0.03, 0.007, 0.05), 0.002), end + (0, sy * 0.02, 0.012)))
    return m


def ankle() -> Model:
    """발목 십자 블록(피치 핀)"""
    m = Model()
    m.add("aluminum", rounded_box((0.026, 0.026, 0.026), 0.004))
    m.add("graphite", ycyl(0.007, 0.05, 0, 16))
    return m


def foot() -> Model:
    """자석 발판(발목 축 원점. 바닥이 z = -ANKLE_ABOVE_FLOOR_M)"""
    m = Model()
    top = -ANKLE_ABOVE_FLOOR_M + 0.022
    m.add("graphite", move(rounded_box((0.15, 0.125, 0.022), 0.01), (0, 0, -ANKLE_ABOVE_FLOOR_M + 0.011)))
    m.add("aluminum", move(lathe([(0, 0), (0.034, 0), (0.034, 0.006), (0.024, 0.014), (0.024, 0.03), (0, 0.03)], 32), (0, 0, top)))
    for sx in (-1, 1):
        m.add("aluminum", move(rounded_box((0.007, 0.03, 0.045), 0.002), (sx * 0.018, 0, top + 0.03)))
    for x in (-0.058, -0.02, 0.02, 0.058):
        for y in (-0.046, 0.046):
            m.add("lens", move(cylinder(0.0045, 0.002, 0, 10), (x, y, top)))
    return m


def arm_links() -> dict[str, Model]:
    L: dict[str, Model] = {}

    def caps(m, r, length, at):
        for s in (-1, 1):
            m.add("graphite", move(ycyl(r * 0.92, 0.008, 0.002, 36), (at[0], at[1] + s * (length / 2 + 0.003), at[2])))

    m = L["arm_link_1"] = Model()
    m.add("cobot", lathe([(0, 0), (0.05, 0), (0.05, 0.07), (0, 0.07)], 40))
    m.add("cobot", move(ycyl(0.05, 0.11, 0.008, 40), (0, 0, 0.11)))
    caps(m, 0.05, 0.11, (0, 0, 0.11))
    m = L["arm_link_2"] = Model()
    m.add("cobot", tube([[0, 0, 0.04], [0, 0, 0.26]], 0.034, 28))
    m.add("cobot", move(ycyl(0.045, 0.095, 0.008, 36), (0, 0, 0.30)))
    caps(m, 0.045, 0.095, (0, 0, 0.30))
    m = L["arm_link_3"] = Model()
    m.add("cobot", tube([[0.04, 0, 0], [0.22, 0, 0]], 0.029, 28))
    m.add("cobot", xcyl(0.037, 0.07, 0.006, 36, start=0.2))
    m.add("graphite", xcyl(0.034, 0.008, 0.002, 36, start=0.268))
    m = L["arm_link_4"] = Model()
    m.add("cobot", move(ycyl(0.035, 0.08, 0.006, 32), (0.06, 0, 0)))
    caps(m, 0.035, 0.08, (0.06, 0, 0))
    m = L["arm_link_5"] = Model()
    m.add("cobot", xcyl(0.033, 0.07, 0.006, 32, start=0.0))
    m.add("graphite", xcyl(0.03, 0.008, 0.002, 32, start=0.068))
    m = L["arm_link_6"] = Model()
    m.add("aluminum", xcyl(0.028, 0.015, 0.002, 32))
    m = L["torch"] = Model()
    neck = mk.catmull_rom([[0, 0, 0], [0.05, 0, 0], [0.11, 0, -0.03], [0.15, 0, -0.11]], 8)
    m.add("graphite", tube(neck, 0.016, 16))
    m.add("graphite", xcyl(0.022, 0.03, 0.003, 24, start=0.0))
    m.add("brass", tube([[0.15, 0, -0.11], [0.159, 0, -0.127], [0.168, 0, -0.144]], 0.013, 16))
    return L


def links() -> dict[str, Model]:
    L: dict[str, Model] = {"base_link": body()}
    for leg in LEG_YAW_DEG:
        L[f"{leg}_hip"] = hip()
        L[f"{leg}_thigh"] = thigh()
        L[f"{leg}_shin"] = shin()
        L[f"{leg}_ankle"] = ankle()
        L[f"{leg}_foot"] = foot()
    L.update(arm_links())
    return L


def _f(v: float) -> str:
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _joint(name, parent, child, xyz, axis, lower, upper, rpy=(0, 0, 0), effort=60, velocity=3):
    o = " ".join(_f(v) for v in xyz)
    r = " ".join(_f(v) for v in rpy)
    a = " ".join(str(v) for v in axis)
    rpy_attr = f' rpy="{r}"' if any(rpy) else ""
    return (
        f'  <joint name="{name}" type="revolute">\n'
        f'    <parent link="{parent}"/><child link="{child}"/>\n'
        f'    <origin xyz="{o}"{rpy_attr}/><axis xyz="{a}"/>\n'
        f'    <limit lower="{_f(math.radians(lower))}" upper="{_f(math.radians(upper))}" effort="{effort}" velocity="{velocity}"/>\n'
        "  </joint>"
    )


def joints_xml() -> str:
    out = []
    for leg, yaw in LEG_YAW_DEG.items():
        sx, sy = LEG_SIGN[leg]
        out.append(_joint(f"{leg}_hip_yaw", "base_link", f"{leg}_hip", (sx * CORNER[0], sy * CORNER[1], BODY[2] / 2), (0, 0, 1), -60, 60, rpy=(0, 0, math.radians(yaw))))
        out.append(_joint(f"{leg}_hip_pitch", f"{leg}_hip", f"{leg}_thigh", PITCH_OFFSET, (0, 1, 0), -90, 70))
        out.append(_joint(f"{leg}_knee", f"{leg}_thigh", f"{leg}_shin", tuple(_dir(THIGH_UP_DEG) * THIGH_M), (0, 1, 0), -150, 150))
        out.append(_joint(f"{leg}_ankle_pitch", f"{leg}_shin", f"{leg}_ankle", tuple(_dir(SHIN_DEG) * SHIN_M), (0, 1, 0), -70, 70, effort=5))
        out.append(_joint(f"{leg}_ankle_roll", f"{leg}_ankle", f"{leg}_foot", (0, 0, 0), (1, 0, 0), -70, 70, effort=5))
    arm = [
        ("arm_1", "base_link", "arm_link_1", (0, 0, BODY[2] / 2 + 0.03), (0, 0, 1), -360, 360),
        ("arm_2", "arm_link_1", "arm_link_2", (0, 0, 0.11), (0, 1, 0), -360, 360),
        ("arm_3", "arm_link_2", "arm_link_3", (0, 0, 0.30), (0, 1, 0), -165, 165),
        ("arm_4", "arm_link_3", "arm_link_4", (0.27, 0, 0), (1, 0, 0), -360, 360),
        ("arm_5", "arm_link_4", "arm_link_5", (0.06, 0, 0), (0, 1, 0), -360, 360),
        ("arm_6", "arm_link_5", "arm_link_6", (0.076, 0, 0), (1, 0, 0), -360, 360),
    ]
    out += [_joint(*j, effort=30) for j in arm]
    out.append(
        '  <joint name="tool_joint" type="fixed">\n'
        '    <parent link="arm_link_6"/><child link="torch"/>\n'
        '    <origin xyz="0.015 0 0"/>\n'
        "  </joint>"
    )
    return "\n".join(out) + "\n"
