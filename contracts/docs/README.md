# 공통 규약 개요

웹, 서버, 팀원 모듈이 주고받는 모든 것의 기준이다. 팀에 인터페이스 합의 경험이 없으므로, 따로 협상하지 않고 아래의 흔한 기본값을 그대로 쓴다. 바꿀 이유가 생기면 이 폴더를 먼저 고치고 ADR을 남긴다.

## 기본값

| 항목 | 기본값 |
| --- | --- |
| 메시지 형식 | JSON, UTF-8, 키는 snake_case |
| 공통 필드 | `v`(스키마 버전), `ts`(epoch ms). 나머지는 메시지별 |
| 길이 | mm, 작업판 좌표계 |
| 각도 | deg |
| 영상 좌표 | 원본 프레임 픽셀 `[x, y]`, 좌상단 원점 |
| 경로 | 점 배열, 시작 → 끝 순서 |
| ID | `site`, `cell`은 소문자 kebab-case. `task_id`는 서버가 발급 |

## 좌표계

- 작업판 좌표계: 판의 한 모서리를 원점, 판 위 평면이 XY, 위쪽이 +Z.
- 픽셀 → 판 좌표 변환(호모그래피)은 서버가 맡는 것을 기본으로 한다. 로봇 어댑터는 판 좌표(mm) 경로를 받는다. (팀원 확인 필요)
- 판 좌표 → 3D 씬 좌표는 사이트 설정의 셀 변환으로 처리한다(디지털 트윈 문서).

## 토픽 구조

```
innoworks/{site}/{cell}/robot/state      서버→웹  관절각, 10~20Hz, QoS 0
innoworks/{site}/{cell}/task/state       서버→웹  작업 상태, QoS 1, retained
innoworks/{site}/{cell}/task/proposal    서버→웹  AI 제안 경로, QoS 1, retained
innoworks/{site}/{cell}/task/snap        서버→웹  수렴 결과, QoS 1
innoworks/{site}/{cell}/task/progress    서버→웹  진행률, QoS 0
innoworks/{site}/{cell}/vision/metrics   서버→웹  지연·신뢰도·외란 강도, QoS 0
innoworks/{site}/{cell}/alarm            서버→웹  QoS 1
innoworks/{site}/{cell}/status           서버→웹  online/offline, retained, LWT
innoworks/{site}/{cell}/cmd/{이름}        웹→서버  edit_start, drag, approve, confirm, estop, resume. QoS 1
innoworks/operator/{client_id}/heartbeat 웹→서버  1초마다, QoS 0
```

- 상태처럼 "지금 값"이 중요한 것은 retained, 명령과 이벤트는 retained 금지.
- 명령은 요청일 뿐이다. 결과는 항상 `task/state`나 `alarm`으로 돌아온다.

## 팀원 모듈과의 경계

팀원 코드는 어댑터 두 개(`VisionAdapter`, `RobotAdapter`)로만 만난다. 시그니처는 기획서 초안을 기본값으로 쓰고, 팀원 쪽 사정으로 바뀌는 부분은 어댑터 안에서 흡수한다.

## 다음에 쪼갤 문서

- `contracts/topics.md` 토픽별 상세
- `contracts/schemas/*.json` 메시지별 JSON Schema
- `contracts/docs/coordinates.md` 캘리브레이션 절차
- `contracts/docs/adapters.md` 어댑터 시그니처
