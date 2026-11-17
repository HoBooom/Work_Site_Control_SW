"""픽스처(JSONL) 생성기. 손으로 고치지 말고 이 파일을 고친 뒤 다시 실행한다.

    python3 digital-twin/fixtures/make_fixtures.py           생성
    python3 digital-twin/fixtures/make_fixtures.py --check   파일이 생성기와 다르면 실패(L0)

한 줄 = {"t": 시나리오 ms, "topic": 토픽, "payload": 메시지}. payload는 contracts/schemas를 통과해야 한다.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
PREFIX = "innoworks"
T0 = 1_767_225_600_000  # 2026-01-01T00:00:00Z. payload.ts = T0 + t

HOME = {"joint_1": 0.0, "joint_2": -30.0, "joint_3": 30.0, "joint_4": 0.0, "joint_5": 45.0, "joint_6": 0.0}


def msg(t, site, cell, suffix, **payload):
    return {"t": t, "topic": f"{PREFIX}/{site}/{cell}/{suffix}", "payload": {"v": 1, "ts": T0 + t, **payload}}


def idle():
    """두 셀이 홈 자세로 정지, 작업 없음. 3초, robot/state 10Hz."""
    out = []
    cells = ["weld-cell-1", "weld-cell-2"]
    for c in cells:
        out.append(msg(0, "shipyard", c, "status", state="online"))
        out.append(msg(0, "shipyard", c, "task/state", state="idle", task_id=None))
    for t in range(0, 3001, 100):
        for c in cells:
            out.append(msg(t, "shipyard", c, "robot/state", joints=dict(HOME)))
    return out


FIXTURES = {"idle": idle}


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
