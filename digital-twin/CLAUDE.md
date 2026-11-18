# 디지털 트윈

먼저 읽을 것: `docs/spec.md`(무엇을, 어느 수준까지), `docs/harness.md`(어떻게 검증하나).
현재 단계: M2 완료(2026-11-17, 기준 이미지 6장 승인). M3-a 완료(2026-11-17). M3-b(로봇·조선소 에셋 품질) 완료(2026-11-18, 기준 이미지 6장 승인). M3 사람 검수(realvirtual 참조 화면 비교)가 남아 있다. M4(공장 사이트, 프론트 코드 변경 0줄) 완료(2026-11-18, 기준 이미지 8장).

## 작업 루프

1. spec의 기능 ID 하나를 고른다. 완료 기준과 검증 단계(L0~L5, H)를 확인한다.
2. 완료 기준을 검사로 먼저 옮긴다. 그 검사가 실패하는 것을 확인한다.
3. 구현한다.
4. `digital-twin/harness/check.sh`를 돌린다. 화면이 바뀌면 `shot.sh`로 찍어 직접 본다.
5. 결과 표를 그대로 붙여 보고한다. 화면이 바뀌었으면 스크린샷 경로도 붙인다.

## 명령 (저장소 루트에서)

```
digital-twin/harness/check.sh              # L0~L4
digital-twin/harness/check.sh --level 2    # L0~L2, 저장할 때마다
digital-twin/harness/check.sh --perf       # L5 포함, 에셋을 바꿨거나 마일스톤을 닫을 때
digital-twin/harness/check.sh --candidates # 화면을 바꿨으면: 후보를 out/review/에 찍어 사람에게 보인다
digital-twin/harness/shot.sh "site=shipyard&fixture=idle&t=1000&preset=overview"
npm run dev -w frontend                    # http://localhost:5173/lab
python3 digital-twin/fixtures/make_fixtures.py   # 픽스처 재생성
npm run gen:types                          # 스키마 → frontend/src/contracts/messages.gen.ts
uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_assets.py   # 소품·배경 USD 생성
uv run --project digital-twin/pipeline python digital-twin/assets/gen/make_robot.py    # 대역 로봇 STL+URDF 생성
uv run --project digital-twin/pipeline python digital-twin/pipeline/build.py   # USD → GLB + site-config
```

## 하지 않는 것

아래가 필요해 보이면 이유를 적고 사람에게 묻는다.

- 기준 이미지 갱신(`--update-golden`). 화면을 일부러 바꾼 작업이면 `--candidates`로 후보를 찍어 보여 주고 승인을 받은 뒤에 한다.
- `budget.json`의 예산, `playwright.config.ts`의 허용 오차 완화
- 검사 건너뛰기(`test.skip`, `--grep`으로 빼기), `helpers.ts`의 콘솔 무시 목록에 우리 코드의 경고 넣기
- `contracts/schemas`, `contracts/topics.json` 변경
- 픽스처 JSONL 직접 편집. `make_fixtures.py`를 고친다.
- `assets/props/*.usda`(cell_marking 제외), `assets/robot/` 직접 편집. 생성기를 고친다.
- site-config의 cells 직접 편집. USD를 고치고 `build.py`를 돌린다.

## 코드 규칙

- 씬(`frontend/src/scene/`)은 site-config와 store만 읽는다. MQTT, 픽스처, 랩을 import하지 않는다.
- 사이트·셀 이름으로 분기하지 않는다(lint가 막는다). 필요하면 site-config에 항목을 더한다.
- 시간에 따라 바뀌는 연출은 벽시계가 아니라 랩의 가상 시계로 계산한다. `freeze=1`에서 화면이 멈춰야 한다.
- 좌표: site-config와 USD는 Z-up·m, three.js 씬은 Y-up. 사이트 그룹 안에서는 사이트 좌표를 그대로 쓴다(`scene/frame.ts`).
- 새 기능이 상태를 가지면 `window.__twin`에서 확인할 수 있게 한다. 테스트는 픽셀이 아니라 그 값으로 단언한다.

## 알아 둘 것

- 3D 위치를 따라다니는 글자는 `scene/ui/DomLabel`을 쓴다. drei `Html`은 Canvas를 다시 만들 때(사이트·품질 전환) React 동기 unmount 오류를 낸다.
- URDFLoader는 링크 메시가 오기 전에 로봇을 돌려준다. 전용 LoadingManager로 끝까지 기다린다(Robot.tsx loadUrdf).
- 키 라이트 그림자 범위는 셀 주변뿐이다. 멀리 선 높은 배경 물체는 그림자 끝이 잘린 조각으로 보이니 셀에서 떨어뜨린다(docs/README.md "사이트 추가하기").
- three 원기둥은 Y축 방향이다. 사이트 그룹(Z-up) 안에서 세우려면 X축으로 90° 돌린다.
- 후처리(EffectComposer)를 쓰므로 톤매핑은 렌더러가 아니라 `scene/Effects.tsx`의 ToneMapping(Neutral)이 맡는다. 렌더 통계는 `gl.info.autoReset`을 끄고 프레임마다 합계를 센다(Lab.tsx).
- three 0.187에는 PCFSoftShadowMap이 없다. R3F `shadows`는 "percentage"로 주고 부드러움은 `shadow.radius`로.
- GLTFLoader는 노드 이름의 `:`를 지운다. 씬에서 찾을 이름은 R3F 쪽 그룹에 붙인다.
- 테스트에서 파일 경로는 `fileURLToPath`로 만든다. `URL.pathname`은 한글을 퍼센트 인코딩한 채로 두어 엉뚱한 곳에 파일이 생긴다.
- Playwright 설정은 상대경로로 넘긴다. 이 저장소 경로에 한글이 있어 절대경로를 쓰면 macOS 유니코드 정규화 차이로 모듈이 두 번 로딩된다.
- 기준 이미지는 개발용 맥(M1 Max, ANGLE Metal)에서 만들었다. 다른 기기에서는 L4가 실패할 수 있다.
- Node 20.17이라 Vite 6, Vitest 3을 쓴다. Node 22로 올리면 Vite 7, Vitest 5로 올릴 수 있다.
