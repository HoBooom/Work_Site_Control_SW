"""실제 카메라(USB·GMSL, OpenCV). 서버가 카메라를 독점하고 같은 프레임을 스트리밍과 추론에 넘긴다.

로봇마다 장치 번호와 캘리브레이션(픽셀 → 면 mm 호모그래피)을 server/calib/{site}.json에 둔다:
  {"spider-1": {"device": 0, "surface": "bottom-shell", "H": [9개]}, ...}
캘리브레이션 절차는 contracts/docs/coordinates.md(예정).
"""
from __future__ import annotations

import json
import threading
import time

from adapters.base import Frame
from app.paths import ROOT


class DeviceCamera:
    def __init__(self, site: str, cells: list[str], fps: float = 15):
        try:
            import cv2  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError("OpenCV(cv2)가 없다. 엣지에서는 opencv-python을 설치하거나 --mock camera로 띄운다") from e
        self._cv2 = cv2
        calib = json.loads((ROOT / "server" / "calib" / f"{site}.json").read_text("utf-8"))
        self._calib = {c: calib[c] for c in cells}
        self._caps = {c: cv2.VideoCapture(calib[c]["device"]) for c in cells}
        self._last: dict[str, Frame] = {}
        self._stop = False
        self._fps = fps
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while not self._stop:
            for cell, cap in self._caps.items():
                ok, bgr = cap.read()
                if ok:
                    rgb = self._cv2.cvtColor(bgr, self._cv2.COLOR_BGR2RGB)
                    ok2, jpg = self._cv2.imencode(".jpg", bgr, [self._cv2.IMWRITE_JPEG_QUALITY, 80])
                    self._last[cell] = Frame(cell, rgb, int(time.time() * 1000), jpg.tobytes() if ok2 else b"", "image/jpeg")
            time.sleep(1 / self._fps)

    def cells(self):
        return list(self._caps)

    def latest(self, cell):
        f = self._last.get(cell)
        if f is None:
            raise RuntimeError(f"{cell} 카메라 프레임이 아직 없다")
        return f

    def calibration(self, cell):
        c = self._calib[cell]
        return {"surface": c.get("surface"), "H": c["H"]}

    @property
    def static(self) -> bool:
        return False

    def close(self):
        self._stop = True
        for cap in self._caps.values():
            cap.release()
