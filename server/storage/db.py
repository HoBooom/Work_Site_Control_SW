"""작업 저장: SQLite(작업·사건) + 파일(멈춘 프레임 PNG, 경로 NPY). 저장 위치는 data/(git 제외). server/docs/storage.md."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

import numpy as np

SCHEMA = """
create table if not exists tasks (
  task_id text primary key,
  site text not null,
  cell text not null,
  surface text,
  created_ts integer not null,
  updated_ts integer not null,
  state text not null,
  confidence real,
  edited integer not null default 0,
  result text,
  path_mm text,
  path_px text
);
create table if not exists events (
  id integer primary key autoincrement,
  ts integer not null,
  site text not null,
  cell text not null,
  task_id text,
  kind text not null,
  detail text
);
create index if not exists events_task on events(task_id);
"""


class Storage:
    def __init__(self, root: Path | None):
        self.root = root
        self._lock = threading.Lock()
        if root is None:
            self.db = sqlite3.connect(":memory:", check_same_thread=False)
        else:
            root.mkdir(parents=True, exist_ok=True)
            (root / "frames").mkdir(exist_ok=True)
            (root / "tasks").mkdir(exist_ok=True)
            self.db = sqlite3.connect(root / "server.sqlite", check_same_thread=False)
        self.db.executescript(SCHEMA)
        self.db.commit()

    def event(self, ts: int, site: str, cell: str, task_id: str | None, kind: str, detail: dict) -> None:
        with self._lock:
            self.db.execute("insert into events(ts, site, cell, task_id, kind, detail) values (?,?,?,?,?,?)", (ts, site, cell, task_id, kind, json.dumps(detail, ensure_ascii=False)))
            self.db.commit()

    def upsert_task(self, ts: int, site: str, cell: str, task_id: str, state: str, surface: str | None = None, proposal=None, result: str | None = None) -> None:
        with self._lock:
            row = self.db.execute("select task_id from tasks where task_id=?", (task_id,)).fetchone()
            if row is None:
                self.db.execute(
                    "insert into tasks(task_id, site, cell, surface, created_ts, updated_ts, state) values (?,?,?,?,?,?,?)",
                    (task_id, site, cell, surface, ts, ts, state),
                )
            self.db.execute("update tasks set updated_ts=?, state=? where task_id=?", (ts, state, task_id))
            if proposal is not None:
                self.db.execute(
                    "update tasks set confidence=?, edited=?, path_mm=?, path_px=? where task_id=?",
                    (proposal.confidence, int(proposal.edited), json.dumps(proposal.path), json.dumps(proposal.path_px), task_id),
                )
            if result is not None:
                self.db.execute("update tasks set result=? where task_id=?", (result, task_id))
            self.db.commit()
        if proposal is not None and self.root is not None:
            d = self.root / "tasks" / task_id
            d.mkdir(exist_ok=True)
            np.save(d / "path_mm.npy", np.array(proposal.path, dtype=np.float64))
            np.save(d / "path_px.npy", np.array(proposal.path_px, dtype=np.float64))

    def save_frame(self, frame_id: str, encoded: bytes, mime: str) -> None:
        if self.root is None:
            return
        ext = "png" if mime == "image/png" else "jpg"
        (self.root / "frames" / f"{frame_id}.{ext}").write_bytes(encoded)

    def load_frame(self, frame_id: str) -> tuple[bytes, str] | None:
        if self.root is None:
            return None
        for ext, mime in (("png", "image/png"), ("jpg", "image/jpeg")):
            p = self.root / "frames" / f"{frame_id}.{ext}"
            if p.exists():
                return p.read_bytes(), mime
        return None

    def tasks(self, limit: int = 50) -> list[dict]:
        with self._lock:
            cur = self.db.execute("select * from tasks order by created_ts desc limit ?", (limit,))
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        for r in rows:
            for k in ("path_mm", "path_px"):
                r[k] = json.loads(r[k]) if r[k] else None
            r["edited"] = bool(r["edited"])
        return rows

    def events(self, task_id: str) -> list[dict]:
        with self._lock:
            cur = self.db.execute("select ts, cell, kind, detail from events where task_id=? order by id", (task_id,))
            return [{"ts": ts, "cell": c, "kind": k, "detail": json.loads(d) if d else {}} for ts, c, k, d in cur.fetchall()]

    def close(self) -> None:
        with self._lock:
            self.db.close()
