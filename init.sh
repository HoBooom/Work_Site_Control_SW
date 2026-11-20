#!/usr/bin/env bash
# welding-hitl 한 번에 실행: 준비(필요한 것만 설치) → 브로커 + 관제 서버 + 프론트.
#
#   ./init.sh                      준비하고 실행(사이트 ship-block, 서버는 Mock 어댑터)
#   ./init.sh server factory       다른 사이트로 실행
#   ./init.sh mock                 파이썬 서버 대신 Node Mock 서버(파이썬 환경이 없어도 된다)
#   ./init.sh play ship-block-weld 서버 대신 픽스처를 반복 재생(명령에는 답하지 않는다)
#   LAN=1 ./init.sh                같은 네트워크의 태블릿에서 http://<맥 IP>:5173/ 로 연다
#   MOCK=robot,camera ./init.sh    Mock으로 쓸 장비를 고른다(빠진 것은 실제 어댑터)
#   ./init.sh --setup              설치만 하고 실행하지 않는다
#   ./init.sh --check              무엇이 준비됐는지만 본다(설치·실행 없음)
#   ./init.sh --help
#
# 실행 부분은 infra/dev.sh가 맡는다. 이 스크립트는 그 앞의 준비와 점검을 더한다.
# 끝낼 때는 Ctrl+C. 브로커·서버·프론트가 함께 내려간다.
set -euo pipefail
cd "$(dirname "$0")"

bold=$'\033[1m'; red=$'\033[31m'; yellow=$'\033[33m'; green=$'\033[32m'; dim=$'\033[2m'; reset=$'\033[0m'
[ -t 1 ] || { bold=; red=; yellow=; green=; dim=; reset=; }
ok()   { echo "  ${green}✓${reset} $*"; }
warn() { echo "  ${yellow}!${reset} $*"; }
fail() { echo "  ${red}✗${reset} $*"; }
step() { echo; echo "${bold}$*${reset}"; }

action=run
case "${1:-}" in
  -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --setup) action=setup; shift ;;
  --check) action=check; shift ;;
esac
mode="${1:-server}"
site="${2:-ship-block}"
case "$mode" in
  server|mock|play) ;;
  *) echo "모르는 모드: $mode (server, mock, play). ./init.sh --help" >&2; exit 2 ;;
esac
need_python=0; [ "$mode" = server ] && need_python=1

problems=0

# ── 1. 도구 ────────────────────────────────────────────────
step "1. 필요한 도구"
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -ge 20 ]; then ok "Node $(node -v)"; else fail "Node $(node -v): 20 이상이 필요하다"; problems=$((problems + 1)); fi
else
  fail "Node가 없다. https://nodejs.org 에서 20 LTS를 설치한다(맥: brew install node@20)"; problems=$((problems + 1))
fi
if command -v uv >/dev/null 2>&1; then
  ok "uv $(uv --version | awk '{print $2}')"
elif [ "$need_python" = 1 ]; then
  fail "uv가 없다(파이썬 서버 환경 관리). 맥: brew install uv  ·  그 밖: https://docs.astral.sh/uv/  ·  서버 없이 보려면 ./init.sh mock"
  problems=$((problems + 1))
else
  warn "uv가 없다. $mode 모드에는 필요 없다"
fi
if [ "$problems" -gt 0 ]; then echo; echo "${red}도구가 모자라 멈춘다.${reset}"; exit 1; fi

# ── 2. 의존성 ──────────────────────────────────────────────
step "2. 의존성"
# 저장소 루트 + frontend 워크스페이스. 잠금 파일이 설치본보다 새것이면 다시 설치한다.
npm_stale=0
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then npm_stale=1
elif [ package-lock.json -nt node_modules/.package-lock.json ]; then npm_stale=1; fi
if [ "$npm_stale" = 0 ]; then ok "node_modules 최신"
elif [ "$action" = check ]; then warn "node_modules 설치·갱신 필요(npm install)"; problems=$((problems + 1))
else echo "  npm install …"; npm install --no-audit --no-fund; ok "node_modules 설치"; fi

if [ "$need_python" = 1 ]; then
  # uv가 잠금 파일(server/uv.lock)과 설치본을 비교한다. 바꿀 것이 없으면 아무것도 하지 않는다
  if [ -x server/.venv/bin/python ] && uv sync --project server --locked --check >/dev/null 2>&1; then
    ok "server/.venv 최신 ($(server/.venv/bin/python -V))"
  elif [ "$action" = check ]; then
    warn "server/.venv 설치·갱신 필요(uv sync --project server)"; problems=$((problems + 1))
  else
    echo "  uv sync --project server …"; uv sync --project server --locked; ok "server/.venv 준비 ($(server/.venv/bin/python -V))"
  fi
fi

# ── 3. 포트 ────────────────────────────────────────────────
step "3. 포트"
# 1883 브로커(TCP) · 9001 브로커(브라우저 WebSocket) · 8090 서버 영상·API · 5173 프론트
busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
port_names=("1883:브로커 TCP" "9001:브로커 WebSocket" "8090:서버 영상·API" "5173:프론트")
for entry in "${port_names[@]}"; do
  port="${entry%%:*}"; name="${entry#*:}"
  [ "$mode" = play ] && [ "$port" = 8090 ] && continue
  pid="$(busy "$port" || true)"
  if [ -z "$pid" ]; then ok "$port $name 비어 있음"; continue; fi
  cmd="$(LC_ALL=en_US.UTF-8 ps -o command= -p "$pid" 2>/dev/null | sed "s#^$HOME#~#; s# $HOME/# ~/#g")"
  if [ "$port" = 5173 ]; then
    front_busy=1
    warn "$port 사용 중(PID $pid: $cmd). 프론트는 다음 빈 포트(5174…)로 뜬다"
  else
    fail "$port $name 사용 중(PID $pid: $cmd)"
    echo "     ${dim}이미 npm run dev나 ./init.sh가 돌고 있으면 그 창을 쓰거나 Ctrl+C로 끈다. 남은 프로세스면: kill $pid${reset}"
    problems=$((problems + 1))
  fi
done

if [ "$action" = check ]; then
  echo
  if [ "$problems" = 0 ]; then echo "${green}준비됐다.${reset} ./init.sh 로 실행한다."; else echo "${yellow}위의 ${problems}가지를 먼저 해결한다.${reset}"; fi
  exit 0
fi
if [ "$action" = setup ]; then
  echo; echo "${green}설치 끝.${reset} 실행: ./init.sh"
  [ "$problems" -gt 0 ] && echo "${yellow}포트 ${problems}개가 사용 중이다. 실행 전에 비운다.${reset}"
  exit 0
fi
if [ "$problems" -gt 0 ]; then echo; echo "${red}포트가 사용 중이라 멈춘다.${reset}"; exit 1; fi

# ── 4. 실행 ────────────────────────────────────────────────
host=localhost
if [ "${LAN:-0}" = 1 ]; then
  lan_ip="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$lan_ip" ] && host="$lan_ip"
fi
step "4. 실행 (모드 $mode, $([ "$mode" = play ] && echo "픽스처" || echo "사이트") $site)"
case "$mode" in
  server) echo "  브로커(1883/9001) + 파이썬 관제 서버(Mock: ${MOCK:-vision,robot,camera}) + 프론트" ;;
  mock)   echo "  브로커(1883/9001) + Node Mock 서버 + 프론트" ;;
  play)   echo "  브로커(1883/9001) + 픽스처 반복 재생 + 프론트(명령 버튼은 응답이 없다)" ;;
esac
# play 모드의 인자는 픽스처 이름이다(factory-…, ship-block-…). 사이트는 그 앞부분
lab_site="$site"
if [ "$mode" = play ]; then case "$site" in factory*) lab_site=factory ;; *) lab_site=ship-block ;; esac; fi
cat <<EOF

  ${bold}관제 화면${reset}   http://$host:5173/?site=$lab_site
  트윈 랩     http://$host:5173/lab?site=$lab_site&source=mqtt
  로봇 랩     http://$host:5173/lab/robot
EOF
if [ "$mode" = server ]; then echo "  서버 API    http://localhost:8090/api/docs  ·  /health  ·  /api/tasks"; fi
if [ "${front_busy:-0}" = 1 ]; then echo "  ${yellow}5173이 사용 중이다. 위 주소의 5173 대신 아래 Vite가 찍는 Local 주소의 포트를 쓴다${reset}"; fi
echo
echo "  ${dim}처음 뜨는 데 5~10초. 끝내려면 Ctrl+C.${reset}"
echo
exec infra/dev.sh "$mode" "$site"
