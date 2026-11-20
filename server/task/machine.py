"""작업 상태 머신(로봇 하나 = 작업 단위 하나). 상태 전이는 여기서만 일어난다. server/docs/state-machine.md.

순수 모듈: MQTT·카메라·로봇을 모른다. 입력(명령, 비전 제안, 수렴 결과, 로봇 진행률)을 받아 상태를 바꾸고
보낼 메시지 [{suffix, payload}]를 돌려준다(payload에 v·ts는 붙이지 않는다. bus가 붙인다).
부수 효과(로봇 실행·정지, 프레임 멈추기, 저장)는 결과의 effects로 알리고 task/service.py가 처리한다.
Mock 서버(tools/mock/machine.mjs)와 같은 표를 따른다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from snap.geometry import Pt, remaining, to_mm

Msg = dict[str, Any]

STATES = ("idle", "proposed", "editing", "running", "completed", "estopped", "paused")
NEED_TASK = ("edit_start", "edit_cancel", "drag", "approve", "confirm")
EDITED_CONFIDENCE_CAP = 0.97  # 사람이 고친 경로의 신뢰도 상한(수렴 점수가 1이어도 100%로 보이지 않게)


@dataclass
class Proposal:
    path_px: list[Pt]
    path: list[Pt]
    confidence: float
    edited: bool = False


@dataclass
class Unit:
    cell: str
    surface: str | None
    frame_size: list[int]
    H: list[float]  # 픽셀 → 면 mm
    state: str = "idle"
    task_id: str | None = None
    task_seq: int = 0
    frame_seq: int = 0
    frame_id: str | None = None
    proposal: Proposal | None = None
    progress: float = 0.0  # 이 작업 전체 경로 기준 0~1
    done: float = 0.0  # 앞서 용접을 끝낸 몫(정지 뒤 재개하면 남은 경로만 다시 제안한다)
    resume_to: str | None = None
    alarm_seq: int = 0
    edit_from: Proposal | None = None
    pause_code: str | None = None  # 일시정지 까닭(재개할 때 그 알람을 푼다)


@dataclass
class Result:
    accepted: bool
    out: list[Msg] = field(default_factory=list)
    effects: list[tuple] = field(default_factory=list)  # ('execute', path_mm) ('stop',) ('freeze', frame_id) ('record', kind, detail)


def state_msg(u: Unit) -> Msg:
    return {"suffix": "task/state", "payload": {"state": u.state, "task_id": u.task_id}}


def proposal_msg(u: Unit) -> Msg:
    p = u.proposal
    body = {"task_id": u.task_id, "path": p.path, "confidence": p.confidence, "frame_id": u.frame_id, "frame_size": u.frame_size, "path_px": p.path_px}
    if u.surface:
        body["surface"] = u.surface
    return {"suffix": "task/proposal", "payload": body}


def progress_msg(u: Unit) -> Msg:
    return {"suffix": "task/progress", "payload": {"task_id": u.task_id, "progress": round(u.progress, 4)}}


def alarm(u: Unit, severity: str, code: str, message: str, active: bool = True, alarm_id: str | None = None, cmd_id: str | None = None) -> Msg:
    if alarm_id is None:
        u.alarm_seq += 1
        alarm_id = f"{u.cell}-{code.lower()}-{u.alarm_seq}"
    body = {"alarm_id": alarm_id, "severity": severity, "code": code, "message": message, "active": active}
    if cmd_id:
        body["cmd_id"] = cmd_id
    return {"suffix": "alarm", "payload": body}


# 늘 같은 id로 띄우고 푸는 알람
def estop_id(u: Unit) -> str:
    return f"{u.cell}-estop"


def heartbeat_id(u: Unit) -> str:
    return f"{u.cell}-heartbeat"


def snap_id(u: Unit) -> str:
    return f"{u.cell}-snap"


def scene_id(u: Unit) -> str:
    return f"{u.cell}-scene"


def snap_cleared(u: Unit) -> Msg:
    return alarm(u, "info", "SNAP_FAILED", "수정 끝", False, snap_id(u))


def _new_frame(u: Unit) -> str:
    u.frame_seq += 1
    u.frame_id = f"f-{u.cell}-{u.frame_seq:05d}"
    return u.frame_id


def propose(u: Unit, path_px: list[Pt], confidence: float) -> Result:
    """비전 제안: 대기 중인 로봇에 새 작업을 연다"""
    if u.state != "idle":
        return Result(False)
    u.task_seq += 1
    u.task_id = f"t-{u.cell}-{u.task_seq:04d}"
    frame = _new_frame(u)
    u.proposal = Proposal([list(map(float, q)) for q in path_px], to_mm(u.H, path_px), round(float(confidence), 4))
    u.progress = u.done = 0.0
    u.state = "proposed"
    return Result(True, [state_msg(u), proposal_msg(u)], [("record", "proposed", {"frame_id": frame})])


def _reject(u: Unit, name: str, payload: dict, why: str) -> Result:
    return Result(False, [alarm(u, "warning", "CMD_REJECTED", f"{name} 거부: {why}", cmd_id=payload.get("cmd_id"))], [("record", "rejected", {"cmd": name, "why": why})])


def command(u: Unit, name: str, payload: dict) -> Result:
    """명령 하나. drag는 수렴 결과가 필요하다: service가 snap을 돌려 apply_snap을 부른다(여기서는 검증만)"""
    if name in NEED_TASK and payload.get("task_id") != u.task_id:
        return _reject(u, name, payload, f"지금 작업({u.task_id or '없음'})이 아니다")
    if name == "edit_start":
        if u.state != "proposed":
            return _reject(u, name, payload, f"{u.state} 상태")
        u.state = "editing"
        u.edit_from = u.proposal
        frame = _new_frame(u)  # 지금 프레임을 멈춘다
        return Result(True, [state_msg(u), proposal_msg(u)], [("freeze", frame)])
    if name == "drag":
        if u.state != "editing":
            return _reject(u, name, payload, f"{u.state} 상태")
        if payload.get("frame_id") != u.frame_id:
            return _reject(u, name, payload, f"멈춘 프레임({u.frame_id})이 아니다")
        return Result(True, [], [("snap", u.frame_id, payload["path_px"])])
    if name == "edit_cancel":
        if u.state != "editing":
            return _reject(u, name, payload, f"{u.state} 상태")
        u.state = "proposed"
        u.proposal = u.edit_from or u.proposal
        return Result(True, [state_msg(u), proposal_msg(u), snap_cleared(u)])
    if name == "approve":
        if u.state != "proposed":
            return _reject(u, name, payload, f"{u.state} 상태")
        u.state = "running"
        u.progress = u.done
        return Result(True, [state_msg(u), progress_msg(u)], [("execute", u.proposal.path), ("record", "approved", {"edited": u.proposal.edited})])
    if name == "confirm":
        if u.state != "completed":
            return _reject(u, name, payload, f"{u.state} 상태")
        result = payload.get("result")
        task = u.task_id
        u.state, u.task_id, u.proposal, u.progress, u.done = "idle", None, None, 0.0, 0.0
        effects = [("record", "confirmed", {"task_id": task, "result": result}), ("reset",)]
        if result == "rework":
            effects.append(("propose", "rework"))  # 같은 자리를 다시 제안(비전을 다시 부른다)
        return Result(True, [state_msg(u)], effects)
    if name == "estop":
        if u.state == "estopped":
            return Result(True)
        _hold(u)
        u.state = "estopped"
        reason = payload.get("reason")
        return Result(
            True,
            [state_msg(u), alarm(u, "critical", "ESTOP", f"긴급정지: {reason}" if reason else "긴급정지", True, estop_id(u))],
            [("stop",), ("record", "estop", {"reason": reason})],
        )
    if name == "resume":
        if u.state not in ("estopped", "paused"):
            return _reject(u, name, payload, f"{u.state} 상태")
        was_estop = u.state == "estopped"
        u.state = u.resume_to or "idle"
        if u.state == "idle":
            u.task_id = None
        u.resume_to = None
        out = [state_msg(u)]
        if u.state == "proposed":
            out.append(proposal_msg(u))
        if was_estop:
            out.append(alarm(u, "critical", "ESTOP", "긴급정지 해제", False, estop_id(u)))
        else:
            code = u.pause_code or "HEARTBEAT_LOST"
            out.append(alarm(u, "warning", code, "일시정지 해제", False, heartbeat_id(u) if code == "HEARTBEAT_LOST" else scene_id(u)))
        u.pause_code = None
        return Result(True, out, [("record", "resume", {})])
    return _reject(u, name, payload, "모르는 명령")


def _hold(u: Unit) -> None:
    """멈출 때: 하던 작업이 있으면 재개 뒤 승인 대기로. 용접하던 중이면 남은 경로만 다시 제안한다"""
    if u.state == "running" and u.proposal and u.progress > u.done:
        frac = (u.progress - u.done) / (1 - u.done) if u.done < 1 else 1.0
        rest = remaining(u.proposal.path_px, frac)
        u.proposal = Proposal(rest, to_mm(u.H, rest), u.proposal.confidence, u.proposal.edited)
        u.done = u.progress
    if u.state == "editing":
        u.proposal = u.edit_from or u.proposal
    u.resume_to = "proposed" if u.task_id else "idle"


def apply_snap(u: Unit, frame_id: str, ok: bool, path_px: list[Pt], score: float) -> Result:
    """수렴 결과. 성공이면 그 경로로 다시 승인 대기, 실패면 수정 중 그대로 + 알람"""
    if u.state != "editing" or frame_id != u.frame_id:
        return Result(False)  # 수렴하는 사이에 상태가 바뀌었다(정지 등)
    snap = {"suffix": "task/snap", "payload": {"task_id": u.task_id, "ok": ok, "path": to_mm(u.H, path_px), "frame_id": frame_id, "frame_size": u.frame_size, "path_px": path_px}}
    if u.surface:
        snap["payload"]["surface"] = u.surface
    if not ok:
        return Result(True, [snap, alarm(u, "info", "SNAP_FAILED", "그린 선이 용접선에서 멀다. 다시 그린다", True, snap_id(u))], [("record", "snap_failed", {"score": score})])
    u.proposal = Proposal(path_px, snap["payload"]["path"], round(min(EDITED_CONFIDENCE_CAP, score), 4), edited=True)
    u.done = 0.0  # 새로 그린 경로는 처음부터
    u.state = "proposed"
    return Result(True, [snap, state_msg(u), proposal_msg(u), snap_cleared(u)], [("record", "snapped", {"score": score})])


def pause(u: Unit, code: str, message: str) -> Result:
    """실행 중인 로봇을 일시정지(웹 heartbeat 끊김 HEARTBEAT_LOST, 장면 변화 SCENE_CHANGED)"""
    if u.state != "running":
        return Result(False)
    _hold(u)
    u.state = "paused"
    u.pause_code = code
    aid = heartbeat_id(u) if code == "HEARTBEAT_LOST" else scene_id(u)
    return Result(True, [state_msg(u), alarm(u, "warning", code, message, True, aid)], [("stop",), ("record", "paused", {"code": code})])


def progress(u: Unit, sub: float, finished: bool) -> Result:
    """로봇 진행률(지금 실행한 경로 기준 0~1). 끝났으면 completed"""
    if u.state != "running":
        return Result(False)
    u.progress = min(1.0, u.done + (1 - u.done) * max(0.0, min(1.0, sub)))
    out = [progress_msg(u)]
    if finished:
        u.progress = 1.0
        out = [progress_msg(u)]
        u.state = "completed"
        out.append(state_msg(u))
        return Result(True, out, [("record", "completed", {})])
    return Result(True, out)


def snapshot(u: Unit) -> list[Msg]:
    """처음 붙었을 때(또는 브로커에 다시 붙었을 때) 보낼 retained 상태"""
    out = [state_msg(u)]
    if u.proposal:
        out.append(proposal_msg(u))
    return out
