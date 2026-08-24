# 待补填信息清单

更新：2026-08-18 ｜ 用途：把「还缺什么、缺了会怎样、拿到后填哪里、怎么验证」集中成一张可勾选的表

**本文件只记录状态，永不记录真实值。** 真实值只写进：测试机的 `deploy/.env.staging`、生产的 `deploy/.env.production` 或云密钥管理、`apps/miniprogram/config.local.js`、`apps/miniprogram/project.private.config.json`、仓库外的上传私钥文件。不要回填到本文档、提交到仓库、贴进聊天或打进日志。

变量逐项说明见 [`../delivery/04-environment-reference.md`](../delivery/04-environment-reference.md)，填完后的部署步骤见 [`../delivery/02-deployment-guide.md`](../delivery/02-deployment-guide.md)。

---

## 0. 按阶段看：现在到底缺什么

| 阶段                 | 必须具备                                     | 状态                |
| ------------------ | ---------------------------------------- | ----------------- |
| **A. 测试机部署（当前目标）** | 一个已备案域名 + DNS A 记录 + 一台装了 Docker 的 Linux | 域名已备案；密钥全部由脚本自动生成 |
| **B. 小程序真机与体验版**   | 小程序 AppID、AppSecret、服务器域名登记、上传私钥、IP 白名单  | 全部待申请             |
| **C. 正式生产上线**      | 普通微信支付凭据、虚拟支付开通与场景结论、S3 兼容对象存储、正式管理员 UUID、告警通道 | 全部待申请 |

阶段 A **不需要**微信、支付、对象存储任何凭据。缺失项的降级行为见第 1 节。

---

## 1. 缺失项的当前行为（不是 bug，是刻意的失败关闭）

| 缺失的东西                                 | 测试机（`APP_ENV=staging`）        | 正式生产                                |
| ------------------------------------- | ----------------------------- | ----------------------------------- |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | `wx.login` 失败，改用账号密码登录        | 微信登录不可用                             |
| 微信支付商户凭据                              | 走模拟支付，可完成解锁                   | 下单返回 503 `PAYMENT_CONFIG_PENDING`   |
| `OSS_*` 云存储凭据                         | 落在服务器本地磁盘                     | 存储调用返回 503 `STORAGE_CONFIG_PENDING` |
| `LINGSUAN_IMAGE_*` / `AI_IMAGE_ENDPOINT` | 返回内置 SVG 占位图                  | 503 `AI_PROVIDER_CONFIG_PENDING`（不回落色块）  |
| `ADMIN_USER_IDS`                      | 后台 404，用 `create-admin.sh` 写入 | 后台 404                              |
| `WECHAT_SUBSCRIBE_TEMPLATE_ID`        | 订阅消息投递标记为失败                   | 同左                                  |
| `PHYSICAL_PAYMENT_PROVIDER`           | 填 `development` 可演练           | 实体订单支付返回 503                        |
| `ALERT_WEBHOOK_URL`                   | 只写健康快照，不外发                    | 同左                                  |

Provider 一律**失败关闭**：不会静默降级到模拟支付或本地存储，除非显式设置 `APP_ENV=staging`。

---

## 2. 主体与微信平台

| 待补项                                      | 填到哪里                                          | 状态   | 验证标准                          |
| ---------------------------------------- | --------------------------------------------- | ---- | ----------------------------- |
| 个体工商户/企业营业执照                             | 公众平台主体资料                                      | ☐ 待补 | 小程序主体认证通过                     |
| 小程序 AppID                                | `project.private.config.json`、`WECHAT_APP_ID` | ☐ 待补 | 真机 `wx.login` 返回 code         |
| 小程序 AppSecret                            | 仅后端 `WECHAT_APP_SECRET`                       | ☐ 待补 | `code2Session` 成功且日志不含 secret |
| 服务器域名登记（request/uploadFile/downloadFile） | 公众平台「开发管理 → 开发设置」                             | ☐ 待补 | 真机不开调试也能请求                    |
| **岛屿素材的 `downloadFile` 域名**（见下）           | 公众平台「开发管理 → 开发设置」的 downloadFile 合法域名           | ☐ 待补 | 真机不开调试也能拉到底图，岛不走「素材未就绪」路径      |
| 小程序代码上传私钥                                | 仓库外文件，`MINIPROGRAM_PRIVATE_KEY_PATH`          | ☐ 待补 | `pnpm upload` 成功              |
| 上传机器出口 IP 白名单                            | 公众平台「小程序代码上传」                                 | ☐ 待补 | 无 `not in whitelist` 报错       |
| 用户隐私保护指引                                 | 公众平台「服务内容声明」                                  | ☐ 待补 | 审核不因隐私项被拒                     |
| 服务类目                                     | 公众平台「基本设置」                                    | ☐ 待补 | 与实际功能一致                       |
| 订阅消息模板 ID                                | `WECHAT_SUBSCRIBE_TEMPLATE_ID`                | ☐ 待补 | 授权后能收到一条提醒                    |

**岛屿素材的下载域名**（`docs/product/22-宠物小岛游戏化方案.md` 5.3、9.4 待定项 6）：宠物小岛的场景素材**全部远程加载**（M1 约 1.6MB，M2 过 5MB，而主包上限 2MB），走 `wx.downloadFile` + 本地 LRU 缓存，因此需要一个 **`downloadFile` 合法域名**。

- 若素材与 API 同域（当前实现：素材经 `/api/plugin-samples/samples/island/...` 出，URL 由服务端按 `PUBLIC_APP_URL` 补域名下发），**登记 request 域名的同时把同一域名加到 downloadFile 即可，不需要新域名**；
- 若后续把素材挪到独立 CDN，那才是一个真正的新增外部依赖，需要单独备案与登记。

缺这一项的表现**不是报错而是降级**：岛走「素材未就绪」路径（纯色底 + 立绘），画面可用但没有场景。所以真机验收时要专门确认底图拉到了，否则会误以为「本来就长这样」。

**宠物立绘走同一个 `downloadFile` 域名，但它是私有对象**（2026-08-05 补）：立绘经 `/api/island/avatar-image/private/<userId>/island/...` 出，与场景素材同域，所以**不额外需要域名**。但它需要另一件事 —— `wx.downloadFile` **不会自动带 cookie 或 header**，端上必须显式送 `Authorization: Bearer`（已在 `island/scene/assets.js` 实现）。漏了的表现是「场景都出来了、只有宠物不见」，看起来像立绘没生成，实际是 401。

## 3. 微信支付与虚拟支付（仅生产需要）

| 待补项               | 环境变量                         | 状态   | 验证标准                         |
| ----------------- | ---------------------------- | ---- | ---------------------------- |
| 商户号               | `WECHAT_MCH_ID`              | ☐ 待补 | 可创建 JSAPI 订单                 |
| API v3 Key（32 字节） | `WECHAT_PAY_KEY`             | ☐ 待补 | 回调解密成功                       |
| 商户证书序列号           | `WECHAT_CERT_SERIAL`         | ☐ 待补 | 请求签名被接受                      |
| 商户 RSA 私钥（PEM）    | `WECHAT_MCH_PRIVATE_KEY`     | ☐ 待补 | 同上；换行可写成 `\n`                |
| 微信支付平台公钥          | `WECHAT_PLATFORM_PUBLIC_KEY` | ☐ 待补 | 支付通知验签通过                     |
| 支付回调地址            | `WECHAT_PAY_NOTIFY_URL`      | ☐ 待补 | 重复回调只解锁一次                    |
| 退款回调地址            | `WECHAT_REFUND_NOTIFY_URL`   | ☐ 待补 | 退款状态回写正确                     |
| 商户平台退款/客服权限       | 商户平台授权                       | ☐ 待补 | 后台退款演练成功                     |
| 支付适配器开关           | `PAYMENT_PROVIDER=wechat`    | ☐ 待补 | `preflight.sh production` 通过 |
| 五类虚拟交付场景的适用性结论 | 微信公众平台工单/官方支持答复 | ☐ 待补 | 会员、作品解锁、AI 候选、年度报告、健康档案逐项有书面结论 |
| 虚拟支付开通、签约与子商户 | 微信公众平台虚拟支付能力 | ☐ 待补 | 安卓沙箱可调通，iOS 简称审核通过 |
| iOS 退款问询通知配置 | 微信公众平台回调配置 | ☐ 待补 | `xpay_subscribe_ios_refund_query_notify` 在 3 秒内响应并留审计 |

微信支付需要**已认证**的小程序主体，且小程序与商户号完成绑定。测试机的模拟支付不能作为小程序审核举证。上表普通微信支付凭据只覆盖实体商品与适用的普通支付场景，**不能替代虚拟支付接入**；虚拟商品必须先完成 [`../product/23-虚拟支付合规改造方案.md`](../product/23-虚拟支付合规改造方案.md)，并修复 `growth_orders` 未经 Provider 直接发权益的既有缺陷。

## 4. 域名、服务器与合规

| 待补项               | 填到哪里                              | 状态      | 验证标准                          |
| ----------------- | --------------------------------- | ------- | ----------------------------- |
| 测试机域名（已备案）        | `PETBABY_DOMAIN`、`PUBLIC_APP_URL` | ☑ 已具备   | HTTPS 可访问，`/api/health` 返回 ok |
| 测试机 DNS A 记录      | DNS 服务商                           | ☐ 部署前确认 | `nslookup` 指向测试机公网 IP         |
| 80/443 入站放行       | 安全组 + 系统防火墙                       | ☐ 部署前确认 | 宿主机 Nginx/Certbot 或云负载均衡可访问   |
| 生产域名与备案           | 同上                                | ☐ 待补    | 备案查询可见                        |
| 生产 TLS 证书 / 云负载均衡 | Nginx 或云 LB                       | ☐ 待补    | SSL 检测通过                      |
| 隐私政策、用户协议、退款规则    | `/legal/*` 页面文案                   | ☐ 草案待确认 | 小程序审核可访问                      |
| AI 生成内容标识方案       | 作品、分享页与导出文件                       | ☑ 已完成（2026-08-18） | 显式底衬与隐式元数据测试通过；真机仍按发布清单抽查 |

## 5. 数据库与对象存储

| 待补项                              | 环境变量                                         | 状态     | 验证标准                          |
| -------------------------------- | -------------------------------------------- | ------ | ----------------------------- |
| 测试机 PostgreSQL                   | 编排内置容器，`DATABASE_URL` 自动生成                   | ☑ 无需准备 | `/api/health` `database=true` |
| 测试机对象存储                          | `OBJECT_STORAGE_PROVIDER=local`              | ☑ 无需准备 | 冒烟测试能读回 `/api/media/*`        |
| 生产 PostgreSQL（建议托管实例）            | `DATABASE_URL`                               | ☐ 待补   | 重启与多实例数据一致                    |
| 生产备份策略                           | 运维流程                                         | ☐ 待补   | 可恢复到 24 小时内                   |
| S3 兼容 Endpoint / Bucket / Region | `OSS_ENDPOINT`、`OSS_BUCKET`、`STORAGE_REGION` | ☐ 待补   | 私有 Bucket，无匿名读取               |
| 最小权限 AccessKey                   | `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`  | ☐ 待补   | 仅允许指定 Bucket 前缀读写删            |
| CDN 域名                           | 反代 / CDN 配置                                  | ☐ 可选   | 分享首屏达标且私图不泄漏                  |
| 生命周期规则                           | 云控制台                                         | ☐ 待补   | 免费作品 90 天自动清理                 |

生产 `OSS_ENDPOINT` 必须是包含 Bucket 的完整 S3 兼容地址；Bucket 默认私有，凭据不得授予账户级管理权限。

## 6. 运营与告警

| 待补项                 | 环境变量 / 位置                                                                            | 状态      | 验证标准                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 测试机管理员              | `ADMIN_USER_IDS`（由 `create-admin.sh` 写入）                                             | ☐ 部署后执行 | 管理员可进 `/admin`，他人 404                                                                                                                            |
| 生产管理员 UUID          | `ADMIN_USER_IDS`                                                                     | ☐ 待补    | 同上                                                                                                                                               |
| 成本熔断阈值              | `DAILY_GENERATION_LIMIT`、`DAILY_COST_LIMIT`、`LAYOUT_GENERATION_COST`、`AI_IMAGE_COST` | ☐ 按账单调整 | 超阈值停止新任务并告警                                                                                                                                      |
| 告警通道（仅 HTTPS）       | `ALERT_WEBHOOK_URL`                                                                  | ☐ 待补    | 失败率/成本告警可达                                                                                                                                       |
| 主 AI 图片接口（lingsuan） | `LINGSUAN_IMAGE_BASE_URL`、`LINGSUAN_IMAGE_API_KEY`、`LINGSUAN_IMAGE_MODEL`、`LINGSUAN_IMAGE_CONCURRENCY` | ☑ 已配（2026-08-06） | 不传 `response_format`（接口接受，但默认 url 更省内存）；返回形态随模型/代理站而变（lingsuan 默认 `url`，packy 时代给 `b64_json`），两者都要能收。**出网白名单要放两个域名**：API 在 `lingsuan.top`，图片下载在 `img.junliai.org`。`n` 固定 1，四选一需 4 次调用；请求统一进入共享 FIFO 队列，默认并发 20、硬上限 20；可重试错误最多重试 3 次。**正式生产缺凭据直接 503，不回落占位图** |
| 备用 AI 图片接口（通用 HTTP） | `AI_IMAGE_ENDPOINT`、`AI_IMAGE_API_KEY`、`AI_IMAGE_MODEL` | ☐ 待补 | 能返回 URL 或 base64 图片并由运行时读取 |
| 备用 AI 接口            | `AI_IMAGE_SECONDARY_*`                                                               | ☐ 待补    | 主供应商故障时自动切换                                                                                                                                      |
| 实体商品供应商             | `PHYSICAL_PAYMENT_PROVIDER` + 履约流程                                                   | ☐ 待补    | 完整演练一单印刷与物流                                                                                                                                      |

## 7. 由脚本自动生成、不需要人工申请

| 值                                                         | 生成方式                      |
| --------------------------------------------------------- | ------------------------- |
| `SESSION_SECRET`、`WORKER_SECRET`、`ADDRESS_ENCRYPTION_KEY` | `gen-env.sh` 随机 32 字节     |
| `POSTGRES_PASSWORD`、`DATABASE_URL`                        | `gen-env.sh` 随机 24 字节     |
| `PASSWORD_AUTH_INVITE_CODE`                               | `gen-env.sh` 随机 6 字节（可清空） |
| TLS 证书                                                    | 宿主机 Certbot/企业证书系统或云证书托管  |
| `ADMIN_USER_IDS`                                          | `create-admin.sh` 查库写入    |

**staging 与 production 的这些值必须各自独立生成，不要互相搬运。**

---

## 8. 补齐后的验证流程

1. 把值写进对应环境文件（权限 600）或云密钥管理，变量名严格按 `04-environment-reference.md`，不改代码里的安全默认值。
2. 执行 `./deploy/scripts/preflight.sh <staging|production>`，它会逐项拦截缺失值、占位值、密钥长度不足，以及「生产环境用了本地存储/模拟支付」这类越界配置。
3. 执行 `./deploy/scripts/deploy.sh <mode>` → `health-check.sh` → `smoke-test.sh`。
4. 涉及微信、支付、云存储的，按 [`05-release-checklist.md`](05-release-checklist.md) 在预发布环境实测：登录、上传、生成、支付回调、退款、分享撤销。
5. 回到本表把 ☐ 改成 ☑ 并写日期，**只记录状态，不记录真实值**。
