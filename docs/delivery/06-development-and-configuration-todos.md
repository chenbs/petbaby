# 开发与配置交付台账

更新：2026-09-21。本文是本轮交付的状态台账；规模、页面和测试总数以 [文档索引](../README.md) 为准。

## 已完成

### 产品与清理

- 已移除宠物小岛旧实现、入口、分包、接口、数据表定义、专属素材、测试及 22/24/25/26 号专属文档；保留历史迁移记录和共享能力，未保留占位入口。
- 已统一品牌为「麻麻抱我」，官网为 `https://www.babykitty.cn`，应用 API 为 `https://app.babykitty.cn`；小程序名称和 `cargo/logo.jpg` Logo 引用已同步。
- 已完成官网内容、真实品牌 Logo、社交分享图、响应式图片衍生资源、法律正文、noindex 草案保护、结构化数据、链接检查和官网发布检查脚本。
- 官网已接入真实域名配置、Nginx 分流、生产发布前后的环境和资源检查；未虚构 ICP、主体、联系方式或小程序码。

### 存储、部署与工具链

- 已实现腾讯 COS 私有读写适配器（桶 `babykitty-user-one-1252454114`），包括 SHA1 签名、完整性校验、路径防护、超时和 404 语义；本地与 staging 仍可显式使用本地存储。
- 已将小程序上传从 `miniprogram-ci` 替换为微信开发者工具 Nightly CLI，保留临时项目隔离、真实 AppID/HTTPS/版本校验和二维码输出。
- 已升级 Next/Astro/Sharp/Vitest/Playwright 等依赖；平台审计无 high/critical，官网和小程序审计通过。
- 已加入 CI：平台检查、PostgreSQL 迁移/E2E、小程序校验、官网构建/链接/像素、依赖审计、gitleaks、容器媒体冒烟和 shell 语法门禁。

### 支付与权益

- 已修复 `growth_orders` 直接改为 paid 并发权益的漏洞：支付准备、渠道确认、幂等发放和退款回收已拆开；普通作品、权益订单、实体商品按 SKU 选择 virtual/wechat/development 渠道。
- 已实现微信虚拟支付签名、商品价格映射、session_key 加密存储、查单、发货确认、退款查单、回调丢失补偿及 Apple iOS 退款问询审计；实体商品仍使用普通微信支付。
- 已实现支付事务、退款事务、唯一订单约束、并发确认锁、重复通知幂等、失败重试及 Worker 对账。
- Web 生产环境明确禁止站内付款；小程序统一使用 `wx.requestVirtualPayment`/`wx.requestPayment`，基础库下限提升至 2.19.2，具备能力检测、登录恢复、取消/失败提示和状态轮询。
- 已补支付回归测试：直调绕过、SKU 路由、金额/商户/用户替换、并发通知、丢回调、异步退款、iOS 退款问询、官方 HMAC/AES 样例和事务回滚均有覆盖。

### 已完成验证

- 平台 45 个测试文件、491 个测试全部通过，覆盖率门禁通过，TypeScript 检查通过，生产构建通过，ESLint 仅保留 6 条既有导航警告。
- 平台迁移空库、重复迁移、结构校验和 PostgreSQL E2E 均已通过；本机媒体冒烟覆盖纪念册、健康 PDF、10 秒年度视频及四张抽帧。
- 小程序 23 页结构校验和 22 个脚本测试通过；官网 Astro 类型检查（0 errors）、390/768/1440px 像素比对、浏览器 `verify`、站内链接和构建通过。
- `git diff --check` 已通过；平台与小程序可见品牌文案已统一为「麻麻抱我」，`PETBABY_*` 环境变量、Cookie、请求头和 AI 元数据保持兼容。

## 未完成或待复验

- Docker 镜像构建和容器内媒体冒烟仍未验证（当前机器没有 Docker）。
- 尚未在远端 GitHub Actions 执行 CI，也未完成本机 gitleaks 全历史扫描；这些项目保持未验证，不虚构通过。

## 需要我补充/手动配置

以下项目必须由项目方或第三方后台完成，代码已提供对应读取、校验和失败提示：

1. **微信主体与支付后台**：在小程序后台完成认证、虚拟支付签约、Offer/商品上架、现网与沙箱 AppKey、商品 `productId` 和价格配置；在商户平台配置商户号 `1117969043`、API v3 Key、证书序列号/私钥、平台证书序列号/公钥及普通支付回调。将值填入部署机环境变量，执行 `deploy/scripts/preflight.sh production`。
2. **微信消息推送**：在「开发 → 开发管理 → 消息推送」配置 `https://app.babykitty.cn/api/payments/virtual/notify`，使用安全模式 Token 与 EncodingAESKey，并在环境中设置 `WECHAT_MESSAGE_TOKEN`、`WECHAT_MESSAGE_AES_KEY`；完成虚拟支付发货、退款和 iOS 退款问询真实回调验证。
3. **登录与域名**：提供真实 AppID/AppSecret，配置 request/upload/downloadFile 合法域名和 HTTPS 证书；确认 `app.babykitty.cn`、`www.babykitty.cn`、裸域跳转及支付回调 DNS/证书生效。
4. **COS**：提供最小权限 SecretId/SecretKey、确认桶地域并设置 `STORAGE_REGION`；桶保持私有读写，CDN 在备案完成后再单独配置，当前不填写 CDN。
5. **官网法务与发布**：提供主体名称、联系邮箱/电话、办公地址、服务商和存储地域、ICP 备案号、真实 PNG 小程序码及法务批准；填入官网变量后运行 `pnpm check:release --dist apps/website/dist`，通过后再发布。
6. **小程序发布**：提供真实 AppID、上传私钥和体验成员，在微信开发者工具 Nightly 中执行 `node scripts/ci.js upload --version x.y.z --desc "..."`，完成预览、体验版、提审、灰度和回滚演练。
7. **真实验收**：用安卓/鸿蒙/Windows 沙箱验证虚拟支付，用 iOS 15+ 真机和 1 元商品验证 Apple 支付退款问询；用最低支持基础库验证升级提示；完成供应商、健康线法律意见、打印质检和备份恢复演练。
8. **宠物人化 V2**：当前 40 个自有特效全部保持 `pending-review`；取得明确书面发布批准后，才可上传、seed、冻结、设为 `live`，随后按哈希、双参考顺序、候选数、授权和盲评清单验收。此前不重新生图、不恢复旧资产。

## 后续验证顺序

1. 完成上述环境变量和后台配置，运行迁移、平台 `pnpm check`、小程序 `pnpm validate`、官网 `pnpm check:release`。
2. 在具备 Docker 的环境运行容器媒体冒烟并保存报告。
3. 执行真实域名 HTTPS、支付回调和 COS 图片读取验收。
4. 通过人工支付、退款、真机、法务和发布审批后，才进行小程序上传与生产部署；任何未配置项保持明确失败，不以模拟数据替代。
