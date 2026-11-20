# Mock 어댑터와 실행 옵션

```
cd server && .venv/bin/python -m app [옵션]      # 또는 저장소 루트에서 npm run server -- [옵션]
```

| 옵션 | 기본 | 뜻 |
| --- | --- | --- |
| `--site` | ship-block | site-config와 `tools/mock/sites.json`의 사이트 |
| `--broker` | mqtt://localhost:1883 | MQTT 브로커(TCP) |
| `--http` | 8090 | 영상·프레임·API 포트(0이면 빈 포트) |
| `--mock` | vision,robot,camera | Mock으로 쓸 것. 빼면 실제 구현(`adapters/vision_real.py`, `adapters/robot_real.py`, `camera/device.py`) |
| `--propose-ms` | 1500 | 대기 뒤 제안까지 |
| `--run-ms` | 8000 | Mock 로봇 용접 시간 |
| `--heartbeat-timeout-ms` | 3000 | 운영자 화면 끊김 판정 |
| `--data` | `data/` | 저장 위치(`none`: 메모리) |
| `--fixed-metrics` | 꺼짐 | Mock 비전 메트릭 고정(70ms, 12%) |

준비가 끝나면 표준 출력에 `READY http=<포트>`.

| Mock | 하는 일 |
| --- | --- |
| `MockCamera` | 로봇마다 강판·용접선 그림 한 장(`mock/frames.py`, Node `tools/mock/frames.mjs`와 같은 그림). 캘리브레이션은 그림의 대응점 4쌍 |
| `MockVision` | 그림에 적어 둔 용접선을 제안(신뢰도 0.88), 둘레에 확률 맵(σ 4px, 절반 해상도). 지연·외란은 시간에 따라 흔들린다 |
| `MockRobot` | 픽스처(`sites.json`의 motion)의 robot/state를 자세 원본으로. 용접 중에는 진행률에 맞춰 재생, 정지하면 그 자리, 남은 경로만 이어서 |

실제 장비로 바꿀 때: `adapters/base.py`의 인터페이스를 팀원 코드로 채운다(각 `*_real.py` 머리말). 카메라 캘리브레이션은 `server/calib/{site}.json`.
