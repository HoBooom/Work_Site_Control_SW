"""MQTT 연결. 로봇(셀)마다 연결 하나 + 유언(status=offline), 명령·heartbeat를 받는 연결 하나.

- 보내는 메시지는 모두 계약으로 검사한다(어기면 예외: 서버가 계약을 어기지 않게).
- 브로커에 (다시) 붙으면 status=online과 지금 상태(retained)를 다시 보낸다(브로커가 다시 떠 retained가 비었을 수 있다).
- 정상 종료도 offline을 보낸다(유언은 비정상 종료에만 나간다).
paho의 콜백은 paho 스레드에서 온다. asyncio 루프로 넘겨 처리한다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
from collections.abc import Callable
from urllib.parse import urlparse

import paho.mqtt.client as paho

from .contracts import V, Contracts, now_ms

log = logging.getLogger("bus")


class ContractError(RuntimeError):
    pass


class Bus:
    def __init__(self, url: str, site: str, cells: list[str], contracts: Contracts, loop: asyncio.AbstractEventLoop):
        u = urlparse(url)
        self.host, self.port = u.hostname or "localhost", u.port or 1883
        self.site, self.cells, self.c, self.loop = site, cells, contracts, loop
        self.instance = secrets.token_hex(3)  # 같은 id로 다시 붙으면 브로커가 앞 연결을 끊는다(세션 인계): 실행마다 다르게
        self.clients: dict[str, paho.Client] = {}
        self.control: paho.Client | None = None
        self.on_cell_connect: Callable[[str], None] = lambda cell: None
        self.on_message: Callable[[str, bytes], None] = lambda topic, payload: None
        self.connected: dict[str, bool] = {}
        self._ready: dict[str, asyncio.Event] = {}
        self.stopped = False

    def _client(self, name: str) -> paho.Client:
        c = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=f"server-{self.site}-{name}-{self.instance}", clean_session=True)
        c.reconnect_delay_set(min_delay=1, max_delay=2)
        return c

    def _offline(self) -> str:
        return json.dumps({"v": V, "ts": now_ms(), "state": "offline"})

    async def start(self, timeout: float = 10) -> None:
        names = [*self.cells, "control"]
        self._ready = {n: asyncio.Event() for n in names}
        for cell in self.cells:
            c = self._client(cell)
            c.will_set(self.c.cell_topic(self.site, cell, "status"), self._offline(), qos=1, retain=True)
            c.on_connect = self._on_connect_cell(cell)
            c.on_disconnect = self._on_disconnect(cell)
            self.clients[cell] = c
        ctl = self._client("control")
        ctl.on_connect = self._on_connect_control
        ctl.on_disconnect = self._on_disconnect("control")
        ctl.on_message = lambda _c, _u, msg: self.loop.call_soon_threadsafe(self.on_message, msg.topic, msg.payload)
        self.control = ctl
        for c in [*self.clients.values(), ctl]:
            c.connect_async(self.host, self.port, keepalive=10)
            c.loop_start()
        await asyncio.wait_for(asyncio.gather(*(e.wait() for e in self._ready.values())), timeout)

    def _on_connect_cell(self, cell: str):
        def cb(_c, _u, _flags, reason, _props):
            if reason.is_failure:
                log.warning("%s 연결 실패: %s", cell, reason)
                return
            self.connected[cell] = True
            self.loop.call_soon_threadsafe(self._cell_up, cell)

        return cb

    def _cell_up(self, cell: str) -> None:
        if self.stopped:
            return
        self.publish(cell, {"suffix": "status", "payload": {"state": "online"}})
        self.on_cell_connect(cell)
        self._ready[cell].set()

    def _on_connect_control(self, c, _u, _flags, reason, _props):
        if reason.is_failure:
            return
        self.connected["control"] = True
        subs = [(t, 1) for t in self.c.subscriptions(self.site)]

        def on_sub(*_a):
            self.loop.call_soon_threadsafe(self._ready["control"].set)

        c.on_subscribe = on_sub
        c.subscribe(subs)

    def _on_disconnect(self, name: str):
        def cb(*_a):
            self.connected[name] = False
            if not self.stopped:
                log.warning("%s 브로커 연결 끊김(다시 붙는다)", name)

        return cb

    def publish(self, cell: str, msg: dict) -> None:
        suffix, payload = msg["suffix"], msg["payload"]
        spec = self.c.cell[suffix]
        body = {"v": V, "ts": now_ms(), **payload}
        errs = self.c.errors(spec.schema, body)
        if errs:
            raise ContractError(f"서버가 계약을 어겼다: {suffix} {errs}")
        c = self.clients.get(cell)
        if c is None or self.stopped:
            return
        c.publish(self.c.cell_topic(self.site, cell, suffix), json.dumps(body, ensure_ascii=False), qos=spec.qos, retain=spec.retained)

    async def close(self) -> None:
        """정상 종료: offline(retained)을 보내고 끊는다"""
        infos = []
        for cell, c in self.clients.items():
            if self.connected.get(cell):
                infos.append(c.publish(self.c.cell_topic(self.site, cell, "status"), self._offline(), qos=1, retain=True))
        self.stopped = True
        for info in infos:
            await asyncio.to_thread(info.wait_for_publish, 2)
        for c in [*self.clients.values(), *( [self.control] if self.control else [])]:
            c.disconnect()
            c.loop_stop()
