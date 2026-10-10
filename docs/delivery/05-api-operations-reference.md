# API 与运维速查

更新：2026-10-08 ｜ 当前规模统一见 [文档索引](../README.md)

## API 分组

| 分组 | 主要路由 | 用途 |
| --- | --- | --- |
| 登录账户 | `/api/auth/wechat`、`/api/auth/password/register`、`/api/auth/password/login`、`/api/auth/logout`、`/api/auth/session`、`/api/account/*` | 微信登录、账号密码注册登录、退出、会话探测、资料、导出和删除 |
| 宠物与主人照片 | `/api/pets/*`、`/api/photos/*`、`/api/uploads`、`/api/owner-photos/*` | 宠物档案和私有素材；主人照片独立存储、上传需确认授权、所有读取与删除校验归属。历史人形身份缓存没有公开读写 API，新宠物人化任务不再生成或读取它；照片、宠物或账户删除时仍清理历史记录和私有对象 |
| 成长时间线 | `GET /api/pets/[id]/timeline`、`GET /api/on-this-day` | 按拍摄时间聚合的时间线（`order` / `limit` 查询参数）；「去年今日」未命中返回空数组，端上据此隐藏整块，不要补占位文案 |
| 健康分诊线 | `/api/health-sessions`、`/api/health-sessions/[id]`、`/api/pets/[id]/weights`、`/api/pets/[id]/care`、`/api/pets/[id]/care/[recordId]`、`/api/health-documents`、`/api/health-documents/[id]/download` | 症状分诊、体重与免疫驱虫记录、健康档案与年度健康记录 PDF 扣冻干导出。**`memorial` 宠物一律拒绝**（`HEALTH_UNAVAILABLE_MEMORIAL`）；档案**不可分享**，无 share_token 也无公开路径，下载校验 key 落在本人私有前缀下 |
| 冻干定价与钱包 | `GET /api/pets/[id]/pricing`、`GET /api/wallet`、`GET /api/wallet/ledger`、`GET /api/wallet/topup-packages`、`POST /api/wallet/topups` | 制作前分档颗数、余额/批次/流水、充值；所有颗数来自 `domain/dongan-pricing.ts` |
| 生成作品 | `/api/generations/*`、`/api/works/*` | 任务、作品、版本、下载和分享 |
| 支付订单 | `/api/orders/*`、`/api/payments/wechat/notify` | 历史现金订单查询、回调与退款；POST /api/orders 已退役（410），历史作品解锁改 POST /api/works/[id]/unlock |
| AI 与模板 | `/api/ai-runs/*`、`/api/image-templates`、`/api/image-templates/[id]/sample` | 当前规模见文档索引；公开接口只下发 live 模板。普通模板样图读取 `sampleStorageKey`、生成读取 `masterStorageKey`；宠物人化两者指向同一自有效果图对象。普通模板支持四选一和重抽；宠物人化固定二选一且不支持重抽。40 图已获用户审核并接入代码与本地对象，生产上传和真实调用仍待验证 |
| 视频与纪念 | `/api/video-catalog`、`/api/video-projects/*`、`/api/video-renders/*`、`/api/annual-films`、`/api/memorials/*`、`/api/memorial-share/*` | 视频项目/渲染/高清解锁与纪念空间/三类产物/分享；`POST /api/annual-films` 建叙事型年度视频（`year` + 可选 `durationSeconds` 10/20/30） |
| 复购与商业 | `/api/subscriptions/*`、`/api/addresses/*`、`/api/physical-skus`、`/api/physical-orders/*`、`/api/growth-orders/*`、`/api/annual-reports/*`、`/api/annual-report-share/*` | 订阅、实体履约、充值订单和年度报告；实体仍现金支付，不享会员折扣 |
| 管理后台 | `/api/admin/dashboard`、`/api/admin/audit`、`/api/admin/users`、`/api/admin/config`、`/api/admin/plugins/*`、`/api/admin/experiments/*`、`/api/admin/experiments/metrics`、`/api/admin/video`、`/api/admin/memorials`、`/api/admin/business`、`/api/admin/wallet`、`/api/admin/operations`、`/api/admin/physical-orders/*` | 驾驶舱、统一审计、用户状态、配置版本、赛马指标、任务恢复、分享关闭、履约、权益和报告运营 |

所有用户写接口要求登录会话、可信客户端头和用户数据归属。管理接口生产环境要求 `ADMIN_USER_IDS`。支付通知使用微信平台签名，不使用用户会话。

错误格式为 `{error:{code,message,details?}}`；余额不足返回 402 `WALLET_INSUFFICIENT`，details 为 `required/balance/shortfall`。小程序必须保留 details，充值确认后重放原 closure 与原幂等键；关闭面板不提交。首充档与普通档从 `/api/wallet/topup-packages` 读取，充值后复用 `/api/growth-orders/[id]/prepare|status`，客户端成功不是到账凭证。

后台 `/admin/wallet` 使用 `GET|POST /api/admin/wallet`：查用户余额/冻结/批次/流水、每日报表与购买所得负债；补偿只能发有期限与原因的赠送所得，并留管理员审计。充值现金收入与冻干消耗分开计。

## Worker

`pnpm worker` 是生产必需进程。每轮（默认 1 秒，`WORKER_POLL_INTERVAL_MS`）并发跑：

1. 生成任务领取、重试和文件落盘。
2. FFmpeg 视频任务。**队列并发是 1** —— 叙事年度视频是四段 filtergraph 一次 `spawn`，加重任务前先确认限流。
3. AI 图片任务与 Provider 故障切换。所有 lingsuan 请求进入同一进程级 FIFO 队列，`LINGSUAN_IMAGE_CONCURRENCY` 默认 20、硬上限 20；可重试错误在首次失败后最多重试 3 次，明确不可恢复的 4xx（除 429）立即失败。生产部署保持单个 Worker 实例，禁止在 Worker 运行时并行调用内部 `ai-worker` 入口绕开部署级总量约束。

模板运行时的参考顺序是契约，不是可交换集合：单宠为“冻结母版 → 宠物身份照”，主人+宠物为“冻结母版 → 授权主人身份照 → 宠物身份照”；宠物人化为“宠物原图（图一）→ 自有效果图（图二）”。宠物人化只调用一次 Provider、固定生成 2 张、只记录这 2 张的成本，不写人物身份缓存或身份字段，`rerollRemaining` 固定为 0，重抽接口返回 `AI_REROLL_NOT_SUPPORTED`（409）。

每 60 秒一轮运维动作：健康快照、关闭超时订单、清理过期内容、投递到期订阅消息、赠送冻干过期（expireGiftLots）、纪念日提醒；健康快照异常或队列积压 >100 时发告警。

两类按小时单独扫（各 `3_600_000` ms）：**「去年今日」**（要遍历全部用户，一天最多产出一条消息）和**健康主动提示**（疫苗驱虫到期 / 体重变化 / senior 季度检查，走站内通知而非微信订阅消息）。

受保护的内部入口 `/api/internal/worker`、`ai-worker`、`message-worker`、`video-worker`、`maintenance` 仅供诊断或定时任务使用，必须携带 `Authorization: Bearer <WORKER_SECRET>`。

## 数据库迁移

```bash
cd apps/platform
DATABASE_URL="postgresql://..." pnpm db:migrate
```

容器部署时由 `deploy/scripts/deploy.sh` 里的 `migrate` 服务自动执行，迁移失败不会更新应用容器。

迁移程序读取 `drizzle/` 下全部 `0000_name.sql` 格式文件，当前迁移范围和数量见文档索引，按名称顺序执行并写入 `schema_migrations`。迁移应向前兼容；回滚应用时不删除新增字段。

> PostgreSQL 与 PGlite 共用 `src/server/db/migrate.ts`，自动扫描 `drizzle/`；不维护硬编码迁移清单。测试重置函数仍需重放有种子数据的迁移，最后执行 0042，确保会员套餐保持 archived。只加前向迁移，不改已应用历史。

近期业务迁移的作用（改动这些表前先读，避免重复建列）：

已退役功能的历史迁移和前向清理迁移仍随迁移程序执行，但不再属于业务接口或操作入口，故不在下表展开。

| 迁移 | 新增内容 |
| --- | --- |
| `0015_photo_shot_at.sql` | `photos.shot_at`（EXIF 拍摄时间，无 EXIF 时为 NULL） |
| `0016_video_duration.sql` | `video_projects.duration_seconds`（用户选择的总时长，10/20/30） |
| `0017_pet_senior_stage.sql` | `pets.life_stage` 放宽为 `active` / `senior` / `memorial` 三态 |
| `0018_pet_weight_records.sql` | `pet_weight_records`（克存储） |
| `0019_health_advisory.sql` | `health_sessions`、`health_daily_quotas`（健康线独立建表、额度独立，不复用 `generation_tasks`） |
| `0020_pricing_and_membership.sql` | `orders.price_tier`、`works.accumulation_snapshot`，会员套餐 v2 |
| `0021_membership_honest_entitlements.sql` | 套餐 v3 ¥69 只留可兑付权益（`tierUnlock` / `annualReport` / `physicalDiscount`），v2 与月度转 inactive；`message_subscriptions.status_updated_at` |
| `0022_health_care_and_reminders.sql` | `pet_care_records`、`health_reminders`、`health_documents`（提示去重靠 `(pet_id, kind, subject_key)` 唯一约束，`subject_key` 必须带变化量否则续期后永不再提示） |
| `0023_membership_health_entitlements.sql` | 套餐 v4 ¥128，加回两项健康权益；v3 转 inactive，已购用户按快照履约 |
| `0025_owner_photos_and_ai_roles.sql` | 独立 `owner_photos` 私有表；`ai_runs.role_inputs` 保存母版、主人和宠物的职责映射 |
| `0026_pet_human_identities.sql` | `pet_human_identities` 私有人形身份缓存；唯一键为 `(user_id, pet_id, source_photo_id, prompt_version)`，状态为 `generating` / `ready` / `failed` |
| `0028_payment_transactions.sql` | 支付事务、退款、iOS 退款问询与微信 session 密文表；支付订单唯一约束与对账索引 |
| `0042_dongan_wallet.sql` | 钱包账户/批次/流水、任务扣费引用、ten/twenty、免费十次、会员归档 |
| `0029_entitlement_delivery_reference.sql` | 权益台账交付资源引用与健康档案撤回时间，支持退款回收 |

`0014_password_auth.sql` 新增 `users.account_name`、`password_hash`、`password_updated_at` 和 `lower(account_name)` 上的部分唯一索引，用于账号密码登录。

`0013_admin_completion.sql` 新增管理员停用字段、赛马上一 live 关系、实体退款元数据，以及 `message_delivery_attempts`、`membership_plan_versions`、`entitlement_adjustments`、`annual_report_templates`、`annual_report_visits`。生产升级必须先执行迁移，再更新 Web 与 Worker。

## 上线后检查

```bash
./deploy/scripts/health-check.sh staging      # 或直接 curl https://<域名>/api/health
./deploy/scripts/smoke-test.sh staging        # 主链路冒烟测试
```

预期：`status=ok`、`database=true`、`stale=0`。同时检查 Web/Worker 日志、队列长度、对象存储 403/404、支付通知失败和 AI 单次成本。

## 备份建议

- PostgreSQL 每日全量备份，保留 7～30 天；每月至少一次恢复演练。
- 发布前执行一次手动快照。
- 不为照片或作品配置绕过数据库的对象存储生命周期；仅由业务清理任务删除相应对象。
- 不备份临时二维码、CI 私钥或本地演示数据。
