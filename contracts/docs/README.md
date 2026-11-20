# 공통 규약 개요

웹, 서버, 팀원 모듈이 주고받는 모든 것의 기준이다. 팀에 인터페이스 합의 경험이 없으므로, 따로 협상하지 않고 아래의 흔한 기본값을 그대로 쓴다. 바꿀 이유가 생기면 이 폴더를 먼저 고치고 ADR을 남긴다.

## 기본값

| 항목 | 기본값 |
| --- | --- |
| 메시지 형식 | JSON, UTF-8, 키는 snake_case |
| 공통 필드 | `v`(스키마 버전), `ts`(epoch ms). 나머지는 메시지별 |
| 길이 | 경로는 mm(작업판·면 좌표계), 3D 위치는 m(사이트 좌표계) |
| 각도 | deg |
| 영상 좌표 | 원본 프레임 픽셀 `[x, y]`, 좌상단 원점 |
| 경로 | 점 배열, 시작 → 끝 순서 |
| ID | `site`, `cell`, surface id는 소문자 kebab-case. `task_id`는 서버가 발급 |
| 자세(회전) | 평면 회전은 `yaw_deg`. 3D 회전은 단위 쿼터니언 `orientation_xyzw` = `[x, y, z, w]` |

## 작업 단위(`{cell}`)

토픽의 `{cell}`은 작업 단위 = 로봇 1대다(ADR 0003). 카메라, 작업 상태 머신, 알람, 연결 상태가 모두 로봇에 붙는다. 이름은 호환을 위해 `cell`로 둔다.

| 로봇 | site-config `cells[]` | `robot/state` | `task/proposal`·`task/snap`의 경로 |
| --- | --- | --- | --- |
| 고정형(셀 바닥에 고정) | `plate`(작업판) 있음. `pose`는 셀 위치 | `joints`만 | `surface` 없이 셀 작업판 좌표 |
| 이동형(4족 자석발 등) | `plate` 없음. `pose`는 대기 위치 | `joints` + `base`(몸통 자세) + `contacts`(발 자석) | `surface`로 사이트의 강판 면을 가리키고 그 면 좌표 |

용접선이 놓이는 강판 면(내저판, 격벽, 외판 등)은 사이트에 고정된 것이므로 site-config `surfaces`에 둔다. 로봇은 여러 면을 오가며 일한다.

## 좌표계

- 사이트 좌표계: USD와 같다. Z-up, m. site-config의 모든 3D 좌표와 `robot/state.base`가 이 좌표계다.
- 작업판 좌표계(고정 로봇): 판의 한 모서리를 원점, 판 위 평면이 XY, 위쪽이 +Z. 단위 mm.
- 면 좌표계(이동 로봇, `surfaces[].pose`): 면의 한 모서리를 원점, 면 위가 XY, +Z는 로봇이 붙는(용접하는) 쪽 법선. 단위 mm. 바닥판이면 회전 없음, 수직 외판이면 X축으로 90° 같은 회전이다.
- `robot/state.base`: URDF `base_link`의 사이트 기준 자세. `surface`는 발이 붙어 있는 면의 id(바닥을 걷거나 면에 붙지 않았으면 null).
- 픽셀 → 판 좌표 변환(호모그래피)은 서버가 맡는 것을 기본으로 한다. 로봇 어댑터는 판 좌표(mm) 경로를 받는다. (팀원 확인 필요)
- 판 좌표 → 3D 씬 좌표는 사이트 설정의 셀 변환으로 처리한다(디지털 트윈 문서).

## 토픽 구조

```
innoworks/{site}/{cell}/robot/state      서버→웹  관절각(+이동 로봇은 몸통 자세·발 접촉), 10~20Hz, QoS 0
innoworks/{site}/{cell}/task/state       서버→웹  작업 상태, QoS 1, retained
innoworks/{site}/{cell}/task/proposal    서버→웹  AI 제안 경로, QoS 1, retained
innoworks/{site}/{cell}/task/snap        서버→웹  수렴 결과, QoS 1
innoworks/{site}/{cell}/task/progress    서버→웹  진행률, QoS 0
innoworks/{site}/{cell}/vision/metrics   서버→웹  지연·신뢰도·외란 강도, QoS 0
innoworks/{site}/{cell}/alarm            서버→웹  QoS 1
innoworks/{site}/{cell}/status           서버→웹  online/offline, retained, LWT
innoworks/{site}/{cell}/cmd/{이름}        웹→서버  edit_start, edit_cancel, drag, approve, confirm, estop, resume. QoS 1
innoworks/operator/{client_id}/heartbeat 웹→서버  1초마다, QoS 0
```

- 브로커: 엣지는 mosquitto(`infra/mosquitto.conf`), 맥 개발·검사는 aedes(`infra/broker.mjs`). 서버·도구는 TCP 1883, 브라우저는 WebSocket 9001(ADR 0004).
- 웹(bus)은 받은 payload를 이 폴더의 스키마로 검사하고, 틀린 메시지는 경고하고 버린다.
- 상태처럼 "지금 값"이 중요한 것은 retained, 명령과 이벤트는 retained 금지.
- 명령은 요청일 뿐이다. 결과는 항상 `task/state`나 `alarm`으로 돌아온다.

## 스키마를 바꿀 때

1. `contracts/examples/`에 통과해야 할 예시(valid)와 걸러야 할 예시(invalid)를 먼저 더한다.
2. `contracts/schemas/*.schema.json`을 고친다. 필드를 더할 때는 선택 필드로 더해 기존 메시지가 그대로 통과하게 한다(이때 `v`는 올리지 않는다).
3. `npm run gen:types` → `frontend/src/contracts/messages.gen.ts`.
4. `node digital-twin/harness/validate-data.mjs`(L0): 예시, site-config, 픽스처를 스키마와 의미 규칙(단위 쿼터니언, 경로가 면 안, 가리키는 surface가 있는지)으로 검사한다.

## 팀원 모듈과의 경계

팀원 코드는 어댑터 두 개(`VisionAdapter`, `RobotAdapter`)로만 만난다. 시그니처는 기획서 초안을 기본값으로 쓰고, 팀원 쪽 사정으로 바뀌는 부분은 어댑터 안에서 흡수한다.

## 다음에 쪼갤 문서

- `contracts/topics.md` 토픽별 상세
- `contracts/schemas/*.json` 메시지별 JSON Schema
- `contracts/docs/coordinates.md` 캘리브레이션 절차
- `contracts/docs/adapters.md` 어댑터 시그니처
