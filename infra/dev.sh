#!/usr/bin/env bash
# 맥 개발 실행: MQTT 브로커(aedes, tcp 1883 / ws 9001) + 프론트 개발 서버 + 서버.
#   infra/dev.sh                     브로커 + 관제 서버(server/, Mock 어댑터: vision·robot·camera, ship-block) + 프론트
#   infra/dev.sh server factory      서버 사이트를 바꾼다
#   infra/dev.sh mock [사이트]        서버 대신 Node Mock 서버(tools/mock-server.mjs)
#   MOCK=robot,camera infra/dev.sh   Mock으로 쓸 어댑터를 고른다(빼면 실제 어댑터, server/adapters/)
#   infra/dev.sh play ship-block-weld  Mock 서버 대신 픽스처를 반복 재생(명령에는 답하지 않는다)
#   LAN=1 infra/dev.sh               같은 네트워크의 태블릿에서 열 수 있게 프론트를 모든 주소에 연다(http://<맥 IP>:5173/)
# 관제 화면: http://localhost:5173/?site=ship-block   트윈 랩(실시간): /lab?site=ship-block&source=mqtt
set -eu
cd "$(dirname "$0")/.."
mode="${1:-server}"
arg="${2:-ship-block}"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

node infra/broker.mjs &
pids+=($!)
sleep 1
if [ "$mode" = server ] && [ ! -x server/.venv/bin/python ]; then
  echo "server/.venv가 없다: uv sync --project server 를 먼저 한다(그 전에는 infra/dev.sh mock)" >&2; exit 2
fi
case "$mode" in
  server) (cd server && exec .venv/bin/python -m app --site "$arg" --mock "${MOCK:-vision,robot,camera}") & pids+=($!) ;;
  mock) node tools/mock-server.mjs --site "$arg" & pids+=($!) ;;
  play) node tools/play.mjs "$arg" --loop & pids+=($!) ;;
  *) echo "모르는 모드: $mode (server, mock, play)" >&2; exit 2 ;;
esac
# 관제 화면 기본 사이트를 서버 사이트와 맞춘다(재생 모드는 frontend/.env 기본값)
if [ "$mode" != play ]; then export VITE_DEFAULT_SITE="$arg"; fi
if [ "${LAN:-0}" = 1 ]; then
  npm run dev -w frontend -- --host &
else
  npm run dev -w frontend &
fi
pids+=($!)
wait
