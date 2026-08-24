#!/usr/bin/env sh
# 从 backup.sh 产出的备份恢复。会覆盖现有数据，执行前请先停掉 web/worker。
# 用法：./deploy/scripts/restore.sh <db 备份.sql.gz> [objects 备份.tar.gz] [staging|production]
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

DB_BACKUP=${1:-}
OBJECT_BACKUP=${2:-}
resolve_mode "${3:-}"
require_env_file
require_docker

[ -n "$DB_BACKUP" ] || fail "用法：$0 <db 备份.sql.gz> [objects 备份.tar.gz] [staging|production]"
[ -f "$DB_BACKUP" ] || fail "找不到备份文件：$DB_BACKUP"

DB_USER=$(env_value POSTGRES_USER)
DB_NAME=$(env_value POSTGRES_DB)

log "停止 web 与 worker"
compose stop web worker

log "启动数据库并清空 public schema"
compose up -d db
compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

log "导入 $DB_BACKUP"
gunzip -c "$DB_BACKUP" | compose exec -T db psql -U "$DB_USER" -d "$DB_NAME"

if [ -n "$OBJECT_BACKUP" ]; then
  [ -f "$OBJECT_BACKUP" ] || fail "找不到对象备份：$OBJECT_BACKUP"
  log "恢复对象存储卷"
  BACKUP_ABS=$(CDPATH= cd -- "$(dirname -- "$OBJECT_BACKUP")" && pwd)
  docker run --rm -v "petbaby-${MODE}_object-data:/data" -v "$BACKUP_ABS:/backup:ro" alpine:3 \
    sh -c "rm -rf /data/* && tar -xzf /backup/$(basename "$OBJECT_BACKUP") -C /data"
fi

log "重新执行迁移并启动应用"
compose run --rm migrate
compose up -d web worker
"$SCRIPT_DIR/health-check.sh" "$MODE"
