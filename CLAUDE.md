# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

宠物照片创意内容平台。仓库同时包含产品文档与可运行实现：`apps/platform`（Next.js 16 App Router，承载 Web/H5/REST API/管理后台/Worker）、`apps/miniprogram`（微信原生小程序，26 页：主包 23 + `island` 分包 3）与 `apps/website`（Astro 7 静态官网，独立域名）。

`AGENTS.md` 是本仓库的贡献规范（目录职责、编码风格、提交与安全要求），本文件只补充架构性、跨文件才能看懂的部分，不重复其内容。

## 常用命令

全部在 `apps/platform/` 下执行：

```bash
pnpm dev                     # 本地模式，localhost:3000
pnpm worker                  # 生产任务 Worker（本地一般不需要，见下）
pnpm check                   # lint + typecheck + test:coverage + build（提交前必跑）
pnpm test                    # Vitest 单测
pnpm test -- src/server/platform-service.test.ts        # 单个测试文件
pnpm test -- -t "创建生成任务"                            # 按用例名筛选
pnpm test:e2e                # Playwright，自动拉起 DATABASE_URL=memory:// 的 dev server（端口 3100）
pnpm test:e2e -- --headed -g "completes generation"     # 单个 E2E 用例
pnpm db:generate             # 由 src/server/db/schema.ts 生成 drizzle/*.sql
pnpm db:migrate              # 对 DATABASE_URL 指向的 PostgreSQL 执行迁移
```

首次需 `pnpm exec playwright install chromium`。小程序侧在 `apps/miniprogram/` 执行 `pnpm validate`（十项门禁 + `node --test`，见下文「小程序主题系统」），`pnpm preview` / `pnpm upload` 走 miniprogram-ci。

**当前仓库没有 `.github/workflows/ci.yml`。** 原有 GitHub Actions 工作流已于 2026-08-22 删除；`pnpm check`、`pnpm test:e2e`、真实 PostgreSQL 迁移、小程序 `pnpm validate`、官网 `pnpm check && pnpm build && pnpm check:links`、Gitleaks 与容器构建目前都要本地或在发布环境显式执行。恢复等价自动门禁是发布前事项，不能把“本地跑过”写成 CI 已覆盖。

## 架构要点

### 数据库：一个手写接口 + 原始 SQL，drizzle 只用来生成迁移

`src/server/db/client.ts` 导出 `Database` 接口（`query` / `exec` / `close`）并按 `DATABASE_URL` 选实现：

- `postgres://` → `postgres` 驱动（生产）
- `memory://` → 内存 PGlite（E2E）
- 空值或 `file://...` → 落盘 PGlite（默认 `file://.data/petbaby`，本地开发）

**运行时全部是原始参数化 SQL**，`src/server/db/schema.ts`（drizzle-orm）仅供 `drizzle-kit generate` 产出 `drizzle/*.sql`，业务代码不 import 它。行→领域对象的转换集中在 `src/server/db/rows.ts`（`mapPet` / `mapWork` / `mapTask` …，snake_case → camelCase）。

**关键陷阱**：`getDatabase()` 在首次调用时按 `client.ts` 里**硬编码列出**的迁移文件顺序 `exec` 一遍（当前 `0000` → `0026`）。新增迁移必须同时：① 在 `drizzle/` 放 forward-only 的 SQL，② 追加到 `client.ts` 的 `readFile` 列表，③ 视情况更新 `resetDatabaseForTest()`（它 TRUNCATE 固定表清单并重跑最后一个迁移）。只做①会让本地/E2E 拿不到新表。迁移一律只向前，不改历史。

### 生成任务：队列 + 本地内联执行

`generation_tasks` 是状态机（`queued` / `processing` / `succeeded` / `failed`，带 `attempt`、`available_at`、`locked_at`）。`src/server/worker/generation-worker.ts` 的 `claimNextTask()` 用 `FOR UPDATE SKIP LOCKED` 抢任务并回收超过 5 分钟的僵死锁，`processTask()` 失败时最多重试 `MAX_ATTEMPTS=2`，终态失败会退还 `daily_quotas` 并写站内通知。

任务驱动有三条路径，改动生成链路时都要考虑：

1. `pnpm worker`（`scripts/worker.ts`）—— 生产循环，同时轮询图文生成、视频渲染（`processNextVideo`）、AI 任务（`processNextAiRun`），每 60 秒跑一轮运维动作（关单、清理过期内容、订阅消息投递、会员配额重置、健康快照与告警）。
2. `POST /api/internal/worker` 等 `internal/*` 路由 —— 需 `Authorization: Bearer $WORKER_SECRET`，否则统一返回 404。
3. **本地/E2E 内联执行** —— `POST /api/generations` 在 `DATABASE_URL` 为空或 `memory://` 时直接 `await runNextTask()`，所以本地不起 Worker 也能走完全流程；这也是 Playwright 用例能同步看到结果的原因。

### 玩法（plugin）是数据驱动的

`src/plugins/registry.ts` 是内置 manifest 清单（PL-01/02/03 图文、PL-10 AI 肖像、PL-15 互动页、PL-19 视频、PL-20/21/22 纪念产品）。`src/plugins/runtime.ts` 才是运行时来源：首次访问把内置 manifest 播种进 `plugin_configs` / `plugin_config_versions`，之后从库里读，并叠加 `experiment_variants` 中 `status='live'` 的赛马变体；所有 manifest 都用同一个 Zod schema 校验，后台发布/回滚走 `updateRuntimePlugin` / `rollbackRuntimePlugin`（版本号自增 + 审计）。任务入库时会快照 `plugin_snapshot`，保证发布后不影响在途任务。

`manifest.generator.template` 映射到具体生成器：`src/server/generators/svg.ts` 的 `generatorRegistry`（`id-card-v1` / `movie-poster-v1` / `time-album-v1`，输出 SVG，必要时用 sharp 转 PNG、`generators/pdf.ts` 转 PDF）、`server/video/ffmpeg.ts`（视频）、`server/ai/*`（AI 图）。新增玩法 = 加 manifest + 加 registry 条目，不改路由。

### 业务逻辑分层

REST route handler 在 `src/app/api/**/route.ts`，它们只做「守卫 → 限频 → 调 service → 包 envelope」，几乎不含业务规则。准确路由数只在 `docs/README.md` 维护。规则集中在少数大 service：

- `server/platform-service.ts` —— 阶段一主链路：宠物、照片、生成、作品/版本/分享、订单、支付、退款。
- `server/growth-service.ts` —— 最大的一个：AI 四选一、互动页、视频项目、订阅消息、会员、年度报告、实体商品。
- `server/memorial-service.ts`、`server/account-service.ts`、`server/user-status-service.ts`、`server/maintenance.ts`。
- `server/timeline-service.ts` —— 成长时间线与「去年今日」，按 `photos.shot_at` 聚合。

外部依赖都走 provider 模式，本地有零配置实现、生产按环境变量切换：`server/storage/index.ts`（`LocalObjectStorage` ↔ `ConfiguredCloudStorage`，另含 `inspectImage` 魔数校验）、`server/payments/provider.ts`（模拟支付 ↔ 微信支付 v3）、`server/ai/provider.ts`（本地 SVG 占位 ↔ HTTP 图片接口，`generateWithFailover` 支持主备 + 熔断）。

### 请求约定

响应统一 `{ data }`；错误统一 `{ error: { code, message } }`，由 `server/errors.ts` 的 `routeError()` 生成（`ZodError` → 422，`AppError` → 自带 status，其余 → 500 且不泄漏细节）。前端 `src/lib/api.ts` 的 `apiFetch` 自动解包 `.data`；小程序 `services/api.js` 同构，并带 `requestWithRetry` 退避重试。

每个写接口的开头模式是固定的：

```ts
assertTrustedMutation(request);                   // 强制 JSON + 同源校验
const userId = await requireUserId(request);      // cookie 或 Bearer
await Promise.all([enforceRateLimit(...), assertGenerationCircuit()]);
```

`assertTrustedOrigin` 对 `x-petbaby-client: miniprogram` 放行（小程序无 Origin）。限频（`enforceRateLimit`）和日成本熔断（`assertGenerationCircuit`，读写 `system_usage`）都落库，不依赖内存状态。

### 认证与后台权限（本地是刻意放宽的）

`server/auth/session.ts` 用 HMAC-SHA256 签名的 cookie（`petbaby_session`，7 天），也接受 `Authorization: Bearer <同一 token>`（小程序用）。**非生产环境 `getOptionalUserId()` 会回落到固定 demo 用户**，`server/auth/admin.ts` 的 `isAdmin()` **非生产环境直接返回 true**；生产必须靠 `ADMIN_USER_IDS` 白名单，未授权时按 404 处理（不暴露后台存在）。所以「本地能进后台」不代表权限正确，涉及权限的改动要按生产语义判断。

后台页面（`src/app/admin/**/page.tsx`）都是 `export const dynamic = "force-dynamic"` + `assertAdminPage(await requireUserId())` 的服务端壳，UI 在对应的 `*-admin-client.tsx`。人工操作通过 `server/admin/audit.ts` 的 `recordAdminAudit` 留痕。

### 小程序主题系统：token 是唯一样式来源，靠 validate 强制

`apps/miniprogram` 的全部样式走 CSS 变量，**`.wxss` 里写死颜色/圆角/阴影/间距/字号会被 `pnpm validate` 拒绝**（`app.wxss` 是唯一豁免文件，承载 `var()` 兜底值）。四层结构：

- `theme/tokens.js` —— `TOKEN_SPEC` 是 57 个 token 的键名+类型真源。新增 token 必须先登记在此，四套皮肤缺键或类型不符时 validate 失败。**与主题无关的常量放 `CONSTANT_VARS`**（`--radius-pill`、`--glass-easing`、`--glass-blur-degraded`），只在 `app.wxss` 的 `page{}` 声明一次——注入串有 2KB 硬门禁，`glass` 主题曾因此超限。
- `theme/index.js` —— `THEMES` 清单（`cute` 默认 / `glass` / `light` / `dark`）+ `resolveTokens()`（缺键回落默认主题同名键，`blurSupported=false` 时叠加皮肤的 `degrade`）。加皮肤只改这一个数组。
- `theme/manager.js` —— 单例，`init()` 在 `app.js` 的 `onLaunch` **早于任何网络请求**调用以避免首屏闪变。切换只走内存 + `wx.setStorageSync` + 订阅广播，不发请求。`detectBlurSupport()` 按平台/基础库推断 `backdrop-filter`（Android 需基础库 2.10+ 且系统 ≥10），结果缓存，不逐帧检测。
- `theme/page-mixin.js` —— 26 页全部接入（含 `island` 分包 3 页），注入变量串并在 `onShow` 用 `wx.setNavigationBarColor` 同步导航栏（没用 `<navigation-bar>` 组件，它需要基础库 2.29.2，与 2.9.0 下限冲突）。

变量注入靠 `page-meta`，所以**基础库下限是 2.9.0**（`project.config.json` 的 `libVersion`）。低版本不白屏，退化成 `app.wxss` 的 `var()` 兜底 + `cute` 外观。

`components/glass-sheet/` 是沉浸式玻璃面板，接入 `pages/work` 和 `pages/ai-run`。**拖动期间零 `setData`**：位移、遮罩、`actions` 反向平移全在 `index.wxs` 里改样式，逻辑层只在手指抬起时收到一次 `onGestureEnd`。面板内的文本层级类（`glass-title` 等）放在 `app.wxss` 而非组件 `.wxss`，因为 slot 内容归页面作用域。

`scripts/validate.js` 十项（编号 1–10，另有 7b）：每页 4 文件齐备、JSON 可解析、零硬编码扫描、token 完整性与类型、文字对比度、玻璃面板双极对比度、注入串体积、黏土内高光跟随卡面明暗（7b）、`var()` 引用的变量确有来源、**组件在同页 `usingComponents` 注册**、**WXML 标签闭合**。最后三项管的都是「静默失效」类错误：无来源的 `var()` 只是不生效，漏注册的组件被当未知节点丢掉、页面少一块但不报错，标签失衡要等开发者工具打开才现形。`pnpm validate` 末尾还会跑 `node --test`（陪伴天数、岛的昼夜天气对照、命中表、帧循环与素材缓存）；准确页数与用例数只看 `docs/README.md`「当前状态」。当前没有 GitHub Actions 工作流，这条门禁必须在每次相关改动和发布前手工执行，恢复 CI 后再将它接回自动关卡。

**测试脚本带 `--test-concurrency=1`，且装 `global` 替身的文件必须在 `test.after()` 里还原。** `global.wx` 是进程级的而 `node --test` 默认并发跑文件，两个文件各自 `installWx()` 会互相覆盖 —— 表现是**单跑全过、合跑随机失败**，且失败信息指向渲染逻辑而完全不提替身（实测挂在「雨转雪两档粒子」与「窗户暖光淡入」两例）。两道防线都要：只加串行是把问题掩盖掉，谁把并发调回来就又随机红。理由见 22 号文 11.11。场景化配色走 `theme/scene-presets.js` 的 `.scene-*` 内联注入，与全局主题 token 刻意隔离。

**门禁的页面清单是 `app.pages ∪ subPackages[].pages`。** 只遍历 `app.pages` 会让分包页面完全不进第 1 项（四文件齐备）与第 9 项（组件注册）—— 而这两项管的正是「不报错但页面少一块」。两种键名都要认（微信同时接受 `subPackages` 与 `subpackages`）。第 8 / 10 项本已全目录递归，不受影响。

另有岛专属门禁 **16 / 17**（`docs/product/22-宠物小岛游戏化方案.md` 9.2）：16 校验 HUD 底板**合成后**的文字对比度并断言底板存在，17 断言岛内 `.wxss` 确实进了第 3 项的扫描范围（不重复扫描，只查覆盖）。文案类门禁 11–15 的扫描对象是服务端的日记模板与物品表，应随模板进 vitest，不在这里。

**门禁 16 遍历的是 `island/hud-vars.js` 的 `ISLAND_TEXT_ON_PLATE`（字色 × 底板的组合表），不是单一字色。** 只算主文字色会漏掉半透明的次级文字 —— `--island-ink-soft` 曾以 @0.7 通过门禁而实测只有 4.23:1（夜+晴压在树丛色上）。**半透明文字必须先与底板合成再算比值**，当成实色算得出的数字虚高。加字色或底板必须同步登记进那张表，`uncoveredVars()` 会正面断言这件事（漏登记 = 那个变量的对比度从来没被算过）。

### 宠物小岛（第一个留存型模块，方案见 `docs/product/22-宠物小岛游戏化方案.md`）

小程序侧在 `apps/miniprogram/island/`，**走分包**（主包余量不足 700KB）。**入口只能是卡片/按钮，不能加第四个 tab** —— tabBar 页面必须在主包内。当前挂「我的」页与宠物档案操作行，后者**必须带 `petId`**（不带的话点非默认宠物会看到错的那只）。**`petId` 两端都要接**：端上拼进 query 只是一半，`getIslandSnapshot` 也必须读它并传给 `loadIslandPet`（服务端此前静默丢弃这个参数，M1 被 `MAX_ISLAND_PETS = 1` 遮住，M2 会立刻必现）。取「优先项」语义而非过滤条件 —— 传进来的宠物没入岛时应回落到岛上那只，硬过滤会让快照变成「岛上没有宠物」。

**`memorial` 宠物不进岛，服务端拦 + 端上过滤两处都要**：只做端上隐藏则接口仍可调，只做服务端拦截则用户会看到入口点进去报错。理由与健康线同源——岛的核心机制是亲密度日增与陪伴天数递增，对已离开的宠物递增天数是明确的冒犯。端上那一半在 `island/service.js` 的 `selectablePets` 与 `pages/pets` 的 `showIsland`。

**昼夜与天气的真源是 `apps/platform/src/domain/island-weather.ts`**，端上 `island/scene/ambient.js` 是同一算法的第二份（TS 在小程序 require 不了，与 `services/companion.js` 对 `domain/companion.ts` 同一关系）。**漂移的表现是「画面在下雨、日记说晴天」**，所以 `scripts/island-ambient.test.js` 读 TS 源文件抽取每一个色值、不透明度、粒子数与段边界逐个比对，改一边不改另一边门禁直接失败。哈希实现本身也是口径的一部分，不能换。

**「两份实现必须一致」的地方，一致性本身要有门禁 —— 注释拦不住任何人。** 当前四对成对实现都有比对测试：`island-weather.ts`↔`ambient.js`、`companion.ts`↔`companion.js`（后者原先只有一句注释在要求，2026-08-06 补，见 22 号文 11.13）、`cutout.ts`↔`upload-island.mjs`、以及**抠图与打标的顺序**（跨 `growth-service.ts` 与 `island/avatar.ts` 的时序约定，由 `avatar.test.ts` 的逐像素用例钉住，见 26 号文缺陷 1）。做法一律是**读对面的源文件正则抽值再逐个断言**，而不是各写一份期望值 —— 写死期望值的话改了真源这边照样通过，而两边已经不一致了。**再添第五对时同步加比对测试。**

**岛的立绘：抠图必须在打标之前，且只打一次标。** 两步都在 `processNextAiRun` 完成（岛的 run 走 `cutoutSprite` → `applyAiLabel(AI_LABEL_PLATE)`），`adoptAvatarCandidate` 只把字节另存到岛的键下。**先打标再抠图会让标识底衬被色键当前景处理成半透明脏块留在图上** —— 实测标识框 4000 像素里 3658 个变半透明，且缩放后残影与真标识不重叠（y≈1330 对 y≈1504），而立绘要实时叠在浅色草地上。这件事**全程不报错**：抠图判据（`clearedPercent` 72.6%、`keyed: true`）与残留统计都是干净的，因为脏块落在羽化带里不进 `residue` 计数。另：`processNextAiRun` 的预览水印 SVG 必须按缩放后的真实尺寸生成，写死 640×640 会让非正方形产物（立绘是 3:4）直接抛 `Image to composite must have same dimensions or smaller`。

**岛的立绘任务复用 `ai_runs` 但不能走通用 `/api/ai-runs/*`。** `island-avatar` 刻意不在 `registry.ts` 注册，所以一旦通用侧的 `selectAiCandidate` 建出 `plugin_id='island-avatar'` 的 `works` 行，`hydrateWork` 现查 manifest 查不到就抛 `WORK_INCOMPLETE` —— **那行打不开也删不掉，且 `listWorks` 逐行 hydrate，一条脏行让整个作品列表 500**（与「archived manifest 不能删」同一故障模式，从另一头进来）。拦在**服务层**：`selectAiCandidate`/`rerollAiRun` 走 `assertNotIslandRun()`，`retryAiRun`/`cancelAiRun` 在 SQL 加 `AND plugin_id<>$3`。通用侧有五个入口，逐个路由加必漏改一处。

**叠加层是普通 alpha（`source-over`），不是色乘**，顺序固定**先昼夜再天气**。方案正文 2.5 与 24 号文第 4 章写的「色乘」是错的：2.5.1 的实算表只在 alpha 下复现得出（雨+夜 0.485；按 multiply 得 0.435，整表都对不上）。alpha 叠加不满足交换律，反序同样对不上。依据见 22 号文 11.2。

**HUD 顶部一行必须有奶白底板。** 16 种昼夜×天气组合下**没有任何单一字色能全域达标** —— 最暗的「雨+夜」深色字 3.23:1、白字 4.13:1 双双不达标。底板把文字与场景明度解耦，门禁 16 同时钉住它的存在（防被「优化」掉）。底板色走 `island/hud-vars.js` 的 `--island-*` 内联注入（内容属性，与 `--scene-*` 分前缀）；其余 HUD 元件全走既有 token，**岛不新增 UI 元件体系**。**这层奶白底板与 AI 标识的深色底衬用途相反、不可共用**：后者要压住白猫/雪地/阳光高光这类最亮画面。

**Canvas 只画场景，HUD 是覆盖其上的 WXML。** Canvas 内像素不受 token 约束，但 HUD 是 WXML 必须走 token。三条帧循环约束：帧率上限 **30fps**（低端安卓是基准机型）、**静止即停帧**、**天气档不适用停帧**（雨雪粒子是唯一持续跑帧的图层，帧预算靠上限 + 粒子数降级守，页面 `onHide` 时 `setIdle(false)` 关掉）。**计时一律 `Date.now()`，刻意忽略 rAF 时间戳** —— 两者原点不同，混用会让过渡动画瞬间跳完，且只在真机上出现。

**Canvas 内没有节点，热区必须自己维护**（`island/scene/layout.js`），每个 ≥88 设计单位、单屏 ≤8 个，宠物排在物件之前（重叠时用户想点的几乎总是宠物）。底图**一律底边对齐**：草地与物件落点因此完整，缺口只落在天空，而天空是唯一能用代码渐变补出来的区域。锚点**逐键合并**不整体替换 —— 少一个键会让站位变 undefined，宠物直接消失。

**素材全部远程加载 + LRU 本地缓存，LRU 必须真删**（`removeSavedFile`，不能只从索引抹掉：只写不删的话超配额后 `saveFile` 静默失败，表现是「素材突然不再更新」）。服务端下发绝对 URL，端上把以 `/` 开头的挑出来丢掉——那种值小程序会当主包内本地文件找，必然裂图且不报错。**「素材未就绪」是方案要求的正式路径不是临时兜底**（弱网首屏永远走它的一部分）：纯色底 + 立绘，**不画占位色块**（抽象色块是方案点名的违例）。

**缓存命中要同时比对 url，不能只看键名。** 场景素材的键带内容哈希（换图必换键）所以只看键是安全的，但**立绘的键是端上写死的 `pet-avatar`**，而它的地址每次重画都变（键里带 `runId`）—— 只看键名的话用户重画形象后画面永远是旧那只，**杀掉小程序重进也一样**（`saveFile` 是持久缓存），只有系统清缓存或被 LRU 淘汰才解开。内存层（`decoded`）与磁盘层（索引）**两道都要比**，漏了前者后者不会被问到。

**岛素材的字节不在镜像里，且必须经 `upload-island.mjs` 处理后才能灌。** `out/island/` 里是人工投放的原图（品红底、尺寸未裁），直接灌等于给端上一张带品红背景的图；`--keep` 写的 `keyed/` 只有需要 alpha 的那几张且被 gitignore。正确做法是 `node tools/imagegen/upload-island.mjs --stage tools/imagegen/out/island/staged`（按对象键布局摆好），`seed-samples.sh` 再整目录拷进卷。漏灌的表现与玩法样例图一致：接口全正常、只有取字节 404、端上大面积裂图且不报错 —— 所以 `/api/health` 下发 `islandAssets`/`islandAssetPaths`，`smoke-test.sh` 逐张校验。**清单读 `/api/health` 不读 `/api/island`**：后者要鉴权，冒烟脚本无会话读它只会拿到 401，于是「取不到地址」被当成「没配素材」静默通过。

**单张立绘只能做整体变换**：呼吸、浮动、挤压拉伸。**不做眨眼和转头** —— 眨眼要闭眼图或眼睛坐标，转头要另一个角度的图（那是多次生成，一致性拿不到）。生命感靠**代码绘制的情绪粒子**补，零素材且比眨眼更能读出情绪。近景是**同一张立绘放大裁切**，不是另一个角度。

**允许乐观动画，不允许乐观数据**（服务端权威）：点草丛立刻播粒子，但**掉落物等服务端返回才进库存显示**；额度与亲密度只能由服务端算。**到达每日上限的措辞决定它是不是体力值机制** —— 说「今天的草丛都看过了」而不是「体力耗尽」，实现在 `island/index/index.js` 的 `limitHintOf`。

**服务端 `/api/island/*` 已实现（9 条路由），两侧已对接。** 端上原按 5.5 契约猜字段名，对接时修了四处对不上的地方，逐条见 22 号文 11.10 —— 共同特征是**不报错**（日期整列空白、轮询 URL 里是 `undefined`、照片列全裂、只有宠物不见）。改岛的接口形状时先看那一节。

**M1 编码已全部完成并经两轮复核**（第 0/0b/2–8 步），7 张素材、manifest 与七组锚点也已回填。剩下的都不是写岛的业务代码：类目自查与 M0 提审、`downloadFile` 域名登记、部署灌图和真机验收。**「现在该做什么」只看 `docs/product/25-宠物小岛待完成清单.md`**（它取代了 22 号文 11.12）。改岛代码前另看两处：第二轮复核的 6 处静默失效缺陷与修法在 `docs/product/26-宠物小岛缺陷修复记录.md`，第 7/8 步的复核结论在 22 号文 11.13。

### UI 重构约定（2026-07 拍板，方案见 `docs/ui-refactor/`）

主基调是**精致**（F 的排版方法论：字重对比、负字距、留白），不是可爱；骨架用 **A**，E 只作区块嵌进 `pets` 与 `me`。J（黏土质感）限 3 处：结果卡、空状态、`create` 结果区。拍板全文见[阶段 0 第八章](docs/ui-refactor/阶段0-代码盘点与方向分配.md)。

**结构 token 全部进 `theme/tokens.js` 的 `CONSTANT_VARS`**，不进主题注入串。注入串有 2KB 硬门禁而 `glass` 曾只剩 3 字节，字重/字距/行高/比例这类与主题无关的值按主题 token 追加会直接把门禁挤挂。`CONSTANT_VARS` 的取值必须与 `app.wxss` 的 `page{}` 声明逐字一致（validate 第 8 项会比对）。

**阴影基色是暖褐不是纯黑**：`theme/tokens.js` 的 `SHADOW_HUE = "60,35,20"`（遮罩另有 `OVERLAY_HUE`），方案称这是「廉价与高级最快的分水岭」。阴影只能以**成品串**形式给出（`--shadow-card` / `--shadow-image` / `--shadow-float` / `--shadow-press`），不能拆成色相变量让 `.wxss` 自己拼 —— 门禁禁止 `.wxss` 出现 `rgba(`，组合必须在 JS 侧完成。

**`.chip / .chips / .chip-on` 与 `.hint` 已于 2026-08-03 提到 `app.wxss`**（`pages/pets` 的四个枚举改 chip 时提的），`ai-create.wxss` 不再重复声明。chip 的下标来自 `dataset.index` 而不是 picker 的 `detail.value` —— 从 picker 改过来时忘了这一处不会报错，只是选中项永远是第一个。

**玻璃面板内的文本层级类（`glass-title` / `glass-sub-title` / `glass-eyebrow` / `glass-small`）和 `.section-block` 放 `app.wxss`**，不放组件 `.wxss` —— slot 内容归页面作用域，写进组件样式表不生效。

**生图工具链在 `tools/imagegen/`**（`client.mjs` lingsuan 客户端 / `prompts.mjs` 提示词库 / `crop.mjs` 按方案 2.5 比例裁切 / `generate.mjs` 断点续跑 / `upload-samples.mjs` 推存储并打印 manifest 片段）。**本仓库的图片生成与图片编辑默认使用 lingsuan API**，不要先走内置生图工具再临时切换。凭据是 `LINGSUAN_IMAGE_BASE_URL` / `LINGSUAN_IMAGE_API_KEY` / `LINGSUAN_IMAGE_MODEL`，与运行时 provider 同名但**来源不同**：工具链读**仓库根目录的 `.env.imagegen`**（进程环境变量优先），运行时读 `apps/platform/.env*`。`.env.imagegen` 被根 `.gitignore` 的 `.env.*` 覆盖，不进版本控制。

**生图接口 2026-08-06 从 packy 换到 lingsuan（`https://lingsuan.top`，OpenAI images 兼容）**，四处实测差异都在代码里有对应处理，换回去或再换站时逐条复核：① 默认返回 **url 而非 b64_json**，且**下载主机与 API 主机不同**（`img.junliai.org`）—— 出网白名单要放两个域名，只放 API 域名的症状是「生成成功、取字节全失败」；② `response_format` 接口**接受**（packy 不接受），但仍不传，默认 url 形态省内存；③ `size` **只对方形生效**（`1600x1000` 实测返回 `2048x1376`），所以 `crop.mjs` 的本地裁切不能省；④ `background=transparent` **返 200 但不生效**（产物 `alpha=false`），packy 是 4xx 拒绝 —— 所以 `generate.mjs` 的品红回落判据是**回读产物 alpha**（`crop.mjs` 的 `hasAlpha`）而不是捕获异常，只 try/catch 的话岛的立绘会静默拿到不透明底、抠图无从下手。单张实测 46–62 秒（`quality=low`），比 packy 慢，超时默认已提到 180s。

**图片玩法现在是模板货架，不再是旧的玩法/风格/气质预设组合。** `server/image-template-registry.ts` 是已登记入口、模板状态、尺寸、主体模式和运行时提示词的单一事实源；只有 `status="live"` 且有 `masterStorageKey` 的模板才由 `/api/image-templates` 下发。当前登记 9 个入口，但 `human` 下的 V2 模板全部 `pending-review`，所以公开 API 仍只返回 8 个入口。单宠运行时输入固定为「冻结母版 → 宠物身份图」，人宠模板固定为「冻结母版 → 主人身份图 → 宠物身份图」；缺任一角色或母版必须明确失败，不能静默回落文生图。主人照片走迁移 `0025` 与 `owner-photo-service.ts` 独立存储，上传必须确认本人授权，读取/删除/账户清理都校验归属。

**宠物人化已经切到直接效果图方案。** 新任务只调用一次 lingsuan，参考顺序固定为「图一：用户宠物原图 → 图二：自有效果图」，一次生成 2 张，只输出完整自然真人，不生成或缓存人物身份卡，也不支持重抽。效果图在上线后由同一个对象同时承担公开展示图与运行时图二；模板专属提示词归一到 `server/pet-human-effect-prompts.json`，固定第一、三部分在 `server/image-template-registry.ts`。迁移 `0026` 与 `pet-human-identity-service.ts` 仅保留历史数据兼容和删除清理，不得重新接回生成链路。2026-08-21 V2 新图已在 `tools/imagegen/out/pet-human-v2/effects/` 完成本地规范化，数字 ID `N` 固定映射为 `human-effect-NN`，提示词和计划对象键均已登记；不得重复生图。全部条目维持 `pending-review`，明确发布批准前不得上传生产、seed、冻结或改 `live`。完整交接见 `docs/product/31-宠物人化两阶段执行与审批记录.md`。

**lingsuan 请求必须经过共享 FIFO 队列。** 运行时在 `server/ai/concurrency-queue.ts`，离线工具在 `tools/imagegen/request-queue.mjs`；两边并发硬上限都是 20。运行时默认 20，离线工具默认串行、可用 `LINGSUAN_IMAGE_CONCURRENCY` 或 `--concurrency=` 提高；429/5xx/网络错误最多重试 3 次，明确不可恢复的 4xx 立即失败。不要在单个生成脚本里再造一套并发或重试逻辑。

**离线审图/返工任务默认固定串行，不能为了批量返工提高并发。** lingsuan 的 `413 Payload Too Large` 通过缩小单次 multipart 载荷规避：每次请求只生成 1 张图，最多传 2 张与当前任务直接相关的参考图；输入先转为最长边不超过 1200px、质量约 82 的 JPEG，合计保持在 1MB 以下；禁止把 `frozen-masters-comparison.png`、`pending-masters-comparison.png`、其他 contact sheet 或整组原始大图作为编辑输入。失败重试仍复用同一份小载荷，不能在重试时追加参考图。

**公开展示图与运行时冻结母版必须分开登记。** 小程序模板卡片读取公开 `sampleStorageKey`，运行时身份替换读取 `masterStorageKey`；公开图可以是去水印、改展示配色或重新裁切后的效果示意，绝不能因此覆盖运行时母版。冻结母版变更必须换版本、哈希和 `masterStorageKey`；公开图变更只换 `sampleStorageKey`。内部 `frozen-masters-comparison.png` / `pending-masters-comparison.png` 只用于“第三方效果参考 ↔ 自有母版”审核，禁止对外发布。

`registry.ts` 里样例图存**站内相对路径**，`/api/plugins` 出口按 `PUBLIC_APP_URL` 补域名（小程序 `<image src>` 遇到以 `/` 开头的值会当主包内本地文件找，必然裂图）。键名带内容哈希，换图必须换键。老库回填**逐键合并**，只补缺的键、不动已有值：按「有 samples 就跳过」处理会让后续新增的子键永远进不去已写过 `heroUrl` 的行。

**纪念页的陪伴天数是过去式且不递增**（「陪伴了 N 天」）。截止日取 `memorial_spaces.created_at` 最小值，经 `listPets` 以 `memorialSince` 下发，端上 `services/companion.js` 用它封口。天数继续往上跳对这些用户是冒犯。该模块解析日期时区分纯日期串（用户填的日历日期，按本地零点）与 ISO 时间戳（服务端时刻，先转本地再取年月日），混用会差一天。

### 情绪价值方向（2026-07-30 交付，任务书见 `docs/product/14-direction-review-emotional-value.md`）

判据是**积累免费、交付物付费**：凡「单次输入 → 单次输出 → 结束」的功能都在抖音射程内，不能作主付费点。视频往**叙事和数据**上加，不往滤镜特效上加。

**时间有两套口径，不能统一**：`shot_at`（EXIF 拍摄时间，可为 NULL）说的是照片里的那一天，`created_at` 说的是用户的行为。年度视频的「今年收藏了 N 张」按 `created_at` 计数，段落里的「第 N 天 / 2025-03-01」按 `shot_at`；用拍摄时间计数会把今年上传的旧照片算到往年去。**排序键一律 `coalesce(shot_at, created_at)`**（与 `mapPhoto` 的读取侧回落同口径）—— 直接按 `shot_at` 排会让 NULL 在 DESC 里占最前，时间线开头全是日期不明的照片。**「去年今日」只认 `shot_at IS NOT NULL`**，上传时间的月日撞上今天纯属巧合。EXIF 解析手写在 `server/media/exif.ts`（最小 TIFF/IFD 读取器，时间字段在 Exif SubIFD 而非 IFD0），写入侧取不到就存 NULL，`Photo.shotAtSource` 区分两类，避免把上传时间当拍摄事实展示。

**陪伴天数一律封口，不跟着今天涨**：纪念页按 `memorialSince`，年度视频按年末（一条 2025 年度视频在 2026 年重看时天数不该变大）。里程碑只列已达成的，取 100/365/1000，不含第 1 天。天数计算全走 `domain/companion.ts`，不重新实现。

**`zoompan` 不要用**。它对**每个输入帧**输出 `d` 帧，配 `-loop 1 -t 2.4`（72 帧）会输出 72×72 帧，实测把 26 秒撑成 3 分 16 秒。`narrative.ts` 有断言钉住「filtergraph 不含 zoompan」+「输出 `-t` 等于所选时长」，加回来会立刻报警。**叙事视频四段走一条 filtergraph、一次 `spawn`**：分段渲染的 CPU 占用是数倍，而 `processNextVideo` 队列并发是 1，真要分段必须同期决定视频任务限流。`escapeDrawtext` 必须处理 4 个字符 `: ' \ %`（漏一个就解析失败或静默画错），计数动画的 `eif` 表达式必须夹上界，否则 `t` 越界后一路涨过目标天数。

时长三档 10/20/30 的单一口径在 `domain/video-duration.ts`；时间不够时**砍对比段**而不是压缩每段（0.3 秒的数据卡等于没有）。年度视频主角只取当年照片最多的一只（多只混排「第 N 天」失去意义），**均匀抽样保留首尾**而不是取前 N 张（否则整条片子停在一月）。成长对比图 `growth-compare-v1`（PL-23）**按拍摄时间排序而非 photoIds 顺序**，`photos.min` 是 2。作品按 `source_kind='report'` + `source_id='<userId>:<year>'` 归档，同年重复生成更新同条并自增版本。

`pages/timeline/` 的入口挂在 `pages/pets` 每只宠物的操作行并**必须带 `petId`**，不带的话点非默认宠物会看到错的那只。

### 健康分诊线（2026-08-03，方案见 `docs/product/17-产品改造方案.md` 3.7）

**做分诊不做诊断。这是法律要求不是产品选择。** 《动物诊疗机构管理办法》第十八条要求线上诊疗必须由持《动物诊疗许可证》机构的备案执业兽医师开展，第六条又要求固定实体场所——纯线上拿不到许可证。微信「宠物医院」类目同样要这张证。所以定位只能是「症状记录 + 紧急度分级 + 就医准备」。

**十条红线全文在 `docs/product/16-竞品分析与产品复盘.md` 3.8**，其中三条在代码里有强制点：

- **不推荐任何药物。** `server/health/triage.ts` 的 `mentionsDrug` 是**代码级后置过滤**，命中即整段降级为通用建议。**不能只靠提示词** —— 模型会在「不要提药」的指令下仍然提到药名，而用药剂量与禁忌高度依赖体重品种（猫对乙酰氨基酚致死）。`triage-adversarial.test.ts` 钉了 13 条绕过尝试（药名/类别/剂量/动作/中英混写）。
- **不给「不用去医院」的确定结论。** 四档里最低档也必须带升级条件，`sanitizeAdvisory` 会把这类句子替换掉并补 `watchFor`。
- **`memorial` 宠物屏蔽全部健康功能。** 服务端 `HEALTH_UNAVAILABLE_MEMORIAL` + 端上列表过滤，**两处都要** —— 只做端上隐藏接口仍可调，只做服务端拦截用户会看到入口点进去报错。

**紧急症状硬编码直通，不进模型**（`EMERGENCY_PATTERNS`）：模型有延迟也有失败率，等十几秒对尿闭的猫是实际风险。关键词**宽进严出**，必须覆盖口语（「喘得厉害」「尿不出来」），不能只匹配医学术语。`triage_source` 字段区分 `keyword` / `model`，是审计要求。

**用户可见文案不得出现「诊断」「确诊」「治愈」「问诊」**，包括类目描述、页面、推送、官网、小程序简介。免责声明由服务端 `advisory.disclaimer` 下发，端上不写死（两端各写一份必然漏改一处），且必须与结论同屏、不折叠。

健康线是**第六类执行管线**，产出不是作品：不进 `works`、不可分享。独立建表（`health_sessions`）而非复用 `generation_tasks`。额度也独立（`health_daily_quotas`），健康分诊用完不影响做图额度。

**`date` 列读出来可能是 JS `Date`**，`String(value).slice(0,10)` 会得到 `"Sat Aug 01"`。归一走 `health-service.ts` 的 `asDateString`，Date 分支取本地年月日而不是 `toISOString()`（`date` 无时区，转 UTC 会在东八区退回前一天）。

**主动提示与交付物（2026-08-04，迁移 0022/0023）**：`health/reminders.ts` 三类提示（疫苗驱虫到期 / 体重变化 / senior 季度检查）走**站内通知**而非微信订阅消息 —— 后者要逐次授权，而健康提示的价值在于打开小程序时看得到。`memorial` 排除写在每条 SQL 里（`life_stage <> 'memorial'`）而不依赖调用方过滤，`recordCare` 写入侧同样拦：**两处都要**。去重靠 `health_reminders` 的 `(pet_id, kind, subject_key)` 唯一约束，`subject_key` 必须带上变化量（疫苗带到期日、体重带记录 id、senior 带年份季度），否则续期或再次称重后永远不再提示。

**「变化」不是「异常」。** `domain/weight-trend.ts` 只做减法：给「较上次 +10%（400 克）」，不给「偏胖」「正常范围」「BMI」——体况评分是执业兽医的触诊项目，靠体重数字算不出来。提示语说「和兽医提一下」把判断权交回有资格的人。`weight-trend.test.ts` 与 `health/document.test.ts` 各有一条扫全文的评价词守卫。

**健康档案 PDF 是就医准备材料不是体检报告**（`health/document.ts`）。免责声明印在第一页顶部、带底衬、位置在正文之前 —— 这份文件会被打印带去医院，没有视觉分隔的免责声明会被当成正文读过去。文件里不出现「确诊」「治愈」「问诊」，也不出现「状况良好」这类评价性结论。**不打 AI 标识**（它是模板套用户自己录入的数据，不是生成合成内容）。会员 `healthExportUnlimited` 无限导出，非会员单买走 `entitlement_ledger` 的 `membership_id IS NULL` 凭据（`grantPurchasedCredit` / `consumePurchasedCredit`）。

**免疫记录的项目名由用户自己填，不给候选清单** —— 给清单等于在推荐具体疫苗或驱虫药（红线 2）。

### AI 生成内容标识（合规硬要求）

《人工智能生成合成内容标识办法》2025-09-01 已施行。**营销水印与 AI 标识命运相反**：前者付费移除（那是用户买走的东西），后者付费也必须保留（第四条要求导出文件也带）。实现在 `server/media/ai-label.ts`。

**`needsAiLabel` 只对 `generator.type === "image-api"` 为真。** 排版类是 SVG 模板套用户原照片、视频是 ffmpeg 模板合成，都不是生成合成内容——给它们打标是错误标注，既误导用户又损害观感。

标识**必须有深色底衬**，不能只用半透明白字：白字压在白猫/雪地/过曝天空上等于没有标识，而「显著」是法条用词。隐式标识走 sharp 的 `withMetadata`，实测能写进 PNG 的 EXIF（`ai-label-metadata.test.ts` 从产物回读验证）。

**AI 候选图的预览要从已打标字节缩**，不是从原始字节缩——否则免费预览没标识、付费版有，正好搞反。

### 玩法调性按生命阶段切换（不是删 manifest）

画册/短片/互动页各自合并了纪念形态，靠 `PluginManifest.toneVariants` + `resolveManifestTone`。`lifeStage` 三态 `active` / `senior` / `memorial`，**只能用户手动设置，不按年龄推断**（品种寿命差异极大）。

**老 manifest（PL-20/21/22）保留为 `status: "archived"`，不能删。** `works` 表**没有** `plugin_snapshot` 列（只有 `generation_tasks` 和 `orders` 有），`hydrateWork` 一律 `getRuntimePlugin(work.pluginId)` 现查——删条目会让历史纪念作品抛 `WORK_INCOMPLETE`，打不开也删不掉。archived 同时满足「新用户看不到」（`/api/plugins` 只输出 live）与「老作品读得出」。

**`hydrateWork` 里也要解析调性**：`createOrder` 的基础价取自 `work.plugin.pricing.unlockPrice`，漏了就会把纪念册按画册的基础价收费。

**免费玩法（`unlockPrice: 0`）的正式产物也要带水印。** `locked=false` 时 `getDownload` 返回 `outputKey`，不覆写的话免费玩法反而拿到比付费更干净的图。水印在这里不是付费墙，是传播载体。

**定价按积累量分档**在 `domain/pricing.ts`（放 `domain/` 因为 Web 端选择器要用），**下单时算不是生成时算**（用户可能隔几天才付，期间又上传了照片）。跨度用 `coalesce(shot_at, created_at)` 的 max−min，与 `timeline-service.ts` 同口径。纪念形态不分档——纪念场景比价是冒犯。

### 官网（`apps/website` + `docs/website/`）

静态原型在 `docs/website/prototype/`（11 区块单页，`index.html` + `styles.css` + `main.js` + `assets/`，无构建步骤，打开即看）。视觉体系与小程序同源：色值取 `cute.js`，阴影用 `tokens.js` 的暖褐成品串，浅色为主、hero 与页脚深色包夹。

**实现是 `apps/website`（Astro 7，纯静态，独立域名，与 `apps/platform` 互不影响）**，方案见 `docs/website/02-独立官网实施方案.md`、实现记录与偏离见 `03-独立官网实现说明.md`。命令在 `apps/website/` 下跑（不是 workspace，不能 `--filter`）：`pnpm build`、`pnpm check:links`（站内链接 + canonical/sitemap 一致性门禁）、`pnpm check:pixels`（首页与原型逐像素比对，Chromium 与 sharp 从 `apps/platform/node_modules` 借）。当前无 CI workflow，以上命令需显式执行。发布走 `deploy/scripts/release-website.sh`，切软链原子生效，不碰 Docker、不重启容器、不跑迁移。

三条不能破：**`src/styles/site.css` 与 `src/scripts/site.js` 是原型文件的逐字节副本**（`cmp` 可验），新样式一律进 `site-additions.css` / `prose.css` —— 改前者就说明视觉出现了偏差，停下来查原因。**素材三处同步**（真源 `tools/imagegen/out/website/` → 原型 → `apps/website/public/assets/`），release 脚本只 warn 不自动同步，因为哪份新只有人知道。**域名只有一个来源**：`SITE_URL` 环境变量同时喂 `astro.config.mjs` 的 `site` 与 `src/config/site.ts`，`robots.txt` / `llms.txt` 都是端点而非静态文件 —— canonical 与 sitemap 逐字一致是硬要求。

改首页结构后必跑 `pnpm check:pixels`：拆组件时漏一个 class 或改一层嵌套肉眼未必看出来，diff 会。它截到 `<footer>` 为止（页脚是刻意与原型不同的），比对范围内三档都必须是 0 差异像素。截图前必须 `img.decode()` 而不只是 `img.complete` —— 后者只说明字节到了、不保证已解码到可绘制，实测会让同一份产物在 0% 与 1.95% 之间来回飘。

**上线硬阻塞只剩小程序码**：放 `public/assets/miniprogram-qr.png` 并把 `site.ts` 的 `MINIPROGRAM_QR.available` 改 `true`，三个触点（顶栏按钮、右下角悬浮、CTA 面板）共用这一个文件。其余占位见 `site.ts` 的 `PLACEHOLDERS`。

`01-KittyPaw复刻规格.md` 的**正文保持原判不改写，偏离逐条记进第 9.1 章**（与 `docs/demand/` 同一个约定）——改官网代码前先看那一章，正文里的部分取值已被实现修正。规格正文是对参考站线上产物的**摘要**，动手前应抓原站产物复核：`curl` 拉 SSR HTML 与 `assets/routes-<hash>.js`（framer-motion 参数在后者，压缩过，用 `indexOf('w-64')` 之类锚点字符串切片读）。已发现正文漏项与自造项各若干，均记在 9.1。

两条容易踩的：**深色站的半透明值不能直接搬到浅色站** —— 原站 `bg-white/10` 的玻璃面板压在深灰天窗框上成立，挂到 hero 亮天空区白字只剩 4.43:1；凡半透明层叠在视频/图片上的都要按最坏帧实测。**给 `<img>` 加 `width`/`height` 属性后，只设 `width` 不设 `height` 的 CSS 规则会被属性高度接管**，`aspect-ratio` 静默失效（两处大图曾因此撑到 1200px 高）。

## 测试口径

Vitest 只收 `src/**/*.test.ts`（`fileParallelism: false`，因为共享 PGlite 单例），并把 `server-only` alias 到 `tests/server-only.ts`。覆盖率阈值（lines/functions/statements 75%、branches 65%）只作用于 `vitest.config.ts` 的 `include` 白名单（domain、plugins、errors、platform-service、request-guard、storage/index、generation-worker、entitlements、media/ai-label、health-service 与 `health/{triage,reminders,document}.ts`）——给这些文件加分支时要同步补测试，否则 `pnpm check` 会挂。健康线那几个进白名单是因为它们承载红线（药物过滤、memorial 排除、档案不给结论），漏测的后果是给出致害建议或对已离开的宠物推提醒。

Playwright 只有 `tests/e2e/main-flow.spec.ts` 两个用例：完整生成→解锁→分享主链路，以及遍历 8 个后台工作台并断言没有 `/api/admin/*` 4xx/5xx。加后台页面时记得补进那个列表。

## 环境与部署

`@electric-sql/pglite` 必须留在 `next.config.ts` 的 `serverExternalPackages` 里，否则 Windows 下 `memory://` E2E 会失败。`next.config.ts` 还统一下发 CSP 等安全头（开发态才放开 `unsafe-eval`）。

`server/runtime-mode.ts` 把运行模式分成 `development` / `staging` / `production` 三态：`NODE_ENV=production` 且 `APP_ENV=staging` 时（测试机）允许 `OBJECT_STORAGE_PROVIDER=local` 和 `PAYMENT_PROVIDER=development`，正式生产两者都强制失败关闭。判定集中在 `storage/index.ts` 的 `selectObjectStorage()`、`payments/provider.ts` 的 `selectPaymentProvider()` 和 `platform-service.ts` 的 `payOrder()`。

`server/config.ts` 的 `inspectConfiguration()` 按模式列出必需环境变量并给出 `productionReady` 判断，`/api/health` 暴露健康快照。变量清单见 `.env.example` 与 `docs/delivery/04-environment-reference.md`；本地容器用根目录 `compose.yaml`，测试机与生产编排、宿主机 **Nginx** 配置（`deploy/nginx/petbaby.conf` 与官网的 `petbaby-website.conf`）和部署脚本在 `deploy/`：**首次部署** `deploy/scripts/bootstrap.sh <域名>`，**日常发布** `deploy/scripts/release.sh staging`（拉代码 → 备份 → 迁移 → 灌样例图 → 健康检查 → 冒烟），**官网单独发布** `deploy/scripts/release-website.sh`。样例图**不在镜像里**（构建上下文是 `apps/platform`，素材在仓库根 `tools/imagegen/out/`），必须由 `seed-samples.sh` 灌进 `object-data` 卷；漏灌时 `/api/plugins` 与 `/api/health` 均正常，只有 `<image>` 取字节时 404，端上表现为大面积裂图且不报错，所以 `smoke-test.sh` 会逐张校验。

`src/proxy.ts`（Next 16 的 proxy 约定，取代旧的 `middleware.ts`）只在 `NODE_ENV=production` 生效：未携带 `petbaby_session` Cookie 且访问非公开页面时重定向到 `/login`（公开前缀为 `/login`、`/legal`、`/share`、`/interactive/share`、`/memorial/share`、`/annual-report/share`），因此本地开发与 Playwright E2E 完全不受影响。

## 文档索引

`docs/README.md` 是总索引，也是**页数/路由数/迁移号/用例数这类会漂移的计数的唯一权威处**。`docs/product/01-roadmap.md` 为治理计划，`docs/product/07-functional-backlog.md` 为唯一的功能待办来源（不要往里混部署或凭据类任务；当前唯一待办是虚拟支付合规与 `growth_orders` 支付缺陷），`docs/operations/05-release-checklist.md` 是发布门禁，`docs/operations/04-external-prerequisites.md` 记录仍需外部提供的凭据。

**两份盘点文档互补不重叠**：`docs/product/21-小程序功能点清单.md` 按 `app.json` 顺序维护小程序功能点编号（`MP-<页序>.<项序>`，编号稳定不重排，是逐项改动的进度依据；附录 B 记着「服务端已建但小程序无调用方」的接口，以及反向的「小程序已建但服务端未实现」——岛的 `/api/island/*` 已补齐，两侧已对接）；`docs/product/15-功能入口清单.md` 管 Web 页面、9 个后台、REST 路由、玩法 manifest 与 Worker 轮次。准确计数只看 `docs/README.md`。改小程序看前者，改 Web/后台/接口看后者。

`docs/product/17-产品改造方案.md`（批次 1–3）与 `20-功能改造方案-第二轮.md`（四批）是已完成的改造方案，偏离分别记在 20 号文 11.4 与 11.6；`19-验收文档.md` 记着验收结果与三个「只有真跑才发现」的缺陷。图片玩法的研究、原始矩阵、重构、animal 扩展和宠物人化审批依次看 `27`～`31` 号文。阶段一至三与后台批次 K 的逐批完成记录已归档清理，需要历史口径查 Git 历史。

`docs/product/14-direction-review-emotional-value.md` 是情绪价值方向的任务书，六项已全部完成，每项末尾的「实现记录」记着偏离与未验证项（**其中年度视频的成片观感未验证 —— 开发机无 ffmpeg**）。

`docs/demand/` 放已定稿的专项需求规格（当前是 `theme.md` 主题系统、`theme-2.md` 玻璃面板）。这两份的约定是**正文保持原判不改写，偏离逐条记进最后一章「实现差异记录」**——改主题相关代码前先看那一章，正文里的部分取值（如 45 个 token、`glassBackground` 透明度）已被实现修正。
