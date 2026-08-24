# 小程序沉浸式玻璃面板（Immersive Glass Sheet）需求规格

| 项 | 内容 |
| --- | --- |
| 文档状态 | 需求定稿，待评审后进入实施 |
| 适用范围 | `apps/miniprogram`（微信原生小程序） |
| 依赖前置 | [`theme.md`](theme.md) 定义的 Theme System 已交付（45 个 token、4 套皮肤、`page-mixin`、`scripts/validate.js` 门禁） |
| 变更边界 | 只改视觉与交互层；不改接口契约、数据结构、业务规则与页面跳转关系 |
| 本期落地页面 | `pages/work/work`（作品详情）为 Must，`pages/ai-run/ai-run`（AI 结果确认）为 Should |
| 编写日期 | 2026-07-28 |

---

## 1. 背景与目标

### 1.1 背景

Theme System 已经消除了颜色硬编码并交付 4 套皮肤，但页面骨架仍是"白底 + 卡片流"：作品图片被压在一张 `t-card` 里，与标题、按钮、历史版本并列，图片只是页面的一个区块。作品详情页是唯一的付费转化入口（解锁高清无水印），当前版式没有把"作品本身"当成主体，用户在决定是否付费时看到的图片面积不足屏幕的一半。

本期引入沉浸式版式：作品占满全屏作为背景，信息与操作收进一块可上下拖动的玻璃面板（Bottom Sheet），用户可以把面板收起来完整看图，也可以展开看参数与历史版本。

### 1.2 目标（Must）

1. 交付一个通用的沉浸式玻璃面板组件 `t-glass-sheet`，承担背景层（图片/视频）、亮度联动、玻璃面板与手势三档吸附。
2. 组件的全部材质、圆角、模糊、文字色由 Theme System 的 token 驱动，4 套皮肤各有明确取值，不新增任何硬编码。
3. `pages/work/work` 改为沉浸式版式，信息按三档分层展示，主 CTA（解锁/保存）在任意档位都可见可点。
4. 手势拖动跟手、有阻尼、松手吸附；拖动过程在渲染层完成，不产生逐帧 `setData`。
5. 图片与视频两类作品背景都成立；`backdrop-filter` 不可用的机型有确定的降级表现。
6. 玻璃面板上的文字在**任意底图**下满足对比度阈值，由 `pnpm validate` 静态校验把关。

### 1.3 非目标（Out of Scope）

1. 不做首页、宠物主页、会员页的接入（见第 8 章，二阶段单独排期）。
2. 不做作品海报生成、长按保存、图片手势缩放/双指放大。
3. 不改 `apps/platform`（Web/H5）的作品详情版式。
4. 不新增后端接口、不新增漏斗事件类型；效果验证复用现有事件与订单数据。
5. 不引入任何第三方动画库或构建步骤（保持微信原生 + 零构建）。

### 1.4 效果验证口径

接入前后对比 `pages/work/work` 的解锁转化率（该页产生的已支付订单数 ÷ 该页访问数），观察窗口不少于 14 天。数据取自现有漏斗事件与订单表，不为此需求新增埋点。转化率不下降是本期的底线要求，提升为期望。

---

## 2. 现状与可行性结论（已实测）

### 2.1 可直接复用的能力

| 能力 | 位置 | 结论 |
| --- | --- | --- |
| Token 定义与校验 | `theme/tokens.js` 的 `TOKEN_SPEC` | 新增 token 只需追加键名与类型，校验、CSS 变量下发、体积门禁自动生效 |
| 模糊支持度探测 | `theme/manager.js` 的 `detectBlurSupport()` | 已按平台与基础库版本推断，页面通过 `blurOk` 透传，本期直接复用，不重复探测 |
| 主题注入 | `theme/page-mixin.js` + `<page-meta page-style="{{themeStyle}}">` | 组件位于页面节点树内，可继承页面根节点上的 CSS 变量，无需单独注入 |
| 降级取值 | 各皮肤的 `degrade` 字段 | `glass` 皮肤已有先例（`cardBlur: "0"`），本期按同一机制补玻璃面板的降级取值 |
| 自定义导航栏 | `components/navbar/`（`t-navbar`，支持 `transparent`） | 沉浸式页面复用，但需补一个反色模式，见 5.4 |
| 静态门禁 | `scripts/validate.js` | 已有硬编码扫描、token 完整性、对比度、注入串体积四项，本期扩展第五项 |

### 2.2 必须解决的技术约束

1. **没有 Vue**。原草案给出的 `GlassBottomSheet.vue` 与 `props / @expand` 写法不适用；本仓库是微信原生小程序，组件形态为 `Component()` + `properties` + `triggerEvent`。
2. **逻辑层与渲染层分离**。手势若走 `bindtouchmove` → `setData` 改样式，每帧一次跨线程通信，中低端 Android 必然掉帧。必须使用 WXS 响应事件（基础库 2.4.4+）在渲染层直接改样式，逻辑层只在档位变化时收到一次通知。
3. **`video` 是原生组件**。CSS `filter` 与 `backdrop-filter` 对原生组件内容的作用在各机型表现不一致，不能作为亮度联动与玻璃材质的实现基础。因此亮度联动统一改用叠加遮罩层（见 4.2），不使用 `filter: brightness()`。
4. **低不透明度玻璃不可读**。作品图片内容不可预知（可能纯白、可能纯黑），原草案的 `rgba(255,255,255,.25)` 在深色底图上合成后亮度仅约 64/255，深色文字对比度约 1.7:1，远低于 4.5:1，属于不可交付的取值。本期改为高不透明度 + 强模糊的材质配方（见 5.2），这也与 iOS 系统材质（`systemThickMaterial` 等效不透明度约 0.7～0.85）一致。
5. **`navigationStyle: "custom"` 下 `wx.setNavigationBarColor` 无效**。沉浸式页面必须跳过 `page-mixin` 中的导航栏同步，需给 `themedPage` 增加选项，见 5.4。

### 2.3 目标页面现状

`pages/work/work` 当前结构：`t-skeleton` → `t-card[variant=media]`（`image`/`video` + 水印提示）→ 标题区 → `t-notice` 错误条 → 操作按钮组（解锁/保存/下载/分享/重置/停止分享）→ 历史版本卡 → `t-dialog` 停止分享二次确认。

页面数据来自 `GET /api/works/:id`（返回 `PublicWork`：`title`、`subtitle`、`serialNumber`、`authority`、`version`、`assetKind`、`locked`、`public`、`outputUrl`、`createdAt`、`shareExpiresAt`，以及关联的 `pet`、`photo`、`plugin`）与 `GET /api/works/:id/versions`。本期不改这两个接口，面板三档展示的字段全部来自上述返回值。

---

## 3. 范围与优先级

| 阶段 | 内容 | 优先级 | 判定 |
| --- | --- | --- | --- |
| 一期 | `t-glass-sheet` 组件 + token 扩展 + `validate` 门禁扩展 | Must | 组件可独立运行，四主题各自成立 |
| 一期 | `pages/work/work` 沉浸式改造（图片与视频两类作品） | Must | 第 12 章验收标准全部通过 |
| 一期 | `pages/ai-run/ai-run` 选中候选后的结果确认区接入 | Should | 仅 `status === 'succeeded'` 且已选中时启用；不改四选一网格本身 |
| 二期 | `pages/pets`（宠物主页）、`pages/index`（首页 hero）、`pages/account`（会员页） | 后续 | 一期上线并观察 14 天转化数据后再排期，见第 8 章 |

原草案的推荐位排序（作品详情页 ★★★★★、AI 生成结果页 ★★★★★、宠物主页 ★★★★、首页 ★★★★、会员页 ★★★）予以保留，作为二期取舍依据。

---

## 4. 组件规格：`t-glass-sheet`

### 4.1 目录与形态

```text
apps/miniprogram/components/glass-sheet/
├── index.js      Component 定义、档位状态机、对外方法
├── index.json    { "component": true }
├── index.wxml    背景层 + 遮罩层 + 面板（三个 slot）
├── index.wxss    材质与布局，只读 CSS 变量
└── index.wxs     手势处理（渲染层，逐帧改样式）
```

标签名 `t-glass-sheet`，与既有组件命名一致（`t-card` / `t-popup` / `t-navbar`）。

组件同时承担背景层与面板层，而不是只做面板：亮度联动要求背景滤镜强度随面板位移逐帧变化，若背景在页面、面板在组件，逐帧联动就必须跨组件通信，无法在渲染层一次完成。

### 4.2 结构与层级

自下而上四层，`z-index` 固定：

| 层 | 内容 | z-index | 说明 |
| --- | --- | --- | --- |
| 背景层 | `image[mode=aspectFill]` 或 `video[object-fit=cover]` | 0 | 绝对定位铺满 100vw × 100vh，不随面板移动 |
| 遮罩层 | 纯色 `view`，颜色 `--glass-scrim` | 1 | 亮度联动的唯一实现：`opacity` 随档位在 `0 ~ --glass-scrim-max` 之间线性变化 |
| 内容层 | `slot[name=overlay]` | 2 | 可选，浮在背景上、面板之上的元素（如水印提示、返回按钮） |
| 面板层 | 玻璃面板（把手 + `header` slot + 滚动内容 + `actions` slot） | 3 | `transform: translateY()` 驱动，不改 `height`，避免逐帧重排 |

**亮度联动等价关系**：草案要求"默认 `brightness(0.65)`、收起后 `brightness(1)`"。本方案用黑色遮罩层 `opacity` 表达同一效果——`opacity = 1 - brightness`，即默认档遮罩 0.35、收起档遮罩 0，展开档遮罩 0.45。这一实现对 `image` 与 `video` 一致生效，且只触发合成不触发重绘。

**面板高度实现**：面板固定高度为 `expandedHeight`，通过 `translateY` 上下移动来呈现三档，收起时下移部分被裁到屏幕外。禁止逐帧修改 `height`。

### 4.3 属性（properties）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `background-image` | String | `""` | 背景图 URL。与 `background-video` 同时为空时，背景退回 `--background` 纯色/渐变 |
| `background-video` | String | `""` | 背景视频 URL。非空时优先于 `background-image`，后者作为 `poster` |
| `poster` | String | `""` | 视频封面 / 图片加载前的占位图，通常传原始照片 `work.photo.url` |
| `state` | String | `"half"` | 初始与受控档位，枚举 `collapsed` / `half` / `expanded` |
| `collapsed-height` | Number | `22` | 收起档高度，单位 vh；实际生效值为 `max(该值vh, 340rpx)`，保证主 CTA 不被裁掉 |
| `default-height` | Number | `60` | 默认档高度，单位 vh |
| `expanded-height` | Number | `90` | 展开档高度，单位 vh；实际生效值不超过 `100vh - 导航栏高度 - 24rpx` |
| `blur` | Boolean | `true` | 是否启用 `backdrop-filter`，页面透传 `blurOk`；`false` 时走 5.3 的降级取值 |
| `anim` | String | `"fade"` | 点击反馈动效类型，透传页面的 `animType` |
| `scrim-max` | Number | `0` | 覆盖 `--glass-scrim-max` 的默认遮罩上限，`0` 表示用 token 取值 |
| `gesture-disabled` | Boolean | `false` | 禁用手势（加载中、错误态、无背景资源时置 `true`，此时面板固定在 `half`） |
| `video-autoplay` | Boolean | `false` | 视频背景是否自动播放，取值规则见 9.3 |
| `title` | String | `""` | 收起档单行标题，为空则收起档只显示把手与 `actions` |

### 4.4 事件

| 事件 | detail | 触发时机 |
| --- | --- | --- |
| `bindstatechange` | `{ from, to }` | 档位发生变化并完成吸附动画后触发一次 |
| `bindexpand` | `{ from }` | 档位变为 `expanded` 时，`statechange` 之外的语义快捷事件 |
| `bindcollapse` | `{ from }` | 档位变为 `collapsed` 时同上 |
| `binddragend` | `{ state, ratio }` | 手指抬起时触发一次，`ratio` 为面板可见高度占屏高的比例（0～1） |
| `bindbackgroundtap` | `{}` | 点击背景层（面板之外区域）时触发 |
| `bindbackgrounderror` | `{ type }` | 背景图/视频加载失败，`type` 为 `image` / `video` |

草案中的 `@drag` 逐帧事件不予实现：逐帧向逻辑层派发会重新引入 `setData` 风暴，与 2.2-2 的约束冲突。需要逐帧联动的视觉效果一律在 WXS 内完成。

### 4.5 对外方法

通过 `selectComponent` 调用：`setState(state)`、`expand()`、`collapse()`、`half()`。均带吸附动画，行为与手势一致，并派发同样的事件。

### 4.6 插槽

| 插槽 | 位置 | 说明 |
| --- | --- | --- |
| 默认 | 面板滚动区 | 展开档的完整内容，置于 `scroll-view` 内 |
| `header` | 面板顶部，把手之下，滚动区之上 | 常驻不滚动，承载标题与状态标签 |
| `actions` | 面板底部，滚动区之下 | 常驻不滚动，承载主 CTA；内边距已含 `env(safe-area-inset-bottom)` |
| `overlay` | 背景层之上、面板之外 | 浮层元素，如水印提示 |

---

## 5. 视觉规格

### 5.1 新增 Token

在 `theme/tokens.js` 的 `TOKEN_SPEC` 追加 11 个键，4 套皮肤必须全部提供，缺键或类型不符时 `pnpm validate` 失败：

| Token | 类型 | 用途 |
| --- | --- | --- |
| `glassBackground` | `paint` | 玻璃面板底色，必须为带 alpha 的颜色或渐变 |
| `glassBackgroundSolid` | `color` | 面板不透明兜底色，供 `blur=false` 降级与文字区兜底使用 |
| `glassBorder` | `border` | 面板顶部描边 |
| `glassBlur` | `length` | `backdrop-filter: blur()` 半径 |
| `glassRadius` | `radius` | 面板顶部圆角（支持 1～4 值，`cute` 用不对称圆角） |
| `glassShadow` | `shadow` | 面板投影 |
| `glassScrim` | `color` | 背景遮罩层颜色（不含 alpha 语义，alpha 由 `glassScrimMax` 控制） |
| `glassScrimMax` | `number` | 默认档遮罩不透明度上限（0～1），等价于 `1 - brightness` |
| `glassTextPrimary` | `color` | 面板主文字色（不复用 `textPrimary`，因合成背景不同） |
| `glassTextSecondary` | `color` | 面板次要文字色 |
| `glassHandle` | `color` | 顶部拖拽把手颜色 |

草案要求的 `--glass-opacity` 不单列为 token：面板不透明度已内含在 `glassBackground` 的 alpha 中，收起档的整体降透明由固定系数 `0.92` 表达（写在组件样式里，不同主题无差异化需求）。草案的 `--glass-background` / `--glass-border` / `--glass-blur` / `--glass-radius` 与上表一一对应。

派生变量（`theme/tokens.js` 的 `deriveScale`）新增两项：

- `--glass-handle-width`：`--page-padding` × 2（把手宽度）
- `--glass-blur-degraded`：固定 `0`，供降级路径引用

### 5.2 四套皮肤取值

| Token | `cute` | `glass` | `light` | `dark` |
| --- | --- | --- | --- | --- |
| `glassBackground` | `rgba(255,248,242,.80)` | `rgba(27,27,79,.62)` | `rgba(255,255,255,.78)` | `rgba(12,12,18,.72)` |
| `glassBackgroundSolid` | `#FFF8F2` | `#211E4F` | `#FFFFFF` | `#101014` |
| `glassBorder` | `2rpx solid rgba(255,255,255,.55)` | `2rpx solid rgba(124,107,255,.45)` | `2rpx solid rgba(255,255,255,.6)` | `2rpx solid rgba(255,255,255,.14)` |
| `glassBlur` | `24px` | `36px` | `28px` | `30px` |
| `glassRadius` | `48rpx 48rpx 0 0` | `40rpx 40rpx 0 0` | `40rpx 40rpx 0 0` | `36rpx 36rpx 0 0` |
| `glassShadow` | `0 -12rpx 48rpx rgba(214,150,150,.28)` | `0 -16rpx 64rpx rgba(8,8,40,.55)` | `0 -12rpx 48rpx rgba(20,20,24,.18)` | `0 -16rpx 56rpx rgba(0,0,0,.6)` |
| `glassScrim` | `#2A1F1F` | `#05051A` | `#101014` | `#000000` |
| `glassScrimMax` | `0.32` | `0.42` | `0.30` | `0.45` |
| `glassTextPrimary` | `#3A2C2C` | `#F4F5FF` | `#1A1A1A` | `#F5F5F7` |
| `glassTextSecondary` | `#7A625E` | `rgba(244,245,255,.75)` | `#5A5A60` | `rgba(245,245,247,.72)` |
| `glassHandle` | `rgba(58,44,44,.28)` | `rgba(244,245,255,.35)` | `rgba(26,26,26,.24)` | `rgba(245,245,247,.3)` |

风格差异对应草案第十章的四主题设定：`cute` 暖白玻璃 + 大不对称圆角 + 柔光投影；`glass` 深色强模糊 + 紫色发光描边；`light` 白色磨砂 + 克制圆角；`dark` 近黑玻璃 + 高遮罩，适配 OLED。

### 5.3 降级取值（`degrade`）

各皮肤的 `degrade` 字段追加：`glassBlur: "0"`，`glassBackground` 改为对应的 `glassBackgroundSolid` 提升到 `0.94` alpha（`cute` → `rgba(255,248,242,.94)`，`glass` → `rgba(33,30,79,.94)`，`light` → `rgba(255,255,255,.94)`，`dark` → `rgba(16,16,20,.94)`）。降级后面板不再是玻璃材质，但仍保留圆角、描边、投影与遮罩联动，观感退化为"高级不透明抽屉"，不出现"糊成一片白"或"完全透视看不清字"。

### 5.4 沉浸式导航

1. 接入页面的 `.json` 增加 `"navigationStyle": "custom"`。
2. `theme/page-mixin.js` 的 `themedPage` 增加 `immersive: true` 选项：跳过 `onShow` 中的 `manager.syncNavigationBar()`（自定义导航栏下该调用无效），其余主题注入逻辑不变。返回上级页面时由上级页面自身的 `onShow` 恢复导航栏，无需额外处理。
3. `components/navbar/` 增加 `tone` 属性（`default` / `inverse`）：`inverse` 时标题与返回箭头使用 `--glass-text-primary`，配合 `transparent` 用于沉浸式页面。返回按钮命中区维持 88rpx × 88rpx。
4. 导航栏叠在背景层之上（`z-index: 30`，低于面板的 `z-index: 3` 所在的组件根层级由页面结构保证面板不被导航栏遮挡；实施时以"面板展开到 `expanded` 时顶部不被导航栏压住"为准）。

---

## 6. 交互规格

### 6.1 三档状态机

| 档位 | 面板可见高度 | 遮罩不透明度 | 面板整体不透明度 | 展示内容 |
| --- | --- | --- | --- | --- |
| `collapsed` | `max(22vh, 340rpx)` | `0` | `0.92` | 把手、单行标题、`actions` 主 CTA |
| `half`（默认） | `60vh` | `glassScrimMax` | `1` | 上述 + `header` 完整信息 + 滚动区首屏 |
| `expanded` | `min(90vh, 100vh - 导航栏高度 - 24rpx)` | `glassScrimMax + 0.1`（上限 `0.6`） | `1` | 全部内容，滚动区可滚 |

档位切换与遮罩、面板不透明度的变化在同一动画中完成，时长 `--glass-duration`，缓动 `--glass-easing`。

### 6.2 手势

1. **响应区域**：把手区与 `header` slot 区域始终可拖；滚动区在 `scrollTop === 0` 且手势方向向下时转为拖动面板，否则交给 `scroll-view` 滚动；`actions` 区不响应拖动（避免误触主 CTA 的相邻区域）。
2. **跟手**：拖动过程中面板位移与手指位移 1:1，逐帧在 WXS 内更新 `transform`，同帧同步更新遮罩 `opacity`（按当前可见高度在两个相邻档位间线性插值）。
3. **阻尼**：超出 `expanded` 上界继续上滑时，超出部分位移乘以 `0.28`；低于 `collapsed` 下界继续下滑时同样乘以 `0.28`。面板不可被拖出屏幕，也不可被关闭——本组件不是弹窗，没有"关闭"态。
4. **吸附判定**（手指抬起时）：
   - 若末段速度绝对值 > `0.6 px/ms`，按速度方向吸附到相邻的下一档；
   - 否则吸附到位移方向上、跨越幅度超过两档间距 25% 的目标档；
   - 均不满足则回弹到起始档。
5. **吸附动画**：`--glass-duration` 时长、`--glass-easing` 缓动。缓动函数必须无过冲（`cute` 主题的 `cubic-bezier(.34,1.56,.64,1)` 会让面板底部越过屏幕下沿露出背景，禁止复用），四套皮肤统一使用 `cubic-bezier(.22,.61,.36,1)`，时长 `cute` `360ms`、其余 `320ms`。
6. **点击背景**：`collapsed` 以外的档位点击背景层 → 切到 `collapsed`；`collapsed` 档点击背景 → 切回 `half`。同时派发 `bindbackgroundtap`。
7. **点击把手**：等价于在 `collapsed → half → expanded → collapsed` 之间循环切换，为不能完成拖动手势的用户提供等效路径。
8. **拖动过程中的 `setData`**：仅在手指抬起并确定目标档位时发生一次（同步档位到逻辑层）。拖动中禁止任何 `setData`。

### 6.3 边界行为

| 场景 | 行为 |
| --- | --- |
| 页面 `onHide` / 返回上级 | 保持当前档位，不重置；视频背景暂停 |
| 页面重新 `onShow` | 恢复档位与视频播放（受 9.3 约束） |
| `gesture-disabled` 为 `true` | 面板固定在 `half`，把手隐藏，点击背景无响应 |
| 背景资源加载失败 | 背景退回 `--background`，遮罩恒为 `0`，派发 `bindbackgrounderror`，面板照常可用 |
| 键盘弹起（面板内有输入框） | 本期接入页面均无输入框，不做适配；二期接入含输入的页面时需补规则 |
| 系统返回手势 | 不拦截，正常返回页面 |

---

## 7. 页面接入规格

### 7.1 `pages/work/work`（Must）

页面结构改为：

```text
<page-meta page-style="{{themeStyle}}">
<t-navbar transparent tone="inverse" title="作品详情">
<t-glass-sheet 背景=作品资源 state="half">
  ├─ overlay：未解锁水印提示（work.locked 时）
  ├─ header：状态标签 + 标题 + 副标题
  ├─ 默认插槽：作品信息 + 分享管理 + 历史版本
  └─ actions：主 CTA + 错误提示
<t-dialog 停止分享二次确认
```

**背景资源取值**：`assetKind === 'video'` 时 `background-video="{{work.outputUrl}}"`、`poster="{{work.photo.url}}"`；否则 `background-image="{{work.outputUrl || work.photo.url}}"`。加载中（`loading`）与错误态（无 `work`）时 `gesture-disabled` 置 `true`，面板内展示既有的 `t-skeleton` / `t-notice`。

**信息分层**：

| 档位 | 内容 |
| --- | --- |
| `collapsed` | 把手；单行标题 `work.title`；`actions` 内的主 CTA |
| `half` | 上述 + `header`：`WORK · V{{work.version}}` eyebrow、解锁状态 `t-tag`、标题、副标题；滚动区首屏：宠物名（`work.pet.name`）、玩法名（`work.plugin.name`）、创建时间 |
| `expanded` | 上述 + 编号 `work.serialNumber`、`work.authority`、分享状态与到期时间（`work.public` / `work.shareExpiresAt`）、分享管理按钮组、历史版本列表（`versions`，含"恢复"操作） |

主 CTA 在三档中始终可见，规则不变：`work.locked` → 解锁按钮（`priceText`）；视频作品 → 下载 MP4；其余 → 保存到相册。`t-notice` 错误条置于 `actions` 之上，出现时不改变面板档位。

"推荐玩法"（草案第五章展开档内容之一）**不在本期实现**：作品详情页当前不请求玩法列表，为此新增一次 `GET /api/plugins` 请求会拖慢首屏，且与本期"提升当前作品的解锁转化"目标无关。二期评估。

**行为不变项**：解锁支付、保存相册、下载视频、开启/重置/停止分享、版本恢复、`onShareAppMessage` 的逻辑与文案全部保持现状，只改容器与位置。

### 7.2 `pages/ai-run/ai-run`（Should）

仅当 `run.status === 'succeeded'` 且 `run.selectedId` 非空时，把"已选中的候选图 + 确认操作"区改为沉浸式：选中图作为背景，面板 `half` 档展示玩法名、Provider、剩余重抽次数与确认/重抽按钮。四选一网格（未选中前）保持现有卡片版式不变——四张图需要并排比较，沉浸式全屏背景与该场景冲突。

### 7.3 组件注册

接入页面的 `.json` 追加 `"t-glass-sheet": "../../components/glass-sheet/index"`，并设置 `"navigationStyle": "custom"`；`app.json` 的 `lazyCodeLoading: "requiredComponents"` 保持不变。

---

## 8. 二期接入判定（不在本期范围）

| 页面 | 背景素材 | 前置条件 |
| --- | --- | --- |
| `pages/pets`（宠物主页） | 该宠物最新一件作品或主照片 | 需先确定"宠物主页"的信息架构（当前是档案列表，不是主页） |
| `pages/index`（首页） | 运营位配图或用户最近作品 | 需要素材来源与兜底策略；首页是 TabBar 页，面板与自定义 TabBar 的层级需额外规则 |
| `pages/account`（会员页） | 主题渐变或权益插画 | 无真实图片素材时收益有限，优先级最低 |

二期启动的判定条件：一期上线满 14 天，`pages/work/work` 解锁转化率未下降，且真机帧率指标（第 9.1 节）达标。

---

## 9. 性能与兼容性

### 9.1 性能预算

| 指标 | 要求 | 测量方式 |
| --- | --- | --- |
| 拖动帧率 | iOS 中端机型 ≥ 55fps；Android 中端机型 ≥ 45fps，掉帧率 < 15% | 开发者工具 Trace / 真机性能面板 |
| 拖动期间 `setData` 次数 | 0 次（手指抬起后 1 次） | 开发者工具"setData 调用"面板 |
| 单次 `setData` 数据量 | < 1KB（档位同步只传状态字符串） | 同上 |
| 背景首帧可见 | ≤ 1.5s（先出 `poster`，再出高清） | 真机秒表 |
| 档位切换动画 | 无可见跳变、无白边、无内容闪烁 | 人工走查 |

### 9.2 模糊与降级矩阵

| 条件 | 面板材质 | 遮罩联动 | 手势 |
| --- | --- | --- | --- |
| `blurOk === true` | `glassBackground` + `backdrop-filter: blur(--glass-blur)` | 生效 | 生效 |
| `blurOk === false`（低版本 Android 等） | `degrade` 中的 0.94 alpha 纯色 | 生效 | 生效 |
| 基础库 < 2.9.0（无 `page-meta`） | `app.wxss` 的 `cute` 兜底变量 + 不透明底 | 生效 | 生效 |
| 基础库 < 2.4.4（无 WXS 响应事件） | 同上 | 生效 | 手势降级为"点击把手切换档位"，不崩溃 |

基础库版本下限沿用 `theme.md` 8.4 的 2.9.0；WXS 响应事件所需的 2.4.4 低于该下限，属于必然满足，第四行仅作为防御性要求。

### 9.3 视频背景规则

1. 静音、循环、无控件、`object-fit="cover"`、`show-center-play-btn="false"`。
2. 网络类型为 `wifi` 时自动播放；非 WiFi 时只显示 `poster`，用户点击背景后才开始播放（点击背景的档位切换行为在此场景下让位于"播放"，仅首次点击如此）。
3. 面板处于 `expanded` 档超过 2 秒时暂停播放（视频几乎不可见），回到其他档位时恢复。
4. 页面 `onHide` 暂停，`onShow` 按上述规则恢复。
5. 视频加载失败时退回 `poster`，再失败退回纯色背景，均不阻塞面板操作。

### 9.4 图片背景规则

`mode="aspectFill"`，居中裁切。加载完成前显示 `poster`（原始照片）。竖图、横图、方图三种比例都必须无拉伸、无留白。

---

## 10. 无障碍与可读性

1. 面板文字对比度：`glassTextPrimary` 与面板合成背景的对比度，在**底图为纯白与纯黑两种极端**下均 ≥ 4.5:1；`glassTextSecondary` 均 ≥ 3:1。计算方式与门禁见 11.2。
2. 把手可点击，`aria-role="button"`、`aria-label="展开或收起详情"`，命中区不小于 88rpx × 88rpx。
3. 面板内所有可点击元素维持既有的 88rpx 最小命中区规范。
4. 背景层不承载任何必读信息；所有文字必须在面板内。
5. `overlay` slot 内的文字（如水印提示）必须自带 `t-tag` 一类的实底容器，不得直接把文字放在图片上。
6. 纪念相关场景（`themedPage` 的 `mood: "memorial"`）若在二期接入：禁用弹性、遮罩上限降至 `0.2`、档位切换时长统一 `280ms`。

---

## 11. 静态校验与门禁扩展

### 11.1 沿用的现有门禁

`scripts/validate.js` 现有五项照常生效，其中"硬编码颜色扫描"与"字面量样式值扫描"会覆盖新增的 `components/glass-sheet/index.wxss`，该文件必须零硬编码。`index.wxs` 内允许出现数值常量（阻尼系数、速度阈值），但不得出现颜色。

### 11.2 新增门禁：玻璃面板文字对比度

在 `scripts/validate.js` 追加一项校验，对每套主题、每种模糊状态（正常 / `degrade`）、每个档位（`half` 与 `collapsed`）执行：

```text
对 底图 ∈ { #FFFFFF, #000000 }：
  合成1 = composite(glassScrim@当前档遮罩不透明度, 底图)
  合成2 = composite(glassBackground@alpha × 当前档面板不透明度, 合成1)
  比值1 = contrast(glassTextPrimary,   合成2)   要求 ≥ 4.5
  比值2 = contrast(glassTextSecondary, 合成2)   要求 ≥ 3.0
```

`composite` / `luminance` / `contrast` 复用文件内既有实现，不重复造轮子。任一组合不达标即 `pnpm validate` 失败并打印具体主题、档位、底图与实际比值。

5.2 给出的取值已按此算法验证通过，最不利组合为"`light` 主题 / `collapsed` 档 / 纯黑底图"，实测约 7.9:1。

### 11.3 其他

- Token 完整性校验自动覆盖新增的 11 个键（`TOKEN_SPEC` 是唯一真源）。
- CSS 变量注入串体积门禁（2KB）需复核：新增 11 个 token 后各主题的变量串长度必须仍在限内，超限时优先合并派生变量而非放宽阈值。

---

## 12. 验收标准

### 功能

1. 作品详情页打开后，作品图片/视频占满全屏，面板停在 `half` 档。
2. 上滑展开至 `expanded`，可看到编号、权威声明、分享状态与历史版本，滚动区可滚动到底。
3. 下滑收起至 `collapsed`，背景遮罩完全消失（等效 `brightness(1)`），画面只剩作品与一行标题、主 CTA。
4. 点击背景可在 `collapsed` 与 `half` 之间切换；点击把手可循环切换三档。
5. 图片作品与视频作品两条路径均成立，视频按 9.3 的规则播放与暂停。
6. 解锁、保存相册、下载 MP4、开启/重置/停止分享、版本恢复、转发分享的行为与改造前完全一致。
7. 主 CTA 在三个档位下均可见且可点击。
8. 背景资源加载失败时页面仍可完成解锁与分享操作。

### 视觉与主题

9. 四套主题下面板材质、圆角、描边、投影、遮罩强度均可区分，且都不出现文字不可读区域。
10. `blurOk === false` 的降级路径下，四套主题各自成立（不透明抽屉观感），不出现空玻璃。
11. 深色作品图与浅色作品图（各准备至少一张纯白背景与一张纯黑背景的测试作品）下，面板文字均清晰可读。

### 性能

12. 拖动过程满足 9.1 的帧率与 `setData` 指标，实测数据随交付提交。
13. 档位切换动画无过冲露底、无白边。

### 代码质量

14. `pnpm validate` 全绿，含 11.2 新增的对比度门禁。
15. `components/glass-sheet/` 与接入页面的 `.wxss` 零硬编码。
16. 四套主题各自补齐 11 个新 token 与对应 `degrade` 取值。
17. 组件可在不修改任何一行代码的前提下被第二个页面接入（以 7.2 的 `ai-run` 接入作为证明）。

### 兼容性

18. iOS 与 Android 真机各验证一台，模糊生效与降级两种表现均可用。
19. 自定义导航栏在刘海屏与非刘海屏上均不遮挡内容、不与胶囊按钮重叠。

### 交付物

20. 四套主题 × 三个档位 × 图片/视频两类作品的走查截图集。
21. 本文档第 14 章据实回填实现差异。

---

## 13. 与原始草案的偏离记录

原始草案（本文档 2026-07-28 改写前的版本）中以下决策已被修正，实施以本文档为准：

| # | 草案 | 本规格 | 原因 |
| --- | --- | --- | --- |
| 1 | `components/GlassBottomSheet.vue`，`props` / `@expand` | `components/glass-sheet/`，`properties` / `triggerEvent` | 仓库是微信原生小程序，无 Vue |
| 2 | 浅色玻璃 `rgba(255,255,255,.25)`、暗色 `rgba(0,0,0,.35)` | alpha 提升至 0.62～0.80，见 5.2 | 低 alpha 在深色/浅色底图上合成后对比度约 1.7:1，无法交付；高 alpha + 强模糊与 iOS 系统材质一致 |
| 3 | `filter: brightness(0.65)` 控制背景亮度 | 叠加遮罩层 `opacity`（等价 `1 - brightness`） | `video` 是原生组件，`filter` 表现不一致；遮罩只触发合成，性能更好 |
| 4 | 浅色/暗色两套玻璃样式 | 四套主题各一组 token 取值 | 与已交付的 Theme System 对齐，主题由 `ThemeManager` 决定，不引入独立的明暗开关 |
| 5 | `@drag` 逐帧事件 | 仅 `binddragend` + `bindstatechange` | 逐帧跨线程派发会引入 `setData` 风暴 |
| 6 | 收起档 `20%` | `max(22vh, 340rpx)` | 小屏机上 20vh 约 266rpx，装不下把手 + 标题 + 主 CTA |
| 7 | 逐帧改 `height` | 固定高度 + `translateY` | 改 `height` 每帧触发重排 |
| 8 | 展开档含"推荐玩法" | 本期不做 | 需新增一次玩法列表请求，与本期转化目标无关 |
| 9 | 一期同时覆盖首页、宠物主页 | 一期只做作品详情页（+ AI 结果页 Should） | 先验证转化收益再铺开，见第 8 章 |
| 10 | `--glass-opacity` 独立变量 | 并入 `glassBackground` 的 alpha | 避免同一视觉属性有两个来源 |

---

## 14. 实现差异记录

实现过程中与本文档正文不一致的决策，逐条记录在此，正文保持原判不改写。

| # | 文档原定 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 1 | 5.2 的 `glassBackground`：`cute` `.80`、`glass` `.62`；11.2 称最不利组合为「`light` / `collapsed` / 纯黑」约 7.9:1 | `cute` 提到 `.84`、`glass` 提到 `.72`；实测最不利组合是「`glass` / `collapsed` / 纯白底图」，当前 4.92:1 | 按 11.2 的算法实算，原取值有三处不达标（`cute`/`collapsed`/纯黑 次要文字 2.81:1，`glass`/`collapsed`/纯白 主文字 3.67:1、次要文字 2.79:1）。收起档的 `0.92` 整体降透明会把面板 alpha 再乘一次，正文给的取值未计入这一项。`light` `.78` 与 `dark` `.72` 原样通过，未改 |
| 2 | 5.1 派生变量新增 `--glass-blur-degraded`、`--glass-easing` 随注入串下发 | 与 `--radius-pill` 一并移出注入串，改由 `app.wxss` 的 `page{}` 声明一次，真源是 `theme/tokens.js` 的 `CONSTANT_VARS` | 新增 11 个 token 后 `glass` 主题注入串 2133 字节，超 2KB 门禁。按 11.3「优先合并派生变量而非放宽阈值」处理：注入串只承载随主题变化的量，三个与主题无关的常量重复下发纯属浪费。`validate` 新增一项校验保证两处取值不漂移 |
| 3 | 4.6 `actions` 插槽位于面板底部、滚动区之下 | 面板下移时 `actions` 反向平移同等距离，并自带一层面板底色与顶部分隔线 | 面板高度固定为展开档、靠 `translateY` 下移，其底部会被移出屏幕，`actions` 会随之消失，与 6.1／12.7「主 CTA 三档均可见」冲突。反向平移后它会叠在滚动区上方，故需自带底色遮挡下方透出的内容；配一条顶部分隔线让它读起来是有意为之的固定操作栏，而非材质接缝 |
| 4 | 5.4.3 `tone="inverse"` 时标题与返回箭头使用 `--glass-text-primary` | 同时补一层由 `--glass-scrim` 渐隐的顶部底衬，不透明度取 `--glass-scrim-max` | 导航栏直接叠在作品图上，作品内容不可预知。`light` 主题的 `glassTextPrimary` 是 `#1A1A1A`，遇到深色底图即不可读；仅靠文字色无法满足第 10 章的可读性要求。底衬与面板遮罩同源，不引入新颜色 |
| 5 | 5.3 「各皮肤的 `degrade` 字段追加」 | `cute` / `light` / `dark` 三套皮肤原本没有 `degrade` 字段，本期为它们新建该字段 | 原文表述预设四套皮肤都已有 `degrade`，实际只有 `glass` 有（见 2.1 表格的措辞）。新建字段只含玻璃相关的两个键，不影响其余 token |
| 6 | 7.2 AI 结果页面板展示「玩法名」 | 展示「玩法编号」（`run.pluginId`） | `GET /api/ai-runs/:id` 返回的 `AiRun` 只有 `pluginId`，没有玩法名；取名字需要额外请求玩法列表，与非目标 4「不新增接口」及首屏性能要求冲突。同一理由下 7.1 已明确不做「推荐玩法」 |
| 7 | 11.2 只新增对比度一项门禁 | 另新增「CSS 变量来源完整性」一项：`.wxss` 里 `var(--x)` 引用的变量必须来自 token、派生量、`CONSTANT_VARS` 或 `scene-presets` | 无来源的 `var()` 不报错、只是静默失效，本期开发中即因此漏过一个笔误变量。该项与 11.1 的零硬编码扫描互补：前者管「不许写死值」，后者管「写的变量确实存在」 |
| 8 | 4.1 目录清单中样式集中在 `components/glass-sheet/index.wxss` | 面板内的文本层级类（`glass-title` / `glass-muted` / `glass-small` / `glass-eyebrow` 等）放在 `app.wxss` | slot 内容由页面提供、归页面作用域，组件自身的 `.wxss` 对其无效。组件文件只保留结构与材质样式，仍是零硬编码 |

### 未完成项（需真机环境）

以下验收项依赖真机与微信开发者工具，当前交付未覆盖，需在联调阶段补齐：

- 12.12 拖动帧率与 `setData` 实测数据（9.1 的性能预算）。代码层面已满足「拖动期间零 `setData`」的设计约束——位移、遮罩、`actions` 位置全部在 `index.wxs` 内改样式，逻辑层只在手指抬起、目标档位确定时收到一次 `onGestureEnd`。
- 12.18 iOS / Android 真机各一台的模糊生效与降级验证。
- 12.19 刘海屏与非刘海屏的导航栏走查。
- 12.20 四套主题 × 三个档位 × 图片/视频两类作品的截图集。

