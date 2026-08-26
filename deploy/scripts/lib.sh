#!/usr/bin/env sh
# 公共函数库，由同目录下的其他脚本 `. lib.sh` 引入，不单独执行。

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$DEPLOY_DIR/.." && pwd)

log() { printf '\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$1" >&2; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$1" >&2; exit 1; }

# staging = 测试机（本地磁盘存储 + 模拟支付）；production = 正式生产（全部真实凭据）。
resolve_mode() {
  MODE=${1:-${PETBABY_MODE:-staging}}
  case "$MODE" in
    staging|production) ;;
    *) fail "未知模式：$MODE（只能是 staging 或 production）" ;;
  esac
  ENV_FILE="$DEPLOY_DIR/.env.$MODE"
  ENV_EXAMPLE="$DEPLOY_DIR/.env.$MODE.example"
  COMPOSE_FILE="$DEPLOY_DIR/compose.$MODE.yaml"
  [ -f "$COMPOSE_FILE" ] || fail "缺少编排文件：$COMPOSE_FILE"
}

require_env_file() {
  [ -f "$ENV_FILE" ] || fail "缺少环境变量文件 $ENV_FILE，先执行：$SCRIPT_DIR/gen-env.sh <域名> <邮箱>"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "未找到 docker，请先安装 Docker Engine 26+"
  docker compose version >/dev/null 2>&1 || fail "未找到 docker compose v2 插件"
  docker info >/dev/null 2>&1 || fail "当前用户无法访问 Docker daemon，请使用 sudo 或执行 usermod -aG docker \$USER 后重新登录"
}

check_docker_storage() {
  docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  [ -n "$docker_root" ] || { warn "无法读取 DockerRootDir，跳过文件系统兼容性检查"; return 0; }

  fs_type=""
  if command -v findmnt >/dev/null 2>&1; then
    fs_type=$(findmnt -T "$docker_root" -n -o FSTYPE 2>/dev/null | awk 'NF { print $1; exit }' || true)
  fi
  if [ -z "$fs_type" ] && command -v stat >/dev/null 2>&1; then
    fs_type=$(stat -f -c %T "$docker_root" 2>/dev/null || true)
  fi

  case "$fs_type" in
    nfs|nfs4|cifs|smb*|9p|fuse*|glusterfs|ceph|lustre|afs|davfs)
      fail "Docker 数据根目录 $docker_root 位于 $fs_type 文件系统；Docker 创建命名卷会复制 system.nfs4_acl 而失败。请将 Docker data-root 迁移到本地 ext4/xfs 后重试（见 docs/delivery/02-deployment-guide.md）。"
      ;;
  esac
}

check_host_compatibility() {
  if [ -r /etc/centos-release ] && grep -qE 'release 7\.' /etc/centos-release; then
    warn "检测到 CentOS 7（已于 2024-06-30 结束生命周期）。仅建议用于临时测试机，不建议承载正式生产。"
    if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
      warn "SELinux 当前为 Enforcing；请确认宿主机 Nginx 的 80/443 和 Certbot 路径策略，否则可能出现 403 或证书读取失败。"
    fi
    if command -v firewall-cmd >/dev/null 2>&1 && ! systemctl is-active --quiet firewalld; then
      warn "firewalld 未运行；请确认云安全组和其他防火墙已放行 80/443。"
    fi
  fi
}

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# 在仓库目录里执行 git。不用 `git -C`：CentOS 7 自带 git 1.8.3 不认这个选项
# （报 "Unknown option: -C"），而测试机就是 CentOS 7。子 shell 里 cd 各版本都支持。
# GIT_PAGER=cat 是防止 log 之类在非交互场景下卡在分页器里。
git_at() { ( cd "$REPO_DIR" && GIT_PAGER=cat git "$@" ); }

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

set_env() {
  awk -v key="$1" -v value="$2" '
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

random_hex() {
  bytes=${1:-32}
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -v -tx1 | tr -d ' \n'
  fi
}
