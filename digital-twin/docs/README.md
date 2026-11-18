# 디지털 트윈 개요

현장을 본뜬 3D 장면과, 그 장면을 실시간 데이터에 연결하는 규칙을 다룬다. 화면을 그리는 코드는 프론트 문서에 있고, 여기는 "무엇을 어떤 구조로 본뜨는가"다.

디지털 트윈을 다른 구획보다 먼저 개발한다. 무엇을 어느 수준까지 만드는지는 [spec.md](spec.md), 어떻게 검증하며 개발하는지는 [harness.md](harness.md)에 있다.

## 범위

- 사이트 2개, 둘 다 용접 환경: 조선소 일부(블록 용접 구역), 제조공장 일부(용접 셀).
- 전체가 아니라 데모에 필요한 구역만 만든다.
- 실제 로봇과 연동되는 셀은 1개다. 나머지 셀은 시나리오 재생으로 움직인다. 트윈 입장에서는 둘이 구분되지 않는다(같은 토픽).

## 두 개의 층

| 층 | 내용 | 만드는 곳 | 갱신 |
| --- | --- | --- | --- |
| 정적 층 | 건물, 블록, 지그, 펜스 등 배경 | Blender → USD → GLB | 빌드 때만 |
| 동적 층 | 로봇 관절, 작업판 위 용접선, 알람 마커, 상태 색 | 웹 코드 | MQTT 메시지마다 |

정적 층에는 데이터가 붙지 않는다. 동적 층만 토픽을 구독한다.

## 에셋 구조 (USD가 원본)

```
digital-twin/
├─ assets/          재사용 단위: robot/(URDF+STL), props/(USD), materials/(재질 라이브러리), gen/(절차적 생성기)
├─ sites/           ship-block.usda, factory.usda  (assets를 reference로 조립)
├─ pipeline/        validate.py, build.py, glb.py(USD→GLB), check_glb.py, test_pipeline.py, pyproject.toml(uv)
├─ site-config/     ship-block.json, factory.json  (웹이 읽는 설정)
├─ fixtures/        시나리오 녹화본(JSONL). 트윈 랩과 tools/play.py가 같이 쓴다
└─ harness/         검사 명령, Playwright 테스트, 기준 스크린샷
```

- 에셋은 한 번 만들고 사이트에서 reference로 불러 쓴다. 로봇을 고치면 모든 셀에 반영된다.
- USD 설정: `upAxis = Z`, `metersPerUnit = 1`. 웹용 GLB는 Y-up으로 변환된다.
- 로봇은 URDF도 함께 둔다. 관절 이름이 `robot/state` 메시지의 관절 이름과 같아야 한다.

## 이름 규칙: prim 경로 = 토픽 = 설정 키

```
USD prim     /ShipBlock/Spider1/Robot
토픽         innoworks/ship-block/spider-1/robot/...
site-config  ship-block.json cells[id = "spider-1"]
```

웹은 토픽의 `{site}/{cell}`만 보고 갱신할 3D 객체를 찾는다. 사이트를 추가할 때는 USD 장면과 site-config만 더하고 코드는 고치지 않는다.

## site-config가 담는 것

- 배경 GLB 경로
- 셀 목록: id, 씬 안 위치·회전, 작업판 크기(mm), 로봇 URDF, 카메라 영상 주소
- 카메라 프리셋: 전경, 셀 클로즈업
- 판 좌표(mm) → 씬 좌표(m) 변환은 셀의 위치·회전에서 계산한다

## 파이프라인

1. 에셋 만들기: `assets/gen/make_assets.py`(소품·배경 USD), `assets/gen/make_robot.py`(로봇 STL+URDF: 고정형 대역 `standin-6axis`, 4족 자석발 이동 용접 로봇 대역 `spider-welder`(`spider.py`, ADR 0003))가 절차적 형상(meshkit: 둥근 상자, 회전체, 관)으로 만든다. 생성 파일은 손으로 고치지 않는다. 나중에 Blender 등에서 만든 USD로 바꿔도 된다(재질은 라이브러리 이름만 쓴다).
2. `sites/{site}.usda`에서 에셋을 reference로 조립한다. 셀의 Robot·Plate는 기준점만 둔다.
3. `validate.py`: 규칙 검증(축, 단위, prim 이름, 셀 구조, 자세는 이동+Z회전만, 지원 형상)
4. `build.py`: usd-core + numpy로 배경 GLB를 직접 쓴다 → `frontend/public/sites/`. Blender가 필요 없고 결정적이다(ADR 0002).
   같은 실행에서 site-config의 cells·background·name을 USD에서 생성하고, 로봇 URDF를 `frontend/public/robots/`로 복사한다.
5. `check_glb.py`: GLB 형식과 예산. `build.py --check`: 결과물이 USD와 같은지

```
uv run --project digital-twin/pipeline python digital-twin/pipeline/build.py   # 저장소 루트에서
```

site-config의 셀 좌표는 손으로 고치지 않는다. USD를 고치고 다시 빌드한다. `environment`, `presets`만 site-config에서 직접 고친다.
`build.py`는 기존 프리셋을 그대로 두고, 클로즈업 프리셋이 없는 셀에만 셀 자세(회전 포함)에서 계산한 클로즈업을 더한다(id = 셀 id). 프리셋이 하나도 없으면 전경도 만든다.

## 사이트

| 사이트 | 내용 | 로봇 |
| --- | --- | --- |
| `factory` | 제조공장 용접 부스 1개(M4) | 고정형 대역 6축 |
| `ship-block` | 건조 도크 안 이중저 블록(ADR 0003). 외판·론지·늑판·거더·측면 외판, 면 2개(`bottom-shell`, `side-shell`). 주변: 도크 벽·안벽, 앞에 탑재된 선체(비계), 뒤에 대기 블록, 골리앗·지브 크레인, 블록 옆 작업 장비(운영자 책상, 로봇 투입 카트, 송풍기·덕트, 가스 랙, 분전반, 적치 자재, 비계 타워, 고소 작업대, 안전 펜스) | 4족 자석발 이동 용접 로봇 2대 |

M1~M3의 고정 셀 조선소 사이트 `shipyard`는 ship-block으로 대체하고 지웠다(2026-11-18). 고정 로봇 셀은 `factory`가 검사한다.

이동 로봇 사이트는 셀에 `Plate`를 두지 않는다. 셀 자세는 대기 위치이고, 움직이는 동안은 `robot/state.base`가 자세를 준다.
용접선이 놓이는 면은 에셋 생성기가 형상과 같은 숫자로 `Surfaces/*` 기준점(role `surface`, `innoworks:sizeMm`, 회전 허용)을 쓰고, `build.py`가 site-config `surfaces`로 옮긴다.

## 사이트 추가하기 (M4에서 공장으로 확인)

프론트 코드는 고치지 않는다. 아래만 하면 랩의 `site=` 인자와 모든 검사에 새 사이트가 들어온다.

1. 배경 에셋: `assets/gen/make_assets.py`에 함수를 더하고 `ASSETS`에 등록한다. 셀 소품(테이블·받침대·마킹)은 다시 쓴다.
2. `sites/{site}.usda`: 기본 prim 이름(PascalCase) = 사이트 id. 셀마다 `Robot`·`Plate` 기준점. 셀 회전은 `xformOp:rotateZ`.
3. `build.py` → `site-config/{site}.json`과 `frontend/public/sites/{site}.glb`. 전경 프리셋이 마음에 안 들면 site-config에서 고친다(다시 빌드해도 남는다).
4. 픽스처: `fixtures/make_fixtures.py`의 `FIXTURES`에 `{site}-…` 이름으로 더한다. 경로 제안이 있는 픽스처가 하나는 있어야 한다.
5. `harness/e2e/shots.json`에 기준 장면, `harness/budget.json`의 `scenes`에 성능 장면을 더한다. 없으면 `sites.spec.ts`가 실패한다.
6. `check.sh --candidates` → 사람 승인 → `--update-golden`.

배경을 놓을 때 알아 둘 것: 키 라이트의 그림자 범위는 셀과 프리셋 목표를 2m 여유로 감싼 영역뿐이다(`scene/Lighting.tsx`). 그 밖에 선 높은 물체(벽, 기둥, 크레인)는 그림자 끝만 범위에 걸려 바닥에 잘린 조각으로 보일 수 있다. 셀에서 충분히 떨어뜨리거나 키 라이트 반대쪽(+X, +Y)에 둔다. 공장 왼쪽 벽을 x=-9에서 -11로 옮긴 이유다.

## 작업 순서

마일스톤과 통과 조건은 [spec.md](spec.md) 6절을 따른다.

1. M0 하네스 뼈대와 계약(스키마, 픽스처, 빈 트윈 랩, 검사 명령)
2. M1 박스 수준의 임시 에셋으로 조선소 사이트 1개를 끝까지 통과시킨다(USD → GLB → 웹 표시)
3. M2 동적 층 완성(상태, 알람, 진행률, 선택)
4. M3 품질 올리기(조명·그림자·재질, 로봇과 조선소 에셋)
5. M4 공장 사이트 추가(프론트 코드 변경 0줄)
6. M5 프론트 통합

## 다음에 쪼갤 문서

- `assets.md` 에셋 목록, 모델링 기준, 재질 라이브러리
- `pipeline.md` 빌드 스크립트 상세
- `site-config.md` 설정 스키마
- `robot-model.md` URDF와 관절 매핑
