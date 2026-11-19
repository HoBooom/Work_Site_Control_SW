#!/usr/bin/env bash
# 맥 개발 실행: MQTT 브로커(aedes, tcp 1883 / ws 9001) + 프론트 개발 서버 + 서버 자리.
#   infra/dev.sh                     브로커 + Mock 서버(ship-block, 명령에 답한다) + 프론트
#   infra/dev.sh mock factory        Mock 서버 사이트를 바꾼다
#   infra/dev.sh play ship-block-weld  Mock 서버 대신 픽스처를 반복 재생(명령에는 답하지 않는다)
# 관제 화면: http://localhost:5173/?site=ship-block   트윈 랩(실시간): /lab?site=ship-block&source=mqtt
# 서버(FastAPI)가 생기면 Mock 서버 자리에 server --mock을 둔다.
set -eu
cd "$(dirname "$0")/.."
mode="${1:-mock}"
arg="${2:-ship-block}"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

node infra/broker.mjs &
pids+=($!)
sleep 1
case "$mode" in
  mock) node tools/mock-server.mjs --site "$arg" & pids+=($!) ;;
  play) node tools/play.mjs "$arg" --loop & pids+=($!) ;;
  *) echo "모르는 모드: $mode (mock 또는 play)" >&2; exit 2 ;;
esac
npm run dev -w frontend &
pids+=($!)
wait
