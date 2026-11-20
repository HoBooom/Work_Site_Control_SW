# 사용법

> 설치부터 화면 조작, 검사, 문제 해결까지. 무엇을 만드는지는 [overview.md](overview.md), 내부 구조는 [architecture.md](architecture.md).
> 명령은 모두 **저장소 루트**에서 실행한다.

목차: [1. 실행](#1-실행) · [2. 화면 구성](#2-화면-구성) · [3. 운영자 작업 따라 하기](#3-운영자-작업-따라-하기) · [4. 태블릿에서 열기](#4-태블릿에서-열기) · [5. 개발용 화면](#5-개발용-화면) · [6. 서버 단독 실행과 API](#6-서버-단독-실행과-api) · [7. 검사](#7-검사) · [8. 자주 하는 개발 작업](#8-자주-하는-개발-작업) · [9. 문제 해결](#9-문제-해결)

## 1. 실행

### 준비물

| 도구 | 버전 | 왜 | 설치(맥) |
| --- | --- | --- | --- |
| Node.js | 20 이상(개발은 20.17) | 프론트, 브로커, 검사 | `brew install node@20` |
| uv | 아무 최신 | 파이썬 서버 환경(Python 3.12~3.13을 알아서 받는다) | `brew install uv` |
| git | — | 저장소 | 맥 기본 |

uv가 없어도 `./init.sh mock`(Node Mock 서버)으로 화면은 볼 수 있다.

### 한 번에 실행

```bash
./init.sh
```

`init.sh`가 하는 일:

1. **도구 점검**: Node 20 이상, uv가 있는지 본다. 없으면 설치 방법을 알려 주고 멈춘다.
2. **의존성 설치**: `node_modules`가 없거나 잠금 파일보다 오래됐으면 `npm install`, 파이썬 환경이 잠금 파일(`server/uv.lock`)과 다르면 `uv sync`. 최신이면 건너뛴다.
3. **포트 점검**: 1883·9001(브로커), 8090(서버), 5173(프론트)을 누가 쓰고 있으면 PID와 함께 알려 준다.
4. **실행**: 브로커 + 관제 서버(Mock 장비) + 프론트를 함께 띄운다(`infra/dev.sh`). **Ctrl+C**로 셋 다 내려간다.

5~10초 뒤 브라우저로 **http://localhost:5173/** 를 연다.

### 실행 모드

| 명령 | 무엇이 뜨나 | 언제 |
| --- | --- | --- |
| `./init.sh` | 브로커 + **파이썬 서버**(Mock 장비, 사이트 `ship-block`) + 프론트 | 기본 |
| `./init.sh server factory` | 같은 구성, 사이트 `factory` | 공장 사이트를 볼 때 |
| `./init.sh mock` | 브로커 + **Node Mock 서버** + 프론트 | 파이썬 환경이 없을 때, 서버와 비교할 때 |
| `./init.sh play ship-block-weld` | 브로커 + **녹화본 반복 재생** + 프론트 | 서버 없이 트윈만 볼 때(버튼에는 응답이 없다) |
| `LAN=1 ./init.sh` | 프론트를 모든 네트워크 주소에 연다 | 태블릿에서 열 때(4절) |
| `MOCK=robot,camera ./init.sh` | 목록에서 뺀 장비(여기서는 vision)를 실제 어댑터로 | 팀원 코드를 붙일 때(8절) |
| `./init.sh --setup` | 설치만 | 처음 한 번, 오프라인 전에 |
| `./init.sh --check` | 점검만(설치·실행 없음) | 무엇이 모자란지 볼 때 |

`npm run dev`도 같은 실행 부분(`infra/dev.sh`)을 부른다. 다만 설치·점검은 하지 않는다.

### 주소

| 화면 | 주소 |
| --- | --- |
| 관제 화면 | http://localhost:5173/ (사이트 고르기: `?site=factory`) |
| 트윈 랩(실시간) | http://localhost:5173/lab?site=ship-block&source=mqtt |
| 로봇 랩 | http://localhost:5173/lab/robot |
| 서버 API 문서 | http://localhost:8090/api/docs (파이썬 서버만) |

## 2. 화면 구성

```
┌ 상태 줄: 로고 · 사이트 이름 ······················· 시계 · 연결 상태 · 운영자 ┐
│ 사이드 패널          │손│ 3D 트윈                          [전경|스파이더 1|2] │
│  로봇을 안 골랐으면   │잡│  ┌ 알람 카드 ┐                                    │
│   → 로봇 카드 목록    │이│  └──────────┘                                     │
│  골랐으면 → 로봇 패널 │  │            (브로커가 끊기면 아래에 안내 띠)          │
├ 하단 독: [스파이더 1][스파이더 2][알람 n] ··················· [전체 긴급정지] ┤
```

| 부분 | 하는 일 |
| --- | --- |
| 상태 줄 | 사이트 이름, 시계, 브로커 연결 상태, 이 브라우저의 운영자 id |
| 3D 트윈 | 현장 3D. 로봇을 누르면 고른다. 드래그로 돌리고 휠·핀치로 확대. 오른쪽 위 버튼으로 카메라 프리셋(고른 로봇을 따라간다) |
| 로봇 패널 | 큰 숫자(실행 중·완료·정지면 진행률, 그 밖에는 AI 신뢰도), 상태 배지, 카메라 영상 + 경로, 메트릭(신뢰도·추론 지연·외란 강도), 안내 띠, 큰 작업 버튼, 머리의 **이 로봇 정지** |
| 손잡이 | 끌어서 패널 폭을 바꾼다. 두 번 누르면 좁게/반반. 키보드 좌우 화살표도 된다 |
| 알람 카드 | 활성 알람(치명이 위, 최신이 위). 누르면 그 로봇 패널이 열린다 |
| 하단 독 | 로봇 버튼(상태 글자 포함), 알람 열기·닫기, **전체 긴급정지**(늘 보인다) |

세로 화면에서는 트윈이 위, 패널이 아래로 간다.

색 규칙: **파랑은 주 동작**(승인하고 용접 시작, 합격), **빨강은 멈춤**(긴급정지, 정지 상태, 치명 알람)에만 쓴다. 영상 위 경로는 제안 빨강, 수정 중 노랑, 수렴 실패 주황, 완료 초록이다.

## 3. 운영자 작업 따라 하기

`./init.sh`로 띄운 Mock 환경에서 그대로 따라 할 수 있다. Mock 로봇은 용접에 8초쯤 걸린다.

### 상태별 버튼

버튼은 **서버가 보낸 상태로만** 켜진다. 누른 뒤 서버가 답할 때까지 버튼이 잠깐 잠긴다(화면을 미리 바꾸지 않는다).

| 상태(배지) | 안내 띠 | 작업 버튼 |
| --- | --- | --- |
| 대기 `idle` | AI 경로 제안을 기다리는 중 | — |
| 승인 대기 `proposed` | 제안 경로를 확인하고 승인하거나 수정한다 | 수정 · **승인하고 용접 시작** |
| 수정 중 `editing` | 영상 위에 용접선을 따라 다시 그린다 | 수정 취소 |
| 용접 중 `running` | 용접 중 | — |
| 확인 대기 `completed` | 용접이 끝났다. 결과를 확인한다 | 재작업 · **합격** |
| 일시정지 `paused` / 긴급정지 `estopped` | 확인 뒤 재개한다 | 재개 |
| 오프라인 | 서버와 연결이 끊겼다 | 모두 막힘 |

**이 로봇 정지**는 긴급정지·오프라인이 아니면 늘 누를 수 있다.

### 따라 하기

1. **로봇 고르기**: 3D 트윈에서 로봇을 누르거나, 패널의 로봇 카드, 하단 독의 로봇 버튼을 누른다. 1.5초쯤 뒤 **승인 대기**가 되고 영상 위에 붉은 제안 선이 뜬다.
2. **승인**: **승인하고 용접 시작**. 트윈에서 로봇이 움직이고(토치에 아크), 큰 숫자가 진행률로 바뀌어 오른다.
3. **결과 확인**: **확인 대기**가 되면 **합격**(기록하고 대기로, 곧 다음 제안) 또는 **재작업**(같은 자리를 새 작업으로 다시 제안).
4. **수정**:
   1. 승인 대기에서 **수정** → 영상이 멈추고 테두리가 노랗게 바뀐다("프레임 정지 · 여기에 그리기").
   2. 마우스나 손가락으로 **용접선을 따라** 긋고 손을 뗀다. 손을 뗄 때 한 번만 서버로 간다(짧게 톡 친 것은 보내지 않는다).
   3. 성공: 서버가 실제 용접선에 맞춘 경로로 다시 **승인 대기**. 신뢰도는 수렴 점수로 바뀐다.
   4. 실패(용접선에서 먼 선): **수정 중** 그대로, 주황 선과 "수렴 실패" 알람. 붉은 점선 가까이 다시 긋는다.
   5. 그만두려면 **수정 취소** → 수정 전 제안으로 돌아간다.
5. **정지와 재개**:
   - **이 로봇 정지**: 그 로봇만 긴급정지. **전체 긴급정지**: 사이트의 모든 로봇. 확인 창 없이 바로 간다.
   - **재개**: 하던 작업이 있으면 승인 대기로(용접 중에 멈췄다면 **남은 경로만** 제안, 진행률은 이어진다), 없으면 대기로.
6. **알람**: 하단 독의 **알람 n**으로 카드를 연다. 알람을 누르면 그 로봇 패널로 간다. 해결되면(재개 등) 알람이 사라진다.
   - `ESTOP` 긴급정지(치명) · `HEARTBEAT_LOST` 운영자 화면 끊김으로 일시정지 · `SCENE_CHANGED` 카메라 장면이 크게 바뀌어 일시정지(실제 카메라) · `SNAP_FAILED` 수렴 실패 · `CMD_REJECTED` 서버가 명령을 거부(이미 지난 작업에 대한 명령 등)
7. **끊김 표시**:
   - 브로커가 끊기면: 트윈이 회색, 아래에 안내 띠. 다시 붙으면 사라지고 서버가 지금 상태를 다시 보낸다.
   - 서버가 죽으면: 로봇이 **오프라인**, 버튼이 막힌다. 서버가 돌아오면 복구.
   - 용접 중에 브라우저 탭을 닫으면(운영자 화면 끊김) 3초 뒤 서버가 그 로봇을 **일시정지**한다.

## 4. 태블릿에서 열기

```bash
LAN=1 ./init.sh
```

`init.sh`가 맥의 주소를 찍어 준다(예: `http://192.168.0.12:5173/`). 맥과 같은 와이파이의 태블릿 브라우저로 연다. 맥 방화벽이 Node 연결을 물으면 허용한다.

태블릿에서 볼 것: 손가락으로 수정 선 긋기(그리는 동안 페이지가 스크롤되지 않아야 한다), 버튼 크기(주 버튼 64px), 가로·세로 배치.

## 5. 개발용 화면

### 트윈 랩 `/lab`

사이드 패널 없이 3D 씬만 띄운다. 주소 인자로 장면을 고정한다.

```
/lab?site=ship-block&fixture=ship-block-basic&t=3200&preset=spider-1&quality=high&freeze=1   녹화본의 3.2초 시점에 멈춤
/lab?site=ship-block&source=mqtt                                                            브로커 실시간
```

| 인자 | 뜻 |
| --- | --- |
| `site` | `ship-block`, `factory` |
| `fixture` | 녹화본(`digital-twin/fixtures/*.jsonl`): `ship-block-idle`, `-basic`, `-weld`, `-edit`, `-alarm`, `-offline`, `-stale`, `factory-idle`, `factory-weld-basic` |
| `t` | 녹화본 시각(ms) |
| `preset` | 카메라: `overview`(전경) 또는 로봇 id |
| `quality` | `high`, `low`(태블릿용) |
| `freeze` | 1이면 시계를 멈춘다 |
| `source=mqtt` | 녹화본 대신 브로커에서 받는다 |

브라우저 콘솔에서 `window.__twin.state()`로 지금 상태를 볼 수 있다(검사가 쓰는 디버그 API, [digital-twin/docs/harness.md](../digital-twin/docs/harness.md)).

### 로봇 랩 `/lab/robot`

로봇 하나를 바닥이나 벽에 붙여 놓고 슬라이더로 관절을 움직인다.

```
/lab/robot?robot=spider-welder&mount=wall&j=arm_2:30,fl_knee:-20
```

## 6. 서버 단독 실행과 API

브로커가 떠 있어야 한다(`npm run broker`).

```bash
npm run server -- --site ship-block --run-ms 4000
```

| 옵션 | 기본 | 뜻 |
| --- | --- | --- |
| `--site` | ship-block | 사이트 |
| `--broker` | mqtt://localhost:1883 | 브로커 |
| `--http` | 8090 | 영상·API 포트 |
| `--mock` | vision,robot,camera | Mock으로 쓸 장비. 빼면 실제 어댑터 |
| `--propose-ms` | 1500 | 대기 뒤 제안까지 |
| `--run-ms` | 8000 | Mock 로봇 용접 시간 |
| `--heartbeat-timeout-ms` | 3000 | 운영자 화면 끊김 판정 |
| `--data` | `data/` | 저장 위치(`none`이면 메모리만) |

| HTTP | 내용 |
| --- | --- |
| `GET /stream/{cell}` | 카메라 영상(실제 카메라 MJPEG, Mock은 PNG 한 장) |
| `GET /frames/{frame_id}` | 수정할 때 멈춘 프레임 |
| `GET /health` | 사이트, 브로커 연결, 로봇별 상태·작업 id, 운영자 heartbeat가 끊긴 시간 |
| `GET /api/tasks?limit=50` | 작업 기록(신뢰도, 사람이 고쳤는지, 결과) |
| `GET /api/tasks/{task_id}/events` | 그 작업의 사건(제안, 승인, 수렴, 정지, 완료, 확인) |
| `GET /api/docs` | API 문서(Swagger) |

작업 기록은 `data/`(git 제외)에 SQLite·PNG·NPY로 남는다([server/docs/storage.md](../server/docs/storage.md)).

브로커에 흐르는 메시지를 직접 보려면 아무 MQTT 클라이언트로 `innoworks/#`를 구독한다(예: `npx mqtt sub -t 'innoworks/#' -v`, 루트 의존성의 mqtt.js).

## 7. 검사

### 처음 한 번

```bash
npx playwright install chromium
```

### 명령

| 명령 | 무엇 | 시간 |
| --- | --- | --- |
| `digital-twin/harness/check.sh --level 2` | L0~L2: 타입·lint·스키마, 에셋, 단위 검사(Vitest, Node Mock 상태 머신, 서버 pytest) | 30초 |
| `digital-twin/harness/check.sh` | L0~L4: 위 + 화면 시나리오(L3, Node Mock·파이썬 서버 둘 다) + 스크린샷 비교(L4) | 5~6분 |
| `digital-twin/harness/check.sh --perf` | L5 성능 포함 | +1분 |
| `npm run test:server` | 서버 단위 검사만 | 2초 |
| `npm test -w frontend` | 프론트 단위 검사만 | 5초 |

끝에 단계별 통과·실패 표가 나온다. 실패한 단계의 로그와 스크린샷 경로가 표 아래에 찍힌다(`digital-twin/harness/out/`).

| 단계 | 무엇을 보나 |
| --- | --- |
| L0 정적 | 타입, lint, 스키마 → 생성 타입이 최신인지, 예시·site-config·녹화본이 계약을 지키는지 |
| L1 에셋 | USD 규칙, GLB 예산, 빌드 결과가 USD와 같은지 |
| L2 단위 | 좌표 변환, 버튼 표, 상태 머신 전이·거부, 수렴, 저장 |
| L3 시나리오 | 실제 브라우저로 운영자 흐름(UI-01~10)을 누르고 결과를 상태 값으로 확인 |
| L4 스크린샷 | 승인된 기준 이미지와 비교(같은 맥에서만 유효) |
| L5 성능 | fps, 드로우 콜, 삼각형, 로딩 시간 |
| H 사람 | 태블릿 터치, 3D 품질 |

### 화면을 바꿨을 때(기준 이미지)

기준 이미지는 **사람이 승인해야** 바뀐다. 통과시키려고 갱신하지 않는다.

```bash
digital-twin/harness/check.sh --candidates
```

1. 위 명령으로 후보를 `digital-twin/harness/out/review/`에 찍는다.
2. 사람이 후보를 열어 본다.
3. 승인하면 `digital-twin/harness/check.sh --update-golden`으로 갱신하고 L4를 다시 돌린다.

## 8. 자주 하는 개발 작업

| 작업 | 순서 | 자세히 |
| --- | --- | --- |
| 메시지 형식 바꾸기 | `contracts/examples`에 예시 → `contracts/schemas` 수정 → `npm run gen:types` → L0 | [contracts/docs/README.md](../contracts/docs/README.md) |
| 실제 비전·로봇·카메라 붙이기 | `server/adapters/vision_real.py`·`robot_real.py`·`server/camera/device.py` 머리말대로 채우기 → `MOCK=…`에서 빼고 실행 → L3 | [architecture.md 9절](architecture.md#9-확장-지점) |
| 사이트 추가 | 에셋 생성기 → `sites/{site}.usda` → `build.py` → 녹화본 → 검사 장면 → 기준 이미지 승인 | [digital-twin/docs/README.md](../digital-twin/docs/README.md) "사이트 추가하기" |
| 3D 에셋·로봇 다시 만들기 | `uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_assets.py`(또는 `make_robot.py`) → `.../pipeline/build.py` | [digital-twin/docs/README.md](../digital-twin/docs/README.md) "파이프라인" |
| 녹화본 다시 만들기 | `python3 digital-twin/fixtures/make_fixtures.py`(JSONL은 손으로 고치지 않는다) | [digital-twin/docs/harness.md](../digital-twin/docs/harness.md) |
| 녹화본 한 번 재생 | `npm run play -- ship-block-weld --speed 2`(브로커가 떠 있어야 한다) | — |
| 설계 바꾸기 | `docs/adr/NNNN-제목.md` 한 장 | [docs/adr/](adr/) |

## 9. 문제 해결

| 증상 | 원인과 해결 |
| --- | --- |
| `init.sh`가 "1883/9001/8090 사용 중"으로 멈춘다 | 이미 `npm run dev`나 `./init.sh`가 돌고 있다. 그 창을 쓰거나 Ctrl+C로 끈다. 남은 프로세스면 찍힌 PID로 `kill <PID>` |
| 프론트가 5174에 떴다 | 5173을 다른 Vite가 쓰고 있다. 찍힌 주소로 열거나 그 Vite를 끈다 |
| `uv가 없다` | `brew install uv`. 급하면 `./init.sh mock` |
| `npm install` 실패 | 네트워크·사내 프록시를 확인한다. Node 20 이상인지 `node -v` |
| 트윈이 회색이고 "브로커와 끊겼다" 띠 | 브로커(1883/9001)가 꺼졌다. `init.sh` 창이 살아 있는지 본다 |
| 로봇이 모두 오프라인, 버튼이 막힘 | 서버가 꺼졌거나 브로커에 못 붙었다. `init.sh` 창의 서버 로그를 본다 |
| 영상이 안 나온다 | 서버 HTTP(8090)가 안 떴다. 프론트는 `/stream`을 8090으로 넘긴다(`frontend/vite.config.ts`) |
| 오래 기다려도 승인 대기가 안 된다 | 서버가 다른 사이트로 떠 있다. 주소의 `?site=`와 `./init.sh server <사이트>`를 맞춘다 |
| 승인했는데 바로 용접 중으로 안 바뀐다 | 정상이다. 서버 응답을 받은 뒤에 바뀐다(보통 0.1초 안). 계속 안 바뀌면 알람의 `CMD_REJECTED`를 본다 |
| L4만 실패한다 | 기준 이미지는 개발용 맥(M1 Max)에서 만들었다. 다른 기기에서는 다를 수 있다. 화면을 일부러 바꿨으면 7절 순서로 승인받는다 |
| L3가 가끔 실패한다 | 검사 중에 `frontend/` 파일을 고치면 Vite가 페이지를 다시 읽어 검사가 깨진다. 검사 중에는 파일을 건드리지 않는다 |
| `--mock`에서 vision을 빼면 서버가 안 뜬다 | 팀원 패키지(`weld_vision`)가 없다. 붙이기 전에는 Mock으로 띄운다 |
