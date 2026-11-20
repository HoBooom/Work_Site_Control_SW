"""멈춘 프레임 보관(/frames/{frame_id}). 수정 모드에서 사람이 그 위에 그린다. 최근 것만 메모리에, 전부 storage에."""
from __future__ import annotations

from collections import OrderedDict

from adapters.base import Frame


class FrameStore:
    def __init__(self, keep: int = 64):
        self.keep = keep
        self._frames: OrderedDict[str, Frame] = OrderedDict()

    def put(self, frame_id: str, frame: Frame) -> None:
        self._frames[frame_id] = frame
        self._frames.move_to_end(frame_id)
        while len(self._frames) > self.keep:
            self._frames.popitem(last=False)

    def get(self, frame_id: str) -> Frame | None:
        return self._frames.get(frame_id)
