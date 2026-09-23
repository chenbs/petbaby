# 纯功能开发待办

版本：v4.0 ｜ 更新：2026-09-23
口径：只记录尚未达到产品验收标准的代码功能；外部资质、密钥、域名、真实供应商联调、测试、部署和发布不进入本文。

**当前纯功能待办已清零。** 虚拟支付改造与 `growth_orders` 支付缺陷的代码已完成；其余下方各节是已完成批次的功能落点登记，供追溯「某个能力落在哪个文件、哪条迁移」用，不是待办。

## 最近完成：陪伴与记录第一期代码增量

规格见 [`33-陪伴与记录开发清单及实施计划.md`](33-陪伴与记录开发清单及实施计划.md)，验收证据与外部待验项见 [实施验收记录](../delivery/09-陪伴与记录实施验收记录.md)。本节只登记代码落点，不表示已批准上线。

| 功能 | 落点 | 状态 |
| --- | --- | --- |
| 独立记录与保留 | 档案新建抽屉、图库记录模式；`maintenance.ts` 保留正常照片 | 代码完成 |
| 上传可靠性、元数据、完整回看 | `photo-library-service.ts`、`photo-upload-session.js`、`photo-memory.ts`；0030/0033 | 代码完成 |
| 私密媒体、删除、持久清理 | `photo-deliverable-assets.ts`、`photo-deletion-service.ts`、`object-cleanup.ts`；0031 | 代码完成 |
| 单宠年度制作与素材快照 | `annual/aggregate.ts`、`video/annual-film.ts`、`video/ffmpeg.ts`；小程序/Web 年度确认 | 代码完成 |
| 陪伴入口与可信记录事件 | index/me/pets/photos/timeline；`record-events.ts`、0032、`scripts/record-funnel.sql` | 代码完成 |

## 虚拟支付合规与 `growth_orders` 支付缺陷

详细方案、外部待确认项、实施顺序与验收标准统一见 [`23-虚拟支付合规改造方案.md`](23-虚拟支付合规改造方案.md)，本表只维护功能状态。

| 功能 | 当前状态 | 完成判据 |
| --- | --- | --- |
| `growth_orders` 支付状态机修复 | 代码完成 | 会员、年度报告和健康档案权益只在渠道查单或验签通知后发放；重复通知幂等；直接调用 `/pay` 不再发权益 |
| 按 SKU 选择普通/虚拟 Provider | 代码完成，待外部场景结论 | 实体商品仍走普通微信支付；虚拟 SKU 走虚拟支付，不按单一环境变量全局切换 |
| 小程序虚拟支付端上链路 | 代码完成，待外部开通 | `clientParams.mode=virtual` 时调用 `wx.requestVirtualPayment`；基础库不足时明确提示升级 |
| iOS 退款问询与审计 | 代码完成，待真实回调 | 通知 3 秒内响应、默认允许退款、审计保留订单交付与权益消耗证据 |

代码工作已完成；微信 2026-04-01 期限已过，公开付费入口仍需等待主体/场景结论、虚拟支付签约、商品上架、真实回调和真机验收，未配置时生产明确失败关闭。

## 情绪价值方向（14 号文）已完成项

任务书与实现记录见 `14-direction-review-emotional-value.md`，六项全部完成，此处只登记功能落点。

| 功能 | 落点 | 状态 |
| --- | --- | --- |
| 照片拍摄时间 | `photos.shot_at`（迁移 0015）+ `server/media/exif.ts` EXIF 解析，无 EXIF 时读取侧回落上传时间并以 `shotAtSource` 区分 | 完成 |
| 视频时长可选 10/20/30 秒 | `domain/video-duration.ts` 单一口径 + 迁移 0016 `video_projects.duration_seconds`；小程序 chip、Web 选择器、`VIDEO_DURATION_MISMATCH` 三处拦截 | 完成 |
| 纪念册多页 PDF | `server/memorial/album.ts`，封面/照片页/故事页/结尾页，照片真嵌入，`works.asset_kind` 新增 `pdf` | 完成 |
| 成长时间线 | `server/timeline-service.ts` + `GET /api/pets/[id]/timeline` + 小程序 `pages/timeline/` | 完成 |
| 去年今日 | `findOnThisDay` / `scheduleOnThisDay`（走 `message_subscriptions`，命中才推、按天去重）+ `GET /api/on-this-day` | 完成 |
| 成长对比图 | `growth-compare-v1` 生成器 + PL-23 manifest（免费带水印，需恰好 2 张照片） | 完成 |
| 叙事型年度视频 | `server/video/narrative.ts` 四段结构 + `server/video/annual-film.ts` + `POST /api/annual-films` | 完成 |
| 年度报告做实 | `server/annual/report.ts`，含真实照片与可核对计数，保留预览水印；与叙事视频共用 `server/annual/aggregate.ts` | 完成 |

**遗留（不阻塞功能验收，属素材与门禁）**：

- PL-23 缺样例图。按约定缺图时只留文字、不画占位色块；补图需走 `tools/imagegen/`，键名带内容哈希。
- 视频类的「实际成片时长 ±0.5 秒」「抽帧不是黑场」「四段观感」需在装有 ffmpeg 的环境实测 —— 开发机无 ffmpeg，参数层面的等价断言已在 `video/ffmpeg.test.ts`、`video/narrative.test.ts` 覆盖。**部署到测试机后应补这一项**：`deploy/scripts/smoke-test.sh` 已有逐张校验样例图的先例，视频可照此加一条 `ffprobe` 时长断言。
- 已部署环境改 `registry.ts` 不自动生效（`runtime.ts` 只在首次访问播种），PL-23 上线需走后台 `updateRuntimePlugin` 或逐键合并回填。

## 产品改造（17 号文）批次 1–3 已完成项

方案见 `17-产品改造方案.md`，技术落点见 `18-技术实现方案.md`，验收结果见 `19-验收文档.md` 第六部分之二。

| 功能 | 落点 | 状态 |
| --- | --- | --- |
| AI 生成内容标识 | `server/media/ai-label.ts`；只对 `image-api` 生效，**付费产物保留标识**（营销水印才随付费移除），含 PNG EXIF 隐式标识 | 完成 |
| 免费玩法零摩擦 | `generation-worker.ts` 按 `unlockPrice` 决定 `locked`；`createOrder` 拒 0 元单；免费产物正式文件也带水印 | 完成 |
| 生命阶段三态 | 迁移 0017 + `domain/models.ts` 放宽枚举 + 小程序 chip（仅手动设置，不按年龄推断） | 完成 |
| 玩法合并 10→7 live | `PluginManifest.toneVariants` + `resolveManifestTone`；PL-20/21/22 转 `archived` | 完成 |
| 定价按积累量分档 | `domain/pricing.ts`（三档）+ `createOrder` 下单时计算，落 `orders.price_tier` 与 `works.accumulation_snapshot` | 完成 |
| PL-01 转免费 | `registry.ts` `unlockPrice: 0`；`pet-id-card-bundle` 套餐同步下线 | 完成 |
| 会员重做 | 迁移 0020（月度转 inactive、年度 v2 ¥128）+ `server/entitlements.ts` | 完成，但**权益无兑付**，已由第二轮 M1–M6 修正（见下） |
| 健康分诊线 | `server/health/{triage,provider}.ts` + `health-service.ts` + `/api/health-sessions` + 小程序 `pages/health/` | 完成 |
| 体重记录 | 迁移 0018 + `/api/pets/[id]/weights` | 完成 |
| 去年今日端上入口 | Web 首页区块（命中才渲染，未命中静默） | 完成 |
| 删除 `/lab` | 目录已删 | 完成 |

**批次 1–3 结束时尚未实施的范围**：A5 健康档案 PDF、A6 年度健康报告、A8 里程碑自动产出、A9 月度小册，以及批次 4（机构 BD、亲友共建、首页宠物优先）。后续第二轮已完成 A5/A6，并补齐 A8 的真实缺口「里程碑达成当天在首页出现一次」，见下文 E3、L1、L2、P5；A9 与批次 4 未进入当前批准范围，不列作当前待办。

**遗留门禁**：健康线的**文案法律意见是对外上线的产品性阻塞**（`19` 号文 E7）——技术实现已完成，但合规结论基于对《动物诊疗机构管理办法》与微信类目要求的推断，未经专业审查。另需确认主体类型可申请的类目范围。

## 功能改造第二轮（20 号文）第一批已完成项

方案见 `20-功能改造方案-第二轮.md`。第一批是该文认定的**五项上线阻塞**加两项高优先级，拍板取 M1 方案 A、M2 路线甲。

| # | 功能 | 落点 | 状态 |
| --- | --- | --- | --- |
| M1 | `tierUnlock` 语义修正 | `domain/pricing.ts` 拆 `MEMBER_SPEC_TIER`（annual，规格）与 `MEMBER_PRICE_TIER`（basic，计价），新增 `resolveOrderPricing()` 统一出应收/参照/省额；`createOrder` 改用它 | 完成 |
| M4 | 年报解锁接会员权益 | `entitlements.ts` 新增 `entitlementBalance` / `claimEntitlement`（记 `entitlement_ledger`，`status='consumed'`）；`createAnnualReportUnlockOrder` 命中即置 `locked=false` 且不建订单 | 完成 |
| M6 | 实体下单接折扣 | `physicalDiscountRate()`（夹在 (0.1,1]）+ `createPhysicalOrder` 下单时折价并保留 `listPrice` | 完成 |
| M2 | 权益下架与降价 | 迁移 0021：yearly v3 ¥69，权益只留 `tierUnlock` / `annualReport` / `physicalDiscount`，移除未实施的两项健康权益；v2 转 inactive | 完成 |
| M3 | 两端价格与权益文案同源 | `domain/membership.ts`（`describeEntitlements` / `singleBuyValue` / `breakEvenDeliverables`）+ `GET /api/membership-plans`；Web 与小程序删掉写死的 PLANS | 完成 |
| L3 | 分档价格下单前可见 | `getDeliveryPricing()` + `GET /api/pets/[id]/pricing`；四处渲染（Web 制作页/作品页、小程序 create/work），文案按「你可以做什么」 | 完成 |
| E2 | 去年今日补授权门 | `scheduleOnThisDay` 先查 `on_this_day` 的 active 授权，**并消耗它**（`status='consumed'`）；`subscribeReminder` 放行该 eventType；小程序补授权入口 | 完成 |
| M5 | 权益兑付端到端测试 | `server/entitlement-redemption.test.ts`（19 例）+ `domain/membership.test.ts`（14 例）；用例走完整购买链路而非直插 active 会员行 | 完成 |

**顺带修掉的同类缺陷**（都属「端上写死或方向反了」，与第一批同一批代码）：

- P4 Web 实体 SKU 选择器：`physical-commerce-client.tsx` 原硬编码 `art-print-a4`，¥99.9 精装册在 Web 端买不到。
- Web 作品页原无解锁入口，也无任何价格文案；小程序作品页读的 `work.unlockPrice` 在 `PublicWork` 上不存在，价格从未显示过。
- 后台 `create_plan` 原把 `{monthlyQuota}` 当整个权益 JSON 写入，建出来的套餐可售但零可兑付权益；`ensureBusinessCatalogs` 的月度会员种子原以 `status='active'` 插入，**一次后台访问就能把已下架套餐重新上架**。
- `create-flow.tsx` 仍在按 `documentType` 拼已下线的 `pet-id-card-bundle`，走到该分支必然 422。

## 功能改造第二轮（20 号文）第二批已完成项

方案见 `20-功能改造方案-第二轮.md` 2.4。这一批全部是「补分发」而不是加功能 —— 该文的判断是**情绪价值不是内容问题而是分发问题**：服务端 8 项情绪能力全部建成，端上入口缺失或单端的有 6 项。

| # | 功能 | 落点 | 状态 |
| --- | --- | --- | --- |
| E1 | 小程序首页宠物优先 | `pages/index` 第一屏改为默认宠物封面 + 陪伴天数（走 `services/companion.js`，纪念阶段按 `memorialSince` 封口），玩法货架下移；无宠物时退回原标语 Hero | 完成 |
| E3 | 里程碑 | 时间线页的历史里程碑**原已实现**（见下方偏离）；本批补的是「达成当天在首页出现一次」，新增 `companion.js` 的 `MILESTONE_DAYS` / `milestoneLabel` / `milestoneToday` | 完成 |
| E4 | 小程序补去年今日 | 首页区块，与 Web 同数据源 `/api/on-this-day`，命中才渲染 | 完成 |
| E5 | `annual-films` 补入口 | 小程序 `pages/timeline` 页尾 + Web `/timeline` 与 `commerce`，年份与时长可选，只入队不轮询 | 完成 |
| E6 | Web 补时间线页 | `/timeline` + `components/timeline-client.tsx`，与小程序同数据源同口径；入口挂 `/me` 首位，首页去年今日区块改指这里 | 完成 |

**与方案的三处偏离**（详见 20 号文 11.4）：

- **E3 的前提描述不准**：方案 2.2 表格记「里程碑无任何端上渲染」，实际 `pages/timeline` 的里程碑区块已在 `b3fab7c` 提交里。真实缺口只是「达成当天在首页出现一次」。
- **里程碑不做常驻标签**：只在达成当天出现。里程碑是一个瞬间而不是一种状态，常驻会让它退化成又一个货架标签；历史里程碑在时间线页回看。**纪念阶段一律不出现** —— 天数已封口不可能「今天刚达成」，且给已离开的宠物弹庆祝是冒犯。
- **E5 挂时间线页尾而不是首页**：叙事视频是四段 filtergraph 而 `processNextVideo` 队列并发是 1，放首页等于在用户还没看任何东西之前就推一个重任务。时间线页的照片正是这条片子的素材，顺序上也更自然。

## 功能改造第二轮（20 号文）第三批与第四批已完成项

方案见 `20-功能改造方案-第二轮.md` 3.3 与 5.1。第三批的判据是该文 6.2 判断三：健康线的付费点设计正确但先决条件未满足 —— **合规不产生留存**，让健康线成为高频场景的是主动提示而非分诊本身。

| # | 功能 | 落点 | 状态 |
| --- | --- | --- | --- |
| L6 | 体重趋势事实陈述 | `domain/weight-trend.ts`（±1% 算持平、5% 值得提一句）+ `getWeightHistory` 随列表下发；**不做 BMI 与肥胖评级** | 完成 |
| L5 | Worker 健康主动提示 | `server/health/reminders.ts` 三类（疫苗驱虫到期 / 体重变化 / senior 季度检查）+ 迁移 0022 的 `pet_care_records`、`health_reminders`；走站内通知，按小时轮次 | 完成 |
| L1 | 健康档案 PDF（A5） | `server/health/document.ts` + `createHealthDocument`；会员无限导出，非会员单买 ¥29.9 走凭据核销 | 完成 |
| L2 | 年度健康记录（A6） | 同一函数传 `year`，走 `annualHealthReport` 按次权益 | 完成 |
| L4 | `senior` 补全 | 画册/短片/星尘页补 `toneVariants.senior`（调性克制但不纪念、不改名不改价）+ 纪念空间入口挂到 senior/memorial 宠物上 | 完成 |
| P5 | 恢复 ¥128 会员 | 迁移 0023 发 yearly v4，加回两项健康权益；`describeEntitlements` 补文案，后台表单放开勾选 | 完成 |
| X1 | 删 `growth-lab-client.tsx` | 已删（`/lab` 页面在批次 3 已删，该组件零引用方） | 完成 |
| X2 | 删 `pages/growth` | 已删，小程序从 24 页降为 **23 页**；`me` 的「AI、互动与视频」改 `switchTab` 指首页 | 完成 |

**这两批的红线守卫**（健康线做错的代价比其他线大，所以每条都有用例钉住）：

- **`memorial` 宠物一律排除**（红线 10）。L5 的三类提示在 SQL 里逐条 `life_stage <> 'memorial'`，L1 的导出也拒绝；写入侧（`recordCare`）同样拦。「已离开的宠物收到体检提醒」是这条线最不可接受的错误。
- **只陈述事实不做评价**。L6 给「较上次 +10%（400 克）」，不给「偏胖」；提示语说「变化了 10%，可以和兽医提一下」而不说「体重异常」——「异常」是评价，而我们没有资格给正常范围。两处都有扫全文的用例。
- **健康档案不是体检报告**。免责声明印在 PDF 第一页顶部、带底衬、位置在正文之前（红线 5）。文件里不出现「确诊」「治愈」「问诊」，也不出现「状况良好」「正常范围」这类评价性结论。
- **不推荐任何疫苗品牌或驱虫药**（红线 2）。`pet_care_records.label` 由用户自己填，产品不给候选清单 —— 给清单就等于在推荐。
- **健康档案不可分享**。没有 share_token 也没有公开路径，下载时校验 key 落在本人私有前缀下。

**顺带修掉的一处真实缺陷**：`breakEvenDeliverables` 原先逐项列举「一次性权益」来做抵扣，P5 加回两项健康权益时漏算，回本件数从 2 错成 4。已改为由 `singleBuyValue` 减去单件档差导出，加新权益不会再漏。

**本轮明确不做**（沿用 20 号文 7.3）：真人兽医接诊（需 ≥2 家持证机构协议）、亲友共建（L7）、临终期内容（L8）、实体商品扩量、玩法数量增加、健康线的用药与影像判读。

**M2 的后续已完成**：A5/A6 完成后已按 P5 发布 ¥128 的 yearly v4，并加回两项健康权益。`domain/membership.ts` 的 `describeEntitlements` 是「已实现兑付的权益白名单」，以后加权益时仍必须同步补文案；`entitlement-redemption.test.ts` 的清单式守卫会在漏补时失败。

## 图片模板货架与宠物人化已完成项

图片方案、母版归档和审批事实源见 `27-图片玩法研究与产品方案.md` 至 `31-宠物人化两阶段执行与审批记录.md`。这里仅登记代码落点，不把视觉审批列为功能待办：

- **模板货架与角色输入**：迁移 `0025`、`server/image-template-registry.ts`、`server/owner-photo-service.ts`、`/api/image-templates*`、`/api/owner-photos*`，以及 Web/小程序创建页；支持 `pet` / `owner-pet` / `pet-human` 三种主体模式。
- **历史身份缓存兼容**：迁移 `0026` 与 `server/pet-human-identity-service.ts` 继续用于删除旧记录和私有对象，不再参与新任务生成。
- **直接效果图运行时**：宠物人化一次请求严格按“宠物原图图一 → 自有效果图图二”传参，生成 2 张，只记录本次候选成本，不写人物身份缓存。
- **端上反馈**：Web 与小程序按模板显示四选一或宠物人化二选一；普通模板保留定向重抽，宠物人化隐藏重抽并由服务端返回 `AI_REROLL_NOT_SUPPORTED`。

当前 40 个 V2 人化模板仍为 `pending-review`，不会由公开 API 下发。本地文件盘点、ID/提示词归一和计划对象键登记已完成；明确发布批准、对象上传/seed/冻结与真实双参考验证仍属于素材和发布门禁，不是未完成业务代码。

## 当前结论

**阶段一至三纯功能待办已清零。**

- 阶段一：宠物/照片资产、PL-01/02/03、生成队列、免费预览与高清解锁、订单退款、作品版本、公开分享、归因、运营后台和账户隐私已完成。
- 阶段二：AI 四选一、互动页与服务端 15 秒导出、独立 FFmpeg 视频、纪念产品线和赛马后台已完成服务端、Web/H5、微信小程序和必要管理员闭环。
- 阶段三：订阅消息、实体商品与人工履约、会员权益和年度报告已完成双端用户入口、后台操作及共享订单/权益/作品/分享联动。
- 导航收口：阶段一至三能力已进入正式 Web、小程序和管理员导航；`/lab` 诊断页已于 17 号文批次 3 删除。
- 管理后台补全（批次 K）：统一鉴权/审计、赛马回滚、任务恢复、阶段三履约与权益、账号停用和三类订单驾驶舱已完成。9 个后台工作台的入口与接口见 `15-功能入口清单.md` 第二章。

阶段一至三与批次 K 的逐批完成记录已归档清理（原 `12-` / `13-` 两份文档），不再作为执行入口；需要历史批次口径请查 Git 历史。

## 不属于功能待办的后续门禁

- 小程序结构检查、平台 `pnpm check`、PGlite/PostgreSQL Playwright、迁移校验和媒体冒烟已通过；开发者工具、真机验证和真实适配器联调仍属于发布门禁。
- 微信登录/支付/订阅、腾讯云 COS、AI Provider、实体供应商和地址加密的真实配置与契约联调。
- Docker/非容器部署演练、备份恢复、监控告警、真机验证、小程序审核和正式发布。

外部 Value 见 `../operations/04-external-prerequisites.md`，部署与接口见 `../delivery/`，发布验收见 `../operations/05-release-checklist.md`。

## 重新进入本文的条件

只有出现新的产品需求，或验证/联调暴露出缺失的用户、管理员业务能力时，才在本文新增功能项。单纯测试失败、凭据缺失、部署问题或供应商差异继续记录在对应门禁文档中。
