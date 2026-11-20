"""MockCamera: 로봇마다 그린 강판 그림 한 장을 늘 같은 영상으로 낸다(tools/mock/sites.json)."""
from __future__ import annotations

import json
import time

from adapters.base import Frame
from app.paths import MOCK_SITES

from .frames import make_frame


def mock_site(site: str) -> dict:
    sites = json.loads(MOCK_SITES.read_text("utf-8"))
    if site not in sites:
        raise ValueError(f"tools/mock/sites.json에 {site}가 없다")
    return sites[site]


class MockCamera:
    def __init__(self, site: str, cells: list[str]):
        m = mock_site(site)
        self._frames = {}
        for i, cell in enumerate(cells):
            if cell not in m:
                raise ValueError(f"tools/mock/sites.json {site}에 {cell}이 없다")
            c = m[cell]
            img, seam_px, H, png = make_frame(c["frame"], c["seam_mm"], seed=i + 1)
            self._frames[cell] = dict(image=img, png=png, seam_px=seam_px, H=H, surface=c.get("surface"))

    def cells(self) -> list[str]:
        return list(self._frames)

    def latest(self, cell: str) -> Frame:
        f = self._frames[cell]
        return Frame(cell, f["image"], int(time.time() * 1000), f["png"], "image/png", {"seam_px": f["seam_px"]})

    def calibration(self, cell: str) -> dict:
        f = self._frames[cell]
        return {"surface": f["surface"], "H": f["H"]}

    @property
    def static(self) -> bool:
        return True  # 영상이 바뀌지 않는다: /stream은 PNG 한 장

    def close(self) -> None:
        pass
