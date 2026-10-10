#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/../.." && pwd)

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$script_dir/stop-local-preview.ps1")"
    ;;
esac

state_dir="$repo_dir/apps/platform/.data/local-preview"
found=0
for name in platform worker website; do
  pid_file="$state_dir/$name.pid"
  if [ ! -f "$pid_file" ]; then continue; fi
  found=1
  pid=$(cat "$pid_file")
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    group=$(ps -o pgid= -p "$pid" | tr -d ' ')
    if [ "$group" = "$pid" ]; then kill -TERM -- "-$group"; else kill -TERM "$pid"; fi
  fi
  rm -f -- "$pid_file"
done
if [ "$found" -eq 0 ]; then echo 'No local preview process record found.' >&2; exit 1; fi
echo 'Local preview services stopped.'
