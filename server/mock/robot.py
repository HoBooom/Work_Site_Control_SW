"""MockRobot: 픽스처의 robot/state를 움직임 원본으로 쓴다. 대기 자세, 용접 구간(진행률에 맞춰 재생), 완료 자세."""
from __future__ import annotations

import json
import time

from app.paths import FIXTURES

from .camera import mock_site

RUN_MS = 8000


def motion_tracks(fixture: str) -> dict[str, list[tuple[int, dict]]]:
    out: dict[str, list] = {}
    for line in (FIXTURES / f"{fixture}.jsonl").read_text("utf-8").splitlines():
        if not line.strip():
            continue
        m = json.loads(line)
        if not m["topic"].endswith("/robot/state"):
            continue
        cell = m["topic"].split("/")[2]
        out.setdefault(cell, []).append((m["t"], m["payload"]))
    return out


def pose_at(track, t: float) -> dict | None:
    if not track:
        return None
    i = next((k for k, (ts, _) in enumerate(track) if ts > t), -1)
    if i == -1:
        return track[-1][1]
    if i == 0:
        return track[0][1]
    (ta, a), (tb, b) = track[i - 1], track[i]
    k = (t - ta) / (tb - ta)
    joints = {n: round((v + (b["joints"].get(n, v) - v) * k) * 1000) / 1000 for n, v in a["joints"].items()}
    return {**a, "joints": joints}


class MockRobot:
    def __init__(self, site: str, cells: list[str], run_ms: int = RUN_MS):
        m = mock_site(site)
        self.motion = m["motion"]
        self.tracks = motion_tracks(self.motion["fixture"])
        self.run_ms = run_ms
        self.units = {c: {"phase": "idle", "offset": 0.0, "start": 0.0, "sub": 0.0} for c in cells}
        self.executed: list[tuple[str, list]] = []  # 검사용: 받은 경로

    @staticmethod
    def _now() -> float:
        return time.time() * 1000

    def _sub(self, u) -> float:
        if u["phase"] != "running":
            return u["sub"]
        dur = max(1.0, self.run_ms * (1 - u["offset"]))
        return min(1.0, (self._now() - u["start"]) / dur)

    def execute(self, cell, path_mm, surface):
        u = self.units[cell]
        self.executed.append((cell, path_mm))
        u.update(phase="running", start=self._now(), sub=0.0)

    def stop(self, cell):
        u = self.units[cell]
        if u["phase"] == "running":
            sub = self._sub(u)
            u.update(phase="stopped", offset=u["offset"] + (1 - u["offset"]) * sub, sub=sub)

    def reset(self, cell):
        self.units[cell].update(phase="idle", offset=0.0, sub=0.0)

    def progress(self, cell):
        u = self.units[cell]
        sub = self._sub(u)
        if u["phase"] == "running" and sub >= 1:
            u.update(phase="done", sub=1.0)
            return 1.0, True
        return sub, u["phase"] == "done"

    def _motion_time(self, u) -> float:
        r0, r1 = self.motion["run"]
        if u["phase"] == "running":
            return r0 + (r1 - r0) * (u["offset"] + (1 - u["offset"]) * self._sub(u))
        if u["phase"] == "stopped" and u["offset"] > 0:
            return r0 + (r1 - r0) * u["offset"]
        if u["phase"] == "done":
            return self.motion["done_t"]
        return self.motion["idle_t"]

    def get_state(self, cell):
        pose = pose_at(self.tracks.get(cell), self._motion_time(self.units[cell]))
        if not pose:
            return None
        out = {"joints": pose["joints"]}
        for k in ("base", "contacts"):
            if pose.get(k):
                out[k] = pose[k]
        return out

    def close(self):
        pass
