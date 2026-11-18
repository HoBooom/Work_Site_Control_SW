"""픽스처(JSONL) 생성기. 손으로 고치지 말고 이 파일을 고친 뒤 다시 실행한다.

    python3 digital-twin/fixtures/make_fixtures.py           생성
    python3 digital-twin/fixtures/make_fixtures.py --check   파일이 생성기와 다르면 실패(L0)

한 줄 = {"t": 시나리오 ms, "topic": 토픽, "payload": 메시지}. payload는 contracts/schemas를 통과해야 한다.
"""
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).parent
PREFIX = "innoworks"
T0 = 1_767_225_600_000  # 2026-01-01T00:00:00Z. payload.ts = T0 + t

# 대역 로봇(digital-twin/assets/robot/standin-6axis) 홈 자세: 상완 약간 앞, 전완 수평, 토치 아래쪽
HOME = {"joint_1": 0.0, "joint_2": 10.0, "joint_3": -10.0, "joint_4": 0.0, "joint_5": 60.0, "joint_6": 0.0}
ROBOT_HZ_MS = 100  # robot/state 10Hz


def msg(t, site, cell, suffix, **payload):
    return {"t": t, "topic": f"{PREFIX}/{site}/{cell}/{suffix}", "payload": {"v": 1, "ts": T0 + t, **payload}}


FACTORY = ("factory", ("weld-booth-1",))


def idle(site, cells):
    """모든 셀이 홈 자세로 정지, 작업 없음. 3초, robot/state 10Hz."""
    out = []
    for c in cells:
        out.append(msg(0, site, c, "status", state="online"))
        out.append(msg(0, site, c, "task/state", state="idle", task_id=None))
    for t in range(0, 3001, ROBOT_HZ_MS):
        for c in cells:
            out.append(msg(t, site, c, "robot/state", joints=dict(HOME)))
    return out


def weld_pose(p: float) -> dict:
    """작업 진행률 p(0~1)에 따른 대역 로봇 자세. IK가 아니라 그럴듯한 움직임이다(관절각은 서버가 준다)."""
    s = math.sin(math.pi * p)
    return {
        "joint_1": round(-15.0 + 30.0 * p, 3),
        "joint_2": round(10.0 + 8.0 * s, 3),
        "joint_3": round(-10.0 - 6.0 * s, 3),
        "joint_4": round(5.0 * math.sin(2 * math.pi * p), 3),
        "joint_5": round(60.0 + 4.0 * s, 3),
        "joint_6": 0.0,
    }


SEAM_T = "t-0001"
# 판 좌표(mm). 판 가운데를 가로지르는 살짝 휜 용접선
SEAM_PATH = [[round(100 + 100 * i, 1), round(250 + 30 * math.sin(math.pi * i / 8), 1)] for i in range(9)]


def weld_basic(site, cells):
    """첫 셀: 제안(0.5s) → 실행(2s~8s, 진행률 0.5s마다) → 완료(8s). 나머지 셀은 대기. 10초.

    실행 전에는 홈에서 시작 자세로 옮겨 가고, 완료 뒤에는 홈으로 돌아간다.
    """
    out = []
    c1, rest = cells[0], cells[1:]
    for c in cells:
        out.append(msg(0, site, c, "status", state="online"))
        out.append(msg(0, site, c, "task/state", state="idle", task_id=None))
    out.append(msg(500, site, c1, "task/state", state="proposed", task_id=SEAM_T))
    out.append(msg(500, site, c1, "task/proposal", task_id=SEAM_T, path=SEAM_PATH, confidence=0.87))
    out.append(msg(2000, site, c1, "task/state", state="running", task_id=SEAM_T))
    for t in range(2000, 8001, 500):
        out.append(msg(t, site, c1, "task/progress", task_id=SEAM_T, progress=round((t - 2000) / 6000, 4)))
    out.append(msg(8000, site, c1, "task/state", state="completed", task_id=SEAM_T))

    start, end = weld_pose(0.0), weld_pose(1.0)

    def lerp(a: dict, b: dict, k: float) -> dict:
        return {j: round(a[j] + (b[j] - a[j]) * k, 3) for j in a}

    for t in range(0, 10001, ROBOT_HZ_MS):
        if t < 1000:
            j1 = dict(HOME)
        elif t < 2000:
            j1 = lerp(HOME, start, (t - 1000) / 1000)
        elif t <= 8000:
            j1 = weld_pose((t - 2000) / 6000)
        elif t < 9000:
            j1 = lerp(end, HOME, (t - 8000) / 1000)
        else:
            j1 = dict(HOME)
        out.append(msg(t, site, c1, "robot/state", joints=j1))
        for c in rest:
            out.append(msg(t, site, c, "robot/state", joints=dict(HOME)))
    return out


def _robot_stream(out, site, cell, t_from, t_to, pose_at):
    for t in range(t_from, t_to + 1, ROBOT_HZ_MS):
        out.append(msg(t, site, cell, "robot/state", joints=pose_at(t)))


def _online_idle(out, site, cells):
    for c in cells:
        out.append(msg(0, site, c, "status", state="online"))
        out.append(msg(0, site, c, "task/state", state="idle", task_id=None))


# ---------- 조선소 블록 내부: 4족 이동 용접 로봇(ADR 0003) ----------
# 형상 값은 대역 로봇 URDF와 site-config에서 읽는다(손으로 두 번 적지 않는다).

ROOT = HERE.parent.parent
SPIDER_URDF = ROOT / "digital-twin" / "assets" / "robot" / "spider-welder" / "robot.urdf"
BLOCK_CONFIG = ROOT / "digital-twin" / "site-config" / "ship-block.json"
LEGS = ("fl", "fr", "rl", "rr")
TORCH_TIP = (0.168, 0.0, -0.144)  # 토치 링크 좌표계의 노즐 끝(digital-twin/assets/gen/spider.py torch)
WORK_ANGLE_DEG = 20.0  # 토치 기울기(전완 피치 합)
STANDOFF_M = 0.012  # 노즐 끝 ~ 강판 거리


def _urdf_joints():
    out = {}
    for j in ET.parse(SPIDER_URDF).getroot().iter("joint"):
        o = j.find("origin")
        xyz = [float(v) for v in o.get("xyz").split()]
        rpy = [float(v) for v in (o.get("rpy") or "0 0 0").split()]
        out[j.get("name")] = (xyz, rpy)
    return out


class Spider:
    """대역 4족 로봇의 기하(URDF에서). 몸통 좌표계: base_link, +X 앞, +Z 위."""

    def __init__(self):
        J = _urdf_joints()
        self.legs = {}
        for leg in LEGS:
            (hx, hy, _), (_, _, yaw) = J[f"{leg}_hip_yaw"]
            reach = J[f"{leg}_hip_pitch"][0][0] + J[f"{leg}_knee"][0][0] + J[f"{leg}_ankle_pitch"][0][0]
            self.legs[leg] = {"hip": (hx, hy), "yaw0": yaw, "reach": reach}
        self.shoulder_z = J["arm_1"][0][2] + J["arm_2"][0][2]  # arm_2 축 높이(몸통 기준)
        self.upper = J["arm_3"][0][2]
        self.fore = J["arm_4"][0][0] + J["arm_5"][0][0]  # arm_3 축 → arm_5 축
        tool_x = J["arm_6"][0][0] + J["tool_joint"][0][0] + TORCH_TIP[0]
        self.tool = (tool_x, TORCH_TIP[2])  # arm_5 축 → 노즐 끝(전완 방향, 위)
        self.stand_z = -min(  # 0° 자세에서 발판 바닥까지(몸통 중심 기준). spider.py STAND_HEIGHT_M
            J["fl_hip_yaw"][0][2] + J["fl_hip_pitch"][0][2] + J["fl_knee"][0][2] + J["fl_ankle_pitch"][0][2] - 0.075, 0
        )

    def foot0(self, leg):
        """0° 자세의 발(몸통 좌표, 수평)"""
        L = self.legs[leg]
        return (L["hip"][0] + L["reach"] * math.cos(L["yaw0"]), L["hip"][1] + L["reach"] * math.sin(L["yaw0"]))

    def hip_yaw_for(self, leg, foot_body):
        """발을 몸통 좌표 foot_body(수평)에 두는 hip_yaw(deg). 반경 차이는 무시한다(작다)"""
        L = self.legs[leg]
        a = math.atan2(foot_body[1] - L["hip"][1], foot_body[0] - L["hip"][0]) - L["yaw0"]
        return round(math.degrees(math.atan2(math.sin(a), math.cos(a))), 3) + 0.0

    def arm_ik(self, target):
        """몸통 좌표의 노즐 끝 목표 → arm_1~6(deg). 팔은 한 평면(arm_1 방위각) 안의 2링크 + 손목 피치. 팔꿈치 위."""
        x, y, z = target
        q1 = math.atan2(y, x)
        h = math.hypot(x, y)
        v = z - self.shoulder_z
        phi = math.radians(WORK_ANGLE_DEG)
        th, tv = self.tool
        # 손목 피치 합 phi만큼 아래로 돈 공구 벡터를 빼서 손목 중심을 구한다
        wh = h - (th * math.cos(phi) + tv * math.sin(phi))
        wv = v - (-th * math.sin(phi) + tv * math.cos(phi))
        a, b = self.upper, self.fore
        d = (wh * wh + wv * wv - a * a - b * b) / (2 * a * b)
        if abs(d) > 1:
            raise ValueError(f"팔이 닿지 않는다: {target}")
        g = math.acos(d)
        alpha = math.atan2(wv, wh) + math.atan2(b * math.sin(g), a + b * math.cos(g))
        beta = alpha - g
        q2 = math.pi / 2 - alpha
        psi = -beta
        q3 = psi - q2
        q5 = phi - psi
        deg = lambda r: round(math.degrees(r), 3) + 0.0  # -0.0을 0.0으로
        return {"arm_1": deg(q1), "arm_2": deg(q2), "arm_3": deg(q3), "arm_4": 0.0, "arm_5": deg(q5), "arm_6": 0.0}


def _quat_x(deg):
    a = math.radians(deg) / 2
    return [round(math.sin(a), 6), 0.0, 0.0, round(math.cos(a), 6)]


def _smooth(k):
    k = min(max(k, 0.0), 1.0)
    return k * k * (3 - 2 * k)


def _block():
    cfg = json.loads(BLOCK_CONFIG.read_text(encoding="utf-8"))
    surf = {s["id"]: s for s in cfg["surfaces"]}
    return cfg, surf


SPIDER_ZERO = {f"{l}_{j}": 0.0 for l in LEGS for j in ("hip_yaw", "hip_pitch", "knee", "ankle_pitch", "ankle_roll")} | {f"arm_{i}": 0.0 for i in range(1, 7)}
ALL_ON = {f"{l}_foot": True for l in LEGS}


def _wall_pose(sp, surf, x_site, z_site):
    """측면 외판(수직, 법선 -Y)에 붙은 몸통 자세. 로봇 +Z = 면 법선, 로봇 +X = 사이트 +X"""
    face_y = surf["pose"]["position_m"][1]
    return {"position_m": [x_site, round(face_y - sp.stand_z, 6), z_site], "orientation_xyzw": _quat_x(90), "surface": "side-shell"}


def _floor_pose(sp, surf, x, y):
    z = surf["pose"]["position_m"][2]
    return {"position_m": [round(x, 6), y, round(z + sp.stand_z, 6)], "orientation_xyzw": [0.0, 0.0, 0.0, 1.0], "surface": "bottom-shell"}


S1_START_X, S1_WORK_X, S1_Y = -0.9, 0.0, 1.2  # 스파이더 1: 론지 사이 통로(y 0.8~1.6)를 따라 걷는다
S2_X, S2_Z = 2.15, 1.07  # 스파이더 2: 측면 외판에 붙어 있다
SEAM1_Y_SITE = 0.812  # 론지(y=0.8) 웹과 외판의 필릿 용접선(로봇 쪽 토)
SEAM1_X = (-0.38, 0.38)
SEAM2_X_SITE = 1.612  # 늑판(x=1.6)과 측면 외판의 수직 용접선(로봇 쪽 토)
SEAM2_H = (380.0, 1080.0)  # 측면 외판 면 좌표 Y(mm)


def _seam1(surf):
    o = surf["pose"]["position_m"]
    return [[round((SEAM1_X[0] + (SEAM1_X[1] - SEAM1_X[0]) * i / 8 - o[0]) * 1000, 1), round((SEAM1_Y_SITE - o[1]) * 1000, 1)] for i in range(9)]


def _seam2(surf):
    o = surf["pose"]["position_m"]
    return [[round((SEAM2_X_SITE - o[0]) * 1000, 1), round(SEAM2_H[0] + (SEAM2_H[1] - SEAM2_H[0]) * i / 7, 1)] for i in range(8)]


def ship_block_idle():
    """스파이더 1은 바닥 외판 위에, 스파이더 2는 측면 외판에 붙어 정지. 작업 없음. 3초."""
    sp = Spider()
    _, surf = _block()
    site = "ship-block"
    out = []
    _online_idle(out, site, ("spider-1", "spider-2"))
    b1 = _floor_pose(sp, surf["bottom-shell"], S1_START_X, S1_Y)
    b2 = _wall_pose(sp, surf["side-shell"], S2_X, S2_Z)
    for t in range(0, 3001, ROBOT_HZ_MS):
        out.append(msg(t, site, "spider-1", "robot/state", joints=dict(SPIDER_ZERO), base=b1, contacts=dict(ALL_ON)))
        out.append(msg(t, site, "spider-2", "robot/state", joints=dict(SPIDER_ZERO), base=b2, contacts=dict(ALL_ON)))
    return out


GAIT_T_MS = 1000  # 트롯 한 주기. 대각 쌍이 반 주기씩 번갈아 든다
PAIR_OFFSET = {"fl": 0, "rr": 0, "fr": GAIT_T_MS // 2, "rl": GAIT_T_MS // 2}
WALK = (500, 3500)  # 스파이더 1 이동 시간(ms)


def _walk_x(t):
    return S1_START_X + (S1_WORK_X - S1_START_X) * _smooth((t - WALK[0]) / (WALK[1] - WALK[0]))


def _leg_state(sp, leg, t):
    """(발 월드 x, 들림 0~1, 붙음). 디딘 발은 강판에 고정되고, 드는 발은 다음 디딤 자리로 옮긴다."""
    fx0 = sp.foot0(leg)[0]
    half = GAIT_T_MS // 2
    start = WALK[0] + PAIR_OFFSET[leg]
    anchor = lambda k: _walk_x(start + k * GAIT_T_MS + half + half // 2) + fx0  # k번째 스윙 뒤 디딤 자리
    # 마지막 스윙 = 디딤 자리가 도착 위치가 되는 첫 스윙(그 뒤로는 들지 않는다)
    last_k = max(0, math.ceil((WALK[1] - start - half - half // 2) / GAIT_T_MS))
    if t < start:
        return _walk_x(WALK[0]) + fx0, 0.0, True
    k = min((t - start) // GAIT_T_MS, last_k)
    in_cycle = t - start - k * GAIT_T_MS
    before = anchor(k - 1) if k > 0 else _walk_x(WALK[0]) + fx0
    if k == last_k and in_cycle >= half or (t - start) // GAIT_T_MS > last_k:
        return anchor(last_k), 0.0, True
    if in_cycle < half:
        s = in_cycle / half
        return before + (anchor(k) - before) * _smooth(s), math.sin(math.pi * s), False
    return anchor(k), 0.0, True


def ship_block_weld():
    """스파이더 1: 론지 사이를 걸어 작업 위치로(0.5~3.5s) → 제안(4.5s) → 실행(5.5s, 토치가 용접선을 따라간다) → 완료(10.5s) → 팔 복귀.
    스파이더 2: 측면 외판에 붙어 수직 용접선 제안(0.5s)을 승인 대기. 12초."""
    sp = Spider()
    _, surf = _block()
    site, c1, c2 = "ship-block", "spider-1", "spider-2"
    out = []
    _online_idle(out, site, (c1, c2))
    seam1, seam2 = _seam1(surf["bottom-shell"]), _seam2(surf["side-shell"])
    out.append(msg(500, site, c2, "task/state", state="proposed", task_id="t-0201"))
    out.append(msg(500, site, c2, "task/proposal", task_id="t-0201", surface="side-shell", path=seam2, confidence=0.84))
    out.append(msg(4500, site, c1, "task/state", state="proposed", task_id="t-0101"))
    out.append(msg(4500, site, c1, "task/proposal", task_id="t-0101", surface="bottom-shell", path=seam1, confidence=0.91))
    out.append(msg(5500, site, c1, "task/state", state="running", task_id="t-0101"))
    WELD = (6000, 10500)
    for t in range(WELD[0], WELD[1] + 1, 500):
        out.append(msg(t, site, c1, "task/progress", task_id="t-0101", progress=round((t - WELD[0]) / (WELD[1] - WELD[0]), 4)))
    out.append(msg(WELD[1], site, c1, "task/state", state="completed", task_id="t-0101"))

    def tip_target(k):
        return _seam1_tip(sp, surf, k)

    seam_start = sp.arm_ik(tip_target(0.0))
    seam_end = sp.arm_ik(tip_target(1.0))
    blend = _blend
    zero_arm = dict(ZERO_ARM)
    for t in range(0, 12001, ROBOT_HZ_MS):
        j = dict(SPIDER_ZERO)
        contacts = dict(ALL_ON)
        bx = _walk_x(t) if t <= WALK[1] else S1_WORK_X
        for leg in LEGS:
            fx, lift, on = _leg_state(sp, leg, t)
            foot_body = (fx - bx, sp.foot0(leg)[1])
            j[f"{leg}_hip_yaw"] = sp.hip_yaw_for(leg, foot_body)
            j[f"{leg}_hip_pitch"] = round(-12.0 * lift, 3) + 0.0
            j[f"{leg}_knee"] = round(-14.0 * lift, 3) + 0.0
            contacts[f"{leg}_foot"] = on
        if t < 5500:
            arm = zero_arm
        elif t < WELD[0]:
            arm = blend(zero_arm, seam_start, (t - 5500) / (WELD[0] - 5500))
        elif t <= WELD[1]:
            arm = sp.arm_ik(tip_target((t - WELD[0]) / (WELD[1] - WELD[0])))
        else:
            arm = blend(seam_end, zero_arm, (t - WELD[1]) / 1000)
        j.update(arm)
        base = _floor_pose(sp, surf["bottom-shell"], bx, S1_Y)
        out.append(msg(t, site, c1, "robot/state", joints=j, base=base, contacts=contacts))
        out.append(msg(t, site, c2, "robot/state", joints=dict(SPIDER_ZERO), base=_wall_pose(sp, surf["side-shell"], S2_X, S2_Z), contacts=dict(ALL_ON)))
    return out


ZERO_ARM = {f"arm_{i}": 0.0 for i in range(1, 7)}


def _blend(a, b, k):
    return {j: round(a[j] + (b[j] - a[j]) * _smooth(k), 3) + 0.0 for j in a}


def _seam1_tip(sp, surf, k):
    """스파이더 1(작업 위치)이 용접선 1을 진행률 k만큼 갔을 때 노즐 끝 목표(몸통 좌표)"""
    shell_z = surf["bottom-shell"]["pose"]["position_m"][2]
    base_z = _floor_pose(sp, surf["bottom-shell"], S1_WORK_X, S1_Y)["position_m"][2]
    x = SEAM1_X[0] + (SEAM1_X[1] - SEAM1_X[0]) * k
    return (x - S1_WORK_X, SEAM1_Y_SITE - S1_Y, shell_z + STANDOFF_M - base_z)


class Block:
    """블록 픽스처 공통: 스파이더 1은 작업 위치(바닥 외판), 스파이더 2는 측면 외판. 시간표는 옛 조선소 셀 픽스처와 같다."""

    SITE, C1, C2 = "ship-block", "spider-1", "spider-2"

    def __init__(self):
        self.sp = Spider()
        _, self.surf = _block()
        self.b1 = _floor_pose(self.sp, self.surf["bottom-shell"], S1_WORK_X, S1_Y)
        self.b2 = _wall_pose(self.sp, self.surf["side-shell"], S2_X, S2_Z)
        self.seam = _seam1(self.surf["bottom-shell"])
        o = self.surf["bottom-shell"]["pose"]["position_m"]
        # 수렴 결과: 사용자가 그린 경로를 용접선 토(론지 웹 쪽)로 4mm 붙이고 끝을 살짝 늘렸다
        self.snap = [[round(x, 1), round(y - 4.0 - 3.0 * math.sin(math.pi * i / 8), 1)] for i, (x, y) in enumerate(self.seam)]

    def arm(self, k):
        return self.sp.arm_ik(_seam1_tip(self.sp, self.surf, min(max(k, 0.0), 1.0)))

    def s1(self, out, t, arm=None):
        out.append(msg(t, self.SITE, self.C1, "robot/state", joints=dict(SPIDER_ZERO) | (arm or ZERO_ARM), base=self.b1, contacts=dict(ALL_ON)))

    def s2(self, out, t):
        out.append(msg(t, self.SITE, self.C2, "robot/state", joints=dict(SPIDER_ZERO), base=self.b2, contacts=dict(ALL_ON)))

    def start(self):
        out = []
        _online_idle(out, self.SITE, (self.C1, self.C2))
        return out

    def propose(self, out, t, path, confidence, state="proposed"):
        out.append(msg(t, self.SITE, self.C1, "task/state", state=state, task_id=SEAM_T))
        out.append(msg(t, self.SITE, self.C1, "task/proposal", task_id=SEAM_T, surface="bottom-shell", path=path, confidence=confidence))


def ship_block_basic():
    """스파이더 1: 제안(0.5s) → 실행(2s~8s, 진행률 0.5s마다, 토치가 용접선을 따라간다) → 완료(8s). 스파이더 2는 대기. 10초.
    옛 weld-basic과 같은 시간표(DY-01~04, DY-06)."""
    b = Block()
    out = b.start()
    b.propose(out, 500, b.seam, 0.87)
    out.append(msg(2000, b.SITE, b.C1, "task/state", state="running", task_id=SEAM_T))
    for t in range(2000, 8001, 500):
        out.append(msg(t, b.SITE, b.C1, "task/progress", task_id=SEAM_T, progress=round((t - 2000) / 6000, 4)))
    out.append(msg(8000, b.SITE, b.C1, "task/state", state="completed", task_id=SEAM_T))
    start, end = b.arm(0.0), b.arm(1.0)
    for t in range(0, 10001, ROBOT_HZ_MS):
        if t < 1000:
            arm = ZERO_ARM
        elif t < 2000:
            arm = _blend(ZERO_ARM, start, (t - 1000) / 1000)
        elif t <= 8000:
            arm = b.arm((t - 2000) / 6000)
        elif t < 9000:
            arm = _blend(end, ZERO_ARM, (t - 8000) / 1000)
        else:
            arm = ZERO_ARM
        b.s1(out, t, arm)
        b.s2(out, t)
    return out


def ship_block_edit():
    """스파이더 1: 제안(0.5s) → 수정 시작(1.5s) → 수렴 결과(2.5s) → 수렴 경로로 다시 제안(3.5s). 6초. DY-04 수정 중, DY-07."""
    b = Block()
    out = b.start()
    b.propose(out, 500, b.seam, 0.62)
    out.append(msg(1500, b.SITE, b.C1, "task/state", state="editing", task_id=SEAM_T))
    out.append(msg(2500, b.SITE, b.C1, "task/snap", task_id=SEAM_T, surface="bottom-shell", ok=True, path=b.snap))
    b.propose(out, 3500, b.snap, 0.95)
    for t in range(0, 6001, ROBOT_HZ_MS):
        b.s1(out, t)
        b.s2(out, t)
    return out


def ship_block_alarm():
    """스파이더 1: 실행(1s~) 중 경고 알람(3s) → 치명 알람과 긴급정지(3.5s) → 치명 해제(5s) → 경고 해제(5.5s). 7초. DY-04 정지, DY-05."""
    b = Block()
    out = b.start()
    b.propose(out, 200, b.seam, 0.9)
    out.append(msg(1000, b.SITE, b.C1, "task/state", state="running", task_id=SEAM_T))
    for t in range(1000, 3501, 500):
        out.append(msg(t, b.SITE, b.C1, "task/progress", task_id=SEAM_T, progress=round((t - 1000) / 6000, 4)))
    out.append(msg(3000, b.SITE, b.C1, "alarm", alarm_id="a-1", severity="warning", code="SCENE_CHANGED", message="작업판 주변 장면 변화 감지", active=True))
    out.append(msg(3500, b.SITE, b.C1, "alarm", alarm_id="a-2", severity="critical", code="ESTOP", message="긴급정지", active=True))
    out.append(msg(3500, b.SITE, b.C1, "task/state", state="estopped", task_id=SEAM_T))
    out.append(msg(5000, b.SITE, b.C1, "alarm", alarm_id="a-2", severity="critical", code="ESTOP", message="긴급정지", active=False))
    out.append(msg(5500, b.SITE, b.C1, "alarm", alarm_id="a-1", severity="warning", code="SCENE_CHANGED", message="작업판 주변 장면 변화 감지", active=False))
    for t in range(0, 7001, ROBOT_HZ_MS):
        b.s1(out, t, b.arm(min((t - 1000) / 6000, 2500 / 6000)))
        b.s2(out, t)
    return out


def ship_block_offline():
    """스파이더 1 실행 중 서버 offline(4s, LWT) → 다시 online(6s, retained 상태 재발행). 8초. DY-08."""
    b = Block()
    out = b.start()
    b.propose(out, 200, b.seam, 0.9)
    out.append(msg(1000, b.SITE, b.C1, "task/state", state="running", task_id=SEAM_T))
    out.append(msg(3500, b.SITE, b.C1, "task/progress", task_id=SEAM_T, progress=0.4))
    out.append(msg(4000, b.SITE, b.C1, "status", state="offline"))
    out.append(msg(6000, b.SITE, b.C1, "status", state="online"))
    out.append(msg(6000, b.SITE, b.C1, "task/state", state="paused", task_id=SEAM_T))
    out.append(msg(6000, b.SITE, b.C1, "task/proposal", task_id=SEAM_T, surface="bottom-shell", path=b.seam, confidence=0.9))
    out.append(msg(6000, b.SITE, b.C1, "task/progress", task_id=SEAM_T, progress=0.4))
    for t in list(range(0, 3901, ROBOT_HZ_MS)) + list(range(6000, 8001, ROBOT_HZ_MS)):  # offline 동안 robot/state 없음
        b.s1(out, t, b.arm(min((t - 1000) / 6000, 0.4)))
    for t in range(0, 8001, ROBOT_HZ_MS):
        b.s2(out, t)
    return out


def ship_block_stale():
    """스파이더 1 robot/state가 3초~6초 끊겼다가 재개. 서버는 online. 8초. DY-09."""
    b = Block()
    out = b.start()
    for t in list(range(0, 3001, ROBOT_HZ_MS)) + list(range(6000, 8001, ROBOT_HZ_MS)):
        b.s1(out, t, b.arm((t % 4000) / 4000))
    for t in range(0, 8001, ROBOT_HZ_MS):
        b.s2(out, t)
    return out


FIXTURES = {
    # 제조공장(고정 로봇 셀 1개, M4)
    "factory-idle": lambda: idle(*FACTORY),
    "factory-weld-basic": lambda: weld_basic(*FACTORY),
    # 조선소 건조 도크 블록 내부, 4족 이동 용접 로봇(ADR 0003)
    "ship-block-idle": ship_block_idle,
    "ship-block-weld": ship_block_weld,
    "ship-block-basic": ship_block_basic,
    "ship-block-edit": ship_block_edit,
    "ship-block-alarm": ship_block_alarm,
    "ship-block-offline": ship_block_offline,
    "ship-block-stale": ship_block_stale,
}


def main():
    check = "--check" in sys.argv
    stale = []
    for name, make in FIXTURES.items():
        lines = sorted(make(), key=lambda m: m["t"])  # 안정 정렬: 같은 t는 생성 순서 유지
        path = HERE / f"{name}.jsonl"
        text = "".join(json.dumps(m, ensure_ascii=False) + "\n" for m in lines)
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(path.name)
            continue
        path.write_text(text, encoding="utf-8")
        print(f"{path.name}: {len(lines)} lines")
    if check:
        if stale:
            print(f"생성기와 다른 픽스처: {', '.join(stale)}. make_fixtures.py를 실행한다.", file=sys.stderr)
            sys.exit(1)
        print(f"픽스처 {len(FIXTURES)}개 최신")


if __name__ == "__main__":
    main()
