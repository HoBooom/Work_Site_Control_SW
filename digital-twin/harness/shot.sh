#!/usr/bin/env bash
# 트윈 랩 장면 한 장을 찍어 digital-twin/harness/out/shots/에 저장한다.
#   shot.sh "site=shipyard&fixture=idle&t=1000&preset=overview"
#   shot.sh "robot?robot=spider-welder&mount=wall"   로봇 랩(/lab/robot)
# freeze=1, hud=0이 기본이다. 개발 서버가 없으면 띄운다.
set -eu
[ $# -eq 1 ] || { sed -n '2,4p' "$0"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.."
SHOT_QUERY="$1" npx playwright test -c digital-twin/harness/playwright.config.ts --grep @shot --reporter=line 2>&1 \
  | grep -E '^(SHOT |콘솔 문제|\[|Error|  [0-9]+\) )' || true
