---
description: 트윈 랩 장면 한 장을 찍어 보여 준다
argument-hint: "site=ship-block&fixture=ship-block-weld&t=8000&preset=spider-1"
---

저장소 루트에서 `digital-twin/harness/shot.sh "$ARGUMENTS"`를 실행한다. 인자가 비어 있으면 `site=ship-block&t=1000`을 쓴다(픽스처는 `{site}-idle`). 로봇만 보려면 `robot?robot=spider-welder&mount=wall`.

출력의 `SHOT <경로>` 파일을 Read로 열어 본 뒤, 보이는 것을 짧게 적는다. 품질 작업 중이면 `digital-twin/docs/spec.md` 2절의 품질 기준 표와 `digital-twin/docs/harness.md`의 사람 검수 항목 기준으로 부족한 점을 적는다. 출력에 `콘솔 문제`가 있으면 그것도 적는다.
