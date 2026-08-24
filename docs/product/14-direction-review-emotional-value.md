# 情绪价值方向：实施任务书

版本：v3.1 ｜ 日期：2026-07-30
性质：**可执行任务文档**。按任务顺序实施，每项含改动范围、验收标准与已知陷阱。
上游：`01-roadmap.md`、`02-product-design.md` ｜ 完成后：把功能项写入 `07-functional-backlog.md`

> **实施状态：六项任务全部完成**（2026-07-30）。每项末尾新增「实现记录」一节，记下与本文正文的偏离、踩到的坑和未验证项。
> 正文保持原判不改写，只在任务标题上标注完成。功能落点已登记进 `07-functional-backlog.md`。
>
> 全仓门禁状态：`eslint` / `tsc` / `vitest`（194 用例）/ `next build` / Playwright E2E（2 用例）/ 小程序 `validate`（23 页）与 `node --test` 全部通过。
> **未执行**：真实 PostgreSQL 迁移、装有 ffmpeg 环境的视频抽帧验证（开发机无 ffmpeg）。

---

## 0. 方向判断（实施前必读）

现在的产品是一组互不相关的图片玩法：用户拿到一张图就结束了，产品和这只宠物之间没有持续关系。这是抖音特效的形态，所以可替代。

**不可替代性只有四条边界**：宠物个体的连续性、内容的长期积累、实物化交付、克制的纪念体验。所有功能取舍以此为准。

**判定标准**：凡是「单次输入 → 单次输出 → 结束」的功能，无论多好看，都在抖音射程内，不能作为主付费点。

**付费分界**：积累永远免费，交付物付费。让用户攒东西不能有任何摩擦，攒得越多交付物越值钱。

**由此推出的视频定位**（重要，决定任务 2 的方向）：作为「一键成片」它可替代；作为「承载真实档案数据的叙事载体」它不可替代。所以视频要往**叙事和数据**上加，不往滤镜特效上加——后者是抖音主场，我们做到 60 分它也是 100 分。

---

## 任务 1：为照片补拍摄时间字段 ✅ 已完成

**为什么最先做**：`photos` 表只有 `created_at`（上传时间），没有拍摄时间。任务 3、4、5 全都依赖真实拍摄时间——用上传时间会让「第 1 天」变成用户建档那天，整条时间线是错的。这是唯一的硬阻塞项。

### 改动范围

1. **新增迁移** `apps/platform/drizzle/0015_photo_shot_at.sql`：
   
   ```sql
   ALTER TABLE photos ADD COLUMN IF NOT EXISTS shot_at timestamptz;
   CREATE INDEX IF NOT EXISTS photos_pet_shot_idx ON photos(pet_id, shot_at);
   ```
   
   可空。历史照片没有 EXIF，读取时回落到 `created_at`。

2. **`apps/platform/src/server/db/client.ts`**：把 `0015_photo_shot_at.sql` 追加到第 61 行起的 `migrations` 数组末尾。
   
   > ⚠️ **只放 SQL 文件不改这里，本地与 E2E 拿不到新列。** 这个清单是硬编码的，`getDatabase()` 首次调用时按序 `exec`。

3. **`apps/platform/src/app/api/uploads/route.ts`**：第 35 行已有 `await sharp(body).metadata()`，在其后提取 EXIF 拍摄时间。`sharp` 的 `metadata()` 返回的 `exif` 是 Buffer，需解析 `DateTimeOriginal`（格式 `YYYY:MM:DD HH:MM:SS`，注意日期部分用冒号分隔）。解析失败或无 EXIF 时传 `undefined`，不要传当前时间。

4. **`apps/platform/src/server/platform-service.ts`** 的 `savePhoto()`（第 137 行）：入参加 `shotAt?: Date`，写进 INSERT。

5. **`apps/platform/src/server/db/rows.ts`** 的 `mapPhoto()`（第 66 行）：加 `shotAt`，**回落到 `created_at`**：
   
   ```ts
   shotAt: iso(row.shot_at || row.created_at),
   ```

6. **`apps/platform/src/domain/models.ts`** 的 `Photo` 类型（第 119 行）：加 `shotAt: string`。

7. **`resetDatabaseForTest()`**（`client.ts` 第 86 行附近）：它 TRUNCATE 固定表清单并重跑最后一个迁移，把重跑的文件名更新为 `0015`。

### 验收标准

- 上传一张带 EXIF 的照片，`shot_at` 有值且等于拍摄时间；上传一张无 EXIF 的（如截图），`shot_at` 为 NULL 且 `mapPhoto` 回落到上传时间不报错。
- `pnpm test` 全绿；`pnpm db:generate` 不产生意外 diff。

### 实现记录

EXIF 解析没有引入依赖，手写在 **`src/server/media/exif.ts`**：sharp 的 `metadata().exif` 只交回 APP1 段原始字节，所以里面是一个最小 TIFF/IFD 读取器。要点：

- 时间字段住在 **Exif SubIFD**（tag `0x8769` 指过去），IFD0 只有 `DateTime`。只扫 IFD0 取不到 `DateTimeOriginal`。
- 取值优先级 `DateTimeOriginal` → `DateTimeDigitized` → `DateTime`。最后那个是文件修改时间，多数编辑软件会改写它。
- 有 `OffsetTimeOriginal`（多数手机会写）时按该偏移换算，没有则按本地时间 —— 与 `companion.js` 同一口径。
- 无效值一律 `undefined`：`0000:00:00`（相机时钟未设）、`2025:02:30`（Date 会静默滚到 3 月，靠回读年月日挡掉）、未来时间（留一天余量兜时区）、字节序标记不对、IFD 被截断。

`mapPhoto` 的回落只在**读取侧**，写入侧取不到 EXIF 就存 NULL，因此库里仍能区分两类照片 —— 为此 `Photo` 类型多了一个 **`shotAtSource: "exif" | "upload"`**，避免把上传时间当拍摄事实展示。

测试：`src/server/media/exif.test.ts` 11 条（自造 EXIF 字节，含大端序、无前缀、截断），另在 `platform-service.test.ts` 补一条落库与回落断言。

### 陷阱

- 迁移一律 forward-only，不改历史文件。
- EXIF 时间没有时区信息，按本地时间处理。**这里区分两类日期值的规则与 `apps/miniprogram/services/companion.js` 一致**：纯日期串按本地零点，ISO 时间戳先转本地再取年月日。混用会差一天。

---

## 任务 2：视频时长改为用户可选（10 / 20 / 30 秒）✅ 已完成

**当前状态**：服务端已修三个缺陷（见附录 A），单张固定 2.4 秒、总长随张数走。20 张 = 48 秒，对小红书偏长。改为用户选总时长、单张停留反推。

### 改动范围

**服务端** `apps/platform/src/server/video/ffmpeg.ts`：

- 把 `PER_PHOTO_SECONDS` 常量改为从 `config.durationSeconds` 读总时长（缺省 20），单张停留 = `总时长 ÷ 张数`。
- 保留 `FADE_SECONDS = 0.45` 的下限校验：单张停留必须 > `FADE_SECONDS * 2`（0.9 秒），否则画面大半在黑场。30 秒 ÷ 20 张 = 1.5 秒 > 0.9，安全；但 10 秒 ÷ 20 张 = 0.5 秒会出问题，需在服务端按所选时长限制张数上限。
- 三档对应的张数上限：**10 秒 ≤ 10 张、20 秒 ≤ 20 张、30 秒 ≤ 20 张**（20 是 `projectSchema` 现有上限）。

**服务端** `apps/platform/src/server/video/service.ts`：

- `projectSchema`（第 10 行）加 `durationSeconds: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(20)`。
- `renderVideoProject()`（第 85 行）构造 `config` 时带上 `durationSeconds`。
- 校验张数与时长的匹配，不匹配抛 `AppError("VIDEO_DURATION_MISMATCH", "...", 422)`。

**迁移**：`video_projects` 加 `duration_seconds integer NOT NULL DEFAULT 20`。同样要追加到 `client.ts` 的迁移清单。

**小程序** `apps/miniprogram/pages/video-create/`：

- 用现成的 `t-chip-group` 组件（3 个选项 ≤ 4，符合 CLAUDE.md 的「选项 ≤4 用 chip 不用 picker」约定）。需在 `video-create.json` 的 `usingComponents` 注册——**漏注册会被当未知节点丢掉，页面少一块但不报错**，`pnpm validate` 第 10 项管这个。
- `video-create.js` 第 31 行的 `syncDuration()` 现在写「每张约 1.5 秒」，与服务端不一致，改为显示所选总时长与当前张数是否匹配。
- `create()` 的 POST body 加 `durationSeconds`。

**Web 端** `apps/platform/src/components/video-create-client.tsx` 同步加时长选择。

### 验收标准

- 三档时长各生成一次，实际成片时长与所选一致（±0.5 秒）。
- 10 秒档选 11 张照片时被拒，错误提示明确。
- 抽取任一档的中间帧，画面不是黑场。
- `pnpm validate` 十项通过。

### 实现记录

单一事实来源落在 **`src/domain/video-duration.ts`**（不是 `server/video/`：Web 端选择器要用同一套上限，从 `server/` 导入会让 RSC 边界看起来是错的）。小程序无法共享模块，`pages/video-create/video-create.js` 顶部有一份对照实现，改档位要两边同步。

**`MIN_PHOTO_SECONDS` 取 1 秒而不是 0.9 秒**（两段 fade 之和）。按 0.9 算 `floor(10 / 0.9) = 11` 张，每张 0.909 秒只比 fade 多 9 毫秒 —— 画面刚淡入完就开始淡出，观感仍是黑场。取整到 1 秒正好给出任务书定的三档上限：10 秒 ≤10 张、20/30 秒 ≤20 张。

顺带修掉三处相关缺陷：

1. **封面重复计入帧数**。`ffmpeg.ts` 把 `cover` 前插到 `photos`，而封面本来就是已选照片之一，帧数比用户选的多一张；`slice(0, 20)` 随后把末尾那张顶掉 —— 用户选的最后一张照片被静默丢弃。改为 `new Set` 去重。
2. **两条入口不写时长**。互动页导出与 `createVideoRender` 原先不带 `durationSeconds`，会隐式吃缺省档。改为显式写入 `shortestDurationFor(张数)`：不让用户选时长的入口取能容下张数的**最短**档，既不黑闪也不把 3 张摊成 30 秒。
3. **硬编码「15 秒」文案**。作品副标题、PL-19 描述、`/video/create` 标题都写死 15 秒，时长可选后对 10/30 秒的片子是错的。副标题改为按实际时长生成；页面标题顺带把「只属于它的」改掉（调性要求不用「它」）。

补了视频侧的自动化覆盖（此前 `server/video/*` 不在覆盖率白名单、Playwright 也不跑视频链路，正是附录 A 那个「`.45` 让线上渲染 100% 失败」活了很久的原因）：把参数拼装抽成纯函数 `buildFfmpegArgs()`，`ffmpeg.test.ts` 10 条断言时长、无前导零写法、fade 起点非负、字体路径转义；`video-duration.test.ts` 8 条钉住不变量；`video/service.test.ts` 7 条覆盖三档落库、11 张被拒、只改时长也被拒、config 带时长、历史项目走 DEFAULT。

**未验证**：本机没有 ffmpeg，「实际成片时长 ±0.5 秒」与「中间帧不是黑场」两条需在有 ffmpeg 的环境实测。参数层面的等价断言已在 `ffmpeg.test.ts` 覆盖。

---

## 任务 3：纪念册质量升级（C1）✅ 已完成

**为什么优先**：`memorial-service.ts` 第 26 行的产物是一段 SVG——纯色底 + 标题 + 正文，**完全没有用户的照片**。而 PL-20 定价 29.9。纪念场景是付费意愿最高、最不比价的一段，这个交付质量撑不住这个价，且粗糙比缺失更伤人。这是唯一「已经在卖但不合格」的一处，属于修补而非新建。

### 改动范围

`apps/platform/src/server/memorial-service.ts` 的 `generateMemorialProduct()`：

- `product === "album"` 分支改为多页图文册：封面（宠物名 + 陪伴天数）→ 照片页（每页 1–2 张 + 用户写的 `storySections`）→ 结尾页。
- 照片要真正嵌入。参考 `apps/platform/src/server/generators/svg.ts` 的 `time-album-v1` 实现（它已经在做多照片排版），复用其模式而不是重写。
- 输出 PDF 而非单张 SVG——`server/generators/pdf.ts` 已有能力。纪念册的交付形态应是可长期保存的文件。

### 验收标准

- 生成的纪念册包含用户全部选中照片，`storySections` 的分段文字正确落位。
- 无照片时给明确错误（现有 `MEMORIAL_PHOTOS_REQUIRED` 已覆盖），不产出空册子。
- 陪伴天数用「陪伴了 N 天」的过去式表述且不递增（见任务 4 的口径说明）。

### 陷阱

- 纪念线全局约束：无弹窗、无推销、无热度榜。文案不得出现感叹号、不得替用户表达悲伤。
- `escapeXml()`（第 23 行）目前是直接删除特殊字符，用户故事里的引号会被吃掉。改成正确转义。

### 实现记录

纪念册在 **`src/server/memorial/album.ts`**，多页 PDF：封面（宠物名 + 陪伴天数 + 封面照）→ 照片页（每页 1–2 张 + 对应 `storySections` 分段）→ 故事页 → 结尾页。照片以 base64 data URI 嵌进 SVG 再由 sharp 光栅化，模式沿用 `time-album-v1`。

几个不显然的决定：

- **不用 `foreignObject` 折行**。librsvg（sharp 的后端）对它支持不完整，结果是**整块文字静默消失** —— 原实现的 story 正是放在 foreignObject 里。改为自己按字数折成多个 `<tspan>`。
- **底色用浅纸色不用深色**。册子是要打印、要翻看的，深底大面积油墨在纸上发闷，且照片压在深底上更暗。
- **故事页文字按行数垂直居中**。故事通常两三行，顶部对齐会得到「一页几乎全空、文字挂在上边」的版面（实际渲染样张确认过）。
- **单张照片页给到 1180 高**（近 3:4）。原先 900 会在页面下方留一条 300px 空白带。
- **照片顺序按 `photo_ids` 重排**。`id=ANY(...)` 的返回顺序不保证与入参一致，而册子的叙事就是用户排的那个顺序。
- **`escapeXml` 改为真转义**并从 album 模块导出复用；单引号不转成 `&apos;`（属性外的 `'` 是合法 XML 字符）。

`works.asset_kind` 新增 `"pdf"` 取值，`Work` 类型同步扩。**这一步不能省**：`work-preview.tsx` 原先无条件把 `outputUrl` 塞进 `<Image>`，PDF 会渲染成碎图占位。现在 PDF 用封面照片做预览、内容走下载（`getDownload` 的 `format=pdf` 本来就能命中）。

陪伴天数的服务端口径落在 **`src/domain/companion.ts`**，是 `apps/miniprogram/services/companion.js` 的对照实现（两边给出不同数字无法向用户解释）。截止日取纪念空间创建时间，**没有截止日就不给数字** —— 用户可以直接把生命阶段改成「已离开」而不建纪念空间，那时天数会一路涨到今天。

顺带修掉：纪念视频直接 INSERT `video_projects` 时不写 `duration_seconds`，会依赖列的 DEFAULT；改为显式写 `shortestDurationFor(张数)`。

测试：`memorial/album.test.ts` 10 条（页数、分段落位、三主题、引号转义），`memorial-service.test.ts` 6 条（PDF 魔数与 contentType、asset_kind、版本自增、空册子与字节丢失均报错、隐藏空间不出册），`domain/companion.test.ts` 10 条。**光栅化用例显式给了 60 秒超时** —— 开覆盖率时 v8 instrumentation 让 sharp 明显变慢，5 秒默认值会造成「只在 `test:coverage` 里挂、单跑又过」的假失败。

---

## 任务 4：成长时间线 + 去年今日 + 成长对比图（方向 A 底座）✅ 已完成

零边际成本，是任务 5 的数据基础。三项建议一起做，共用同一批查询。

### 4.1 时间线视图

- 新接口 `GET /api/pets/[id]/timeline`：按 `shot_at`（回落 `created_at`）倒序返回照片，每条带「第几天」。
- 起算日规则**沿用 `apps/miniprogram/services/companion.js` 的现有逻辑**：优先生日/到家日，缺失时回落档案创建日。不要重新实现一套。
- 自动里程碑：第 100 / 365 / 1000 天。
- 小程序新页面 `pages/timeline/`，需 4 文件齐备（`.js` `.json` `.wxml` `.wxss`）并加进 `app.json` 的 `pages`。

### 4.2 去年今日

- 查询：同一宠物、`shot_at` 的月日与今天相同、年份更早的照片。
- 命中才推送，**没有就静默，不要硬凑**。走已有的 `message_subscriptions` 通道。

### 4.3 成长对比图

- 新玩法，走 `svg.ts` 的 `generatorRegistry` 加一个 `growth-compare-v1`，manifest 加进 `registry.ts`。
- 内容：同一只宠物两个时间点并排 + 间隔天数。
- **样例图规则**：`registry.ts` 里存站内相对路径，键名带内容哈希，换图必须换键。缺样例图时只留文字，**不画占位色块**。

### 验收标准

- 时间线的「第几天」与 `companion.js` 算出的陪伴天数一致，不差一天。
- 无 `shot_at` 的历史照片按上传时间排序，不报错、不排到 1970。
- 对比图的两张照片确实来自不同时间，间隔天数正确。
- 新玩法在 `registry.test.ts` 有对应断言。

### 陷阱

- 新增玩法 = 加 manifest + 加 registry 条目，**不改路由**。
- `runtime.ts` 只在首次访问时播种内置 manifest，之后从 `plugin_configs` 读。**已部署环境改 `registry.ts` 不会自动生效**，必须走后台 `updateRuntimePlugin` 或补回填。老库回填要**逐键合并**，只补缺的键、不动已有值。

### 实现记录

服务端集中在 **`src/server/timeline-service.ts`**：`getPetTimeline` / `findOnThisDay` / `scheduleOnThisDay` / `pickGrowthPair`。「第几天」全部走 `domain/companion.ts`，不重新实现一套。

- **排序键是 `coalesce(shot_at, created_at)`**，与 `mapPhoto` 的回落口径一致。直接按 `shot_at` 排会把无 EXIF 的照片全堆到最前（NULL 在 DESC 里排最前），时间线开头就是一堆日期不明的照片。两处口径必须一样，否则「排第 3 位的照片显示更早的日期」。
- **去年今日只认 `shot_at IS NOT NULL`**。上传时间的月日撞上今天纯属巧合，拿它说「去年今日」是假的。没命中返回空数组，端上静默隐藏。
- **`scheduleOnThisDay` 按天去重**，Worker 里放在 1 小时的独立轮次而不是 60 秒运维轮次 —— 它要遍历全部用户、每人一次命中查询，而一天最多产出一条消息。
- **`totalDays` 按 `memorialSince` 封口**，里程碑只列已达成的：已离开的宠物不该冒出一个不会发生的「第 1000 天」。
- 里程碑取 100 / 365 / 1000，**不含第 1 天**（那是起点不是成就，标出来会稀释另外三个）。

成长对比图 = `growth-compare-v1` 生成器 + PL-23 manifest。两个决定：**按拍摄时间排序而不是 photoIds 顺序**（用户点选顺序与拍摄先后无关，排错了「成长」方向就是倒的）；**`photos.min` 是 2 而不是 1**（一张比不出变化，放行只会让用户拿到左右一样的图）。渲染样张确认过：最早的在左、间隔天数 = 右边天数 − 左边天数。

小程序新增 `pages/timeline/`（4 文件齐备、已进 `app.json`，23 页 validate 通过），入口挂在 `pages/pets` 每只宠物的操作行，带 `petId` 进去 —— 不带的话点非默认宠物会看到错的那只。

`registry.test.ts` 补了一条**通用**断言：所有 `html-template` 玩法的 `template` 必须在 `generatorRegistry` 里。这类错配原先要等任务入队后在 Worker 里才失败，用户先看到「生成中」再看到失败，而原因（拼错的模板名）只在服务端日志。

**样例图缺失**：PL-23 暂无 `samples`。按 CLAUDE.md 的规则缺图时只留文字、不画占位色块，补图时键名要带内容哈希。

测试：`timeline-service.test.ts` 15 条、`generators/svg.test.ts` 5 条、`domain/companion.test.ts` 10 条。另起 dev server 实测过 `/api/pets/[id]/timeline`（`totalDays: 942`，里程碑含 100/365 不含 1000）与 `/api/on-this-day`，外人的 pet id 返回 404。

---

## 任务 5：叙事型年度视频（B6，PL-19 的升级形态）✅ 已完成

**这是视频「可变玩法」的第一个具体形态**，也是任务 0 里「往叙事和数据上加」的落地。技术已全部验证可行（见附录 B），四段结构：

1. **开场**：陪伴天数从 0 计数到当前值。`drawtext` + `eif` 表达式实现。
2. **时间线**：每张照片带真实拍摄日期 + 「第 N 天」+ 可选备注。依赖任务 1 的 `shot_at`。
3. **成长对比**：`vstack` 上下分屏，第 1 天 vs 今天。
4. **结尾数据卡**：照片数、作品数等逐行淡入。数据源与 `annual_reports`（`growth-service.ts` 第 355 行）的聚合查询共用。

每个数字都必须来自这个用户的真实数据。**判定方法：把宠物名字换掉，如果句子仍然成立，这句文案就是无效的。**

### 验收标准

- 用真实档案生成一条，四段齐全，日期与 `photos.shot_at` 一致。
- 照片不足（如只有 1 张）时降级为单段，不崩。
- 总时长受任务 2 的时长选项约束。

### 陷阱

- **`zoompan` 帧数陷阱（务必写进代码注释）**：它对**每个输入帧**都输出 `d` 帧。若输入用 `-loop 1 -t 2.4`（72 帧），实际输出 72×72 帧——实测把 26 秒的片子撑成 3 分 16 秒。必须只喂单帧静图（不加 `-loop`），再用 `trim=duration=N,setpts=PTS-STARTPTS` 封口。
- **分段渲染加剧队列挤占**：每段一次 `spawn` 加最终拼接，CPU 占用是单段方案的数倍，而 `processNextVideo` 队列并发是 **1**。实施时需同步决定是否给视频任务单独限流或独立 Worker——否则视频任务会拖慢图文任务。

### 实现记录

三个文件：`server/annual/aggregate.ts`（数据）、`server/video/narrative.ts`（filtergraph，纯函数）、`server/video/annual-film.ts`（入队 + 渲染编排）。入口 `POST /api/annual-films`。

**两个陷阱的处置**：

1. **`zoompan` 不用**。帧数陷阱的注释写进了 `narrative.ts` 的函数文档，并有一条断言钉住「输出侧 `-t` 等于所选时长」+「filtergraph 不含 zoompan」—— 将来有人加进来会立刻报警。不用它的理由不只是风险：方向判断明说「往叙事和数据上加，不往滤镜特效上加」，Ken Burns 的观感收益不值这个代价。
2. **不分段渲染**。四段走**一条** filtergraph、一次 `spawn`，因此不引入新的 CPU 倍数，队列并发 1 不用动，也就不需要给视频任务单独限流。代价是 filtergraph 较长；收益是队列行为与现状完全一致。真要分段时必须同期决定限流 —— 这条留在注释里。

**几个不显然的口径**：

- **计数按 `created_at`，叙事日期按 `shot_at`**。「你今年收藏了 128 张照片」说的是用户当年的行为；用拍摄时间会把今年上传的旧照片算到往年去。而段落里的「第 N 天 / 2025-03-01」说的是照片里的那一天。两者语义不同，不能统一。
- **陪伴天数按年末封口，不按今天**。一条 2025 年度视频在 2026 年重看时天数不该变大 —— 那份视频讲的是 2025 年结束时的事实。年份未过完时才按今天算。
- **主角只有一只宠物**（当年照片最多的那只）。多只混在一条时间线上，「第 N 天」就失去意义，因为各自起算日不同。
- **均匀抽样保留首尾**，不取前 12 张 —— 取前 N 张会让整条片子停在年初，「这一年」只讲了一月份。
- **时间不够时砍对比段**而不是把每段压到看不清；一段 0.3 秒的数据卡等于没有。
- **`escapeDrawtext` 处理 4 个字符**：`:`（filtergraph 分隔符）、`'`（提前闭合引号）、`\`（转义引导）、`%`（drawtext 的 strftime 格式符）。漏掉任何一个会让 filtergraph 解析失败或静默画错内容。
- 计数动画的 `eif` 表达式**必须夹上界**：`t` 超出区间后表达式仍在求值，不夹会一路涨过目标天数。

作品按 `source_kind='report'` + `source_id='<userId>:<year>'` 归档，同年重复生成更新同一条并自增版本。锁定策略沿用 PL-19（预览免费、高清 19.9）。

测试：`narrative.test.ts` 16 条、`annual/aggregate.test.ts` 13 条、`annual-film.test.ts` 5 条、`annual-render.test.ts` 2 条（验证 `processNextVideo` 认出 `kind==='annual-film'` 走叙事分支；本机无 ffmpeg 时断言失败必须落 `status='failed'` 带 error_code，不静默卡在 processing）。接口实测：无照片返回 `ANNUAL_PHOTOS_REQUIRED`，非法时长 422。

**未验证**：本机没有 ffmpeg，四段成片的实际观感与「日期与 `photos.shot_at` 一致」需在有 ffmpeg 的环境抽帧确认。参数层面的等价断言已覆盖。

---

## 任务 6：年度报告内容做实（B3）✅ 已完成

`growth-service.ts` 第 355 行的 `annual_reports` 现在是纯计数 SVG（几个数字 + 一句话），没有任何照片。改成有真实照片和叙事的长图。与任务 5 共用聚合数据，建议同期做。

### 验收标准

- 报告包含用户当年的真实照片。
- 预览版水印逻辑保留（现有实现第 364 行的 `preview` 替换）。

### 实现记录

排版在 **`src/server/annual/report.ts`**，数据与叙事视频**共用** `annual/aggregate.ts` —— 两个产物在同一年给出的数字不一样是不能接受的。结构：封面（陪伴天数 + 主图）→ 3 张真实照片带「第 N 天」与拍摄日期 → 数据条 → 年初到年末的跨度。

- **删掉了「这一年，我们认真生活过」**。把宠物名字换掉这句仍然成立，按判定方法它是无效文案，有一条测试钉住它不再出现。
- **仍是长图不是 PDF**。年度报告的用途是分享（获客物追求可传播），与纪念册（付费物追求可保存）相反 —— 见任务书「交付形态优先级」那条冲突的分层处理。
- **落 PNG 而不是 SVG**。微信内置浏览器与部分客户端对 SVG 里的 data URI 图片渲染不一致，而这份东西就是要被别人打开的。
- **水印仍用「在 `</svg>` 前插一组元素」**而不是重新排版：预览与正式版版面必须逐像素一致，否则用户解锁后会发现「买到的和看到的不一样」。
- 只放 3 张照片：再多长图会长到没人滑到底。

渲染样张逐版看过并据此修了三处：封面照从 240 高改到 320（原来像一条色带）、照片说明文字改为相对图片底边定位（原来贴到下一张图上）、`年糕 的 2025` 这类中文里的多余空格。

测试：`annual/report.test.ts` 10 条（照片真嵌入、计数与天数落位、无效文案已删、纪念过去式、水印不改版面、光栅化尺寸），另在 `growth-service.test.ts` 补一条端到端断言 —— 输出是 `.png`、`contentType` 为 `image/png`、嵌了真照片的长图体积 > 20KB、预览版字节与正式版不同（水印确实叠上了）。

---



## 定价参考（已有实现的沿用，新增的建议值）

| 交付物           | 定价        | 状态                     |
| ------------- | --------- | ---------------------- |
| 叙事型年度视频（任务 5） | 19.9–29.9 | 沿用 PL-19 现有 19.9       |
| 纪念册电子版（任务 3）  | 29.9–49   | PL-20 现价 29.9，质量修好后可上调 |
| 纪念视频（PL-21）   | 29.9      | 维持，同样应升级为叙事结构          |
| 年度报告（任务 6）    | 19.9      | 沿用 PL-09 现价            |
| 周年纪念册         | 19.9–39.9 | 新增，时点稀缺 + 内容不可替代       |
| 成长对比图（任务 4.3） | 免费（带水印）   | 属「积累」层，作分享钩子           |

---

## 内容调性要求（所有任务适用）

产品说「你们」，不说「用户」和「素材」。

**文案克制，陈述事实而不评价情绪。**「你们一起过了 743 天」比「多么温暖的陪伴时光」有效得多——前者是用户自己的事实，后者是产品的表演。与 UI 重构已定的「主基调是精致而非可爱」一致。

不要用「它」这种字眼，不可行，要把宠物当成家人，替代方案你自行寻找和决定。

**陪伴天数在纪念场景是过去式且不递增**（「陪伴了 N 天」）。截止日取 `memorial_spaces.created_at` 最小值，经 `listPets` 以 `memorialSince` 下发，端上 `services/companion.js` 封口。天数继续往上跳对这些用户是冒犯。

**交付形态优先级**：实物 > 可长期保存的文件（PDF/长图/视频）> 分享链接 > 一张图。

> 这与 `02-product-design.md` 现有的「晒图优先」原则有冲突。分层处理：**获客物追求可传播，付费物追求可保存。**

**使用节奏**：每日（去年今日，有则推无则静默）→ 每月（月度小册静默生成）→ 里程碑（第 100/365/1000 天、生日、到家日，付费转化主窗口）→ 每年（年度报告 + 叙事视频，11–12 月）。纪念线永不主动触达。

---

## 附录 A：已修复的三个视频缺陷（已完成，勿重复）

均在 `apps/platform/src/server/video/ffmpeg.ts`，已改并实测验证通过（`tsc` / `eslint` / `vitest` 62 用例全绿）。

**① 线上视频渲染此前 100% 失败。** 原 `fade=...:d=.45`，ffmpeg 6+ 拒绝把 `.45` 解析为时长（`Unable to parse option value ".45" as duration`），filtergraph 初始化失败。生产镜像 `apk add ffmpeg` 装的正是 6.x。已改为 `0.45`。

此缺陷从未被发现是因为覆盖不到：`vitest.config.ts` 的 include 白名单不含 `server/video/*`，Playwright 也不跑视频链路。**建议补测试覆盖，否则同类 bug 会再来。**

**② 近一半时间画面在黑场。** 原 `duration = 15 / 张数`，8 张时每张 1.875 秒，两段 fade 吃掉 0.9 秒。已改为固定单张时长（任务 2 会进一步改为用户可选）。

**③ Alpine 容器中文字幕静默丢失。** `drawtext` 未指定 `fontfile`，`apk add ffmpeg` 不含中文字体，中文渲染成方框或整行消失，**且 ffmpeg 退出码仍为 0**。已新增 `FFMPEG_FONT_FILE` 环境变量 + `drawtextFilter()` 函数，Dockerfile 增装 `font-noto-cjk`。

同步改动：`Dockerfile`、`.env.example`、`deploy/.env.staging.example`、`deploy/.env.production.example`、`docs/delivery/04-environment-reference.md`。

**尚未执行**：`pnpm build`、`pnpm test:e2e`。

---

## 附录 B：已验证可行的 FFmpeg 手段

全部纯 FFmpeg，零边际成本，已用真实照片实测出片。

| 手段                 | 效果                  | 备注                            |
| ------------------ | ------------------- | ----------------------------- |
| `xfade` 交叉溶解       | 画面直接过渡，不经过黑场        | 比 `fade` 观感高一档                |
| `zoompan` 缓慢推近     | 静态照片有呼吸感（Ken Burns） | **见任务 5 的帧数陷阱**               |
| 模糊衬底 + `contain`   | 竖屏不裁掉宠物头部           | 需 sharp 预合成                   |
| `drawtext` + `eif` | 数字随时间递增的计数动画        | 用于陪伴天数开场                      |
| `vstack` 上下分屏      | 两个时间点的成长对比          | 需分别预处理成半幅                     |
| `drawbox` 半透明底衬    | 字幕在任何底图上可读          | 服务端不受 `.wxss` 禁 `rgba(` 的门禁约束 |
| 分段渲染 + `concat`    | 多段式叙事结构             | **CPU 占用数倍，队列并发为 1**          |
| 1080×1920 / CRF 20 | 小红书基准画质             | 体积 8 MB 量级                    |

**成本画像**（8 张照片、19.2 秒、开发机）：渲染 3.6 秒、输出 2.4 MB。2 核测试机按 3–4 倍估算约 10–15 秒。真正的约束不是钱，是**队列串行**——视频任务独占 CPU 时图文任务跟着延迟。

另有一处待优化：每条 render 把同样字节写两份（`key` 与 `previewKey` 都 put 同一 body），MP4 体积下这是实际浪费。

---

## 附录 C：万相实验记录（技术底牌，不进正式功能）

探索过「给定一张照片让它动起来、不同照片做相同动作」的路线，跑通且效果好，但**不作为正式功能**。此处仅存档，需要时可复活。

**模型选择**：百炼主线已到 Wan 2.7 / HappyHorse 1.1，但 **animate（动作迁移）只存在于 wan2.2 分支**，全平台仅 `wan2.2-animate-move`（动作迁到照片主体，背景不变）和 `wan2.2-animate-mix`（换主体）两个。没有 wan2.6/2.7-animate。选它不是因为新，而是「动作一致性」在百炼上只有它满足——更新的 `*-i2v` 是首帧生视频，模型自由发挥、每次结果不同，恰好做不到一致性。

**实测**（2026-07-30 北京区，wan-std）：耗时 87 秒，4 秒成片，计费 `{"video_duration":4,"video_ratio":"standard"}` = 1.6 元，输出 816×1088 / 15fps。**官方文档通篇只讲「人物图片」，未提动物，但对宠物有效**——输出首帧从侧脸转向镜头，毛发、胡须、眼睛高光均保住，无糊脸或结构漂移。

**定价**：wan-std 0.4 元/秒、wan-pro 0.6 元/秒。按「生图类定价 ≥ 10 倍 API 成本」，4–5 秒经济性成立（1.6–2.4 元成本对 19.9–29.9 定价），超过 10 秒崩掉。

**若复活，三个前置条件**：

1. **驱动视频的来源与授权**——比技术更硬。需预备动作模板（歪头、眨眼、打哈欠），每个是一段真实动物视频，必须有商用授权，不能抓取。
2. **不能用临时上传接口**——官方明确 `getPolicy` 上限 100 QPS 不可扩容、不建议用于生产，文件 48 小时过期。须走自有 OSS 签名 URL（`ConfiguredCloudStorage` 可复用）。
3. **结果 URL 24 小时过期**，必须立即下载转存。

**产品红线**：这类「让照片动起来」用在已离世宠物身上极其敏感。`04-plugins-playbook.md` 的 PL-18「老照片微动」已标注「纪念线，最敏感，克制包装」。技术上与活体同一条链路，产品上必须分开定调性。

**凭据**：仓库根 `.env.wanx`（被 `.gitignore` 的 `.env.*` 覆盖）。**该 Key 曾在明文对话中出现，建议在百炼控制台轮换。**

---

## 实施顺序

```
任务 1（shot_at）🔴 阻塞其他任务
  ├─→ 任务 4（时间线 + 去年今日 + 对比图）
  │     └─→ 任务 5（叙事视频）── 需先完成任务 2
  └─→ 任务 6（年度报告）

任务 2（时长选项）── 可与任务 1 并行
任务 3（纪念册质量）── 可与任务 1 并行，不依赖 shot_at
```

任务 1 是唯一阻塞项。任务 2、3 可与它并行。任务 4 依赖 1，任务 5 依赖 1、2、4。

每完成一项跑 `pnpm check`（lint + typecheck + test:coverage + build），涉及小程序的另跑 `pnpm validate`。

---

## 实施小结（2026-07-30）

按 1 → 2 → 3 → 4 → 5 → 6 顺序完成，每项均跑过 lint / typecheck / 单测 / build。新增迁移两支（0015 `photo_shot_at`、0016 `video_duration`），均已追加到 `client.ts` 的硬编码清单与 `resetDatabaseForTest`。

**新增的共享模块**（三项以上任务复用，改动前先看它们）：

| 模块 | 职责 | 谁在用 |
| --- | --- | --- |
| `domain/companion.ts` | 陪伴天数与日期归一，`services/companion.js` 的服务端对照实现 | 纪念册、时间线、对比图、年度视频、年度报告 |
| `domain/video-duration.ts` | 三档时长与张数上限的单一口径 | 视频 service / ffmpeg / Web 端 / 纪念视频 / 互动导出 |
| `server/annual/aggregate.ts` | 年度聚合数据 | 叙事视频、年度报告 |

**顺带修掉的既有缺陷**（不在任务书范围内，但会让本轮功能出错）：

1. 视频封面重复计入帧数，末张照片被静默丢弃（`ffmpeg.ts` 未去重）。
2. 互动页导出、`createVideoRender`、纪念视频三条入口不写 `durationSeconds`，隐式吃缺省档。
3. 作品副标题、PL-19 描述、`/video/create` 标题硬编码「15 秒」。
4. `work-preview.tsx` 无条件把 `outputUrl` 塞进 `<Image>`，PDF 产物会渲染成碎图。
5. `escapeXml` 直接删除特殊字符，用户故事里的引号被吃掉。

**测试口径的两处调整**：光栅化类用例显式给 60 秒超时（开覆盖率时 v8 instrumentation 让 sharp 明显变慢，5 秒默认值会造成只在 `test:coverage` 里挂的假失败）；`registry.test.ts` 新增通用断言，把所有 `html-template` 玩法的 `template` 钉在 `generatorRegistry` 上。

**待外部环境验证**：真实 PostgreSQL 迁移、有 ffmpeg 环境下的成片时长与抽帧、PL-23 样例图。Playwright E2E 已在本机跑通（2 用例）。
