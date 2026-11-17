---
description: 디지털 트윈 하네스 검사를 돌리고 결과를 요약한다
argument-hint: "[--level N | --perf]"
---

저장소 루트에서 `digital-twin/harness/check.sh $ARGUMENTS`를 실행한다(2분 넘게 걸릴 수 있으니 timeout을 넉넉히 준다).

보고:
1. 스크립트가 끝에 출력한 결과 표를 그대로 붙인다.
2. 실패한 단계마다 로그(`digital-twin/harness/out/logs/`)에서 원인을 찾아 한두 줄로 적는다. L4가 실패했으면 `*-diff.png`와 `*-actual.png`를 열어 무엇이 달라졌는지 적는다.
3. `--perf`를 줬으면 `digital-twin/harness/out/stats.json`의 수치를 `digital-twin/harness/budget.json`의 예산과 나란히 적는다.

고치지 않는다. 기준 이미지 갱신, 예산 완화, 검사 건너뛰기는 제안만 하고 사람에게 묻는다.
