# 环境变量参考

更新：2026-07-26 ｜ 模板：`deploy/.env.staging.example`（测试机）、`deploy/.env.production.example`（正式生产）、`apps/platform/.env.example`（本地开发）

「必填」列区分三种模式：**本地** = `NODE_ENV` 非 production；**测试机** = `NODE_ENV=production` 且 `APP_ENV=staging`；**生产** = `NODE_ENV=production` 且不设 `APP_ENV`。

## 核心运行环境

| 变量 | 本地 | 测试机 | 生产 | 说明 |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | 可选 | 必填 `production` | 必填 `production` | 启用生产安全边界：无 demo 用户兜底、Cookie `Secure`、后台白名单 |
| `APP_ENV` | 可选 | 必填 `staging` | **禁止 `staging`** | 唯一放行本地磁盘存储与模拟支付的开关 |
| `DATABASE_URL` | 可选 | 必填 | 必填 | PostgreSQL 连接串；留空或 `file://` 用落盘 PGlite，`memory://` 用内存 PGlite（仅本地/E2E） |
| `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD` | — | 必填 | 必填 | Compose 创建 PostgreSQL 容器时使用；由 `gen-env.sh` 随机生成密码 |
| `SESSION_SECRET` | 可选 | 必填 ≥32 位 | 必填 ≥32 位 | 会话 Cookie 的 HMAC 密钥 |
| `WORKER_SECRET` | 可选 | 必填 ≥32 位 | 必填 ≥32 位 | `internal/*` 接口鉴权；缺失时这些路由返回 404 |
| `ADDRESS_ENCRYPTION_KEY` | 可选 | 必填 | 必填 | 实体订单地址字段加密，必须独立随机 |
| `PUBLIC_APP_URL` | 可选 | 必填 HTTPS | 必填 HTTPS | H5、分享和回调的公开地址 |
| `PETBABY_DOMAIN` | — | 必填 | 必填 | 反向代理使用的裸域名（不带协议） |
| `ACME_EMAIL` | — | 可选 | — | 保留用于环境文件兼容；宿主机 Nginx/Certbot 或云证书系统实际使用 |
| `ADMIN_USER_IDS` | 可选 | 部署后写入 | 必填 | 逗号分隔的管理员 UUID；未配置时后台页面/API 全部返回 404 |
| `APP_PORT` | — | — | 可选，默认 3000 | 仅 `compose.production.yaml` 用，绑定在 `127.0.0.1` |
| `PETBABY_IMAGE` | — | 推荐 | 推荐 | 不可变镜像标签，回滚依赖它 |
| `NODE_BASE_IMAGE` | — | 推荐 | 推荐 | Dockerfile 的 Node 22 基础镜像；Docker Hub 不通时改为国内/企业仓库完整地址 |
| `POSTGRES_IMAGE` | — | 推荐 | 推荐 | Compose 的 PostgreSQL 17 镜像；Docker Hub 不通时改为国内/企业仓库完整地址 |
| `PNPM_VERSION` | — | 推荐 `10.13.1` | 推荐 `10.13.1` | 固定容器内 pnpm 版本，必须与 `apps/platform/package.json` 的 `packageManager` 一致 |
| `NPM_REGISTRY` | — | 推荐 | 推荐 | 容器构建时的 npm/pnpm registry；网络受限时改为云厂商或企业镜像 |

非生产环境 `getOptionalUserId()` 会回落到固定 demo 用户，`isAdmin()` 直接返回 true。所以「本地能进后台」不代表权限正确。

## 登录

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PASSWORD_AUTH_ENABLED` | 非生产为 `true`，生产为 `false` | 账号密码注册/登录开关。测试机必须显式设为 `true` |
| `PASSWORD_AUTH_INVITE_CODE` | 空 | 设置后注册必须携带邀请码；公网测试机建议保留 |
| `WECHAT_APP_ID`、`WECHAT_APP_SECRET` | 空 | 小程序 `wx.login` 换取 openid；缺失时微信登录不可用 |

账号规则：字母开头、3-32 位、仅含字母数字点下划线连字符，大小写不敏感唯一。密码规则：10-72 位且同时含字母和数字，用 scrypt（N=16384, r=8, p=1）加盐存储。

相关接口：`POST /api/auth/password/register`、`POST /api/auth/password/login`、`POST /api/auth/logout`、`GET /api/auth/session`、`POST /api/auth/wechat`。

## 微信与支付

| 变量 | 说明 |
| --- | --- |
| `PAYMENT_PROVIDER` | 生产固定 `wechat`；`development` 只在 `APP_ENV=staging` 或本地生效 |
| `WECHAT_MCH_ID`、`WECHAT_PAY_KEY` | 商户号与 32 字节 API v3 Key |
| `WECHAT_CERT_SERIAL` | 商户证书序列号 |
| `WECHAT_MCH_PRIVATE_KEY` | PEM 私钥；换行可写为 `\n` |
| `WECHAT_PLATFORM_PUBLIC_KEY` | 支付通知验签公钥 |
| `WECHAT_PAY_NOTIFY_URL`、`WECHAT_REFUND_NOTIFY_URL` | 公网 HTTPS 回调 |
| `WECHAT_SUBSCRIBE_TEMPLATE_ID` | 订阅消息模板 ID |
| `PHYSICAL_PAYMENT_PROVIDER` | 实体订单支付适配器；未配置时生产拒绝模拟支付 |

微信支付要求用户具备 openid。账号密码注册的用户没有 openid，在生产模式下会得到 422 `WECHAT_OPENID_REQUIRED`——这是预期行为。

## 对象存储

| 变量 | 说明 |
| --- | --- |
| `OBJECT_STORAGE_PROVIDER` | 生产设 `s3`；`local` 只在 `APP_ENV=staging` 或本地开发生效，正式生产会被强制回落到云适配器 |
| `LOCAL_STORAGE_DIR` | 本地磁盘存储根目录；容器内为 `/app/.data/objects`，挂在共享命名卷上供 web 与 worker 同时读写 |
| `OSS_ENDPOINT` | S3 兼容的完整 Bucket Endpoint，必须包含 Bucket 主机或路径 |
| `OSS_BUCKET` | Bucket 名，用于配置核对 |
| `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | 最小权限凭据 |
| `STORAGE_REGION` | S3 签名 Region，默认 `auto` |

Bucket 必须默认私有，凭据仅允许指定 Bucket 的读写删除；不要授予账户级管理权限。测试机用本地磁盘时，照片和成品在 Docker 卷 `petbaby-staging_object-data` 里，`down -v` 会一并删除。

## AI、视频与成本

主通道优先级为 **lingsuan → 通用 HTTP → 本地占位图**。配了 `LINGSUAN_IMAGE_*` 后 lingsuan 接管主位，原 `AI_IMAGE_ENDPOINT` 自动顺延为备用通道（不会被下线）。

**出网白名单要放两个域名**：API 在 `lingsuan.top`，图片下载在 `img.junliai.org`。接口默认以 url 形态返回，只放 API 域名会让「生成成功但取字节失败」，症状是任务全部 `AI_PROVIDER_DOWNLOAD_FAILED`。

**正式生产（`NODE_ENV=production` 且未设 `APP_ENV=staging`）缺凭据时不再回落占位图**，而是以 `AI_PROVIDER_CONFIG_PENDING`（503）失败 —— 纯色块不是可交付的产物，用户为它付了钱。开发与测试机仍回落本地占位图以便跑通链路。

只有 PL-10（AI 肖像）与岛的立绘走 lingsuan；PL-01/02/03、PL-20、PL-23 是确定性 SVG 排版，PL-19/21 走 ffmpeg，都不调用大模型。

| 变量 | 默认值 / 说明 |
| --- | --- |
| `LINGSUAN_IMAGE_BASE_URL`、`LINGSUAN_IMAGE_API_KEY` | lingsuan 图像接口（OpenAI images 兼容），当前主通道；两项齐备才生效。BASE_URL 为 `https://lingsuan.top` |
| `LINGSUAN_IMAGE_MODEL` | 默认 `gpt-image-2` |
| `LINGSUAN_IMAGE_CONCURRENCY` | lingsuan 进程内共享请求队列并发数，默认 20，硬限制为 1～20；PL-10、岛立绘和同进程内的其他生成调用合计不超过该值 |
| `LINGSUAN_IMAGE_SIZE`、`LINGSUAN_IMAGE_QUALITY` | 默认 `1024x1024` / `high`。size **只对方形生效**：实测 `1600x1000` 返回 `2048x1376` |
| `LINGSUAN_IMAGE_INPUT_FIDELITY` | 图生图时要求保住主体特征。**默认留空**：接口接受该参数（packy 时代会 400），但「接受」不等于有效，产物是否更贴主体未验证过，开之前要人眼比对一批 |
| `LINGSUAN_IMAGE_TIMEOUT_MS` | 单张请求超时，默认 180000。实测 `quality=low` 已需 46–62 秒，high 更久，勿低于 120000 |
| `AI_IMAGE_ENDPOINT`、`AI_IMAGE_API_KEY` | 可选；lingsuan 未配时作主通道，已配时作备用；都缺则仅本地占位图 |
| `AI_IMAGE_MODEL` | 主 AI Provider 模型版本快照 |
| `AI_IMAGE_SECONDARY_ENDPOINT`、`AI_IMAGE_SECONDARY_API_KEY` | 备用 Provider，用于主供应商故障切换 |
| `AI_IMAGE_SECONDARY_MODEL` | 备用 Provider 模型版本快照 |
| `AI_CIRCUIT_FAILURE_THRESHOLD` | Provider 连续失败熔断阈值，默认 3 |
| `FFMPEG_PATH` | 容器内 `/usr/bin/ffmpeg` |
| `FFMPEG_FONT_FILE` | 视频字幕字体，容器内 `/usr/share/fonts/noto/NotoSansCJK-Regular.ttc`（由镜像的 `font-noto-cjk` 提供）。留空则用 fontconfig 默认字体，中文字幕会变方框或整行消失，且 ffmpeg 仍返回成功 |
| `WORKER_POLL_INTERVAL_MS` | 默认 1000 ms |
| `DAILY_GENERATION_LIMIT` | 默认 500 次/日（测试机模板设 200） |
| `DAILY_COST_LIMIT` | 默认 50 元/日（测试机模板设 10） |
| `LAYOUT_GENERATION_COST` | 默认 0.01 元/次 |
| `AI_IMAGE_COST` | 默认 0.08 元/次 |
| `ALERT_WEBHOOK_URL` | 可选，仅接受 HTTPS |

### 离线素材生成的凭据（`tools/imagegen`）

`tools/imagegen/` 是构建期工具链，用来产出方案要求的入口成品图与风格对比图。
它读**仓库根目录的 `.env.imagegen`**，与服务端运行时的 `apps/platform/.env*` 是两套来源，
互不影响 —— 工具链允许长超时（300s）与高分辨率落盘，运行时有请求预算与熔断约束。

| 变量 | 说明 |
| --- | --- |
| `LINGSUAN_IMAGE_BASE_URL`、`LINGSUAN_IMAGE_API_KEY` | 必填，缺任一项直接报错退出（不给 BASE_URL 默认值：写死域名会出现「改了 `.env` 却没生效」） |
| `LINGSUAN_IMAGE_MODEL` | 可选，默认 `gpt-image-2` |
| `LINGSUAN_IMAGE_CONCURRENCY` | 可选，离线工具默认串行，硬限制为 1～20；所有 `generate/edit` 调用共用同一 FIFO 请求队列 |

进程环境变量优先于文件。`.env.imagegen` 被根 `.gitignore` 的 `.env.*` 覆盖，
不进版本控制；**不要**把它复制成 `.env.imagegen.example` 之类带真值的文件。

素材本身不需要凭据即可使用：产出图经 `tools/imagegen/upload-samples.mjs`
推入对象存储后写进 manifest，线上只走 `/api/plugin-samples/` 下发。
即工具链只在**新增或更换素材**时才需要凭据，日常部署与 CI 都不需要。

## 小程序 CI 变量

只用于执行 `pnpm preview` / `pnpm upload` 的机器，不注入后端：

| 变量 | 说明 |
| --- | --- |
| `MINIPROGRAM_APP_ID` | 小程序 AppID |
| `MINIPROGRAM_PRIVATE_KEY_PATH` | 上传私钥路径，必须在仓库外 |
| `MINIPROGRAM_API_BASE_URL` | 会被写入 `config.local.js`；upload 模式强制 HTTPS |
| `MINIPROGRAM_VERSION` | 仅 upload 需要，格式 `x.y.z` |
| `MINIPROGRAM_DESCRIPTION` | 版本备注，最长 40 字 |

## 密钥管理规则

- 本地使用未跟踪的 `.env.local`、`deploy/.env.staging`、`deploy/.env.production` 和 `config.local.js`，权限 600。
- 生产优先使用云密钥管理或 CI Secret，不通过聊天、日志或 Markdown 传递真实值。
- staging 与 production 的密钥各自独立生成，不互相搬运。
- 私钥轮换时先并行验证新证书，再切换环境变量；旧证书在支付平台确认无流量后撤销。
- 轮换 `SESSION_SECRET` 会使所有已登录会话失效（旧 Cookie 验签失败），用户需重新登录。
