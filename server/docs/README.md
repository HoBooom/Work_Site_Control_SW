# 서버 개요

MIC-711D(Jetson)에서 도는 관제 서버다. 작업 상태의 기준을 들고, 카메라·비전 모델·로봇을 묶어 웹에 내보낸다. Python + FastAPI, 단일 프로세스(asyncio).

현재(2026-11-20): Mock 어댑터(vision·robot·camera)로 끝까지 동작한다. 관제 화면 L3 검사(`app.spec.ts`)를 Node Mock 서버와 같이 통과한다(ADR 0007). 실제 비전·로봇·카메라는 팀원 코드가 오면 `adapters/*_real.py`, `camera/device.py`에 붙인다.

## 실행

```
uv sync --project server                    # 처음 한 번(server/.venv)
npm run dev                                 # 브로커 + 이 서버(Mock 어댑터) + 프론트
npm run server -- --site ship-block         # 서버만(브로커가 떠 있어야 한다). 옵션은 mock.md
npm run test:server                         # 단위 검사(pytest, tests/server/)
WELD_SERVER=python npx playwright test -c digital-twin/harness/playwright.config.ts app.spec.ts   # 관제 화면 검사를 이 서버로
```

## 책임

- 작업 상태 머신을 유일한 기준으로 관리한다
- 카메라를 독점하고 같은 프레임을 스트리밍과 추론에 넘긴다
- 웹의 명령을 검증해서 받아들이거나 거부한다
- 드래그 경로를 용접선으로 수렴시킨다
- 연결이 끊기거나 이상이 생기면 로봇을 멈춘다
- 작업 데이터를 저장한다

## 외부와의 연결

| 채널 | 용도 |
| --- | --- |
| MQTT | 상태·명령·알람·메트릭 전부. 브로커는 개발 때 맥의 Mosquitto, 데모 때 Jetson |
| HTTP | 영상(`/stream/{cell}`: 실제 카메라는 MJPEG, Mock은 PNG 한 장), 멈춘 프레임(`/frames/{frame_id}`), `/health`, 작업 기록(`/api/tasks`), API 문서(`/api/docs`), 웹 빌드 정적 서빙(`frontend/dist`가 있으면 `/`) |
| 어댑터 | 팀원의 비전 모델·로봇 제어를 같은 프로세스에서 import |

기획서 초안의 WebSocket 채널은 MQTT로 바꾼다. 메시지 종류는 그대로이고 토픽으로 나뉠 뿐이다.

## 모듈

```
server/
├─ app/        __main__(시작점, 옵션), http(라우트), paths
├─ bus/        contracts(토픽 조립·스키마 검증), mqtt(셀별 연결 + LWT, 재접속 시 상태 재발행)
├─ task/       machine(상태 머신, 순수), service(명령 줄, 부수 효과 처리)
├─ camera/     frames(멈춘 프레임 보관), mjpeg, device(실제 카메라, OpenCV)
├─ snap/       livewire(확률 맵 수렴), geometry(호모그래피, 꺾은선)
├─ safety/     heartbeat 감시, scene(장면 변화)
├─ storage/    db(SQLite + PNG·NPY)
├─ metrics/    collector(추론 지연·신뢰도·외란)
├─ adapters/   base(인터페이스), vision_real, robot_real
└─ mock/       camera, frames, vision, robot
```

의존 방향: `app → task → (camera, snap, safety, storage, adapters)`, 모두가 `bus`를 통해서만 밖으로 말한다. `task`는 MQTT를 직접 알지 못한다.

## 데이터 흐름

```
카메라 ─ camera ─┬─ MJPEG ───────────────────────────→ 웹
                 └─ adapters.vision.infer ─→ task ─ bus ─→ task/proposal
웹 cmd/approve ─→ bus ─ task(검증) ─ adapters.robot.execute
                              └─ bus ─→ task/state, task/progress, alarm
adapters.robot.get_joints ─ bus ─→ robot/state (10~20Hz)
```

## 핵심 규칙

- 상태 전이는 `task/`에서만 일어난다. 허용되지 않는 상태에서 온 명령은 거부하고 알람을 낸다.
- `task/state`는 retained로 발행한다. 웹이 새로 접속해도 현재 상태를 바로 받는다.
- 서버가 죽으면 브로커가 `status = offline`을 대신 발행한다(LWT).
- 웹 heartbeat가 끊기면 작업 중인 로봇을 pause한다.
- 추론은 매 프레임이 아니라 경로 제안이 필요할 때만 부른다.
- Mock과 실제 구현은 같은 인터페이스를 쓰고 실행 옵션으로 바꾼다.

## 작업 순서

1. `bus/` + 스키마 검증, 빈 서버가 `status`를 발행 — 완료
2. `mock/` 세 개 + `camera/` MJPEG — 완료
3. `task/` 상태 머신 + 테스트(모든 전이와 거부 케이스) — 완료
4. 제안 → 승인 → 실행 → 완료 흐름을 Mock으로 끝까지 — 완료(L3)
5. `snap/` 경로 수렴 + 수정 흐름 — 완료
6. `safety/` (estop, heartbeat, 장면 변화) — 완료(장면 변화는 실제 카메라에서 확인 필요)
7. `storage/`, `metrics/` — 완료
8. `adapters/` 실제 구현 연결 — 자리만(팀원 코드 대기)

## 세부 문서

- [state-machine.md](state-machine.md) 상태와 전이 표
- [snap.md](snap.md) 수렴 알고리즘과 파라미터
- [safety.md](safety.md) 정지 조건
- [storage.md](storage.md) 저장 구조
- [mock.md](mock.md) 실행 옵션과 Mock 어댑터
