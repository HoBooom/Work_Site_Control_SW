"""어댑터 인터페이스. 팀원의 비전 모델·로봇 제어와 카메라는 이 모양으로만 서버를 만난다(contracts/docs/README.md "팀원 모듈과의 경계").

Mock(server/mock/)과 실제 구현(server/adapters/*_real.py, server/camera/)이 같은 인터페이스를 쓰고, 실행 옵션 --mock으로 바꾼다.
시그니처는 기획서 초안을 기본값으로 둔다. 팀원 쪽 사정으로 바뀌는 부분은 *_real.py 안에서 흡수한다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

Pt = list[float]


@dataclass
class Frame:
    """카메라 한 장. image는 (h, w, 3) uint8 RGB. encoded는 웹에 그대로 줄 수 있는 인코딩(PNG·JPEG)"""

    cell: str
    image: np.ndarray
    ts: int
    encoded: bytes = b""
    mime: str = "image/png"
    meta: dict = field(default_factory=dict)  # Mock만: 용접선 정답 등

    @property
    def size(self) -> list[int]:
        h, w = self.image.shape[:2]
        return [int(w), int(h)]


@dataclass
class VisionResult:
    """비전 추론 결과. path_px는 원본 프레임 픽셀의 용접선(시작 → 끝), prob는 용접선 확률 맵(h', w', 0~1, 프레임과 같은 비율)"""

    path_px: list[Pt]
    confidence: float
    prob: np.ndarray | None = None
    latency_ms: float = 0.0


class Camera(Protocol):
    def cells(self) -> list[str]: ...
    def latest(self, cell: str) -> Frame: ...
    def calibration(self, cell: str) -> dict:
        """{'surface': 면 id 또는 None, 'H': 픽셀 → 면 mm 호모그래피 9개}"""
        ...
    def close(self) -> None: ...


class VisionAdapter(Protocol):
    def infer(self, frame: Frame) -> VisionResult: ...
    def metrics(self, cell: str, now_ms: int) -> dict | None:
        """모델 쪽 메트릭이 따로 있으면 {'latency_ms', 'disturbance'}(없으면 None: 서버가 잰 값을 쓴다)"""
        ...


class RobotAdapter(Protocol):
    def execute(self, cell: str, path_mm: list[Pt], surface: str | None) -> None:
        """경로(면 좌표 mm)를 따라 용접을 시작한다. 바로 돌아오고 진행은 progress로 본다"""
        ...
    def stop(self, cell: str) -> None:
        """지금 동작을 멈춘다(긴급정지·일시정지). 가능한 한 빨리, 예외 없이"""
        ...
    def reset(self, cell: str) -> None:
        """작업을 끝내고 대기 자세로"""
        ...
    def progress(self, cell: str) -> tuple[float, bool]:
        """(지금 실행 경로 기준 진행률 0~1, 끝났는가)"""
        ...
    def get_state(self, cell: str) -> dict | None:
        """robot/state payload(v·ts 빼고): {'joints': {...}, 'base'?: {...}, 'contacts'?: {...}}"""
        ...
    def close(self) -> None: ...
