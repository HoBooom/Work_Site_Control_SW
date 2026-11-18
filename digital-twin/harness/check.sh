#!/usr/bin/env bash
# 디지털 트윈 검사 진입점. digital-twin/docs/harness.md "검사 단계".
#
#   check.sh                  L0~L4
#   check.sh --level 2        L0~L2만(빠른 확인)
#   check.sh --perf           L5 포함
#   check.sh --candidates     L4 장면을 out/review/에 후보로 찍는다(기준 이미지는 그대로). 사람이 보고 승인한다
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
CANDIDATES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --level) LEVEL="$2"; shift 2 ;;
    --perf) PERF=1; shift ;;
    --update-golden) UPDATE_GOLDEN=1; shift ;;
    --candidates) CANDIDATES=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
[ "$PERF" = 1 ] && LEVEL=5

cd "$ROOT"
rm -rf "$LOGS" "$OUT/test-results"; mkdir -p "$LOGS"
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

note() { ROWS+=("$1|$2|해당 없음|-|$3"); printf -- '- %-3s %-22s 해당 없음: %s\n' "$1" "$2" "$3"; }

# pw <단계> <인자...>: 단계마다 결과 폴더를 따로 쓴다(out/test-results/<단계>)
pw() { local lvl="$1"; shift; PW_OUTPUT_DIR="./out/test-results/$lvl" npx playwright test -c "$PW_CONFIG" "$@"; }

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
    command -v uv >/dev/null || { echo "uv가 없다. https://docs.astral.sh/uv/ 로 설치한다." >&2; exit 2; }
    PY=(uv run --frozen --project digital-twin/pipeline python)
    step L1 "에셋 생성기 최신" "${PY[@]}" digital-twin/assets/gen/make_assets.py --check
    step L1 "로봇 생성기 최신" "${PY[@]}" digital-twin/assets/gen/make_robot.py --check
    step L1 "USD 규칙" "${PY[@]}" digital-twin/pipeline/validate.py
    step L1 "파이프라인 테스트" "${PY[@]}" -m unittest discover -s digital-twin/pipeline -p "test_*.py"
    step L1 "빌드 결과 최신" "${PY[@]}" digital-twin/pipeline/build.py --check
    step L1 "GLB 예산" "${PY[@]}" digital-twin/pipeline/check_glb.py
  else
    note L1 "에셋" "digital-twin/sites/에 USD가 아직 없다(M1에서 추가)"
  fi
fi

# L2 단위
[ "$LEVEL" -ge 2 ] && step L2 "단위 테스트" npx vitest run --root frontend

# L3 씬 상태, L4 스크린샷
[ "$LEVEL" -ge 3 ] && step L3 "씬 상태" pw L3 --grep @L3
if [ "$LEVEL" -ge 4 ]; then
  if [ "$CANDIDATES" = 1 ]; then
    rm -rf "$OUT/review"
    step L4 "후보 이미지" env GOLDEN_DIR="$OUT/review" npx playwright test -c "$PW_CONFIG" --grep @L4 --update-snapshots=all
    echo "후보: ${OUT#$ROOT/}/review/ (승인하면 --update-golden)"
  elif [ "$UPDATE_GOLDEN" = 1 ]; then
    step L4 "기준 이미지 갱신" pw L4 --grep @L4 --update-snapshots=all
  else
    step L4 "스크린샷 비교" pw L4 --grep @L4
  fi
fi

# L5 성능
[ "$LEVEL" -ge 5 ] && step L5 "성능 예산" pw L5 --grep @perf

echo
echo "| 단계 | 검사 | 결과 | 시간 | 비고 |"
echo "| --- | --- | --- | --- | --- |"
for r in "${ROWS[@]}"; do
  IFS='|' read -r a b c d e <<<"$r"
  echo "| $a | $b | $c | $d | $e |"
done
[ -f "$OUT/stats.json" ] && [ "$LEVEL" -ge 5 ] && echo && echo "성능 수치: ${OUT#$ROOT/}/stats.json"
if [ "$LEVEL" -ge 4 ]; then
  for f in "$OUT"/test-results/L4/*/*-actual.png; do
    [ -e "$f" ] || continue
    echo "찍은 화면: ${f#$ROOT/}"
    d="${f%-actual.png}-diff.png"
    [ -e "$d" ] && echo "  기준과 차이: ${d#$ROOT/}"
  done
fi

exit $FAILED
