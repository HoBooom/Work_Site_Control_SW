# welding-hitl

조선소·제조공장 용접 현장용 관제 SW. AI가 제안한 용접 경로를 사람이 3D 디지털 트윈 웹앱에서 승인·수정하고, 로봇이 실행한 뒤 결과를 확인한다.
스택: R3F(웹) + MQTT(상태·명령) + USD(3D 원본) + FastAPI(엣지 서버, MIC-711D). 개발은 맥에서 Mock으로 한다.

## 구획과 문서

전체 문서: `docs/overview.md`(개요), `docs/usage.md`(사용법), `docs/architecture.md`(아키텍처 위키). 실행·구조·상태가 바뀌면 이 셋도 맞춰 고친다.

작업 전에 해당 구획의 `docs/README.md`를 먼저 읽는다. 문서는 각 구획 폴더 안의 `docs/`에 둔다. 구획을 넘는 변경은 contracts부터 고친다.

개발 순서: 디지털 트윈이 먼저다. 기능명세는 `digital-twin/docs/spec.md`, 검증 방법은 `digital-twin/docs/harness.md`.

| 구획 | 폴더 | 문서 | 무엇을 다루나 |
| --- | --- | --- | --- |
| 공통 규약 | `contracts/` | `contracts/docs/README.md` | 토픽, 메시지 스키마, 좌표·단위. 모든 구획의 단일 기준 |
| 디지털 트윈 | `digital-twin/` | `digital-twin/docs/README.md` | USD 원본 에셋, 사이트 조립, GLB 변환, prim↔토픽 매핑 |
| 서버 | `server/` | `server/docs/README.md` | 작업 상태 머신, 카메라, 경로 수렴, 안전, 저장, 어댑터, Mock |
| 프론트 | `frontend/` | `frontend/docs/README.md` | 3D 씬, 사이드 패널, 알람, 수정 모드, 메트릭 |
| 인프라·도구 | `infra/`, `tools/` | (각 폴더 README) | 브로커 설정, 실행 스크립트, 시나리오 재생기 |
| 결정 기록 | `docs/adr/` | `NNNN-제목.md` | 왜 그렇게 설계했는지 한 장씩 |

## 폴더 구조

```
contracts/      docs/ topics.md, schemas/*.json  → frontend 타입과 server 모델을 여기서 생성
digital-twin/   docs/ assets/ sites/ pipeline/ site-config/ fixtures/ harness/
server/         docs/ app/ bus/ task/ camera/ snap/ safety/ storage/ metrics/ adapters/ mock/
frontend/       docs/ src/(app/ bus/ store/ scene/ lab/ panel/ alarms/ metrics/ shared/)
infra/          mosquitto.conf, 실행 스크립트
tools/          시나리오 재생기, 토픽 모니터
data/           task별 저장물 (git 제외)
tests/          상태 머신, 경로 수렴, 스키마 검증
docs/           adr/ (구획을 넘는 설계 결정만)
```

## 지켜야 할 규칙

- 작업 상태의 기준은 서버다. 웹은 명령만 보내고, 화면은 서버가 보낸 상태를 받은 뒤에 바꾼다.
- 메시지 형식은 `contracts/schemas`에서만 고친다. frontend·server에 타입을 직접 쓰지 않는다.
- 팀원 코드(비전 모델, 로봇 제어)는 `server/adapters/` 안에서만 import한다.
- 새 기능은 Mock으로 먼저 끝까지 동작시킨 뒤 실제 구현을 붙인다.
- 단위: 길이 mm(작업판 좌표), 각도 deg, 시간 epoch ms, 영상 좌표는 원본 프레임 픽셀.
- 설계를 바꾸면 `docs/adr/`에 한 장 남긴다.

## 실행 (맥, Mock)

디지털 트윈 M0~M5 완료(ADR 0003 이동 로봇, ADR 0004 MQTT). 지금 동작하는 명령:

```
./init.sh                                     # 한 번에: 도구 점검 + 의존성 설치(필요할 때만) + 포트 점검 + 아래 npm run dev
./init.sh --check                             # 점검만. 인자는 infra/dev.sh와 같다(./init.sh mock, LAN=1 ./init.sh …)
npm install                                   # 저장소 루트에서 한 번
uv sync --project server                      # 서버 가상환경(server/.venv) 한 번
npm run dev                                   # infra/dev.sh: 브로커(aedes, 1883/9001) + 관제 서버(server/, Mock 어댑터) + 프론트
npm run dev -- mock                           # 서버 대신 Node Mock 서버(tools/mock-server.mjs)
npm run dev -- play ship-block-weld           # 서버 대신 픽스처를 반복 재생
LAN=1 npm run dev                             # 같은 네트워크의 태블릿에서 http://<맥 IP>:5173/ 로 연다
npm run play -- <픽스처> [--speed 2]           # 픽스처 한 번 재생(브로커가 떠 있어야 한다)
npm run dev -w frontend                       # 프론트만(픽스처 트윈 랩)
npm run server -- --site ship-block           # 서버만(옵션 server/docs/mock.md)
npm run test:server                           # 서버 단위 검사(pytest)
digital-twin/harness/check.sh                 # 트윈·관제·서버 검사 L0~L4 (/twin-check)
digital-twin/harness/shot.sh "<랩 주소 인자>"   # 장면 한 장 (/twin-shot)
```

프론트(서버 전): 기능명세 `frontend/docs/spec.md`, F0~F3 완료(ADR 0005, 화면 디자인 ADR 0006). F4는 메트릭·태블릿 기준 화면까지, 태블릿 사람 확인이 남았다.

화면: 관제 `http://localhost:5173/`(기본 사이트 ship-block, 브로커·Mock 서버. 디자인 시안 Welding Control v3 + `frontend/DESIGN.md`, ADR 0006), 트윈 랩 `/lab`(픽스처) 또는 `/lab?site=ship-block&source=mqtt`(브로커), 로봇 랩 `/lab/robot`.

서버(ADR 0007): Python FastAPI, Mock 어댑터(vision·robot·camera)로 끝까지 동작하고 관제 L3를 Node Mock 서버와 같이 통과한다. 실제 비전·로봇·카메라 연결(팀원 코드)과 Jetson 실행 확인이 남았다.
