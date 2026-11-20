"""MockVision: 그림을 그릴 때 적어 둔 용접선을 제안하고, 그 둘레에 확률 맵을 만든다."""
from __future__ import annotations

import math
import time

import numpy as np

from adapters.base import Frame, VisionResult
from snap.livewire import _dist_to_polyline

PROB_SCALE = 0.5  # 확률 맵은 프레임의 절반 크기(실제 모델의 출력 해상도를 흉내)
PROB_SIGMA_PX = 4.0


class MockVision:
    def __init__(self, confidence: float = 0.88, fixed_metrics: bool = False):
        self.confidence = confidence
        self.fixed_metrics = fixed_metrics
        self._prob: dict[str, np.ndarray] = {}

    def _prob_map(self, frame: Frame) -> np.ndarray:
        if frame.cell not in self._prob:
            w, h = frame.size
            pw, ph = int(w * PROB_SCALE), int(h * PROB_SCALE)
            Y, X = np.mgrid[0:ph, 0:pw].astype(float)
            d = _dist_to_polyline((X + 0.5) / PROB_SCALE, (Y + 0.5) / PROB_SCALE, frame.meta["seam_px"])
            self._prob[frame.cell] = np.exp(-(d * d) / (2 * PROB_SIGMA_PX**2)).astype(np.float32)
        return self._prob[frame.cell]

    def infer(self, frame: Frame) -> VisionResult:
        t0 = time.perf_counter()
        prob = self._prob_map(frame)
        path = [list(p) for p in frame.meta["seam_px"]]
        return VisionResult(path, self.confidence, prob, (time.perf_counter() - t0) * 1000)

    def metrics(self, cell: str, now_ms: int) -> dict:
        # 모델 추론 지연·외란이 시간에 따라 흔들리는 모양(tools/mock-server.mjs와 같은 식). fixed_metrics면 t=0(70ms, 12%)
        t = 0 if self.fixed_metrics else now_ms / 1000
        return {
            "latency_ms": round((70 + 15 * math.sin(t / 3) + 5 * math.sin(t * 1.7)) * 10) / 10,
            "disturbance": round((0.12 + 0.08 * math.sin(t / 5)) * 100) / 100,
        }
