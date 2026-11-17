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
├─ assets/          재사용 단위: robot/, plate/, jig/, props/
├─ sites/           shipyard.usda, factory.usda  (assets를 reference로 조립)
├─ pipeline/        build.py(조립·검증·GLB 변환), validate.py, check_glb.py
├─ site-config/     shipyard.json, factory.json  (웹이 읽는 설정)
├─ fixtures/        시나리오 녹화본(JSONL). 트윈 랩과 tools/play.py가 같이 쓴다
└─ harness/         검사 명령, Playwright 테스트, 기준 스크린샷
```

- 에셋은 한 번 만들고 사이트에서 reference로 불러 쓴다. 로봇을 고치면 모든 셀에 반영된다.
- USD 설정: `upAxis = Z`, `metersPerUnit = 1`. 웹용 GLB는 Y-up으로 변환된다.
- 로봇은 URDF도 함께 둔다. 관절 이름이 `robot/state` 메시지의 관절 이름과 같아야 한다.

## 이름 규칙: prim 경로 = 토픽 = 설정 키

```
USD prim     /Shipyard/WeldCell1/Robot
토픽         innoworks/shipyard/weld-cell-1/robot/...
site-config  sites.shipyard.cells["weld-cell-1"]
```

웹은 토픽의 `{site}/{cell}`만 보고 갱신할 3D 객체를 찾는다. 사이트를 추가할 때는 USD 장면과 site-config만 더하고 코드는 고치지 않는다.

## site-config가 담는 것

- 배경 GLB 경로
- 셀 목록: id, 씬 안 위치·회전, 작업판 크기(mm), 로봇 URDF, 카메라 영상 주소
- 카메라 프리셋: 전경, 셀 클로즈업
- 판 좌표(mm) → 씬 좌표(m) 변환은 셀의 위치·회전에서 계산한다

## 파이프라인

1. Blender에서 에셋 모델링 → USD로 내보내기
2. `build.py`: usd-core로 사이트 조립, 규칙 검증(prim 경로, 단위, 축)
3. Blender 헤드리스로 GLB 내보내기 → `frontend/public/sites/`
4. site-config 생성 또는 갱신

## 작업 순서

마일스톤과 통과 조건은 [spec.md](spec.md) 6절을 따른다.

1. M0 하네스 뼈대와 계약(스키마, 픽스처, 빈 트윈 랩, 검사 명령)
2. M1 박스 수준의 임시 에셋으로 조선소 사이트 1개를 끝까지 통과시킨다(USD → GLB → 웹 표시)
3. M2 동적 층 완성(상태, 알람, 진행률, 선택)
4. M3 품질 올리기(조명·그림자·재질, 로봇과 조선소 에셋)
5. M4 공장 사이트 추가
6. M5 프론트 통합

## 다음에 쪼갤 문서

- `assets.md` 에셋 목록, 모델링 기준, 재질 라이브러리
- `pipeline.md` 빌드 스크립트 상세
- `site-config.md` 설정 스키마
- `robot-model.md` URDF와 관절 매핑
