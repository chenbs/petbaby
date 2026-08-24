#!/usr/bin/env sh
# 备份 PostgreSQL 与对象存储卷到 deploy/backups/。
# 用法：./deploy/scripts/backup.sh [staging|production]
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
require_env_file
require_docker

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$DEPLOY_DIR/backups"
mkdir -p "$BACKUP_DIR"

DB_USER=$(env_value POSTGRES_USER)
DB_NAME=$(env_value POSTGRES_DB)
DB_FILE="$BACKUP_DIR/$MODE-db-$STAMP.sql.gz"

log "导出数据库到 $DB_FILE"
compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip > "$DB_FILE"

if [ "$MODE" = "staging" ]; then
  OBJECT_FILE="$BACKUP_DIR/$MODE-objects-$STAMP.tar.gz"
  # compose 项目名是 petbaby-staging，命名卷因此叫 petbaby-staging_object-data。
  VOLUME="petbaby-staging_object-data"
  log "打包对象存储卷到 $OBJECT_FILE"
  docker run --rm -v "$VOLUME:/data:ro" -v "$BACKUP_DIR:/backup" alpine:3 tar -czf "/backup/$(basename "$OBJECT_FILE")" -C /data .
fi

chmod 600 "$BACKUP_DIR"/*"$STAMP"* 2>/dev/null || true
log "备份完成，目录：$BACKUP_DIR（内含用户数据，不要提交到版本库）"
