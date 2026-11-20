"""메트릭(vision/metrics): 추론 지연·신뢰도·외란 강도. 비전 어댑터가 따로 내는 값이 있으면 그것을, 없으면 서버가 잰 값을 쓴다."""
from __future__ import annotations


class Metrics:
    def __init__(self, alpha: float = 0.3):
        self.alpha = alpha
        self.latency: dict[str, float] = {}

    def infer_done(self, cell: str, latency_ms: float) -> None:
        prev = self.latency.get(cell)
        self.latency[cell] = latency_ms if prev is None else prev + self.alpha * (latency_ms - prev)

    def payload(self, cell: str, confidence: float, disturbance: float, model: dict | None) -> dict:
        latency = (model or {}).get("latency_ms", self.latency.get(cell, 0.0))
        dist = max(disturbance, (model or {}).get("disturbance", 0.0))
        return {"latency_ms": round(float(latency), 1), "confidence": round(float(confidence), 4), "disturbance": round(min(1.0, max(0.0, float(dist))), 2)}
