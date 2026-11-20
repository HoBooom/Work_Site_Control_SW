"""관제 서버 시작점.

  python -m app [--site ship-block] [--broker mqtt://localhost:1883] [--http 8090] [--mock vision,robot,camera]
                [--propose-ms 1500] [--run-ms 8000] [--heartbeat-timeout-ms 3000] [--data ../data] [--fixed-metrics]

준비가 끝나면 표준 출력에 `READY http=<포트>` 한 줄을 쓴다(검사·실행 스크립트가 기다린다).
SIGTERM·SIGINT: 정상 종료(status=offline을 보내고 끊는다). 강제 종료되면 브로커가 유언(offline)을 보낸다.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
import sys
from pathlib import Path

import uvicorn

from bus.contracts import Contracts
from bus.mqtt import Bus
from storage.db import Storage
from task.service import Runtime

from .http import make_http
from .paths import DATA, SITE_CONFIG

log = logging.getLogger("app")


def parse(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m app", description="용접 관제 서버")
    p.add_argument("--site", default="ship-block")
    p.add_argument("--broker", default="mqtt://localhost:1883")
    p.add_argument("--http", type=int, default=8090, help="0이면 빈 포트")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--mock", default="vision,robot,camera", help="Mock으로 쓸 것(쉼표). 빼면 실제 어댑터")
    p.add_argument("--propose-ms", type=int, default=1500)
    p.add_argument("--run-ms", type=int, default=8000, help="Mock 로봇 용접 시간")
    p.add_argument("--heartbeat-timeout-ms", type=int, default=3000)
    p.add_argument("--data", default=str(DATA), help="저장 위치. 'none'이면 메모리만")
    p.add_argument("--fixed-metrics", action="store_true", help="Mock 비전 메트릭을 고정값으로(기준 화면)")
    p.add_argument("--log", default="info")
    return p.parse_args(argv)


def build(args: argparse.Namespace) -> Runtime:
    mocks = {m.strip() for m in args.mock.split(",") if m.strip()}
    config = json.loads((SITE_CONFIG / f"{args.site}.json").read_text("utf-8"))
    cells = [c["id"] for c in config["cells"]]
    if "camera" in mocks:
        from mock.camera import MockCamera

        camera = MockCamera(args.site, cells)
    else:
        from camera.device import DeviceCamera

        camera = DeviceCamera(args.site, cells)
    if "vision" in mocks:
        from mock.vision import MockVision

        vision = MockVision(fixed_metrics=args.fixed_metrics)
    else:
        from adapters.vision_real import RealVision

        vision = RealVision()
    if "robot" in mocks:
        from mock.robot import MockRobot

        robot = MockRobot(args.site, cells, run_ms=args.run_ms)
    else:
        from adapters.robot_real import RealRobot

        robot = RealRobot()
    storage = Storage(None if args.data == "none" else Path(args.data))
    return Runtime(args.site, camera, vision, robot, storage, propose_ms=args.propose_ms, heartbeat_timeout_ms=args.heartbeat_timeout_ms)


async def main(argv: list[str]) -> None:
    args = parse(argv)
    logging.basicConfig(level=args.log.upper(), format="[server] %(name)s %(message)s", stream=sys.stderr)
    loop = asyncio.get_running_loop()
    rt = build(args)
    contracts = Contracts()
    bus = Bus(args.broker, args.site, list(rt.units), contracts, loop)
    rt.publish = bus.publish
    bus.on_cell_connect = lambda cell: [bus.publish(cell, msg) for msg in rt.snapshot(cell)]

    def on_message(topic: str, raw: bytes) -> None:
        if bus.stopped:
            return
        what = contracts.parse(args.site, topic)
        if not what:
            return
        try:
            payload = json.loads(raw)
        except ValueError:
            return
        spec = what["spec"]
        if what["kind"] == "heartbeat":
            if contracts.valid(spec.schema, payload):
                rt.operator_heartbeat(what["client"], payload)
            return
        if not contracts.valid(spec.schema, payload):
            rt.invalid_command(what["cell"], what["name"], payload)
            return
        rt.submit(what["cell"], what["name"], payload)

    bus.on_message = on_message
    await bus.start()

    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    async def ticker():
        while not stop.is_set():
            try:
                await rt.tick()
            except Exception:  # noqa: BLE001
                log.exception("tick 실패")
            await asyncio.sleep(0.1)

    async def metrics():
        while not stop.is_set():
            rt.metrics_tick()
            await asyncio.sleep(1)

    http = uvicorn.Server(uvicorn.Config(make_http(rt, lambda: dict(bus.connected)), host=args.host, port=args.http, log_level="warning", lifespan="off"))
    http.install_signal_handlers = lambda: None  # 신호는 여기서 받는다
    serve = asyncio.ensure_future(http.serve())
    while not http.started:
        if serve.done():
            serve.result()
        await asyncio.sleep(0.02)
    port = http.servers[0].sockets[0].getsockname()[1]
    tasks = [asyncio.ensure_future(ticker()), asyncio.ensure_future(metrics())]
    print(f"READY http={port}", flush=True)
    log.info("서버: %s, 로봇 %d대, 영상 http://localhost:%d/stream/{cell}", args.site, len(rt.units), port)

    await stop.wait()
    log.info("종료")
    await bus.close()
    http.should_exit = True
    await serve
    for t in tasks:
        t.cancel()
    rt.robot.close()
    rt.camera.close()
    rt.storage.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
