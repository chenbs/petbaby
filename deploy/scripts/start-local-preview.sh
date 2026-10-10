#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/../.." && pwd)

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$script_dir/start-local-preview.ps1")" "$@"
    ;;
esac

command -v corepack >/dev/null 2>&1 || { echo "corepack is required" >&2; exit 1; }
command -v setsid >/dev/null 2>&1 || { echo "setsid is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

host_ip=${1:-}
if [ -z "$host_ip" ] && command -v ip >/dev/null 2>&1; then
  host_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')
fi
if [ -z "$host_ip" ]; then
  echo "No local IPv4 address found. Pass the host IP as the first argument." >&2
  exit 1
fi

state_dir="$repo_dir/apps/platform/.data/local-preview"
for name in platform worker website; do
  pid_file="$state_dir/$name.pid"
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$name preview is already running (PID $(cat "$pid_file"))" >&2
    exit 1
  fi
done
mkdir -p "$state_dir"

# 与生产同构：本地 PostgreSQL（DATABASE_URL 写在 .env.local）+ Web + 独立 Worker。
(cd "$repo_dir/apps/platform" && node scripts/local-db.mjs start)
(
  cd "$repo_dir/apps/platform"
  setsid corepack pnpm worker >"$state_dir/worker.out.log" 2>"$state_dir/worker.err.log" </dev/null &
  echo $! >"$state_dir/worker.pid"
)
(
  cd "$repo_dir/apps/platform"
  setsid env NODE_ENV=development APP_ENV=local \
    OBJECT_STORAGE_PROVIDER=local LOCAL_STORAGE_DIR=.data/objects \
    PAYMENT_PROVIDER=development PHYSICAL_PAYMENT_PROVIDER=development \
    PASSWORD_AUTH_ENABLED=true PUBLIC_APP_URL="http://$host_ip:3000" \
    corepack pnpm dev --hostname "$host_ip" --port 3000 \
    >"$state_dir/platform.out.log" 2>"$state_dir/platform.err.log" </dev/null &
  echo $! >"$state_dir/platform.pid"
)
(
  cd "$repo_dir/apps/website"
  setsid env SITE_URL="http://$host_ip:4321" \
    corepack pnpm dev --host "$host_ip" --port 4321 \
    >"$state_dir/website.out.log" 2>"$state_dir/website.err.log" </dev/null &
  echo $! >"$state_dir/website.pid"
)

ready() {
  local port=$1 path=$2
  for ((attempt = 0; attempt < 60; attempt++)); do
    if curl --noproxy '*' -fsS --max-time 2 -o /dev/null "http://$host_ip:$port$path"; then return 0; fi
    sleep 1
  done
  echo "Port $port did not become ready; check logs in $state_dir" >&2
  return 1
}

if ! ready 3000 /api/health || ! ready 4321 /; then
  bash "$script_dir/stop-local-preview.sh"
  exit 1
fi

printf 'Platform and H5: http://%s:3000\nWebsite:         http://%s:4321\nLogs:            %s\n' "$host_ip" "$host_ip" "$state_dir"
printf 'Stop:            bash deploy/scripts/stop-local-preview.sh\n'
