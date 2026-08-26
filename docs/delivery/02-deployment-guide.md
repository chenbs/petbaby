# 部署总手册（测试机与正式生产）

更新：2026-07-27 ｜ 覆盖范围：`apps/platform`（Web/H5/REST API/管理后台/Worker）、`apps/miniprogram`（微信小程序）、PostgreSQL、对象存储、反向代理

这份文档是唯一的部署入口。小程序的上传与发布步骤在 [`03-miniprogram-release.md`](03-miniprogram-release.md)，环境变量逐项说明在 [`04-environment-reference.md`](04-environment-reference.md)，还没拿到的外部凭据在 [`../operations/04-external-prerequisites.md`](../operations/04-external-prerequisites.md)。

---

## 0. 先读这一节：两种部署模式

仓库支持两种模式，**用同一套镜像和脚本**，靠 `APP_ENV` 区分：

|                        | `staging`（测试机，本次要做的）          | `production`（正式生产）                  |
| ---------------------- | ----------------------------- | ----------------------------------- |
| 环境变量文件                 | `deploy/.env.staging`         | `deploy/.env.production`            |
| 编排文件                   | `deploy/compose.staging.yaml` | `deploy/compose.production.yaml`    |
| `NODE_ENV` / `APP_ENV` | `production` / `staging`      | `production` / 不设置                  |
| 登录方式                   | 账号密码注册登录 + 微信登录（补齐 AppID 后）   | 微信登录为主                              |
| 对象存储                   | **服务器本地磁盘**（Docker 命名卷）       | 必须 S3 兼容云存储，缺凭据直接 503               |
| 支付                     | 模拟支付（可走通解锁流程，不产生真实交易）         | 必须微信支付 v3                           |
| HTTPS                  | 宿主机 Nginx + Certbot/云证书       | 宿主机 Nginx / 云负载均衡                   |
| 反向代理                   | 宿主机 Nginx → `127.0.0.1:3000`  | 宿主机 Nginx → `127.0.0.1:3000` / 云 LB |

`APP_ENV=staging` 是**唯一**能让生产构建接受本地磁盘存储和模拟支付的开关。正式生产设置这个值会被 `preflight.sh` 直接拒绝。

---

## 1. 环境要求

### 1.1 服务器

| 用途        | CPU / 内存  | 磁盘         | 说明                       |
| --------- | --------- | ---------- | ------------------------ |
| 本次测试机（最低） | 2 核 4 GB  | 40 GB SSD  | 能跑完整链路；视频渲染较慢            |
| 测试机（推荐）   | 4 核 8 GB  | 60 GB SSD  | FFmpeg 视频玩法体验正常          |
| 正式首发      | 4 核 8 GB  | 80 GB SSD  | PostgreSQL、Web、Worker 同机 |
| 稳定运营      | 8 核 16 GB | 100 GB SSD | 数据库改托管实例，Worker 独立机      |

架构：Linux x86_64。线上推荐 Ubuntu 24.04；测试机如果使用 CentOS 7.4 仅作为临时测试环境，照片、预览图、成品和视频都写在本地磁盘，磁盘按「预计测试图片数 × 3MB × 3（原图+预览+成品）」预留。

> CentOS 7 已于 2024-06-30 结束生命周期。部署脚本会识别 CentOS 7 并给出警告，但不会自动切换软件源、关闭 SELinux 或修改防火墙；这些动作会改变宿主机安全边界，应由管理员明确执行。正式生产不要使用 CentOS 7.4。

### 1.2 软件

| 软件             | 版本                       | 说明                             |
| -------------- | ------------------------ | ------------------------------ |
| Docker Engine  | 26+                      | 部署脚本唯一硬依赖                      |
| Docker Compose | v2（`docker compose` 子命令） | 不是老的 `docker-compose`          |
| git            | 任意                       | 拉代码                            |
| curl           | 任意                       | 健康检查                           |
| openssl        | 可选                       | 生成随机密钥；缺失时脚本回落到 `/dev/urandom` |

容器内已包含 Node.js 22、pnpm、FFmpeg 6，**宿主机不需要装 Node.js**。

### 1.2.1 Docker 数据根目录必须使用本地文件系统

PostgreSQL 和对象命名卷要求 Docker 的 `DockerRootDir` 位于本地 ext4 或 xfs 文件系统。不要把 `/var/lib/docker`（或 `docker info` 显示的其他根目录）放在 NFS、CIFS/SMB、`fuse` 等网络或用户态文件系统上。Docker 在首次挂载命名卷时会复制扩展属性；NFS 不能写入 `system.nfs4_acl` 时会出现 `failed to copy xattrs`，容器甚至不会创建。

部署前检查：

```bash
docker info --format '{{.DockerRootDir}}'
findmnt -T "$(docker info --format '{{.DockerRootDir}}')" -o FSTYPE,SOURCE,TARGET
```

如果输出为 `nfs`/`nfs4`/`cifs` 或其他非本地类型，请先停 Docker，将数据根目录迁移到本地 SSD（例如 `/var/lib/docker-local`），再启动并确认 `DockerRootDir` 已改变。迁移前必须备份并保留旧目录，确认容器和卷均正常后再清理旧目录；不要为绕过错误直接执行 `docker compose down -v`，该命令会同时删除对象存储卷。

### 1.3 网络与域名

| 项目       | 要求                                                     |
| -------- | ------------------------------------------------------ |
| 域名       | 一个已备案的域名或子域，例如 `petbaby.example.com`                   |
| DNS      | A 记录指向测试机公网 IP，且已生效（`nslookup` 能解析）                    |
| 入站端口 80  | **必须对公网开放**，Certbot 的 HTTP-01 校验和 HTTP → HTTPS 跳转走这个端口 |
| 入站端口 443 | 必须对公网开放，正式访问入口                                         |
| 出站 443   | 需要能访问 Docker 镜像源、Certbot/ACME、AI/微信接口                  |
| 端口 3000  | **不需要**对外开放，Web 容器只在内网暴露                               |

云服务器要同时放开**安全组**和**系统防火墙**（`ufw` / `firewalld`）。80/443 由宿主机 Nginx 监听，Docker 编排不会占用这两个端口。

### 1.4 本次部署需要的外部凭据

**只需要一个域名。** 其余全部可以留空：

| 依赖                   | 测试机是否必需   | 缺失时的行为                 |
| -------------------- | --------- | ---------------------- |
| 已备案域名 + DNS          | **必需**    | 无法签发证书或配置云证书，HTTPS 不可用 |
| PostgreSQL           | 不需要额外准备   | 编排内自带 PostgreSQL 17 容器 |
| 对象存储凭据               | 不需要       | 落在服务器本地磁盘              |
| 微信 AppID / AppSecret | 不需要       | 微信登录不可用，改用账号密码登录       |
| 微信支付商户凭据             | 不需要       | 使用模拟支付，可走通解锁           |
| AI 图片接口              | 不需要       | AI 玩法返回内置 SVG 占位图      |
| 小程序上传私钥              | 上传体验版时才需要 | 只能在开发者工具模拟器里调试         |

---

## 2. 部署步骤

以下命令全部在**测试机**上执行。示例域名 `petbaby.example.com` 替换为你的真实域名。

### 2.1 安装 Docker

#### 方案 A：使用 Docker 官方脚本（网络可直连 Docker 下载站时）

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker            # 或者退出重新登录
docker compose version   # 应输出 v2.x
```

#### 方案 B：国内云服务器使用阿里云镜像源（推荐）

下面命令适用于阿里云、腾讯云、华为云等提供的标准 Ubuntu/Debian/Rocky/CentOS 云主机。命令只使用阿里云 Docker CE 软件源，不依赖 Docker Desktop；执行前确认当前用户具备 `sudo` 权限。CentOS 7.4 不建议继续使用下面的 CentOS 9 源，优先升级系统；若无法升级，只把它当临时测试机并单独处理 EOL 软件源。

Ubuntu 22.04/24.04：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

Debian 12：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/debian/gpg \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/debian $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

Rocky Linux 9 / CentOS Stream 9：

```bash
sudo dnf -y install dnf-plugins-core ca-certificates curl
sudo dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

CentOS 7.4 临时测试机（不推荐长期使用）：

```bash
# CentOS 7 已 EOL，标准镜像源可能返回 404；先切换到 vault.centos.org 归档源。
sudo sed -i \
  -e 's|^mirrorlist=|#mirrorlist=|g' \
  -e 's|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|g' \
  /etc/yum.repos.d/CentOS-*.repo
sudo yum clean all
sudo yum makecache fast
sudo yum install -y yum-utils device-mapper-persistent-data lvm2 ca-certificates curl
sudo yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

CentOS 7.4 上如果阿里云仓库不再提供兼容包，不要强行混装 CentOS 9/Stream 9 的 RPM；应将测试机升级到 Rocky 9/AlmaLinux 9/Ubuntu 24.04 后再部署。Docker Compose 必须是 `docker compose` v2，旧的 `docker-compose` v1 不受支持。

如果云主机启用了旧 Docker 包，先卸载冲突包再执行上面的安装命令：

```bash
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
# Rocky/CentOS 使用：
# sudo dnf remove -y docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman runc
```

确认 Compose、Buildx 和服务状态：

```bash
docker compose version
docker buildx version
sudo systemctl is-active docker
docker run --rm hello-world
```

`hello-world` 首次拉取仍可能访问 Docker Hub；若云服务器无法访问 Docker Hub，只需配置云厂商提供的容器镜像加速器后重启 Docker，再继续部署：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": ["https://你的云厂商容器镜像加速地址"]
}
JSON
sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | sed -n '/Registry Mirrors:/,/Live Restore Enabled/p'
```

镜像加速地址必须从当前云账号控制台复制，不能把示例地址直接用于生产。

如果已经遇到 `failed to resolve source metadata for docker.io/library/node:22-alpine` 或 `registry-1.docker.io:443 i/o timeout`，说明 Docker daemon 仍在直连 Docker Hub。先在宿主机配置镜像加速器并验证：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": ["https://你的云厂商容器镜像加速地址"]
}
JSON
sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | sed -n '/Registry Mirrors:/,/Live Restore Enabled/p'
docker pull node:22-alpine
docker pull postgres:17-alpine
```

如果镜像加速器仍不可用，也可以把镜像改成企业/云厂商仓库中的完整地址（地址和 Tag 必须先在该仓库确认存在）：

```bash
sed -i 's|^NODE_BASE_IMAGE=.*|NODE_BASE_IMAGE=你的仓库/node:22-alpine|' deploy/.env.staging
sed -i 's|^POSTGRES_IMAGE=.*|POSTGRES_IMAGE=你的仓库/postgres:17-alpine|' deploy/.env.staging
docker pull "$(sed -n 's/^NODE_BASE_IMAGE=//p' deploy/.env.staging)"
docker pull "$(sed -n 's/^POSTGRES_IMAGE=//p' deploy/.env.staging)"
./deploy/scripts/preflight.sh staging
./deploy/scripts/deploy.sh staging
```

部署脚本现在会在构建前预拉取并检查 `NODE_BASE_IMAGE`、`POSTGRES_IMAGE`；基础镜像不可达时会直接停止，并显示需要修改的环境变量，不会再等到 `migrate` 构建阶段才失败。

依赖安装还需要访问 npm registry。项目已将平台容器的 pnpm 固定为 `10.13.1`，并支持通过 `NPM_REGISTRY` 配置依赖镜像；容器使用 npm 安装固定版本 pnpm，不走 Corepack 的 `/pnpm/<version>` 下载路径，避免 npmmirror 返回 404。不要让容器自动选择 pnpm 11，否则可能出现 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。测试机推荐：

```env
PNPM_VERSION=10.13.1
NPM_REGISTRY=https://registry.npmmirror.com/
```

修改 `deploy/.env.staging` 后重新执行：

```bash
./deploy/scripts/preflight.sh staging
./deploy/scripts/deploy.sh staging
```

如果 `deploy/.env.staging` 是在本次配置项加入前生成的，不要用 `FORCE=1` 重建（会更换数据库和会话密钥），直接追加以下两行：

```bash
printf '\nPNPM_VERSION=10.13.1\nNPM_REGISTRY=https://registry.npmmirror.com/\n' >> deploy/.env.staging
chmod 600 deploy/.env.staging
```

### 2.2 放开防火墙

```bash
# Ubuntu / Debian
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw reload

# Rocky / CentOS
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

云控制台的安全组也要放开 80、443。

### 2.3 确认 DNS 已生效

```bash
nslookup petbaby.example.com
curl -s ifconfig.me; echo    # 对比本机公网 IP
```

两者一致再继续，否则证书签发或 Nginx 回源会失败。

### 2.4 拉取代码

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone <你的仓库地址> petbaby
sudo chown -R "$USER":"$USER" /opt/petbaby
cd /opt/petbaby
chmod +x deploy/scripts/*.sh
```

`chmod +x` 这一步不能省，Windows 上提交的脚本默认没有执行位。

### 2.5 配置测试机宿主机 Nginx 和 HTTPS

测试机的 Nginx 不在 Docker Compose 中运行，必须先在宿主机安装、申请证书并启用转发配置；完成后再执行下一节的 `bootstrap.sh`。

Ubuntu/Debian 示例：

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot
sudo mkdir -p /var/www/certbot

# 先用 standalone 模式申请证书；此时 80 端口暂时不能被 Nginx 占用。
sudo systemctl stop nginx
sudo certbot certonly --standalone --non-interactive --agree-tos \
  --email you@example.com -d petbaby.example.com

# 启用仓库提供的宿主机 Nginx 配置，并替换示例域名。
sudo cp /opt/petbaby/deploy/nginx/petbaby.conf /etc/nginx/sites-available/petbaby.conf
sudo sed -i 's/petbaby\.example\.com/petbaby.example.com/g' /etc/nginx/sites-available/petbaby.conf
sudo ln -sfn /etc/nginx/sites-available/petbaby.conf /etc/nginx/sites-enabled/petbaby.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl enable certbot.timer
sudo certbot renew --dry-run
```

CentOS 7.4 的 Nginx 配置目录不同，不能直接使用 Ubuntu 的 `sites-available/sites-enabled` 命令：

```bash
sudo yum install -y nginx
sudo mkdir -p /var/www/certbot
sudo systemctl stop nginx || true
sudo yum install -y epel-release
sudo yum install -y certbot
sudo certbot certonly --standalone --non-interactive --agree-tos \
  --email you@example.com -d petbaby.example.com
sudo cp /opt/petbaby/deploy/nginx/petbaby.conf /etc/nginx/conf.d/petbaby.conf
sudo sed -i 's/petbaby\.example\.com/petbaby.example.com/g' /etc/nginx/conf.d/petbaby.conf
sudo nginx -t
sudo systemctl enable --now nginx
```

CentOS 7.4 已 EOL，系统仓库中的 Certbot 可能不可用或版本过旧。上面的命令只有在 `yum install certbot` 成功时才能执行；证书签发后用下面命令验证自动续期：

```bash
sudo certbot renew --dry-run
```

如果 `yum install certbot` 在 CentOS 7.4 上失败，不要从 Ubuntu 或 Rocky 复制 RPM；改用云证书托管，或先把测试机升级到 Rocky 9/AlmaLinux 9/Ubuntu 24.04。

CentOS 7.4 额外注意：SELinux 为 `Enforcing` 时，宿主机 Nginx 反代到回环端口可能被拒绝。优先保留 Enforcing，并执行：

```bash
sudo yum install -y policycoreutils-python
sudo setsebool -P httpd_can_network_connect 1
sudo restorecon -Rv /var/www/certbot /etc/letsencrypt
sudo nginx -t
```

只有在确认测试机不承载敏感数据、且无法完成 SELinux 策略配置时，才可临时执行 `sudo setenforce 0`；不要把关闭 SELinux 写入永久配置，也不要在生产环境照搬。

把 `you@example.com` 和 `petbaby.example.com` 换成真实值。证书成功后，配置中的 `/etc/letsencrypt/live/<域名>/` 路径会被 Nginx 直接读取。若使用云负载均衡或云证书托管终止 TLS，则跳过 Certbot，仅保留云 LB 到宿主机 `127.0.0.1:3000` 的回源配置。

### 2.6 一键部署

```bash
./deploy/scripts/bootstrap.sh petbaby.example.com you@example.com
```

第二个参数保留为证书运维邮箱，供 Certbot/云证书申请时使用；省略则自动用 `admin@<域名>`。

这一条命令会依次做完：

1. **生成 `deploy/.env.staging`**（权限 600，不进版本库）：写入域名，随机生成数据库密码、`SESSION_SECRET`、`WORKER_SECRET`、`ADDRESS_ENCRYPTION_KEY` 和一个 6 字节的**注册邀请码**。
2. **预检**：环境变量完整性、占位值、密钥长度、DNS 解析、编排文件语法；80/443 由宿主机 Nginx 占用属于正常状态。
3. **构建镜像**并启动 PostgreSQL。
4. **执行数据库迁移**（当前 `0000` → `0026`，失败则不更新应用容器）。
5. **启动 web / worker**，等待 web 进入 `healthy`；宿主机 Nginx 不由 Docker 编排管理。
6. **灌样例图**（`seed-samples.sh`）：把 `tools/imagegen/out/` 下的入口图与风格对比图按内容哈希写进 `object-data` 卷。**这一步不能省** —— 素材不在镜像里（构建上下文是 `apps/platform`，素材在仓库根的 `tools/imagegen/`），漏掉的表现是首页 Hero、玩法网格、AI 风格选项全部裂图，而 `/api/plugins` 仍返回 200（manifest 里只是路径字符串），健康检查也照样通过。
7. **健康检查** `https://<域名>/api/health`。
8. **主链路冒烟测试**：注册 → 建宠物档案 → 上传照片 → 提交生成 → Worker 出图 → 读回对象存储 → 下单模拟支付解锁 → 生成分享链接并匿名访问 → 软删除测试账号；随后逐张校验 13 张样例图能取到字节。

首次执行大约 5-15 分钟（镜像构建占大部分）。结束后终端会打印**邀请码**和后续三步操作，请留存。

> 邀请码的作用：测试机在公网上，没有邀请码任何人都能注册。想去掉就把 `deploy/.env.staging` 里的 `PASSWORD_AUTH_INVITE_CODE=` 清空，再跑一次 `./deploy/scripts/deploy.sh staging`。

### 2.7 注册账号并开通管理后台

```bash
# 1) 浏览器打开 https://petbaby.example.com/login
#    选「注册新账号」，填账号（字母开头 3-32 位）、密码（≥10 位且含字母和数字）、邀请码

# 2) 把这个账号加入管理员白名单
./deploy/scripts/create-admin.sh <刚注册的账号名>
```

`create-admin.sh` 会查出该账号的 UUID、写入 `ADMIN_USER_IDS`、重启 web 和 worker。完成后访问 `https://petbaby.example.com/admin`。

生产语义下管理后台对非管理员**返回 404**（不暴露后台是否存在），所以「访问 /admin 是 404」通常意味着白名单没生效，不是页面丢了。

### 2.8 手工验收

自动冒烟测试覆盖了 API 主链路，浏览器端再走一遍：

- `/` 首页玩法列表可见；未登录访问任意页面会跳到 `/login`。
- 选「宠物身份证」→ 填名字 → 上传照片 → 免费生成预览（带水印）。
- 「支付并去水印」→ 解锁成功（测试机走模拟支付）→ 下载图片、PDF。
- 「生成分享页」→ 用**无痕窗口**打开分享链接，能匿名访问。
- `/me` → 各入口可进；`/account` 可导出数据。
- `/admin` → 8 个后台工作台都能打开，「环境配置诊断」里运行模式显示「测试机（staging）」。
- 视频玩法：`/video/create` 提交一个短片，观察 Worker 日志里 FFmpeg 是否正常。

---

## 3. 小程序接入测试机

完整步骤见 [`03-miniprogram-release.md`](03-miniprogram-release.md)。最小接入只有两步：

```bash
cd apps/miniprogram
cp config.local.example.js config.local.js
# 编辑 config.local.js，把 apiBaseUrl 改成 https://petbaby.example.com
```

然后用微信开发者工具导入 `apps/miniprogram/`。**没有 AppID 也能调试**：选「测试号」或游客模式，在开发者工具的「详情 → 本地设置」里勾选「不校验合法域名」，即可访问测试机。小程序内在「我的 → 登录与退出」用账号密码登录（`wx.login` 在没有 AppID/AppSecret 时会失败，代码已做兜底，不会覆盖账号密码会话）。

调试基础库**不要低于 2.9.0**：CSS 变量靠 `page-meta` 注入，低版本不白屏但会退化成 `app.wxss` 的兜底值与 `cute` 外观，四套皮肤看不出差别。

**真机验证前必须先登记 `downloadFile` 域名。** 样例图与成品图都由 `<image src>` 直接取远端字节，走的是 downloadFile 通道而非 request；开发者工具勾了「不校验合法域名」不受影响，真机上没登记就是整片裂图，且**不抛任何错误**。登记入口见 `docs/operations/04-external-prerequisites.md` 的「服务器域名登记」。

---

## 4. 日常运维

全部命令在 `/opt/petbaby` 下执行，`staging` 可省略（脚本默认 staging）。

| 目的            | 命令                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 看全部日志         | `./deploy/scripts/logs.sh staging`                                                                                     |
| 看 Web 日志      | `./deploy/scripts/logs.sh staging web`                                                                                 |
| 看 Worker 日志   | `./deploy/scripts/logs.sh staging worker`                                                                              |
| 看 Nginx 日志    | `sudo tail -f /var/log/nginx/petbaby.access.log /var/log/nginx/petbaby.error.log`                                      |
| 健康检查          | `./deploy/scripts/health-check.sh staging`                                                                             |
| **日常发布/更新**   | **`./deploy/scripts/release.sh staging`**                                                                              |
| 重跑主链路         | `./deploy/scripts/smoke-test.sh staging`                                                                               |
| 重灌样例图（换图后）    | `./deploy/scripts/seed-samples.sh staging`                                                                             |
| 备份数据库和对象文件    | `./deploy/scripts/backup.sh staging`                                                                                   |
| 恢复            | `./deploy/scripts/restore.sh deploy/backups/staging-db-<时间>.sql.gz deploy/backups/staging-objects-<时间>.tar.gz staging` |
| 更新到最新代码       | `git pull && ./deploy/scripts/deploy.sh staging`                                                                       |
| 停止（保留数据）      | `docker compose --env-file deploy/.env.staging -f deploy/compose.staging.yaml stop`                                    |
| 彻底清除（**删数据**） | `docker compose --env-file deploy/.env.staging -f deploy/compose.staging.yaml down -v`                                 |
| 进数据库          | `docker compose --env-file deploy/.env.staging -f deploy/compose.staging.yaml exec db psql -U petbaby -d petbaby`      |

### 更新与回滚

- 每次发布建议改 `deploy/.env.staging` 里的 `PETBABY_IMAGE`（例如 `petbaby-platform:2026.07.26-1`），这样能回滚到具体镜像。
- 更新前先 `backup.sh`。
- 回滚：把 `PETBABY_IMAGE` 改回上一版本 → `SKIP_BUILD=1 ./deploy/scripts/deploy.sh staging`。
- **迁移只向前**。回滚应用镜像不回滚数据库，也不删除已新增的兼容字段。

### 数据存放位置

| 数据          | 位置                                                               |
| ----------- | ---------------------------------------------------------------- |
| PostgreSQL  | Docker 卷 `petbaby-staging_postgres-data`                         |
| 照片、预览、成品、视频 | Docker 卷 `petbaby-staging_object-data`（容器内 `/app/.data/objects`） |
| TLS 证书      | 宿主机 `/etc/letsencrypt/` 或云证书管理                                   |
| 访问日志        | 宿主机 `/var/log/nginx/petbaby.access.log`                          |

`down -v` 会连带删除这些卷。测试机数据无价值时才用。

---

## 5. 故障排查

| 现象                                 | 原因与处理                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `health-check.sh` 超时，浏览器打不开 HTTPS  | 依次检查 `docker compose ... ps web`、`sudo nginx -t`、`sudo systemctl status nginx`、Nginx 错误日志、DNS 和安全组                            |
| Certbot/ACME 申请证书失败                | 确认 DNS 已指向本机、80 端口可访问、Nginx 保留 `/.well-known/acme-challenge/`，再重试；不要频繁触发 ACME 限流                                              |
| 打开任何页面都跳 `/login`                  | 正常：生产模式没有登录不给进。注册或登录即可                                                                                                        |
| 登录后访问 `/admin` 返回 404              | `ADMIN_USER_IDS` 没生效。执行 `create-admin.sh <账号名>`                                                                               |
| 注册报「邀请码不正确」                        | 邀请码在 `deploy/.env.staging` 的 `PASSWORD_AUTH_INVITE_CODE`                                                                      |
| 注册报「账号密码登录未启用」                     | `PASSWORD_AUTH_ENABLED` 不是 `true`，改完执行 `deploy.sh staging`                                                                    |
| 生成任务一直 `queued`                    | Worker 没起来：`logs.sh staging worker`。也可能触发了日成本熔断（后台「环境配置诊断」和 `/api/health` 可见），调 `DAILY_GENERATION_LIMIT` / `DAILY_COST_LIMIT` |
| 生成失败、日志报存储错误                       | 确认 `OBJECT_STORAGE_PROVIDER=local` 且 `APP_ENV=staging`；正式生产模式下 local 会被强制回落到云存储适配器并返回 503                                     |
| 上传照片报「仅支持真实的 JPG/PNG/WebP」         | 服务端按魔数校验，改扩展名无效                                                                                                               |
| 上传报 413                            | 单张限 2.5MB（应用层）；宿主机 Nginx `client_max_body_size` 限 16MB                                                                        |
| 解锁报 `PAYMENT_ADAPTER_REQUIRED` 503 | `APP_ENV` 不是 `staging`，或 `PAYMENT_PROVIDER` 不是 `development`                                                                  |
| 视频渲染失败                             | `logs.sh staging worker` 看 FFmpeg 输出；确认 `FFMPEG_PATH=/usr/bin/ffmpeg`；2 核机器上大分辨率容易超时                                          |
| `db` 容器起不来                         | 卷里已有用不同密码初始化的数据。要么恢复原密码，要么 `down -v` 重来                                                                                       |
| 迁移失败                               | `logs.sh staging migrate`。迁移在事务里执行，失败不会更新应用容器                                                                                 |
| `preflight.sh` 报占位值                | `.env.staging` 里还有 `replace-with` / `example.com` / `placeholder`                                                             |

---

## 6. 日常发布（更新已部署的环境）

一条命令：

```bash
cd /opt/petbaby && ./deploy/scripts/release.sh staging
```

依次做完：拉代码 → 发布前备份 → 预检 → 构建 → 迁移 → 启动 → 灌样例图 → 健康检查 → 冒烟测试（含逐张校验样例图能取到字节）。

`bootstrap.sh` 是**首次部署**用的（它会先生成 `deploy/.env.staging`）；环境已存在后日常更新用 `release.sh`。

几条设计上的取舍：

- **不检查工作区是否干净**。部署机上 `chmod +x` 这类权限位变更会被 git 记成改动，为此拦住发布得不偿失。拉取用 `--ff-only`，真有冲突时 git 自己会拒绝并保留现场，脚本随即停在拉取步骤、不做任何部署动作。
  权限位噪音想根治就关掉跟踪：`cd /opt/petbaby && git config core.fileMode false`。
- **迁移前必备份**。迁移是单向的（没有 down 脚本），改过库结构后只能靠备份回去。首次发布时数据库容器还没起，这一步会自动跳过。
- **样例图每次都灌**。键名由内容哈希决定，没换图时就是覆盖同名文件，代价是 13 个小文件的 `docker cp`。换了图或卷被 `down -v` 重建过时，这是唯一能补上字节的地方 —— 分不清哪次需要，不如每次都做。

出问题时的开关（正常发布一个都不用加）：

| 开关              | 作用                      |
| --------------- | ----------------------- |
| `SKIP_PULL=1`   | 不拉代码，只重新部署当前工作区         |
| `SKIP_BACKUP=1` | 跳过发布前备份（不建议）            |
| `SKIP_BUILD=1`  | 不重新构建，用现有镜像标签（回滚时用）     |
| `SKIP_SMOKE=1`  | 跳过冒烟测试；注意样例图能否取到字节也就没验了 |

代码回滚：`git checkout <旧提交> && SKIP_PULL=1 ./deploy/scripts/release.sh staging`。
数据回滚：`./deploy/scripts/restore.sh <db备份.sql.gz> [objects备份.tar.gz] staging`（先停 web/worker）。

### 6.1 分步执行

`release.sh` 与 `bootstrap.sh` 都只是把下面几步串起来，任何一步都能单独重跑：

```bash
./deploy/scripts/gen-env.sh petbaby.example.com you@example.com staging   # 生成环境变量（已存在时用 FORCE=1 重建）
./deploy/scripts/preflight.sh staging                                      # 只做检查，不改任何东西
./deploy/scripts/deploy.sh staging                                         # 构建 + 迁移 + 启动
./deploy/scripts/seed-samples.sh staging                                   # 灌样例图（换图后单独重跑这一条即可）
./deploy/scripts/health-check.sh staging
./deploy/scripts/smoke-test.sh staging
```

日常发布不必手敲这些，用上面的 `release.sh` 即可；分步执行留给需要缩小故障范围的场合。`gen-env.sh` 会跳过已存在的环境变量文件，所以重跑是安全的。

可用的环境开关：

| 开关                              | 作用                     |
| ------------------------------- | ---------------------- |
| `FORCE=1 gen-env.sh`            | 覆盖已有的 `.env.staging`   |
| `SKIP_BUILD=1 deploy.sh`        | 不构建，直接用现有镜像（回滚用）       |
| `SKIP_DNS_CHECK=1 preflight.sh` | 跳过 DNS 检查（内网测试、自带证书时用） |
| `ATTEMPTS=60 health-check.sh`   | 加长健康检查等待轮次             |
| `PETBABY_MODE=production`       | 等价于给脚本传 `production`   |

---

## 7. 切换到正式生产

拿到全部凭据后，正式生产**不复用** staging 的环境文件：

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
# 按 04-environment-reference.md 逐项填写；确认：
#   APP_ENV 不设置（或不是 staging）
#   OBJECT_STORAGE_PROVIDER=s3 且 OSS_* 全部填写
#   PAYMENT_PROVIDER=wechat 且商户凭据齐全
#   PASSWORD_AUTH_ENABLED=false（只保留微信登录）
#   ADMIN_USER_IDS 填正式管理员 UUID
./deploy/scripts/preflight.sh production
./deploy/scripts/deploy.sh production
```

`compose.staging.yaml` 和 `compose.production.yaml` 都只启动 PostgreSQL、迁移、Web 和 Worker；Web 发布到宿主机回环地址 `127.0.0.1:${APP_PORT:-3000}`。测试机和生产都由**宿主机 Nginx** 监听 80/443、终止 TLS，再反向代理到 `127.0.0.1:3000`，配置示例见 `deploy/nginx/petbaby.conf`。Nginx 不随应用编排重启，证书和宿主机网络边界可以独立管理。

宿主机安装 Nginx（Ubuntu/Debian）并启用配置：

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo cp deploy/nginx/petbaby.conf /etc/nginx/sites-available/petbaby.conf
sudo ln -sfn /etc/nginx/sites-available/petbaby.conf /etc/nginx/sites-enabled/petbaby.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
```

首次申请 Let's Encrypt 证书（Certbot standalone 方式会临时占用 80 端口，因此先停 Nginx）：

```bash
sudo apt-get update
sudo apt-get install -y certbot
sudo systemctl stop nginx
sudo certbot certonly --standalone --non-interactive --agree-tos \
  --email you@example.com -d petbaby.example.com
sudo systemctl start nginx
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable certbot.timer
sudo certbot renew --dry-run
```

`deploy/nginx/petbaby.conf` 中的域名和证书路径必须替换为实际值。上面的 standalone 申请步骤会短暂停止 Nginx；这是首次部署最简单、最不容易因证书文件不存在而失败的方式。若后续改用 webroot 续期，必须先准备一份不引用证书文件的临时 HTTP-only Nginx 配置，再执行 Certbot。若使用云负载均衡或云证书托管终止 TLS，则不需要在宿主机安装 Certbot，负载均衡后端转发到宿主机 `127.0.0.1:${APP_PORT}`（或按云厂商要求绑定内网地址）。

验证 Nginx 到 Web 容器的转发：

```bash
curl -I http://127.0.0.1:3000/api/health
curl -fsS https://petbaby.example.com/api/health
```

生产还必须补齐（`preflight.sh production` 会逐项拦截）：微信 AppID/AppSecret、商户号、API v3 Key、证书序列号、商户私钥、平台公钥、支付与退款回调、OSS Endpoint/Bucket/Region/AccessKey。发布门禁见 [`../operations/05-release-checklist.md`](../operations/05-release-checklist.md)。

**staging 和 production 的密钥必须各自独立**，不要把测试机的 `SESSION_SECRET`、数据库密码或加密密钥搬到生产。

---

## 8. 交付物索引

| 交付物                   | 路径                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 测试机编排（Web/Worker/数据库） | `deploy/compose.staging.yaml`                                                            |
| 生产编排                  | `deploy/compose.production.yaml`                                                         |
| Nginx 配置示例（测试机与生产宿主机） | `deploy/nginx/petbaby.conf`                                                              |
| 官网 Nginx 配置示例         | `deploy/nginx/petbaby-website.conf`                                                      |
| systemd 单元（非容器生产）     | `deploy/systemd/petbaby-web.service`、`petbaby-worker.service`                            |
| 环境变量模板                | `deploy/.env.staging.example`、`deploy/.env.production.example`                           |
| 部署脚本                  | `deploy/scripts/*.sh`                                                                    |
| 主链路冒烟测试               | `apps/platform/scripts/smoke.ts`                                                         |
| 应用镜像定义                | `apps/platform/Dockerfile`                                                               |
| 数据库迁移                 | `apps/platform/drizzle/0000_*.sql` … `0026_pet_human_identities.sql`                    |
| 官网产物与发布               | `apps/website/`，发布走 `deploy/scripts/release-website.sh`（见 `docs/website/03-独立官网实现说明.md`） |
| 本地开发用编排               | 仓库根 `compose.yaml`（**只用于本地，密码是硬编码占位值**）                                                  |
