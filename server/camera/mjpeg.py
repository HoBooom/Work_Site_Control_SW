"""MJPEG(multipart/x-mixed-replace) 스트림. 실제 카메라처럼 영상이 바뀌면 이것으로 내보낸다(브라우저 <img>가 그대로 재생한다)."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable

BOUNDARY = "frame"
MEDIA_TYPE = f"multipart/x-mixed-replace; boundary={BOUNDARY}"


async def mjpeg(next_jpeg: Callable[[], bytes], fps: float = 10, is_closed: Callable[[], bool] = lambda: False) -> AsyncIterator[bytes]:
    while not is_closed():
        jpg = next_jpeg()
        yield b"--" + BOUNDARY.encode() + b"\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n"
        await asyncio.sleep(1 / fps)
