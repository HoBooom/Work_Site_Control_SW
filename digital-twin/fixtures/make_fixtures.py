"""픽스처(JSONL) 생성기. 손으로 고치지 말고 이 파일을 고친 뒤 다시 실행한다.

    python3 digital-twin/fixtures/make_fixtures.py           생성
    python3 digital-twin/fixtures/make_fixtures.py --check   파일이 생성기와 다르면 실패(L0)

한 줄 = {"t": 시나리오 ms, "topic": 토픽, "payload": 메시지}. payload는 contracts/schemas를 통과해야 한다.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
PREFIX = "innoworks"
T0 = 1_767_225_600_000  # 2026-01-01T00:00:00Z. payload.ts = T0 + t

# 대역 로봇(digital-twin/assets/robot/standin-6axis) 홈 자세: 상완 약간 앞, 전완 수평, 토치 아래쪽
HOME = {"joint_1": 0.0, "joint_2": 10.0, "joint_3": -10.0, "joint_4": 0.0, "joint_5": 60.0, "joint_6": 0.0}
ROBOT_HZ_MS = 100  # robot/state 10Hz


def msg(t, site, cell, suffix, **payload):
    return {"t": t, "topic": f"{PREFIX}/{site}/{cell}/{suffix}", "payload": {"v": 1, "ts": T0 + t, **payload}}


SHIPYARD = ("shipyard", ("weld-cell-1", "weld-cell-2"))
FACTORY = ("factory", ("weld-booth-1",))


def idle(site=SHIPYARD[0], cells=SHIPYARD[1]):
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


def weld_basic(site=SHIPYARD[0], cells=SHIPYARD[1]):
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


SNAP_PATH = [[round(100 + 100 * i, 1), round(240 + 20 * math.sin(math.pi * i / 8), 1)] for i in range(9)]


def weld_edit():
    """셀 1: 제안(0.5s) → 수정 시작(1.5s) → 수렴 결과(2.5s) → 수렴 경로로 다시 제안(3.5s). 6초. DY-04 수정 중, DY-07."""
    out = []
    site, c1, c2 = "shipyard", "weld-cell-1", "weld-cell-2"
    _online_idle(out, site, (c1, c2))
    out.append(msg(500, site, c1, "task/state", state="proposed", task_id=SEAM_T))
    out.append(msg(500, site, c1, "task/proposal", task_id=SEAM_T, path=SEAM_PATH, confidence=0.62))
    out.append(msg(1500, site, c1, "task/state", state="editing", task_id=SEAM_T))
    out.append(msg(2500, site, c1, "task/snap", task_id=SEAM_T, ok=True, path=SNAP_PATH))
    out.append(msg(3500, site, c1, "task/state", state="proposed", task_id=SEAM_T))
    out.append(msg(3500, site, c1, "task/proposal", task_id=SEAM_T, path=SNAP_PATH, confidence=0.95))
    for c in (c1, c2):
        _robot_stream(out, site, c, 0, 6000, lambda t: dict(HOME))
    return out


def alarm():
    """셀 1: 실행(1s~) 중 경고 알람(3s) → 치명 알람과 긴급정지(3.5s) → 치명 해제(5s) → 경고 해제(5.5s). 7초. DY-04 정지, DY-05."""
    out = []
    site, c1, c2 = "shipyard", "weld-cell-1", "weld-cell-2"
    _online_idle(out, site, (c1, c2))
    out.append(msg(200, site, c1, "task/state", state="proposed", task_id=SEAM_T))
    out.append(msg(200, site, c1, "task/proposal", task_id=SEAM_T, path=SEAM_PATH, confidence=0.9))
    out.append(msg(1000, site, c1, "task/state", state="running", task_id=SEAM_T))
    for t in range(1000, 3501, 500):
        out.append(msg(t, site, c1, "task/progress", task_id=SEAM_T, progress=round((t - 1000) / 6000, 4)))
    out.append(msg(3000, site, c1, "alarm", alarm_id="a-1", severity="warning", code="SCENE_CHANGED", message="작업판 주변 장면 변화 감지", active=True))
    out.append(msg(3500, site, c1, "alarm", alarm_id="a-2", severity="critical", code="ESTOP", message="긴급정지", active=True))
    out.append(msg(3500, site, c1, "task/state", state="estopped", task_id=SEAM_T))
    out.append(msg(5000, site, c1, "alarm", alarm_id="a-2", severity="critical", code="ESTOP", message="긴급정지", active=False))
    out.append(msg(5500, site, c1, "alarm", alarm_id="a-1", severity="warning", code="SCENE_CHANGED", message="작업판 주변 장면 변화 감지", active=False))

    def pose(t):
        return weld_pose(min(max((t - 1000) / 6000, 0), (3500 - 1000) / 6000))

    _robot_stream(out, site, c1, 0, 7000, pose)
    _robot_stream(out, site, c2, 0, 7000, lambda t: dict(HOME))
    return out


def offline():
    """셀 1 실행 중 서버 offline(4s, LWT) → 다시 online(6s, retained 상태 재발행). 8초. DY-08."""
    out = []
    site, c1, c2 = "shipyard", "weld-cell-1", "weld-cell-2"
    _online_idle(out, site, (c1, c2))
    out.append(msg(200, site, c1, "task/state", state="proposed", task_id=SEAM_T))
    out.append(msg(200, site, c1, "task/proposal", task_id=SEAM_T, path=SEAM_PATH, confidence=0.9))
    out.append(msg(1000, site, c1, "task/state", state="running", task_id=SEAM_T))
    out.append(msg(3500, site, c1, "task/progress", task_id=SEAM_T, progress=0.4))
    out.append(msg(4000, site, c1, "status", state="offline"))
    # 다시 붙으면 retained 메시지가 다시 온다
    out.append(msg(6000, site, c1, "status", state="online"))
    out.append(msg(6000, site, c1, "task/state", state="paused", task_id=SEAM_T))
    out.append(msg(6000, site, c1, "task/proposal", task_id=SEAM_T, path=SEAM_PATH, confidence=0.9))
    out.append(msg(6000, site, c1, "task/progress", task_id=SEAM_T, progress=0.4))

    def pose(t):
        return weld_pose(min(max((t - 1000) / 6000, 0), 0.4))

    _robot_stream(out, site, c1, 0, 3900, pose)  # offline 동안 robot/state 없음
    _robot_stream(out, site, c1, 6000, 8000, pose)
    _robot_stream(out, site, c2, 0, 8000, lambda t: dict(HOME))
    return out


def stale():
    """셀 1 robot/state가 3초~6초 끊겼다가 재개. 서버는 online. 8초. DY-09."""
    out = []
    site, c1, c2 = "shipyard", "weld-cell-1", "weld-cell-2"
    _online_idle(out, site, (c1, c2))

    def pose(t):
        return weld_pose((t % 4000) / 4000)

    _robot_stream(out, site, c1, 0, 3000, pose)
    _robot_stream(out, site, c1, 6000, 8000, pose)
    _robot_stream(out, site, c2, 0, 8000, lambda t: dict(HOME))
    return out


FIXTURES = {
    "idle": idle,
    "weld-basic": weld_basic,
    "weld-edit": weld_edit,
    "alarm": alarm,
    "offline": offline,
    "stale": stale,
    # M4 공장 사이트(셀 1개)
    "factory-idle": lambda: idle(*FACTORY),
    "factory-weld-basic": lambda: weld_basic(*FACTORY),
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
