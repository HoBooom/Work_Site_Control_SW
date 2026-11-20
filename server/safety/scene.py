"""장면 변화 감지: 이웃한 카메라 프레임의 차이로 외란 강도(0~1)를 잰다. 용접 중 크게 바뀌면(사람·물체가 들어옴) 일시정지한다."""
from __future__ import annotations

import numpy as np


class SceneWatch:
    def __init__(self, threshold: float = 0.35, frames: int = 3, size: int = 64):
        self.threshold = threshold  # 이 강도를 frames장 연달아 넘으면 변화로 본다
        self.frames = frames
        self.size = size
        self._prev: dict[str, np.ndarray] = {}
        self._over: dict[str, int] = {}
        self.level: dict[str, float] = {}

    def _small(self, image: np.ndarray) -> np.ndarray:
        h, w = image.shape[:2]
        ys = np.linspace(0, h - 1, self.size).astype(int)
        xs = np.linspace(0, w - 1, self.size).astype(int)
        g = image[ys][:, xs].astype(np.float32)
        return g.mean(axis=2) if g.ndim == 3 else g

    def update(self, cell: str, image: np.ndarray) -> float:
        cur = self._small(image)
        prev = self._prev.get(cell)
        self._prev[cell] = cur
        if prev is None:
            self.level[cell] = 0.0
            return 0.0
        # 밝기 차이(0~255)를 0~1로. 60 정도 차이 나면 1
        level = float(min(1.0, np.mean(np.abs(cur - prev)) / 60))
        self.level[cell] = level
        self._over[cell] = self._over.get(cell, 0) + 1 if level > self.threshold else 0
        return level

    def changed(self, cell: str) -> bool:
        return self._over.get(cell, 0) >= self.frames
