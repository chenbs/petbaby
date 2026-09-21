# 文档索引

更新：2026-09-21

本目录只保留当前有效的产品、运营、交付和发布资料。既定产品批次和 76 个非人化图片母版已完成；宠物人化直接效果图运行时代码与 V2 本地素材接入已完成，效果图尚未上传、seed、冻结或批准上线，因此相关注册项继续不可见。虚拟支付合规与 `growth_orders` 支付缺陷的代码改造已完成，剩余工作是素材发布、外部凭据、真实 Provider/微信/供应商联调、远端 CI、部署演练和发布门禁。

## 先看这几份

| 目的                                | 文档                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| 了解产品路线和阶段目标                       | [`product/01-roadmap.md`](product/01-roadmap.md)                                                   |
| 了解当前功能边界与已完成批次                    | [`product/07-functional-backlog.md`](product/07-functional-backlog.md)                             |
| 按网站、小程序前端和后端查看开发、配置与验收待办 | [`delivery/06-development-and-configuration-todos.md`](delivery/06-development-and-configuration-todos.md) |
| 只看未完成的业务与功能事项 | [`delivery/07-business-and-feature-todos.md`](delivery/07-business-and-feature-todos.md) |
| 按页查功能点、改一项要动哪几端                   | [`product/21-小程序功能点清单.md`](product/21-小程序功能点清单.md)                                                 |
| 查 Web/后台/REST 入口与玩法 manifest      | [`product/15-功能入口清单.md`](product/15-功能入口清单.md)                                                     |
| 情绪价值方向任务书（六项已完成，含实现记录）            | [`product/14-direction-review-emotional-value.md`](product/14-direction-review-emotional-value.md) |
| 竞品分析与产品复盘（分析文档，非任务书；健康线十条红线在 3.8） | [`product/16-竞品分析与产品复盘.md`](product/16-竞品分析与产品复盘.md)                                               |
| 产品改造方案（批次 1–3 已完成）                | [`product/17-产品改造方案.md`](product/17-产品改造方案.md)                                                     |
| 改造的技术实现方案                         | [`product/18-技术实现方案.md`](product/18-技术实现方案.md)                                                     |
| 改造的验收结果与已发现缺陷                     | [`product/19-验收文档.md`](product/19-验收文档.md)                                                         |
| 第二轮功能改造方案（四批全部完成，含偏离记录）           | [`product/20-功能改造方案-第二轮.md`](product/20-功能改造方案-第二轮.md)                                             |
| **虚拟支付合规改造（全局，代码已实现，待外部验收）**        | [`product/23-虚拟支付合规改造方案.md`](product/23-虚拟支付合规改造方案.md)                                             |
| 图片玩法研究、图生图生产规则与产品约束               | [`product/27-图片玩法研究与产品方案.md`](product/27-图片玩法研究与产品方案.md)                                           |
| **9 个已登记图片入口、116 个模板与效果图唯一归档** | [`product/28-图片母版货架与65图归档矩阵.md`](product/28-图片母版货架与65图归档矩阵.md)、[`product/30-动物效果图扩展执行计划.md`](product/30-动物效果图扩展执行计划.md)、[`product/31-宠物人化两阶段执行与审批记录.md`](product/31-宠物人化两阶段执行与审批记录.md) |
| 图片玩法重构、付费点与实现覆盖说明                  | [`product/29-图片玩法重构方案.md`](product/29-图片玩法重构方案.md)                                                       |
| API 与运维速查                         | [`delivery/05-api-operations-reference.md`](delivery/05-api-operations-reference.md)               |
| 小程序 UI 重构拍板结论                     | [`ui-refactor/阶段0-代码盘点与方向分配.md`](ui-refactor/阶段0-代码盘点与方向分配.md)                                     |
| 配置外部账号、域名和凭据                      | [`operations/04-external-prerequisites.md`](operations/04-external-prerequisites.md)               |
| 发布前验收和回滚                          | [`operations/05-release-checklist.md`](operations/05-release-checklist.md)                         |
| 测试机/生产部署                          | [`delivery/02-deployment-guide.md`](delivery/02-deployment-guide.md)                               |
| 小程序上传和发布                          | [`delivery/03-miniprogram-release.md`](delivery/03-miniprogram-release.md)                         |
| 小程序主题系统规格                         | [`demand/theme.md`](demand/theme.md)                                                               |
| 沉浸式玻璃面板规格                         | [`demand/theme-2.md`](demand/theme-2.md)                                                           |
| 官网复刻规格与待办                         | [`website/01-KittyPaw复刻规格.md`](website/01-KittyPaw复刻规格.md)                                         |
| 官网静态原型（打开即看）                      | [`website/prototype/index.html`](website/prototype/index.html)                                     |
| 官网改造成独立站的方案                       | [`website/02-独立官网实施方案.md`](website/02-独立官网实施方案.md)                                                 |
| 官网工程与发布（已实现）                      | [`website/03-独立官网实现说明.md`](website/03-独立官网实现说明.md)                                                 |

## 目录结构

```text
docs/
├── README.md
├── product/
│   ├── 01-roadmap.md               # 治理总纲，阶段目标与止损线
│   ├── 02-product-design.md        # 产品定位、壳+插件架构、设计原则
│   ├── 03-features-shell.md        # 壳的 P0/P1 规格（阶段一原始口径）
│   ├── 04-plugins-playbook.md      # 玩法弹药库与赛马状态流转
│   ├── 05-tech-and-compliance.md   # 技术选型、成本防守、合规清单
│   ├── 07-functional-backlog.md    # 唯一的功能待办来源 + 各批次完成登记
│   ├── 14-direction-review-emotional-value.md  # 情绪价值方向任务书
│   ├── 15-功能入口清单.md           # Web/后台/REST/玩法 manifest 盘点
│   ├── 16-竞品分析与产品复盘.md      # 分析文档；健康线十条红线在 3.8
│   ├── 17-产品改造方案.md           # 改/加/删总表与细分方案
│   ├── 18-技术实现方案.md           # 17 的技术落地
│   ├── 19-验收文档.md              # 逐条可执行验收与已发现缺陷
│   ├── 20-功能改造方案-第二轮.md     # 对 17 的端到端核实与四批改造
│   ├── 21-小程序功能点清单.md        # 按页编号的功能点表，逐项修改用
│   ├── 23-虚拟支付合规改造方案.md    # 全局支付改造；2026-04-01 期限已过
│   ├── 27-图片玩法研究与产品方案.md  # 图片玩法、图生图生产协议与产品门禁
│   ├── 28-图片母版货架与65图归档矩阵.md # 原始 8 入口、61 模板及 65 图唯一归档
│   ├── 30-动物效果图扩展执行计划.md # animal 目录 24 张历史产物、21 个当前 live 模板
│   ├── 29-图片玩法重构方案.md      # 图片玩法、付费点及后续决策覆盖记录
│   └── 31-宠物人化两阶段执行与审批记录.md # 宠物人化方案演进、直接效果图链路与接入交接
├── operations/
│   ├── 01-ops-plan.md
│   ├── 02-xiaohongshu-playbook.md
│   ├── 04-external-prerequisites.md
│   └── 05-release-checklist.md
├── delivery/
│   ├── 01-deliverables.md
│   ├── 02-deployment-guide.md
│   ├── 03-miniprogram-release.md
│   ├── 04-environment-reference.md
│   ├── 05-api-operations-reference.md
│   ├── 06-development-and-configuration-todos.md # 三端开发、配置与验收待办总览
│   └── 07-business-and-feature-todos.md # 仅含未完成业务与功能的三端视图
├── demand/
│   ├── theme.md
│   └── theme-2.md
├── ui-refactor/
│   ├── UI重构方案.md                # 原始方案（Token 与组件规范的取值来源）
│   ├── 阶段0-代码盘点与方向分配.md    # 拍板结论（第八章）与生图链路（第九章）
│   └── layout-directions.html       # 方向对比原型，打开即看
└── website/
    ├── 01-KittyPaw复刻规格.md       # 视觉与交互真源；偏离记在 9.1
    ├── 02-独立官网实施方案.md        # Astro 独立站 + SEO/GEO + 文章模块（方案）
    ├── 03-独立官网实现说明.md        # 实现记录：命令、验收结果、偏离与待收口
    └── prototype/
        ├── index.html      # 11 区块单页，打开即看
        ├── styles.css
        ├── main.js         # hero 视频 5 秒截断循环 + 入场时间线 + 菜单
        ├── assets/         # bg.mp4 与素材（由 tools/imagegen 生成）
        └── refframes/      # 参考站抽帧，仅作比对，不进正式站也不随官网发布
```

## 文档边界

- `product/` 维护产品方向、功能规格、插件状态和合规约束。`07-functional-backlog.md` 只记录纯功能开发，不混入部署、凭据或上线任务；各批次完成后的功能落点也登记在这里。`16-竞品分析与产品复盘.md` 是**分析文档不是任务书**，其中的建议需人工筛选后才写入 backlog；它的第七章明确了哪些结论是代码事实、哪些是未经用户验证的假设，3.8 是健康线十条红线的全文。
- **两份盘点文档分工不同**：`21-小程序功能点清单.md` 以小程序 `app.json` 顺序为主线，回答「有哪些功能点、改一项要动哪几端」，是逐项修改的进度依据；`15-功能入口清单.md` 以入口和接口为主线，回答「从哪进、打哪个接口」，Web 页面、管理后台、REST 路由和玩法 manifest 的清单在这份。
- `23-虚拟支付合规改造方案.md` 是**全局支付改造**。微信规范要求 2026-04-01 前完成虚拟商品的全终端虚拟支付接入，**该期限已过**，会员与作品解锁落在适用范围内；SKU 路由、支付确认、权益幂等、退款回收和 iOS 退款问询审计的代码已完成，文档继续记录外部签约、真实回调与真机验收门禁。
- `operations/` 维护运营策略、内容方法、外部依赖和发布门禁。外部依赖文档只记录状态和验证方法，不保存真实密钥。
- `delivery/` 维护交付物边界、部署步骤、小程序发布、环境变量和 API/Worker 运维速查。
- `demand/` 维护已定稿的专项需求规格。规格正文保持原判不改写，实现层面的偏离逐条记进各文档最后一章「实现差异记录」。
- `website/` 维护配套官网的设计输入、静态原型与工程化方案。三份文档分工：`01` 是**视觉与交互的真源**（从参考站实测的取值、内容映射、待确认事项），`02` 是**工程化与 SEO**（Astro 独立站、部署、文章模块），`03` 是**实现记录**（命令、验收结果、十条偏离、待收口项）。改视觉动效看 `01`，改部署或加文章看 `02`，动官网代码前先看 `03`。官网正式文案不在此维护。**`01` 与 `02` 的正文保持原判不改写，偏离分别记进 `01` 的第 9.1 章和 `03` 的第 4 章** —— 与 `demand/` 同一个约定。`prototype/refframes/` 是参考站抽帧，属他人素材，仅作生成参考与构图比对。
- `ui-refactor/` 维护小程序 UI 重构的方案、代码盘点与拍板结论。拍板结论在 `阶段0-代码盘点与方向分配.md` 第八章、生图链路在第九章；`UI重构方案.md` 保留为 Token 与组件规范的取值来源。日常编码约定不在此维护，看根目录 `CLAUDE.md`。
- 同一事实只在一个文档中维护，其他文档通过链接引用；完成记录不作为新的开发待办。
- 生产环境不得使用本地磁盘存储或模拟支付；只有显式 `APP_ENV=staging` 才允许测试机降级配置。

## 当前状态（2026-09-21）

**代码规模**（与工作区一致）：数据库迁移 `0000`～`0029`、REST 路由 132 个、Web/H5 与后台页面 37 个（含 9 个后台）、小程序 23 页、内置玩法 manifest 10 条（7 live + 3 archived）、图片货架 9 个已登记入口 / 116 个模板（76 个冻结 live、40 个已完成本地素材映射但尚未上传的 `pending-review`；`human` 入口没有 live 项，因此公开 API 当前仍下发 8 个入口）、小程序主题 4 套 / 57 token / 18 个公共组件。

**已完成的功能批次**（口径与落点全部登记在 `product/07-functional-backlog.md`）：

- 阶段一至三及管理后台补全批次 K 的纯功能开发已完成，Web/H5、REST API、Worker、微信小程序和管理员入口均已覆盖。批次划分与完成记录见 Git 历史，不再单列文档。
- 情绪价值方向（`product/14-direction-review-emotional-value.md`）六项：照片 EXIF 拍摄时间、可选视频时长、多页纪念册 PDF、成长时间线与「去年今日」、叙事型年度视频、年度报告做实。
- 产品改造（`product/17-产品改造方案.md`）批次 1–3：AI 生成内容标识合规、免费玩法零摩擦、生命阶段三态、玩法合并 10→7 live、定价按积累量分档、会员重做、健康分诊线、体重记录、去年今日入口、删除 `/lab`。验收结果与三个「只有真跑才发现」的缺陷记在 `product/19-验收文档.md` 第六部分之二。
- 第二轮改造（`product/20-功能改造方案-第二轮.md`）四批：M1–M6 会员权益兑付与价格同源、E1–E6 情绪能力补端上分发、L1–L6 健康线主动提示与档案 PDF、P5 恢复 ¥128 会员、X1/X2 删除 `growth-lab-client.tsx` 与 `pages/growth`（小程序由此从 24 页降为 23 页）。三处与方案的偏离记在该文 11.4，第三四批的未验证项在 11.6。
- 图片玩法重构（`product/27`～`31`）：9 个入口 / 116 个模板已注册，76 个自有母版冻结上线；另有 40 个全新的宠物人化 V2 模板完成本地素材、提示词和计划对象键映射，维持 `pending-review`。主人照片授权与私有存储、运行时多参考图、定向重抽和 lingsuan 共享队列已落地；宠物人化采用“宠物图一 + 自有效果图二”的单次两候选链路，禁用身份卡生成与重抽。V2 图片均为 `720x1280`，但尚未上传、seed、冻结或批准上线。animal 扩展批次历史生成 24 张，当前保留 21 个 live，3 个按用户结论下架并进入审计归档。普通模板的公开展示图与运行时母版分离；宠物人化则明确由同一个自有效果图对象同时承担 `sampleStorageKey` 与 `masterStorageKey`。

### 小程序剩余事项

| 类型 | 剩余事项 | 权威入口 |
| --- | --- | --- |
| 代码 / 合规 | 虚拟支付按 SKU 选 Provider、`growth_orders` 改为支付确认后发权益、端上接 `wx.requestVirtualPayment` 与 iOS 退款问询已完成；待真实后台和真机验收 | `delivery/06-development-and-configuration-todos.md` |
| 自动化门禁 | `.github/workflows/ci.yml` 已恢复；远端 Actions、gitleaks 和容器关卡仍待实际运行 | `operations/05-release-checklist.md` |
| 宠物人化素材发布 | V2 本地图片、ID、提示词和计划对象键已登记；待完整门禁、明确发布批准、对象存储上传、seed、冻结和真实双参考验证 | `product/31-宠物人化两阶段执行与审批记录.md` |
| 微信后台 / 发布 | AppID、AppSecret、登录、支付、订阅消息模板、三类合法域名、隐私与服务类目、上传私钥和提审发布 | `operations/04-external-prerequisites.md`、`delivery/03-miniprogram-release.md` |
| 真实环境 | PostgreSQL E2E、真实 lingsuan/对象存储/供应商联调、年度视频抽帧、健康 PDF 中文字形、四主题真机走查、部署与备份恢复演练 | `operations/05-release-checklist.md` |

这里的“剩余”包含素材、外部后台和真实环境门禁，不等于小程序页面功能没写完；纯功能基线仍以 `product/07-functional-backlog.md` 为准。

**当前阻塞与未验证项**：

- **健康线的文案法律意见是对外上线的产品性阻塞**（`19` 号文 E7）。技术实现已完成，但合规结论基于对《动物诊疗机构管理办法》与微信类目要求的推断，未经专业审查；第二轮新增的档案 PDF、免疫记录与提示文案同样属用户可见文案。
- **年度视频的成片观感从未验证** —— 开发机无 ffmpeg，需在有 ffmpeg 的环境抽帧确认四段齐全、成片总长等于所选时长。
- **健康档案 PDF 的中文字形未在真机/真实打印下验证** —— PDF 走 sharp 栅格化，生产容器字体集若不同可能出现方框。
- **虚拟支付代码改造已完成**，但微信虚拟支付签约、商品上架、真实回调、iOS 退款问询和真机验收尚未完成；未配置时生产会明确拒绝支付。
- **自动化 CI 已恢复但尚未远端执行**：本机平台覆盖率、内存/PostgreSQL E2E、小程序、官网像素与媒体冒烟已验证；gitleaks、Docker 构建和 GitHub Actions 仍待执行。
- 宠物人化旧两阶段资产不可恢复；V2 本地映射虽已完成，但在对象上传、真实调用验证和明确发布批准前仍保持 `pending-review`，不会下发给用户。
- 官网 `apps/website`（Astro 静态站）已实现；上线仍需真实小程序码、主体/备案/法务信息和生产域名验收。
- 小程序主题系统与玻璃面板的剩余验收依赖真机，见 `operations/05-release-checklist.md` 的「主题系统验收」。
- PostgreSQL 空库/重复迁移及内存/PostgreSQL E2E 已在本机通过；真实 Provider/微信/供应商联调、真实 Linux + Docker 部署和备份恢复仍需按发布清单验收。


## 维护规则

1. 修改代码、迁移、部署脚本或外部依赖时，同步更新唯一对应文档。
2. 所有日期使用绝对日期格式（如 `2026-08-04`）。
3. 发布状态以 `operations/05-release-checklist.md` 为准，部署参数以 `delivery/04-environment-reference.md` 为准。
4. 文档改动与对应代码或交付资产一起提交，并在提交前检查链接、命令和环境变量是否仍然存在。
5. 页数、路由数、迁移号、用例数这类会随代码漂移的计数以本文「当前状态」为准；交付和发布文档中的数字只视为带日期的验收快照，不得反向覆盖本文。
