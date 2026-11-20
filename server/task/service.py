"""작업 조율: 상태 머신(task/machine.py)과 카메라·비전·수렴·로봇·안전·저장·메트릭을 잇는다.

MQTT를 직접 알지 못한다. 보낼 메시지는 publish(cell, {suffix, payload})로 넘기고, 받은 명령은 bus가 command()로 넘긴다.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable

from adapters.base import Camera, RobotAdapter, VisionAdapter
from camera.frames import FrameStore
from metrics.collector import Metrics
from safety.heartbeat import HeartbeatWatch
from safety.scene import SceneWatch
from snap.geometry import snap_to_polyline
from snap.livewire import SnapParams, snap
from storage.db import Storage

from . import machine as m

log = logging.getLogger("task")
PROGRESS_EVERY_MS = 500


def now_ms() -> int:
    return int(time.time() * 1000)


class Runtime:
    def __init__(
        self,
        site: str,
        camera: Camera,
        vision: VisionAdapter,
        robot: RobotAdapter,
        storage: Storage,
        *,
        propose_ms: int = 1500,
        heartbeat_timeout_ms: int = 3000,
        snap_params: SnapParams = SnapParams(),
    ):
        self.site = site
        self.camera, self.vision, self.robot, self.storage = camera, vision, robot, storage
        self.propose_ms = propose_ms
        self.snap_params = snap_params
        self.publish: Callable[[str, m.Msg], None] = lambda cell, msg: None
        self.units: dict[str, m.Unit] = {}
        for cell in camera.cells():
            cal = camera.calibration(cell)
            self.units[cell] = m.Unit(cell=cell, surface=cal.get("surface"), frame_size=camera.latest(cell).size, H=cal["H"])
        self.frames = FrameStore()
        self.prob: dict[str, object] = {}  # frame_id → 확률 맵(수렴에 쓴다)
        self.heartbeat = HeartbeatWatch(heartbeat_timeout_ms)
        self.scene = SceneWatch()
        self.metrics = Metrics()
        self._idle_since = {c: now_ms() for c in self.units}
        self._last_progress = {c: 0 for c in self.units}
        self._busy: set[str] = set()  # 제안을 만드는 중인 로봇
        self._queue: asyncio.Queue | None = None

    # 밖으로
    def _send(self, cell: str, msgs: list[m.Msg]) -> None:
        for msg in msgs:
            self.publish(cell, msg)

    def snapshot(self, cell: str) -> list[m.Msg]:
        return m.snapshot(self.units[cell])

    async def _apply(self, cell: str, r: m.Result) -> None:
        u = self.units[cell]
        self._send(cell, r.out)
        for eff in r.effects:
            kind = eff[0]
            if kind == "execute":
                self.robot.execute(cell, eff[1], u.surface)
            elif kind == "stop":
                self.robot.stop(cell)
            elif kind == "reset":
                self.robot.reset(cell)
            elif kind == "freeze":
                await self._freeze(cell, eff[1])
            elif kind == "snap":
                await self._snap(cell, eff[1], eff[2])
            elif kind == "propose":
                await self.propose(cell)
            elif kind == "record":
                self._record(cell, eff[1], eff[2])

    def _record(self, cell: str, kind: str, detail: dict) -> None:
        u = self.units[cell]
        task_id = detail.get("task_id", u.task_id)
        ts = now_ms()
        try:
            self.storage.event(ts, self.site, cell, task_id, kind, detail)
            if task_id:
                state = u.state if u.task_id == task_id else "idle"
                result = detail.get("result") if kind == "confirmed" else None
                self.storage.upsert_task(ts, self.site, cell, task_id, state, u.surface, u.proposal if u.task_id == task_id else None, result)
        except Exception:  # noqa: BLE001  저장이 실패해도 작업은 멈추지 않는다
            log.exception("저장 실패")

    async def _freeze(self, cell: str, frame_id: str) -> None:
        frame = self.camera.latest(cell)
        self.frames.put(frame_id, frame)
        self.storage.save_frame(frame_id, frame.encoded, frame.mime)
        # 멈춘 프레임의 확률 맵(수렴에 쓴다). 비전을 한 번 더 부른다
        vr = await asyncio.to_thread(self.vision.infer, frame)
        self.metrics.infer_done(cell, vr.latency_ms)
        self.prob[frame_id] = vr.prob

    async def _snap(self, cell: str, frame_id: str, drawn: list) -> None:
        u = self.units[cell]
        prob = self.prob.get(frame_id)
        if prob is not None:
            res = await asyncio.to_thread(snap, prob, tuple(u.frame_size), drawn, self.snap_params)
            ok, path, score = res.ok, res.path_px, res.score
        else:  # 확률 맵이 없는 모델: 제안 경로를 용접선으로 보고 붙인다
            ok, path, mean = snap_to_polyline((u.edit_from or u.proposal).path_px, drawn)
            score = max(0.0, 1 - mean / 40)
        log.info("%s 수렴 %s (점수 %.2f)", cell, "성공" if ok else "실패", score)
        await self._apply(cell, m.apply_snap(u, frame_id, ok, path, score))

    # 비전 제안
    async def propose(self, cell: str) -> None:
        u = self.units[cell]
        if u.state != "idle" or cell in self._busy:
            return
        self._busy.add(cell)
        try:
            frame = self.camera.latest(cell)
            vr = await asyncio.to_thread(self.vision.infer, frame)
            self.metrics.infer_done(cell, vr.latency_ms)
            r = m.propose(u, vr.path_px, vr.confidence)
            log.info("%s 제안 %s (신뢰도 %.2f)", cell, u.task_id, vr.confidence)
            if r.accepted:
                self.frames.put(u.frame_id, frame)
                self.prob[u.frame_id] = vr.prob
                self.storage.save_frame(u.frame_id, frame.encoded, frame.mime)
                await self._apply(cell, r)
        finally:
            self._busy.discard(cell)

    # 받은 것
    def submit(self, cell: str | None, name: str, payload: dict) -> None:
        """명령을 받은 순서대로 처리한다(수정 시작 → 드래그처럼 앞 명령의 결과가 필요하다). 긴급정지는 줄을 서지 않는다"""
        if name == "estop":
            asyncio.ensure_future(self.command(cell, name, payload))
            return
        if self._queue is None:
            self._queue = asyncio.Queue()
            asyncio.ensure_future(self._worker())
        self._queue.put_nowait((cell, name, payload))

    async def _worker(self) -> None:
        while True:
            cell, name, payload = await self._queue.get()
            try:
                await self.command(cell, name, payload)
            except Exception:  # noqa: BLE001
                log.exception("명령 처리 실패: %s %s", cell, name)

    async def command(self, cell: str | None, name: str, payload: dict) -> None:
        targets = list(self.units) if cell is None else [cell]
        for c in targets:
            u = self.units.get(c)
            if not u:
                continue
            r = m.command(u, name, payload)
            log.info("%s %s → %s", c, name, u.state if r.accepted else "거부")
            await self._apply(c, r)

    def invalid_command(self, cell: str | None, name: str, payload: object) -> None:
        cmd_id = payload.get("cmd_id") if isinstance(payload, dict) and isinstance(payload.get("cmd_id"), str) else None
        for c in list(self.units) if cell is None else [cell]:
            if c in self.units:
                self._send(c, [m.alarm(self.units[c], "warning", "CMD_REJECTED", f"{name} 거부: 계약에 맞지 않는 명령", cmd_id=cmd_id)])

    def operator_heartbeat(self, client: str, payload: dict) -> None:
        if payload.get("site") == self.site:
            self.heartbeat.beat(client, now_ms())

    # 시간 진행(100ms마다)
    async def tick(self) -> None:
        now = now_ms()
        for cell, u in self.units.items():
            if u.state != "idle":
                self._idle_since[cell] = now
            elif now - self._idle_since[cell] >= self.propose_ms:
                asyncio.ensure_future(self.propose(cell))
            if u.state == "running":
                sub, finished = self.robot.progress(cell)
                if finished or now - self._last_progress[cell] >= PROGRESS_EVERY_MS:
                    self._last_progress[cell] = now
                    await self._apply(cell, m.progress(u, sub, finished))
            if self.heartbeat.lost(now):
                silent = self.heartbeat.silent_ms(now) or 0
                await self._apply(cell, m.pause(u, "HEARTBEAT_LOST", f"운영자 화면 응답 없음({round(silent / 1000)}초)"))
            if not getattr(self.camera, "static", False):
                self.scene.update(cell, self.camera.latest(cell).image)
                if u.state == "running" and self.scene.changed(cell):
                    await self._apply(cell, m.pause(u, "SCENE_CHANGED", "카메라 장면이 크게 바뀌었다(사람·물체 진입?)"))
            state = self.robot.get_state(cell)
            if state:
                self.publish(cell, {"suffix": "robot/state", "payload": state})

    def metrics_tick(self) -> None:
        now = now_ms()
        for cell, u in self.units.items():
            conf = u.proposal.confidence if u.proposal else 0.0
            payload = self.metrics.payload(cell, conf, self.scene.level.get(cell, 0.0), self.vision.metrics(cell, now))
            self.publish(cell, {"suffix": "vision/metrics", "payload": payload})

    def frame(self, frame_id: str):
        f = self.frames.get(frame_id)
        if f is not None:
            return f.encoded, f.mime
        return self.storage.load_frame(frame_id)
