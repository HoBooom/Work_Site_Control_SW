# 디지털 트윈

먼저 읽을 것: `docs/spec.md`(무엇을, 어느 수준까지), `docs/harness.md`(어떻게 검증하나).
현재 단계: M0 완료. 다음은 M1(박스 에셋으로 USD → GLB → 랩 표시, 관절 추종, 용접선).

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
digital-twin/harness/shot.sh "site=shipyard&fixture=idle&t=1000&preset=overview"
npm run dev -w frontend                    # http://localhost:5173/lab
python3 digital-twin/fixtures/make_fixtures.py   # 픽스처 재생성
npm run gen:types                          # 스키마 → frontend/src/contracts/messages.gen.ts
```

## 하지 않는 것

아래가 필요해 보이면 이유를 적고 사람에게 묻는다.

- 기준 이미지 갱신(`--update-golden`). 화면을 일부러 바꾼 작업이면 새 스크린샷을 보여 주고 승인을 받은 뒤에 한다.
- `budget.json`의 예산, `playwright.config.ts`의 허용 오차 완화
- 검사 건너뛰기(`test.skip`, `--grep`으로 빼기), `helpers.ts`의 콘솔 무시 목록에 우리 코드의 경고 넣기
- `contracts/schemas`, `contracts/topics.json` 변경
- 픽스처 JSONL 직접 편집. `make_fixtures.py`를 고친다.

## 코드 규칙

- 씬(`frontend/src/scene/`)은 site-config와 store만 읽는다. MQTT, 픽스처, 랩을 import하지 않는다.
- 사이트·셀 이름으로 분기하지 않는다(lint가 막는다). 필요하면 site-config에 항목을 더한다.
- 시간에 따라 바뀌는 연출은 벽시계가 아니라 랩의 가상 시계로 계산한다. `freeze=1`에서 화면이 멈춰야 한다.
- 좌표: site-config와 USD는 Z-up·m, three.js 씬은 Y-up. 사이트 그룹 안에서는 사이트 좌표를 그대로 쓴다(`scene/frame.ts`).
- 새 기능이 상태를 가지면 `window.__twin`에서 확인할 수 있게 한다. 테스트는 픽셀이 아니라 그 값으로 단언한다.

## 알아 둘 것

- Playwright 설정은 상대경로로 넘긴다. 이 저장소 경로에 한글이 있어 절대경로를 쓰면 macOS 유니코드 정규화 차이로 모듈이 두 번 로딩된다.
- 기준 이미지는 개발용 맥(M1 Max, ANGLE Metal)에서 만들었다. 다른 기기에서는 L4가 실패할 수 있다.
- Node 20.17이라 Vite 6, Vitest 3을 쓴다. Node 22로 올리면 Vite 7, Vitest 5로 올릴 수 있다.
