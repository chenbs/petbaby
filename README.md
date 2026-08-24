# Petbaby

宠物照片创意内容平台，包含 Next.js Web/H5/API、PostgreSQL/PGlite、异步生成 Worker 和微信原生小程序。

## 快速开始

```powershell
cd apps/platform
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:3000`，可完成“选择玩法 → 建立宠物档案 → 上传照片 → 生成免费预览 → 模拟支付解锁 → 创建 H5 分享页”的完整本地流程。

## 当前交付

- 阶段一：宠物/照片资产、PL-01/02/03、低清预览与高清解锁、订单、分享归因和账户隐私。
- 阶段二：AI 四选一、互动页/服务端 15 秒导出、独立 FFmpeg 视频、纪念产品和赛马后台均已完成功能闭环。
- 阶段三：订阅消息、实体订单与人工履约、会员权益和年度报告均已完成服务端、Web/H5、小程序与必要后台入口。
- 图片玩法：9 个已登记入口的模板货架、单宠/人宠分角色输入、主人照片私有存储和冻结母版运行时链路已完成；宠物人化已改为“宠物图一 + 自有效果图二”的单次生成链路，每次 2 张且不支持重抽。公开 API 当前只下发含 live 模板的入口，模板生产进度见 `docs/README.md`。
- 生产 Provider：微信支付 v3、S3 兼容对象存储、通用 AI 图片接口。
- Web/H5、REST API、管理后台和微信原生小程序均已形成可运行闭环；页数、路由数、迁移号和测试用例数只在 `docs/README.md` 维护。
- 小程序主题系统：57 个 token、4 套皮肤（`cute`/`glass`/`light`/`dark`）、18 个零硬编码公共组件和沉浸式玻璃面板。
- 情绪价值方向：照片 EXIF 拍摄时间、成长时间线与「去年今日」、成长对比图、可选时长（10/20/30 秒）的叙事型年度视频、多页纪念册 PDF。
- 健康分诊线：症状分诊与紧急度分级、体重与免疫驱虫记录、主动到期提示、健康档案 PDF。**做分诊不做诊断**，红线见 `docs/product/16-竞品分析与产品复盘.md` 3.8。
- 会员与定价：按积累量分档计价、权益台账与按次凭据核销、两端价格文案同源。
- 管理后台补全：统一鉴权/审计、赛马回滚、互动/视频/纪念任务、订阅/履约/会员/报告运营及安全账号停用。
- 独立官网 `apps/website`（Astro 7 静态站，11 个页面，独立域名）。
- 宠物小岛：2D 治愈系小岛（采集 / 喂食 / 摸摸 / 装扮 / 日记），昼夜四档与天气四档正交叠加共 16 种组合，立绘抠图与 AI 标识合规。M1 编码已完成，**待办只看 `docs/product/25-宠物小岛待完成清单.md`**。
- 数据库前向迁移、独立 Worker、健康检查、限频、成本熔断、告警和清理任务。

本地模式使用匿名账户、PGlite 持久数据库和私有文件目录；生产必须使用 PostgreSQL、对象存储和微信正式配置。仍待外部提供的 Value 集中在 `docs/operations/04-external-prerequisites.md`。

## 验证

```powershell
cd apps/platform
pnpm check
pnpm test:e2e
```

产品文档索引见 `docs/README.md`。

不考虑测试与上线时的功能状态统一维护在 `docs/product/07-functional-backlog.md`。

截至 2026-08-22，阶段一至三、管理后台补全、情绪价值方向、两轮产品改造和宠物小岛 M1 的功能代码均已交付；图片模板货架、主人照片链路、宠物人化直接效果图链路、图生图多输入与共享生成队列也已落地。准确规模与 2026-08-22 门禁结果只看 `docs/README.md`「当前状态」。

当前工作转入虚拟支付合规改造、恢复自动化 CI 门禁、PostgreSQL E2E、真实 Provider/微信/供应商联调、真机走查、部署演练和发布门禁。非人化图片母版已完成视觉审批；宠物人化 V2 已完成本地图片规范化、ID/提示词归一和计划对象键登记，但尚未上传、seed、冻结或批准上线，仍不公开。状态见 `docs/product/31-宠物人化两阶段执行与审批记录.md`。三个未验证项：年度视频的成片观感与健康档案 PDF 的中文字形（均需在真实环境验证），以及**健康线文案的法律意见——这是对外上线的产品性阻塞**。宠物小岛素材已经到齐，岛侧剩余的是**类目自查 + M0 体验版提审、合法域名登记、部署灌图与真机验收**，见 `docs/product/25-宠物小岛待完成清单.md`；**虚拟支付合规改造**（微信 2026-04-01 期限已过，且 `growth_orders` 链路从未接入真实支付）见 `docs/product/23-虚拟支付合规改造方案.md`。

## 交付与部署

- 交付物总表：`docs/delivery/01-deliverables.md`
- 部署总手册（测试机 + 正式生产）：`docs/delivery/02-deployment-guide.md`
- 小程序调试、上传与发布：`docs/delivery/03-miniprogram-release.md`
- 环境变量：`docs/delivery/04-environment-reference.md`
- API 与运维：`docs/delivery/05-api-operations-reference.md`

本地容器配置位于 `compose.yaml`；测试机与生产编排、宿主机 Nginx 配置示例和一键部署脚本位于 `deploy/`。测试机首次部署：`./deploy/scripts/bootstrap.sh <域名> <邮箱>`；日常发布：`./deploy/scripts/release.sh staging`；官网单独发布：`./deploy/scripts/release-website.sh`。待补填的外部凭据见 `docs/operations/04-external-prerequisites.md`，发布前按 `docs/operations/05-release-checklist.md` 验收。

产品路线与功能现状：`docs/product/01-roadmap.md`（治理总纲）、`docs/product/02-product-design.md`、`docs/product/03-features-shell.md`、`docs/product/04-plugins-playbook.md`、`docs/product/07-functional-backlog.md`（唯一功能待办来源）。逐项改动查 `docs/product/21-小程序功能点清单.md`（按页编号）与 `docs/product/15-功能入口清单.md`（入口与接口）。小程序视觉规格见 `docs/demand/theme.md` 与 `docs/demand/theme-2.md`。阶段实现计划与后台补全记录已完成并从文档树移除，需要历史背景请查 Git 历史；下一步以 `docs/operations/04-external-prerequisites.md`、`docs/operations/05-release-checklist.md` 和 `docs/delivery/` 为准。
