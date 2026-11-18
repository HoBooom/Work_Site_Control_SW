# 디지털 트윈 개발 하네스

[spec.md](spec.md)의 기능이 끝났는지를 사람에게 묻지 않고 확인하는 장치다. 사람이 개발하든 Claude Code 같은 에이전트가 개발하든 같은 장치를 쓴다.

## 원칙

- 명령 하나로 통과 여부가 나온다.
- 서버, 브로커, 실제 로봇 없이 돈다. 입력은 녹화된 픽스처뿐이다.
- 결정적이다. 같은 픽스처, 같은 시각, 같은 카메라면 같은 화면이 나온다.
- 숫자로 잴 수 있는 것은 자동으로 잰다. 보기 좋은지는 사람이 본다. 둘을 섞지 않는다.

## 구성

```
fixtures/*.jsonl ─→ 픽스처 재생기 ─→ store ─→ scene ─→ 화면
                                               │
                                     window.__twin (상태·통계 조회)
                                               │
                      Playwright: 상태 단언 · 스크린샷 비교 · 성능 측정
```

```
digital-twin/
├─ fixtures/
│  ├─ make_fixtures.py  픽스처 생성기(JSONL은 손으로 고치지 않는다)
│  └─ *.jsonl           시나리오 녹화본
├─ harness/
│  ├─ check.sh          검사 진입점
│  ├─ shot.sh           스크린샷 한 장 찍기
│  ├─ validate-data.mjs L0 스키마·site-config·픽스처 검사
│  ├─ budget.json       L5 성능 예산
│  ├─ playwright.config.ts
│  ├─ e2e/              Playwright 테스트(L3 lab·scene·state·interaction·render·sites, L4 shots, L5 perf), shots.json(장면 목록)
│  │                    sites.spec.ts는 site-config에 있는 모든 사이트를 이름을 적지 않고 같은 기준으로 검사한다(M4)
│  ├─ golden/           승인된 기준 스크린샷
│  └─ out/              실행 결과물(git 제외): logs/, shots/, test-results/, stats.json
└─ pipeline/            build.py, validate.py, check_glb.py (M1)
contracts/gen-types.mjs 스키마 → frontend/src/contracts/messages.gen.ts
frontend/src/lab/       트윈 랩(씬만 띄우는 개발용 화면)
```

## 픽스처

토픽 메시지를 시간 순서로 적은 파일이다. 한 줄이 메시지 하나다.

```
{"t": 0,    "topic": "innoworks/shipyard/weld-cell-1/status",     "payload": {"v": 1, "ts": 0, "state": "online"}}
{"t": 50,   "topic": "innoworks/shipyard/weld-cell-1/robot/state", "payload": {...}}
```

- `t`는 시나리오 시작부터의 ms다.
- `payload`는 `contracts/schemas/`의 스키마를 통과해야 한다(L0에서 검사).
- 같은 파일을 `tools/play.py`가 브로커로 재생한다. 트윈 랩용과 통합 테스트용을 따로 만들지 않는다.

기본 픽스처.

| 이름 | 내용 | 주로 검증하는 기능 |
| --- | --- | --- |
| `idle` | 로봇이 홈 자세로 정지, 작업 없음 | RD, IX |
| `weld-basic` | 제안 → 승인 → 실행(진행률 0→100%) → 완료 | DY-01, 03, 04, 06 |
| `weld-edit` | 제안 → 수정 → 수렴 결과 → 승인 | DY-07 |
| `alarm` | 실행 중 알람 발생, 정지, 해제 | DY-05 |
| `offline` | 실행 중 서버 offline, 복구 | DY-08 |
| `stale` | `robot/state`가 3초간 끊겼다가 재개 | DY-09 |
| `two-cells` | 셀 2개가 서로 다른 작업을 동시에 진행. 아직 없음: 지금은 `weld-basic`(셀 1 작업, 셀 2 대기)으로 DY-02를 본다 | DY-02 |
| `factory-idle`, `factory-weld-basic` | 공장 사이트(셀 1개)의 `idle`, `weld-basic`. 생성기 함수에 사이트·셀을 넘겨 만든다(M4) | M4 |
| `ship-block-idle` | 블록 내부: 스파이더 1은 바닥 외판, 스파이더 2는 측면 외판에 붙어 정지 | DY-10 |
| `ship-block-weld` | 스파이더 1이 론지 사이를 걸어(트롯, 디딘 발은 강판에 고정) 작업 위치로 → 제안 → 실행(토치가 용접선을 따라감) → 완료. 스파이더 2는 수직 용접선 승인 대기 | DY-10, DY-11 |

블록 픽스처는 로봇 형상을 대역 URDF에서, 면 위치를 site-config에서 읽어 만든다(걸음의 hip_yaw, 팔 역기구학). 로봇이나 블록을 바꾸면 `make_fixtures.py`를 다시 돌린다. `e2e/mobile.spec.ts`가 결과를 확인한다.

위 표의 이름 없는 것은 조선소 픽스처다. 다른 사이트의 픽스처는 `{사이트}-` 접두어를 붙인다. 한 픽스처의 토픽은 한 사이트만 쓴다(`e2e/data.ts fixturesOfSite`가 이것으로 사이트별 픽스처를 찾는다).

## 로봇 랩

`/lab/robot?robot=spider-welder&mount=floor|wall&j=arm_2:30,fl_knee:-20&panel=0`. 사이트·픽스처 없이 로봇 하나를 바닥이나 강판 벽에 붙여 보고, 오른쪽 패널의 슬라이더로 관절을 움직인다.
로봇은 0° 자세의 크기로 자동으로 놓인다(바닥: 최저점이 z=0, 벽: 발판이 벽 면 y=0). `window.__robotLab`(`frontend/src/lab/robot-lab-api.ts`)으로 링크 상자·좌표계를 조회하고, `e2e/robot.spec.ts`(L3)가 이것으로 단언한다.
`shot.sh "robot?robot=spider-welder&mount=wall"`로 한 장 찍는다.

## 트윈 랩

사이드 패널 없이 씬만 띄우는 화면이다. 주소의 인자로 상태를 고정한다.

```
/lab?site=shipyard&fixture=weld-basic&t=3200&preset=overview&quality=high&freeze=1
```

| 인자 | 뜻 |
| --- | --- |
| `site` | 사이트 id |
| `fixture` | 픽스처 이름 |
| `t` | 시나리오 시각(ms). `freeze=1`이면 이 시각의 상태로 멈춘다 |
| `preset` | 카메라 프리셋 |
| `quality` | `high` / `low` |
| `freeze` | 1이면 시계를 멈춘다. 스크린샷과 상태 단언에 쓴다 |

결정성을 위한 규칙.

- 씬의 모든 애니메이션(관절 보간, 데이터 끊김 판정, 깜빡임)은 벽시계가 아니라 랩이 주는 가상 시계로 계산한다.
- 예외: 카메라 프리셋 전환(IX-03)은 사용자 조작 연출이라 실제 프레임 시간으로 움직인다. 주소 인자로 준 첫 프리셋은 바로 놓이므로 스크린샷에는 영향이 없다.
- 검사할 때는 화면 크기 1280×720, 픽셀 비율 1로 고정한다.
- 무작위 값을 쓰는 연출은 시드를 고정한다.

## 디버그 API

랩에서만 `window.__twin`을 연다(`frontend/src/lab/debug-api.ts`). 테스트는 화면 픽셀이 아니라 이 API로 상태를 확인한다. Lab 모듈이 지연 로딩되므로 테스트는 `window.__twin`이 생길 때까지 기다린 뒤 `ready()`를 기다린다(`e2e/helpers.ts`의 `openLab`).

| 호출 | 돌려주는 것 | 생기는 단계 |
| --- | --- | --- |
| `ready()` | 로딩과 첫 3프레임이 끝나면 풀리는 Promise. 로딩 실패면 거부 | M0 |
| `state()` | 사이트, 픽스처, 가상 시각, 정지 여부, 셀별 상태(store 복사본) | M0 |
| `stats()`, `resetStats()` | 드로우 콜, 삼각형, 텍스처·지오메트리 수, 평균 fps, 프레임 시간 p95 | M0 |
| `setClock(t)` | 시나리오 시각을 옮기고 즉시 반영 | M0 |
| `frames(n)` | n프레임 뒤에 풀린다. `setClock` 뒤 씬이 따라오기를 기다릴 때 | M1 |
| `object(site, cell, part)` | 객체 존재 여부, 보임 여부, 원점과 크기(사이트 좌표) | M1 |
| `joints(site, cell)` | 씬의 로봇 관절각(deg) | M1 |
| `camera()` | 카메라 위치, 목표점(사이트 좌표), 거리 | M1 |
| `seam(site, cell)` | 그려진 용접선: 전체 점, 완료·남은 구간(사이트 좌표), 점선 여부, 구간별 색 | M1, M2 |
| `view(site, cell)` | 상태 램프(상태·색), 라벨(글자·상태), 알람 마커(아래부터), 로봇 회색 여부, 멈춤 표시 | M2 |
| `screen(site, cell, part 또는 {alarm})` | 객체 중심의 화면 좌표(px). 테스트가 그 자리를 실제로 눌러 선택을 확인한다 | M2 |
| `selection()` | 현재 선택 이벤트 `{site, cell, kind, id}` | M2 |
| `count(name, type?)` | 이름이 같은 객체 수(이전 선이 남았는지 등) | M2 |
| `render()` | 품질 등급, 환경광 유무, 키 라이트 그림자 설정, 켜진 후처리, 그림자 범위, 로봇·배경의 그림자 설정 | M3 |
| `setPreset(id)`, `setSite(site)`, `setQuality(tier)` | 랩 상태 변경. 사이트·품질은 Canvas를 다시 만들고 첫 프레임까지 기다린다 | M2 |

## 검사 단계

| 단계 | 무엇을 | 도구 | 시간 | 언제 |
| --- | --- | --- | --- | --- |
| L0 정적 | 타입(frontend, e2e), lint, 생성 타입·픽스처가 최신인지, site-config·픽스처의 스키마 통과 | tsc, eslint, ajv | 10초 | 저장할 때마다 |
| L1 에셋 | USD 규칙(`validate.py`), GLB 예산·로봇 메시 없음·빌드 해시(`check_glb.py`) | usd-core, gltf-transform | 30초 | 에셋·파이프라인을 고쳤을 때 |
| L2 단위 | 좌표 변환, 토픽→객체 조회, 관절 보간, 진행률→선 구간 | Vitest | 10초 | 저장할 때마다 |
| L3 씬 상태 | 픽스처를 특정 시각에 멈추고 `__twin`으로 상태 단언. 콘솔 오류 0건 | Playwright | 1~2분 | 작업 하나를 끝낼 때 |
| L4 스크린샷 | 정해진 장면을 찍어 기준 이미지와 비교 | Playwright | 1~2분 | 작업 하나를 끝낼 때 |
| L5 성능 | 픽스처를 10초 재생하며 fps, 드로우 콜, 삼각형, 로딩 시간 측정. 드로우 콜·삼각형은 그림자·후처리 패스까지 한 프레임 합계 | Playwright + `stats()` | 1분 | 마일스톤을 닫을 때, 에셋을 바꿨을 때 |
| H 검수 | 품질 기준 표와 참조 화면을 나란히 놓고 사람이 승인 | 사람 | — | M3, 기준 이미지 갱신 때 |

## 명령

```
digital-twin/harness/check.sh              # L0~L4
digital-twin/harness/check.sh --level 2    # L0~L2만(빠른 확인)
digital-twin/harness/check.sh --perf       # L5 포함
digital-twin/harness/check.sh --candidates # L4 장면을 out/review/에 후보로 찍기(기준 이미지는 그대로)
digital-twin/harness/shot.sh "site=shipyard&fixture=weld-basic&t=3200&preset=cell-1"
```

- 실패하면 종료 코드가 0이 아니다.
- 끝에 단계별 통과·실패 표를 한 번 출력한다.
- 결과물은 `harness/out/`에 남는다: 찍은 스크린샷, 기준과의 차이 이미지, `stats.json`.

## 스크린샷 비교

- 기준 이미지 이름: `golden/{site}-{fixture}-{t}-{preset}-{quality}.png`
- 장면 목록은 `e2e/shots.json` 한 곳에 둔다. 사이트마다 전경 1장, 셀 클로즈업 1장, 상태별 1장씩으로 시작한다.
- 허용 오차: 픽셀별 색 차이 0.02(Playwright `threshold`) 넘는 픽셀이 0.5% 이하. 같은 맥에서는 화면이 바이트 단위로 같다(M1에서 3회 확인). GPU마다 결과가 조금 다르므로, 기준 이미지는 개발용 맥 한 대에서 만들고 그 환경에서만 비교한다.
- 기준 이미지는 사람이 승인해야 갱신한다. 순서: `check.sh --candidates` → `out/review/`를 사람이 본다 → 승인하면 `check.sh --update-golden`. 통과시키려고 갱신하지 않는다.
- 장면에 `select`를 주면 그 객체를 실제로 눌러 선택한 뒤 찍는다(선택 외곽선 확인).
- 기준 이미지가 없으면 실패한다(`updateSnapshots: 'none'`). Playwright 기본값은 찍은 화면을 승인 없이 기준으로 저장하므로 막아 두었다.
- 찍은 화면과 차이 이미지는 `out/test-results/L4/`에 남는다. 단계마다 결과 폴더가 따로라 L5가 L4 결과를 지우지 않는다.
- 픽셀 비교가 통과했다는 것은 "전과 같다"는 뜻이지 "보기 좋다"는 뜻이 아니다. 품질 작업을 했으면 `out/`의 스크린샷을 직접 열어 본다.

## 작업 루프

1. spec의 기능 ID 하나를 고르고 작업 카드를 쓴다.
2. 그 기능의 완료 기준을 검사로 먼저 옮긴다. 이때 검사는 실패해야 한다.
3. 구현한다.
4. `check.sh`를 돌린다. 화면이 바뀌는 작업이면 스크린샷을 열어 본다.
5. 통과 표, 스크린샷 경로, 예산 수치를 붙여 보고한다.

작업 카드.

```
기능: DY-03 용접선
픽스처: weld-basic, t=1200
완료 기준: 선의 각 점이 SC-02로 계산한 좌표와 1mm 이내
추가할 검사: e2e/seam.spec.ts (L3), shots.json에 장면 1개 (L4)
건드리는 곳: frontend/src/scene/seam/
건드리지 않는 곳: contracts/, 다른 셀 코드
```

## 완료 정의

- 해당 기능의 검사가 추가되었고 통과한다.
- `check.sh`가 전부 통과한다(기존 검사 포함).
- 콘솔 오류와 경고가 0건이다.
- 성능 예산을 넘지 않는다.
- 화면이 바뀌었으면 스크린샷을 보고에 붙였다.

## 에이전트 규칙

Claude Code로 작업할 때 지킬 것. M0에서 `digital-twin/CLAUDE.md`에 옮겨 적는다.

- 작업을 끝냈다고 말하기 전에 `check.sh`를 돌리고 결과 표를 그대로 보고한다.
- 하지 않는 것: 기준 이미지 갱신, 예산·허용 오차 완화, 검사 건너뛰기(`skip`), `contracts/` 스키마 변경. 필요하면 이유를 적고 사람에게 묻는다.
- 화면 품질 작업은 참조 화면과 찍은 스크린샷을 나란히 놓고 다른 점을 적은 뒤 고친다.
- 사이트나 셀 이름으로 분기하는 코드를 쓰지 않는다. 필요해 보이면 site-config에 항목을 더한다.
- 명령 등록: `/twin-check`(검사 실행과 결과 요약), `/twin-shot`(장면 한 장 찍어 보기).

## 사람 검수 항목

M3과 기준 이미지 갱신 때 본다. 참조 화면은 realvirtual WEB 공개 데모를 같은 구도로 찍어 `docs/reference/`에 둔다(내부 비교용).

1. 물체가 바닥에 붙어 보이는가
2. 금속 면에 환경이 비치는가
3. 흰색이 날아가거나 그림자가 뭉개진 곳이 없는가
4. 가는 형상이 깜빡이지 않는가
5. 박스 그대로인 형상이 남아 있지 않은가
6. 로봇, 용접선, 알람 마커가 배경에 묻히지 않고 한눈에 들어오는가
7. 카메라를 돌릴 때 끊기지 않는가
8. 태블릿(low 등급)에서도 1~6이 크게 무너지지 않는가

## M0에서 만드는 것

- `contracts/schemas/`: site-config, `robot/state`, `task/state`, `task/proposal`, `task/snap`, `task/progress`, `alarm`, `status`
- `digital-twin/fixtures/idle.jsonl`
- `frontend/`: Vite + R3F 뼈대, store의 최소 조각, 픽스처 재생기, 빈 트윈 랩, `window.__twin`의 `ready()`·`state()`·`stats()`
- `digital-twin/harness/`: `check.sh`(L0~L4), `shot.sh`, 빈 씬 테스트 1개, 기준 이미지 1장
- `digital-twin/CLAUDE.md`, `.claude/commands/twin-check.md`, `twin-shot.md`
