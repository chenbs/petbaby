# Petbaby 微信原生小程序

使用微信开发者工具打开本目录。当前 `project.config.json` 使用游客 AppID，只用于结构检查；真实 AppID、合法 HTTPS 域名与支付配置统一记录在 `docs/operations/04-external-prerequisites.md`。

代码避免可选链和空值合并语法，以兼容较旧基础库（下限 `2.9.0`）。业务规则全部由 `apps/platform` API 执行，小程序只处理登录、上传、路由和展示。

当前共 26 页（主包 23 + `island` 分包 3）。AI 创建页接入已登记 9 个入口的模板货架，但只展示已有自有冻结母版的 live 模板，所以公开接口当前返回 8 个入口。单宠模板上传 1 张宠物身份照，人宠模板另要求 1 张已授权主人照片。宠物人化已改为“宠物图一 + 自有效果图图二”、一次生成 2 张且不支持重抽；新素材完成映射和审批前仍保持 `pending-review`，不会出现在公开货架。准确规模、完成进度和剩余事项统一看 `../../docs/README.md`。

## 主题系统

26 个页面（含 `island` 分包 3 页）和 18 个公共组件的样式全部走 CSS 变量，`.wxss` 里不允许出现颜色、圆角、阴影、间距和字号的字面量（`app.wxss` 是唯一豁免文件，用于 `var()` 兜底）。

- `theme/tokens.js` —— 57 个 token 的键名与类型真源；新增 token 必须先登记在此，否则四套皮肤缺键时 `pnpm validate` 直接失败。与主题无关的常量放 `CONSTANT_VARS`，只在 `app.wxss` 的 `page{}` 声明一次，不进注入串（注入串有 2KB 门禁）。
- `theme/themes/` —— `cute`（默认）、`glass`、`light`、`dark` 四套皮肤。新增皮肤只需在 `theme/index.js` 的 `THEMES` 追加一项，页面与组件无需改动。
- `theme/manager.js` —— 单例，负责读取/切换/持久化/广播。切换只走内存 + 缓存 + 订阅，不产生网络请求。它还探测 `backdrop-filter` 支持度，不支持时应用皮肤的 `degrade` 取值。
- `theme/page-mixin.js` —— 每个页面都必须接入，负责注入 CSS 变量串并在 `onShow` 同步导航栏配色。
- `components/glass-sheet/` —— 沉浸式玻璃面板，当前接入 `pages/work` 与 `pages/ai-run`。拖动期间零 `setData`，位移与遮罩都在 `index.wxs` 内完成。

规格与实现差异记录见 `../../docs/demand/theme.md` 和 `../../docs/demand/theme-2.md`。

## 检查、预览与上传

```powershell
pnpm install --frozen-lockfile
pnpm validate
pnpm preview   # 需要 AppID、上传私钥和 API 域名环境变量
pnpm upload    # 另需 MINIPROGRAM_VERSION
```

`pnpm validate` 是改样式或加页面后的强制门禁，共十项（编号 1–10，另有 7b）：每页 4 个文件齐备、全部 JSON 可解析、`.wxss` 零硬编码、四套皮肤 token 完整且类型正确、正文与按钮文字对比度达标、玻璃面板文字双极对比度、注入串体积在 2KB 内、黏土内高光跟随卡面明暗（7b）、`var()` 引用的变量确有来源、自定义组件已在同页 `usingComponents` 注册、WXML 标签闭合。通过时输出页数 / 主题数 / token 数。

末尾还会跑 `node --test scripts/**/*.test.js`（当前覆盖陪伴天数，以及小岛昼夜天气、命中表、素材缓存和帧循环）。仓库当前没有 GitHub Actions 工作流，因此相关改动和发布前必须手工执行整条 `pnpm validate`；不能只跑前半段结构校验。

最后三项管的都是**静默失效**类错误：无来源的 `var()` 只是不生效；漏注册的组件被当未知节点丢掉，页面少一块却不报错；标签失衡要等开发者工具打开才现形。这类问题不会让门禁自然变红，必须显式检查。

复制 `config.local.example.js` 为未跟踪的 `config.local.js` 可配置本地/测试机 API。没有 AppID 时可在开发者工具里勾选「不校验合法域名」，并用「我的 → 登录与退出」的账号密码登录测试机。完整流程（含上传体验版、提交审核、发布与回退）见 `../../docs/delivery/03-miniprogram-release.md`。
