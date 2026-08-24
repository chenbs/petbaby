#!/usr/bin/env sh
# 查看容器日志。
# 用法：./deploy/scripts/logs.sh [staging|production] [web|worker|db|migrate]
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
require_env_file
SERVICE=${2:-}

if [ -n "$SERVICE" ]; then
  compose logs -f --tail=200 "$SERVICE"
else
  compose logs -f --tail=100
fi
