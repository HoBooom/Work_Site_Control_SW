"""HTTP: 영상(/stream/{cell}), 멈춘 프레임(/frames/{frame_id}), 상태 확인(/health), 작업 기록(/api/tasks), 웹 빌드 정적 서빙(/)."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from camera.mjpeg import MEDIA_TYPE, mjpeg
from task.service import Runtime

from .paths import WEB_DIST

NO_STORE = {"Cache-Control": "no-store"}


def make_http(rt: Runtime, bus_state: callable) -> FastAPI:
    api = FastAPI(title="welding-hitl server", docs_url="/api/docs", openapi_url="/api/openapi.json")
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

    @api.get("/stream/{cell}")
    async def stream(cell: str):
        if cell not in rt.units:
            raise HTTPException(404, "없음")
        if getattr(rt.camera, "static", False):  # 바뀌지 않는 영상(Mock)은 한 장
            f = rt.camera.latest(cell)
            return Response(f.encoded, media_type=f.mime, headers=NO_STORE)
        return StreamingResponse(mjpeg(lambda: rt.camera.latest(cell).encoded), media_type=MEDIA_TYPE, headers=NO_STORE)

    @api.get("/frames/{frame_id}")
    async def frame(frame_id: str):
        got = rt.frame(frame_id)
        if not got:
            raise HTTPException(404, "없음")
        data, mime = got
        return Response(data, media_type=mime, headers=NO_STORE)

    @api.get("/health")
    async def health():
        return {
            "site": rt.site,
            "bus": bus_state(),
            "units": {c: {"state": u.state, "task_id": u.task_id} for c, u in rt.units.items()},
            "heartbeat_silent_ms": rt.heartbeat.silent_ms(__import__("time").time() * 1000),
        }

    @api.get("/api/tasks")
    async def tasks(limit: int = 50):
        return rt.storage.tasks(limit)

    @api.get("/api/tasks/{task_id}/events")
    async def events(task_id: str):
        return rt.storage.events(task_id)

    if WEB_DIST.exists():  # 데모: 웹 빌드를 서버가 함께 낸다(npm run build -w frontend)
        api.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
    return api
