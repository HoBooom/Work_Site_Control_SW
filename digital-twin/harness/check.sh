#!/usr/bin/env bash
# 디지털 트윈 검사 진입점. digital-twin/docs/harness.md "검사 단계".
#
#   check.sh                  L0~L4
#   check.sh --level 2        L0~L2만(빠른 확인)
#   check.sh --perf           L5 포함
#   check.sh --update-golden  L4 기준 이미지 갱신. 사람이 승인한 뒤에만 쓴다.
#
# 실패하면 종료 코드가 0이 아니다. 로그는 digital-twin/harness/out/logs/.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out"
LOGS="$OUT/logs"
PW_CONFIG="digital-twin/harness/playwright.config.ts"  # 상대경로: 한글 경로의 유니코드 정규화 차이로 모듈이 두 번 로딩되는 것을 피한다

LEVEL=4
PERF=0
UPDATE_GOLDEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --level) LEVEL="$2"; shift 2 ;;
    --perf) PERF=1; shift ;;
    --update-golden) UPDATE_GOLDEN=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
[ "$PERF" = 1 ] && LEVEL=5

cd "$ROOT"
rm -rf "$LOGS"; mkdir -p "$LOGS"
[ -d node_modules ] || { echo "node_modules가 없다. 저장소 루트에서 npm install을 먼저 한다." >&2; exit 2; }

ROWS=()
FAILED=0

# step <단계> <이름> <명령...>
step() {
  local lvl="$1" name="$2"; shift 2
  local log="$LOGS/${lvl}-${name// /_}.log"
  local t0=$SECONDS
  printf '… %-3s %-22s' "$lvl" "$name"
  if "$@" >"$log" 2>&1; then
    printf '\r✓ %-3s %-22s %4ss\n' "$lvl" "$name" "$((SECONDS - t0))"
    ROWS+=("$lvl|$name|통과|$((SECONDS - t0))s|")
  else
    printf '\r✗ %-3s %-22s %4ss\n' "$lvl" "$name" "$((SECONDS - t0))"
    ROWS+=("$lvl|$name|실패|$((SECONDS - t0))s|${log#$ROOT/}")
    FAILED=1
    echo "----- ${log#$ROOT/} (마지막 40줄) -----"
    tail -n 40 "$log"
    echo "-----"
  fi
}

note() { ROWS+=("$1|$2|해당 없음|-|$3"); printf '- %-3s %-22s 해당 없음: %s\n' "$1" "$2" "$3"; }

pw() { npx playwright test -c "$PW_CONFIG" "$@"; }

# L0 정적
step L0 "타입(frontend)" npx tsc --noEmit -p frontend
step L0 "타입(harness)" npx tsc -p digital-twin/harness/tsconfig.json
step L0 "lint" npm run lint -w frontend --silent
step L0 "생성 타입 최신" node contracts/gen-types.mjs --check
step L0 "픽스처 최신" python3 digital-twin/fixtures/make_fixtures.py --check
step L0 "스키마·데이터" node digital-twin/harness/validate-data.mjs

# L1 에셋
if [ "$LEVEL" -ge 1 ]; then
  if ls digital-twin/sites/*.usd* >/dev/null 2>&1; then
    step L1 "USD 규칙" python3 digital-twin/pipeline/validate.py
    step L1 "GLB 예산" python3 digital-twin/pipeline/check_glb.py
  else
    note L1 "에셋" "digital-twin/sites/에 USD가 아직 없다(M1에서 추가)"
  fi
fi

# L2 단위
[ "$LEVEL" -ge 2 ] && step L2 "단위 테스트" npx vitest run --root frontend

# L3 씬 상태, L4 스크린샷
[ "$LEVEL" -ge 3 ] && step L3 "씬 상태" pw --grep @L3
if [ "$LEVEL" -ge 4 ]; then
  if [ "$UPDATE_GOLDEN" = 1 ]; then
    step L4 "기준 이미지 갱신" pw --grep @L4 --update-snapshots
  else
    step L4 "스크린샷 비교" pw --grep @L4
  fi
fi

# L5 성능
[ "$LEVEL" -ge 5 ] && step L5 "성능 예산" pw --grep @perf

echo
echo "| 단계 | 검사 | 결과 | 시간 | 비고 |"
echo "| --- | --- | --- | --- | --- |"
for r in "${ROWS[@]}"; do
  IFS='|' read -r a b c d e <<<"$r"
  echo "| $a | $b | $c | $d | $e |"
done
[ -f "$OUT/stats.json" ] && [ "$LEVEL" -ge 5 ] && echo && echo "성능 수치: ${OUT#$ROOT/}/stats.json"
[ "$LEVEL" -ge 4 ] && [ -d "$OUT/test-results" ] && ls "$OUT"/test-results/*/*-diff.png >/dev/null 2>&1 \
  && echo "스크린샷 차이: $(ls "$OUT"/test-results/*/*-diff.png | sed "s#$ROOT/##")"

exit $FAILED
