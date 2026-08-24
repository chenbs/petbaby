# 前后端交付物清单

更新：2026-08-23 ｜ 适用版本：图片模板货架与宠物人化 V2 本地接入完成

## 交付边界

本仓库包含一个 Next.js 单体后端/H5、一个微信原生小程序、一个独立 Astro 官网、数据库迁移、异步 Worker、Docker 部署资产（测试机与生产两套编排）、一键部署脚本和项目文档。H5 不是独立静态站点，必须与后端 API 一起部署；官网 `apps/website` 是纯静态产物，独立域名、独立发布，不随应用容器部署。

## 当前成熟度

| 范围 | 状态 | 生产前还需完成 |
| --- | --- | --- |
| 阶段一主链路 | 本地可运行、自动化测试覆盖 | 微信登录/支付、云对象存储和真机联调 |
| 阶段二玩法平台 | AI、互动、独立视频、纪念和赛马双端/后台功能闭环完成 | Provider、FFmpeg 容器、分享和商业权益的预发布联调验收 |
| 图片模板货架 | 已登记 9 个入口 / 116 个条目；76 个 live 冻结模板、公开展示图和主人/宠物分角色输入已交付；40 个 V2 人化效果图已完成本地盘点、ID/提示词归一和计划对象键登记，运行时为“宠物图一 + 效果图二”、每次 2 张且禁用重抽 | 取得明确发布批准后完成 V2 对象上传、seed、冻结、展示检查和真实双参考验证；双主体补足至少 12 位主人盲评、真实 Provider 端到端与隐私政策更新 |
| 阶段三复购能力 | 订阅、实体履约、会员和年度报告双端/后台功能闭环完成 | 微信消息、供应商、支付、额度和报告的预发布联调验收 |
| 小程序主题系统 | 57 token、4 套皮肤、26 页零硬编码（主包 23 + `island` 分包 3）、玻璃面板和静态门禁已交付 | iOS/Android 真机的模糊生效与降级验证、四套主题走查截图集 |
| 情绪价值与健康线 | 时间线、去年今日、叙事年度视频、纪念册 PDF、健康分诊、体重与免疫记录、健康档案 PDF 已交付 | 年度视频成片抽帧（需 ffmpeg）、档案 PDF 中文字形（需真机/打印）、**健康线文案的法律意见** |
| 会员与权益兑付 | 套餐版本 v4 ¥128、权益台账、按次凭据核销、两端价格文案同源已交付 | 先完成虚拟支付合规与 `growth_orders` 缺陷修复，再做真实购买、回调和退款回收演练 |
| 独立官网 | `apps/website` Astro 静态站、11 个页面、逐像素比对与发布脚本已交付 | 小程序码素材、ICP 备案、法务正文 |
| 测试机部署 | 编排、宿主机 Nginx HTTPS、一键脚本和主链路冒烟测试已交付 | 在真实 Linux + Docker 机器上实跑（当前开发机无 Docker） |
| 正式生产部署 | 编排、Nginx 示例、systemd 单元和 `preflight.sh production` 门禁已交付 | 补齐微信、支付、云存储凭据 |

## 后端与 H5

| 交付物 | 路径 | 说明 |
| --- | --- | --- |
| Web/H5/API | `apps/platform/src/app/` | 页面、登录页、分享页、REST API 和管理后台 |
| 业务服务 | `apps/platform/src/server/` | 登录、支付、存储、生成、账户、会员和运维逻辑 |
| 登录守卫 | `apps/platform/src/proxy.ts` | Next 16 proxy（旧称 middleware）：生产模式下未登录访问受保护页面时跳转 `/login` |
| 运行模式判定 | `apps/platform/src/server/runtime-mode.ts` | `development` / `staging` / `production` 三态 |
| 账号密码凭据 | `apps/platform/src/server/auth/password.ts` | scrypt 加盐、邀请码、账号唯一性 |
| 数据库迁移 | `apps/platform/drizzle/` | `0000`～`0026`，按文件名顺序执行；后续只新增迁移 |
| 后台 Worker | `apps/platform/scripts/worker.ts` | 生成、视频、订阅消息和周期维护 |
| 迁移程序 | `apps/platform/scripts/migrate.ts` | 自动发现并记录全部 SQL 迁移 |
| 主链路冒烟测试 | `apps/platform/scripts/smoke.ts` | 注册→上传→生成→解锁→分享→清理 |
| 容器镜像 | `apps/platform/Dockerfile` | Node.js 22、FFmpeg、非 root 运行、预建对象存储目录 |
| 测试机编排 | `deploy/compose.staging.yaml` | PostgreSQL + 迁移 + Web + Worker + 共享对象卷；Web 绑定宿主机回环地址 |
| 生产编排 | `deploy/compose.production.yaml` | PostgreSQL、迁移、Web、Worker |
| 反向代理示例 | `deploy/nginx/petbaby.conf` | 测试机与生产宿主机 Nginx 的 HTTPS、上传大小和代理超时 |
| 官网反代示例 | `deploy/nginx/petbaby-website.conf` | 静态站的 `try_files` 目录式 URL、`/_astro/` 长缓存与 `/assets/` 短缓存 |
| 非容器部署 | `deploy/systemd/petbaby-web.service`、`petbaby-worker.service` | systemd 单元模板 |

## 前端

| 交付物 | 路径 | 说明 |
| --- | --- | --- |
| Web 移动端界面 | `apps/platform/src/app/`、`src/components/` | 随后端镜像发布 |
| H5 分享/互动页 | `apps/platform/src/app/share/`、`interactive/` | 无需单独构建 |
| 微信小程序 | `apps/miniprogram/` | 23 个原生页面（含登录页、主题选择页、健康助手、成长时间线）和文本型自定义 tabBar |
| 小程序主题系统 | `apps/miniprogram/theme/` | 57 个 token、4 套皮肤（`cute`/`glass`/`light`/`dark`）、`page-mixin` 与场景预设 |
| 小程序 UI 重构 | `apps/miniprogram/`、`tools/imagegen/` | 结构 token、组件扩参、13 个页面改造；素材由 `tools/imagegen` 离线产出，决策见 `docs/ui-refactor/` |
| 小程序公共组件 | `apps/miniprogram/components/` | 18 个零硬编码组件，含沉浸式玻璃面板 `glass-sheet` |
| 小程序 CI | `apps/miniprogram/scripts/ci.js` | 生成预览码或上传体验版 |
| 小程序结构检查 | `apps/miniprogram/scripts/validate.js` | 十项门禁：页面文件齐备、JSON 可解析、样式零硬编码、token 完整性与类型、文字与玻璃面板对比度、注入串 2KB、`var()` 来源、组件注册、WXML 标签闭合 |
| 独立官网 | `apps/website/` | Astro 7 静态站，11 个页面（首页 + 文章模块 + 法务两页 + 元数据端点），独立域名 |
| 官网校验脚本 | `apps/website/scripts/` | `check-links.mjs`（站内链接与 canonical/sitemap 一致性发布门禁）、`pixel-diff.mjs`（与原型逐像素比对）、`verify.mjs`（浏览器端 63 条断言） |

## 部署脚本

全部位于 `deploy/scripts/`，POSIX Shell，Linux 上执行前需 `chmod +x deploy/scripts/*.sh`：

| 脚本 | 作用 |
| --- | --- |
| `bootstrap.sh <域名> [邮箱]` | 全新测试机一键部署（生成环境变量 → 预检 → 部署 → 健康检查 → 冒烟测试） |
| `release.sh <mode>` | 日常发布（拉代码 → 备份 → 迁移 → 灌样例图 → 健康检查 → 冒烟） |
| `release-website.sh` | 官网发布，切软链原子生效；不碰 Docker、不重启容器、不跑迁移 |
| `seed-samples.sh` | 把插件样图、76 张获批冻结母版和 76 张公开展示图灌进 `object-data` 卷（第三方效果原图与主人身份原图不灌入；漏灌时接口全绿只有 `<image>` 404） |
| `gen-env.sh` | 生成 `.env.<mode>`，随机化全部密钥与邀请码 |
| `preflight.sh` | 环境变量、占位值、密钥长度、DNS、端口、编排语法检查 |
| `deploy.sh` | 构建 → 启动数据库 → 迁移 → 更新应用容器 → 等待 healthy |
| `health-check.sh` | 轮询 `/api/health` |
| `smoke-test.sh` | 在 Compose 网络内执行 `scripts/smoke.ts` |
| `create-admin.sh <账号名>` | 查库取 UUID 写入 `ADMIN_USER_IDS` 并重启应用 |
| `logs.sh` | 跟踪容器日志 |
| `backup.sh` / `restore.sh` | 数据库与对象存储卷备份/恢复 |
| `lib.sh` | 公共函数，不单独执行 |

## 文档

- 部署总手册：`docs/delivery/02-deployment-guide.md`（环境要求、可执行步骤、排障、生产切换）。
- 小程序发布：`docs/delivery/03-miniprogram-release.md`（调试 → 上传 → 体验版 → 审核 → 发布 → 回退）。
- 环境变量：`docs/delivery/04-environment-reference.md`。
- 待补填信息：`docs/operations/04-external-prerequisites.md`，只记录状态，不保存真实密钥。
- 发布门禁：`docs/operations/05-release-checklist.md`。
- 官网工程与发布：`docs/website/03-独立官网实现说明.md`（命令、验收结果、偏离与待收口项）。
- 文档总索引与当前代码规模：`docs/README.md`。

## 不包含的内容

真实 AppID、AppSecret、上传私钥、支付证书、域名、备案、OSS/COS 凭据、AI Key、订阅模板 ID、正式品牌素材和商店审核结果不进入代码交付包。它们必须通过部署平台密钥管理或本机未跟踪文件注入。
