"""운영자 화면 heartbeat 감시. 한 번도 받지 못했으면(운영자 화면이 없으면) 끊김을 판정하지 않는다."""
from __future__ import annotations


class HeartbeatWatch:
    def __init__(self, timeout_ms: int = 3000):
        self.timeout_ms = timeout_ms
        self.last: dict[str, float] = {}  # 운영자 화면 client_id → 마지막으로 받은 시각

    def beat(self, client: str, now_ms: float) -> None:
        self.last[client] = now_ms

    def silent_ms(self, now_ms: float) -> float | None:
        """가장 최근 heartbeat 뒤로 지난 시간. 한 번도 없었으면 None"""
        if not self.last:
            return None
        return now_ms - max(self.last.values())

    def lost(self, now_ms: float) -> bool:
        s = self.silent_ms(now_ms)
        return s is not None and s > self.timeout_ms
