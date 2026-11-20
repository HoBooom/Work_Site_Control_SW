"""계약(contracts/)을 읽어 토픽 조립과 스키마 검증을 맡는다. 메시지 형식은 여기서 정의하지 않는다(contracts/schemas가 기준)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from functools import cached_property

from jsonschema import Draft7Validator

from app.paths import CONTRACTS

V = 1


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class TopicSpec:
    suffix: str
    schema: str
    qos: int
    retained: bool
    scopes: tuple[str, ...] = ("cell",)


class Contracts:
    def __init__(self) -> None:
        topics = json.loads((CONTRACTS / "topics.json").read_text("utf-8"))
        self.prefix: str = topics["prefix"]
        self.cell = {t["suffix"]: TopicSpec(t["suffix"], t["schema"], t["qos"], t["retained"]) for t in topics["cell_topics"]}
        self.commands = {
            t["suffix"]: TopicSpec(t["suffix"], t["schema"], t["qos"], t["retained"], tuple(t.get("scopes", ["cell"])))
            for t in topics["command_topics"]
        }
        self.operator = {t["suffix"]: TopicSpec(t["suffix"], t["schema"], t["qos"], t["retained"]) for t in topics["operator_topics"]}

    @cached_property
    def _validators(self) -> dict[str, Draft7Validator]:
        out = {}
        for f in (CONTRACTS / "schemas").glob("*.schema.json"):
            schema = json.loads(f.read_text("utf-8"))
            out[schema["$id"]] = Draft7Validator(schema)
        return out

    def errors(self, schema: str, body: object) -> list[str]:
        v = self._validators[schema]
        return [f"{'/'.join(map(str, e.path)) or '(root)'}: {e.message}" for e in v.iter_errors(body)]

    def valid(self, schema: str, body: object) -> bool:
        return not self.errors(schema, body)

    # 토픽
    def cell_topic(self, site: str, cell: str, suffix: str) -> str:
        return f"{self.prefix}/{site}/{cell}/{suffix}"

    def subscriptions(self, site: str) -> list[str]:
        return [f"{self.prefix}/{site}/+/cmd/#", f"{self.prefix}/{site}/cmd/#", f"{self.prefix}/operator/+/heartbeat"]

    def parse(self, site: str, topic: str) -> dict | None:
        """받은 토픽을 해석: {'kind': 'command', 'cell': str|None, 'name', 'spec'} 또는 {'kind': 'heartbeat', 'client'}"""
        parts = topic.split("/")
        if len(parts) < 3 or parts[0] != self.prefix:
            return None
        if parts[1] == "operator":
            if len(parts) == 4 and parts[3] in self.operator:
                return {"kind": "heartbeat", "client": parts[2], "spec": self.operator[parts[3]]}
            return None
        if parts[1] != site:
            return None
        site_scope = parts[2] == "cmd"
        suffix = "/".join(parts[2:] if site_scope else parts[3:])
        spec = self.commands.get(suffix)
        if not spec:
            return None
        if site_scope and "site" not in spec.scopes:
            return None
        return {"kind": "command", "cell": None if site_scope else parts[2], "name": suffix.removeprefix("cmd/"), "spec": spec}
