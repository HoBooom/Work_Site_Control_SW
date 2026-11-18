#!/usr/bin/env bash
# 맥 개발 실행(M5): MQTT 브로커(aedes, tcp 1883 / ws 9001) + 프론트 개발 서버. 서버가 생기면 여기에 더한다(server --mock).
#   infra/dev.sh                       브로커 + 프론트(http://localhost:5173)
#   infra/dev.sh ship-block-weld       위에 더해 픽스처를 브로커로 반복 재생(서버 대신)
# 관제 화면: http://localhost:5173/?site=ship-block   트윈 랩(실시간): http://localhost:5173/lab?site=ship-block&source=mqtt
set -eu
cd "$(dirname "$0")/.."
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

node infra/broker.mjs &
pids+=($!)
sleep 1
npm run dev -w frontend &
pids+=($!)
if [ $# -ge 1 ]; then
  sleep 2
  node tools/play.mjs "$1" --loop &
  pids+=($!)
fi
wait
