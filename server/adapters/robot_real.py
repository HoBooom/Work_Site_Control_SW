"""팀원 로봇 제어 어댑터. 팀원 코드는 이 파일 안에서만 import한다(CLAUDE.md 규칙).

연결할 때 할 일:
1. 팀원 제어 패키지를 의존성에 더한다.
2. execute: 면 좌표 mm 경로(contracts 좌표계)를 팀원 제어가 받는 좌표로 바꿔 넘긴다. 바로 돌아와야 한다(비동기 실행).
3. stop: 긴급정지. 예외를 내지 않고 가능한 한 빨리. 하드웨어 E-stop과 별개다(이것은 소프트웨어 정지).
4. get_state: 관절각(deg, URDF joint 이름) + 이동 로봇이면 base(사이트 좌표, m, 쿼터니언)·contacts. 서버가 10Hz로 부른다.
5. `--mock vision,camera`처럼 robot을 Mock 목록에서 빼면 이것을 쓴다.
"""
from __future__ import annotations

import os


class RealRobot:
    def __init__(self, endpoint: str | None = None):
        self.endpoint = endpoint or os.environ.get("WELD_ROBOT_ENDPOINT")
        try:
            import weld_robot  # type: ignore[import-not-found]  # 팀원 패키지(이름은 확인 필요)
        except ImportError as e:
            raise RuntimeError("로봇 제어 패키지(weld_robot)가 없다. 팀원 코드를 설치하거나 --mock robot으로 띄운다") from e
        self._client = weld_robot.connect(self.endpoint)

    def execute(self, cell, path_mm, surface):
        self._client.execute(cell, path_mm, surface=surface)

    def stop(self, cell):
        try:
            self._client.stop(cell)
        except Exception:  # noqa: BLE001  정지는 실패해도 위로 던지지 않는다(알람은 상태 머신이 이미 냈다)
            pass

    def reset(self, cell):
        self._client.home(cell)

    def progress(self, cell):
        p = self._client.progress(cell)
        return float(p["progress"]), bool(p["done"])

    def get_state(self, cell):
        s = self._client.state(cell)
        out = {"joints": dict(s["joints"])}
        for k in ("base", "contacts"):
            if s.get(k):
                out[k] = s[k]
        return out

    def close(self):
        self._client.close()
