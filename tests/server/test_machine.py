"""작업 상태 머신: 모든 전이와 거부(server/docs/state-machine.md). tools/mock/machine.test.mjs와 같은 표를 검사한다."""
import copy

import pytest

from task import machine as m

from conftest import OP, SEAM, assert_contract, new_unit


def states(out):
    return [x["payload"]["state"] for x in out if x["suffix"] == "task/state"]


def rejected(r):
    return not r.accepted and any(x["payload"].get("code") == "CMD_REJECTED" and x["payload"].get("cmd_id") == OP["cmd_id"] for x in r.out)


def effects(r, kind):
    return [e for e in r.effects if e[0] == kind]


def run(u, sub=1.0):
    r = m.command(u, "approve", {**OP, "task_id": u.task_id})
    assert r.accepted
    if sub >= 1:
        m.progress(u, 1.0, True)
    elif sub > 0:
        m.progress(u, sub, False)
    return r


def test_flow_ok(proposed):
    u = proposed
    r = m.command(u, "approve", {**OP, "task_id": u.task_id})
    assert_contract(r.out)
    assert states(r.out) == ["running"]
    assert effects(r, "execute")[0][1] == u.proposal.path, "승인하면 로봇에 mm 경로를 넘긴다"
    mid = m.progress(u, 0.5, False)
    assert_contract(mid.out)
    assert u.progress == pytest.approx(0.5)
    end = m.progress(u, 1.0, True)
    assert states(end.out) == ["completed"]
    r = m.command(u, "confirm", {**OP, "task_id": u.task_id, "result": "ok"})
    assert_contract(r.out)
    assert (u.state, u.task_id) == ("idle", None)
    assert ("record", "confirmed", {"task_id": "t-spider-1-0001", "result": "ok"}) in r.effects
    assert not effects(r, "propose")


def test_rework_reproposes(proposed):
    u = proposed
    run(u)
    r = m.command(u, "confirm", {**OP, "task_id": u.task_id, "result": "rework"})
    assert u.state == "idle"
    assert ("propose", "rework") in r.effects, "재작업이면 비전을 다시 불러 같은 자리를 제안한다"
    r2 = m.propose(u, SEAM, 0.8)
    assert u.state == "proposed" and u.task_id == "t-spider-1-0002"
    assert_contract(r2.out)


def test_edit_snap(proposed):
    u = proposed
    before = u.frame_id
    r = m.command(u, "edit_start", {**OP, "task_id": u.task_id})
    assert_contract(r.out)
    assert u.state == "editing" and u.frame_id != before
    assert effects(r, "freeze") == [("freeze", u.frame_id)]
    r = m.command(u, "drag", {**OP, "task_id": u.task_id, "frame_id": u.frame_id, "path_px": [[300, 252], [700, 240]]})
    assert r.accepted and effects(r, "snap"), "drag는 수렴을 맡긴다"
    r = m.apply_snap(u, u.frame_id, False, [[100, 450], [900, 450]], 0.1)
    assert_contract(r.out)
    assert u.state == "editing"
    assert any(x["payload"].get("alarm_id") == "spider-1-snap" and x["payload"]["active"] for x in r.out)
    path = [[300 + 50 * i, 245] for i in range(9)]
    r = m.apply_snap(u, u.frame_id, True, path, 1.0)
    assert_contract(r.out)
    assert u.state == "proposed"
    p = next(x for x in r.out if x["suffix"] == "task/proposal")["payload"]
    assert p["path_px"] == path and p["confidence"] == 0.97
    assert u.proposal.edited
    assert any(x["payload"].get("alarm_id") == "spider-1-snap" and x["payload"]["active"] is False for x in r.out)


def test_snap_after_state_change_is_dropped(proposed):
    u = proposed
    m.command(u, "edit_start", {**OP, "task_id": u.task_id})
    fid = u.frame_id
    m.command(u, "estop", {**OP})
    assert not m.apply_snap(u, fid, True, SEAM, 1.0).accepted, "수렴하는 사이에 정지하면 결과를 버린다"
    assert u.state == "estopped"


def test_edit_cancel(proposed):
    u = proposed
    before = copy.deepcopy(u.proposal)
    m.command(u, "edit_start", {**OP, "task_id": u.task_id})
    m.apply_snap(u, u.frame_id, False, [[100, 450], [900, 450]], 0.1)
    r = m.command(u, "edit_cancel", {**OP, "task_id": u.task_id})
    assert_contract(r.out)
    assert u.state == "proposed"
    assert next(x for x in r.out if x["suffix"] == "task/proposal")["payload"]["path_px"] == before.path_px
    assert any(x["payload"].get("alarm_id") == "spider-1-snap" and x["payload"]["active"] is False for x in r.out)
    assert rejected(m.command(u, "edit_cancel", {**OP, "task_id": u.task_id}))
    assert rejected(m.command(u, "edit_cancel", {**OP, "task_id": "t-old"}))


def setup_unit(state):
    u = new_unit()
    if state != "idle":
        m.propose(u, SEAM, 0.88)
    if state == "editing":
        m.command(u, "edit_start", {**OP, "task_id": u.task_id})
    if state in ("running", "completed"):
        run(u, 1.0 if state == "completed" else 0)
    assert u.state == state
    return u


@pytest.mark.parametrize("state", ["idle", "proposed", "editing", "running", "completed"])
def test_estop_resume(state):
    u = setup_unit(state)
    r = m.command(u, "estop", {**OP, "reason": "시험"})
    assert_contract(r.out)
    assert u.state == "estopped"
    assert any(x["payload"].get("code") == "ESTOP" and x["payload"]["active"] for x in r.out)
    assert effects(r, "stop"), "긴급정지는 로봇을 멈춘다"
    r = m.command(u, "resume", {**OP})
    assert_contract(r.out)
    assert u.state == ("idle" if state == "idle" else "proposed")
    assert any(x["payload"].get("code") == "ESTOP" and x["payload"]["active"] is False for x in r.out)


def test_estop_mid_run_reproposes_remaining_path(proposed):
    u = proposed
    full = copy.deepcopy(u.proposal.path_px)
    run(u, 0.5)
    m.command(u, "estop", {**OP})
    m.command(u, "resume", {**OP})
    assert u.state == "proposed"
    rest = u.proposal.path_px
    assert len(rest) == len(full)
    assert rest[0][0] == pytest.approx(500, abs=1), "남은 경로는 멈춘 곳(절반)에서 시작"
    assert rest[-1] == full[-1]
    # 남은 경로를 승인해 끝까지: 진행률은 전체 기준으로 50% → 100%
    m.command(u, "approve", {**OP, "task_id": u.task_id})
    assert u.progress == pytest.approx(0.5)
    m.progress(u, 0.5, False)
    assert u.progress == pytest.approx(0.75)
    m.progress(u, 1.0, True)
    assert u.state == "completed" and u.progress == 1.0


def test_pause_heartbeat(proposed):
    u = proposed
    assert not m.pause(u, "HEARTBEAT_LOST", "끊김").accepted, "실행 중이 아니면 그대로"
    run(u, 0)
    r = m.pause(u, "HEARTBEAT_LOST", "운영자 화면 응답 없음")
    assert_contract(r.out)
    assert u.state == "paused"
    assert any(x["payload"].get("alarm_id") == "spider-1-heartbeat" and x["payload"]["active"] for x in r.out)
    r = m.command(u, "resume", {**OP})
    assert_contract(r.out)
    assert u.state == "proposed"
    assert any(x["payload"].get("alarm_id") == "spider-1-heartbeat" and x["payload"]["active"] is False for x in r.out)


def test_pause_scene_change(proposed):
    u = proposed
    run(u, 0)
    r = m.pause(u, "SCENE_CHANGED", "장면 변화")
    assert any(x["payload"].get("alarm_id") == "spider-1-scene" for x in r.out)
    r = m.command(u, "resume", {**OP})
    assert any(x["payload"].get("alarm_id") == "spider-1-scene" and x["payload"]["active"] is False for x in r.out)


CASES = [
    ("idle", "approve"), ("idle", "edit_start"), ("idle", "confirm"), ("idle", "resume"),
    ("proposed", "drag"), ("proposed", "confirm"), ("proposed", "resume"), ("proposed", "edit_cancel"),
    ("editing", "approve"), ("editing", "confirm"),
    ("running", "approve"), ("running", "edit_start"), ("running", "confirm"), ("running", "edit_cancel"),
    ("completed", "approve"), ("completed", "edit_start"),
]


@pytest.mark.parametrize("state,cmd", CASES)
def test_rejections(state, cmd):
    u = setup_unit(state)
    r = m.command(u, cmd, {**OP, "task_id": u.task_id or "t-none", "frame_id": u.frame_id or "f", "path_px": [[0, 0], [1, 1]], "result": "ok"})
    assert_contract(r.out)
    assert rejected(r), f"{state}에서 {cmd}"
    assert u.state == state


def test_stale_task_and_frame(proposed):
    u = proposed
    assert rejected(m.command(u, "approve", {**OP, "task_id": "t-old"}))
    m.command(u, "edit_start", {**OP, "task_id": u.task_id})
    assert rejected(m.command(u, "drag", {**OP, "task_id": u.task_id, "frame_id": "f-old", "path_px": [[0, 0], [1, 1]]}))
