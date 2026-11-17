# welding-hitl

조선소·제조공장 용접 현장용 관제 SW. AI가 제안한 용접 경로를 사람이 3D 디지털 트윈 웹앱에서 승인·수정하고, 로봇이 실행한 뒤 결과를 확인한다.
스택: R3F(웹) + MQTT(상태·명령) + USD(3D 원본) + FastAPI(엣지 서버, MIC-711D). 개발은 맥에서 Mock으로 한다.

## 구획과 문서

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

디지털 트윈 우선 개발 중(M0 완료). 지금 동작하는 명령:

```
npm install                                   # 저장소 루트에서 한 번
npm run dev -w frontend                       # http://localhost:5173/lab  트윈 랩
digital-twin/harness/check.sh                 # 트윈 검사 L0~L4 (/twin-check)
digital-twin/harness/shot.sh "<랩 주소 인자>"   # 장면 한 장 (/twin-shot)
```

나중에 생길 명령:

```
infra/dev.sh          # mosquitto + server(--mock vision,robot,camera) + frontend dev
tools/play.py <시나리오>   # 연동 안 된 사이트에 녹화 데이터 재생
```
