"""팀원 비전 모델 어댑터. 팀원 코드는 이 파일 안에서만 import한다(CLAUDE.md 규칙).

연결할 때 할 일:
1. 팀원 패키지를 server/pyproject.toml 의존성에 더하거나 PYTHONPATH로 보인다.
2. 아래 _load()에서 모델을 불러오고, infer()에서 팀원 출력 → VisionResult로 바꾼다.
   - path_px: 원본 프레임 픽셀 [[x, y], ...] 시작 → 끝(모델이 축소 영상을 보면 여기서 원본 크기로 되돌린다)
   - prob: 용접선 확률 맵(0~1). 수렴(snap/livewire)이 쓴다. 없으면 서버는 제안 경로에 붙이는 단순 수렴으로 물러선다
   - confidence: 0~1
3. `python -m app --mock robot,camera`처럼 vision을 Mock 목록에서 빼면 이것을 쓴다.
"""
from __future__ import annotations

import os
import time

from adapters.base import Frame, VisionResult


class RealVision:
    def __init__(self, model_path: str | None = None):
        self.model_path = model_path or os.environ.get("WELD_VISION_MODEL")
        self._model = self._load()

    def _load(self):
        try:
            import weld_vision  # type: ignore[import-not-found]  # 팀원 패키지(이름은 확인 필요)
        except ImportError as e:
            raise RuntimeError("비전 모델 패키지(weld_vision)가 없다. 팀원 코드를 설치하거나 --mock vision으로 띄운다") from e
        return weld_vision.load(self.model_path)

    def infer(self, frame: Frame) -> VisionResult:
        t0 = time.perf_counter()
        out = self._model.predict(frame.image)  # 기획서 초안: {'path': [[x, y]...], 'confidence': float, 'prob': ndarray}
        return VisionResult(
            path_px=[[float(x), float(y)] for x, y in out["path"]],
            confidence=float(out["confidence"]),
            prob=out.get("prob"),
            latency_ms=(time.perf_counter() - t0) * 1000,
        )

    def metrics(self, cell: str, now_ms: int) -> dict | None:
        return None  # 서버가 잰 추론 지연과 장면 변화를 쓴다
