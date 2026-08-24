# 小程序全局 UI 主题系统需求规格

| 项 | 内容 |
| --- | --- |
| 文档状态 | 需求定稿，待评审后进入 Phase 1 |
| 适用范围 | `apps/miniprogram`（微信原生小程序，21 个页面 + 1 个自定义 TabBar 组件） |
| 不适用范围 | `apps/platform`（Next.js Web/H5/管理后台）本期不改造，仅在第 10 章记录后续对齐口径 |
| 变更边界 | 只改视觉与样式层；不改数据结构、接口契约、业务规则与页面跳转关系 |
| 编写日期 | 2026-07-28 |

---

## 1. 背景与目标

### 1.1 背景

宠物照片创意内容平台的小程序端已完成全部功能开发（21 页覆盖玩法、生成、解锁、分享、纪念、会员、后台入口）。当前视觉是一套硬编码的"奶绿 + 深墨绿 + 黄"配色，逐页手写颜色，缺少统一的设计语言，也无法按用户偏好切换外观。

本期目标不是换皮，而是建立一套完整的 **Theme System**：Design Token 为唯一样式来源，主题皮肤只提供 token 取值，页面与组件不再出现字面量颜色。

### 1.2 产品定位对 UI 的约束

产品主链路：上传宠物照片 → 选择玩法 → AI 生成作品 → 预览 → 付费解锁高清 → 收藏/分享。

UI 必须传达：宠物陪伴感、AI 创造感、作品高品质感、情绪价值、年轻用户审美。

必须避免：工具后台感、按钮墙、密集表单、无留白的长列表。参照物是 AI 创作类应用、图片社区、高端相册，而非传统工具类小程序。

### 1.3 本期目标（Must）

1. 建立 Design Token 体系与命名规范，覆盖颜色、状态色、AI 色、按钮、卡片、间距、字体、圆角、阴影、动效。
2. 交付 4 套完整主题皮肤：`cute`（温馨可爱风，默认）、`glass`（透明玻璃科技风）、`light`（极简高级亮色）、`dark`（极简高级暗色）。
3. 交付 `ThemeManager`：读取当前主题、切换主题、本地持久化、全局注入、已打开页面即时生效。
4. 交付主题选择页：4 张主题预览卡，点击即时切换并写入本地缓存。
5. 改造全部 21 个页面与自定义 TabBar，消除颜色硬编码。
6. 抽取公共 UI 组件（当前仓库无 `components/` 目录），使其全部主题可控。

### 1.4 非目标（Out of Scope）

1. 不改任何 `services/api.js` 调用、字段、参数与错误处理逻辑。
2. 不改 `app.json` 中 `pages` ��既有顺序与页面路径（只允许追加主题选择页）。
3. 不做跟随系统深色模式的自动切换（仅在第 9.6 节留扩展点）。
4. 不做多语言、无障碍全量审计、H5/Web 端同步改造。
5. 不引入构建期 CSS 预处理器或第三方 UI 框架（保持微信原生 + 零构建）。

---

## 2. 现状分析（Phase 1 输入，已完成实测）

### 2.1 技术栈与工程约束

| 项 | 结论 |
| --- | --- |
| 框架 | 微信原生小程序，无 Taro/uni-app，无构建步骤 |
| 样式方案 | 逐页 `.wxss` + 全局 `app.wxss`；`app.wxss` 仅 8 条全局规则（`page` 选择器与 `.page` `.eyebrow` `.title` `.muted` `.primary` `.panel` `.empty`） |
| 组件化程度 | 无 `components/` 目录；唯一组件是 `custom-tab-bar/`；页面直接堆 `view` / `button` / `picker` |
| 构建校验 | `pnpm validate`（`scripts/validate.js`）校验 `app.json` 每页 4 个文件齐备 + 全部 JSON 可解析 |
| 发布 | `pnpm preview` / `pnpm upload` 走 `miniprogram-ci`；`project.config.json` 开启 `minified`、`minifyWXML`、`postcss` |
| 主题相关全局态 | `app.js` 的 `globalData` 现只有 `apiBaseUrl`、`loggedIn`；无主题字段 |

### 2.2 样式问题清单

1. **颜色硬编码 102 处**，分布在 23 个 `.wxss` 文件中（`app.wxss` 7、`index` 12、`interactive` 15、`interactive-create` 11、`ai-run` 10、`create` 9、`pets` 6、`ai-create` 6、`custom-tab-bar` 5、其余各 1–4）。高频字面量：`#14251c`（主文字/描边）、`#edf8f2`（页面底色）、`#fffef9`（卡片）、`#216844`（绿）、`#f56643`（强调橙）、`#f6c949` / `#fff1b7`（黄）、`#53645b` / `#5d7066`（次要文字）、`#d9e7df`（分割线）。
2. **同义 token 取值不一致**：次要文字有 `#53645b` 与 `#5d7066` 两个值；卡片底色有 `#fffef9` 与 `#fff` 两个值；输入框底色有 `#edf8f2` 与 `#fff` 两套；圆角在 `12rpx`–`58rpx` 间有 11 种取值；错误提示样式在 `create`、`pets`、`ai-run`、`interactive` 四处各写一遍。
3. **布局风格被写死在结构里**：`pages/index` 的 hero 用 `border: 4rpx solid` + `box-shadow: 14rpx 16rpx 0` 的"实体描边投影"风格，`interactive` 场景卡用 `linear-gradient` + 不对称圆角（`50rpx 50rpx 110rpx 50rpx`）。全仓库 6 处 `linear-gradient`。这些属于主题特性，不应固定在页面里。
4. **导航栏与页面底色分离**：`app.json` 的 `window.navigationBarBackgroundColor`、`backgroundColor` 是静态 `#edf8f2`，与主题无关，切换主题后顶部会出现色块不一致。
5. **自定义 TabBar 在页面树之外**：`custom-tab-bar` 不继承页面���点上的 CSS 变量，必须独立注入主题变量，否则切换后 TabBar 保持旧色。
6. **原生 `button` 混用**：多处直接用 `type="primary"` / `size="mini"` 依赖微信默认绿色按钮（`account`、`login`、`memorials`、`physical`、`commerce`、`pets`、`works`、`ai-run` 等），这部分颜色不受 WXSS 变量控制，必须替换为自定义按钮样式。
7. **可读性风险**：`pages/interactive` 场景卡固定 `color: #fff`，主题转亮色后会失去对比度；`video` 进度条固定 `#f56643` / `#dce9e0`。

### 2.3 页面清单（21 页，按 `app.json` 顺序）

| # | 路径 | 角色 | 层级 |
| --- | --- | --- | --- |
| 1 | `pages/index/index` | 玩法首页（hero + 玩法卡列表） | TabBar |
| 2 | `pages/create/create` | 创作流程（档案 → 选图 → 生成中 → 结果，四态单页） | 二级 |
| 3 | `pages/works/works` | 作品柜（三筛选 + 任务/作品混合列表） | TabBar |
| 4 | `pages/work/work` | 作品详情（预览、解锁、保存、分享、历史版本） | 二级 |
| 5 | `pages/orders/orders` | 订单与退款 | 三级 |
| 6 | `pages/me/me` | 我的（额度、通知、8 个入口行） | TabBar |
| 7 | `pages/pets/pets` | 宠物档案（表单 + 列表 + 头像） | 三级 |
| 8 | `pages/photos/photos` | 照片库（��物筛选 + 九宫格） | 三级 |
| 9 | `pages/account/account` | 账户与隐私（资料、导出、删除） | 三级 |
| 10 | `pages/growth/growth` | 创作方式选择（AI / 互动页 / 视频三卡） | 二级 |
| 11 | `pages/ai-create/ai-create` | AI 四选一参数表单（PL-10） | 三级 |
| 12 | `pages/ai-run/ai-run` | AI 任务状态、四候选选择、解锁、重抽 | 三级 |
| 13 | `pages/interactive-create/interactive-create` | 互动页创建（含主题化实时预览，PL-15） | 三级 |
| 14 | `pages/interactive/interactive` | 互动页编辑 + 星尘互动 + 导出 MP4 | 三级 |
| 15 | `pages/video-create/video-create` | 视频项目创建（选图、字幕、BGM，PL-19） | 三级 |
| 16 | `pages/video/video` | 视频渲染进度与字幕编辑 | 三级 |
| 17 | `pages/memorials/memorials` | 纪念空间（创建 + 列表 + 衍生品） | 三级 |
| 18 | `pages/memorial-share/memorial-share` | 纪念空间只读分享页（访客可见） | 分享落地 |
| 19 | `pages/commerce/commerce` | 会员、订阅提醒、年度报告 | 三级 |
| 20 | `pages/physical/physical` | 实体纪念品下单（收货表单） | 三级 |
| 21 | `pages/login/login` | 登录/注册 | 独立 |

### 2.4 改造方案结论

- **注入方式**：`page-meta` → `page-style` 注入 CSS 自定义属性（基础库 2.9.0+），使 token 落在 page 根节点并被全部子节点继承；`app.wxss` 只定义"变量 → 语义类"的映射，不再出现字面量。
- **不采用**的方案及理由：① 逐页 `data` 绑定 inline style——改动面大且无法覆盖伪类；② 多套 `.wxss` 按主题条件引入——小程序无条件编译，包体膨胀；③ 仅靠 `app.wxss` 的 `page` 选择器——无法在运行时切换取值。
- **落地顺序**：Token 与 ThemeManager（Phase 2）→ 四套皮肤（Phase 3）→ 公共组件与页面（Phase 4）→ 动效与细节（Phase 5）。渐进改造，不做一次性大规模重写。

---

## 3. Theme Architecture（主题架构）

### 3.1 目录结构

```text
apps/miniprogram/
├── theme/
│   ├── tokens.js          # Token 键名清单 + 默认值 + 校验（唯一真源）
│   ├── themes/
│   │   ├── cute.js        # 温馨可爱风（默认）
│   │   ├── glass.js       # 透明玻璃科技风
│   │   ├── light.js       # 极简高级亮色
│   │   └── dark.js        # 极简高级暗色
│   ├── manager.js         # ThemeManager：get / set / subscribe / 持久化 / 注入
│   └── index.js           # 对外出口：themes 列表、当前主题、CSS 变量串
├── components/            # 本期新建的公共组件目录（见第 7 章）
└── pages/theme/theme.*    # 主题选择页（见第 6 章）
```

说明：需求原文示例用 `.ts`，但本仓库小程序端是零构建的原生 JS（`package.json` 无 TypeScript 依赖，`project.config.json` 直接编译源码），因此统一用 `.js` + JSDoc 注释，不引入编译链。

### 3.2 Token 分层

三层，页面只允许引用第 3 层（语义层）：

| 层 | 内容 | 示例 | 页面可否直接用 |
| --- | --- | --- | --- |
| L1 调色板 | 主题私有色阶，仅在皮肤文件内部使用 | `palette.pink500` | 否 |
| L2 语义 Token | 跨主题稳定的语义键名 | `colorPrimary`、`cardBackground` | 是（唯一入口） |
| L3 CSS 变量 | L2 自动转换出的 `--*` 变量 | `var(--color-primary)` | 是 |

L2 → L3 命名规则：camelCase 转 kebab-case 并加 `--` 前缀，例如 `textPrimary` → `--text-primary`、`aiGradientStart` → `--ai-gradient-start`。转换由 `theme/index.js` 统一完成，不允许手写映射。

### 3.3 Token 清单（每套主题必须提供全部键，缺键即校验失败）

**基础颜色（9）**：`primary`、`secondary`、`background`、`surface`、`cardBackground`、`textPrimary`、`textSecondary`、`border`、`divider`

**状态颜色（4 + 2）**：`success`、`warning`、`error`、`disabled`，另加 `successSurface`、`errorSurface`（用于提示条底色，现状 `#ffd8cb`/`#ffe2d8` 等硬编码的替代）

**AI 相关（3 + 1）**：`aiGradientStart`、`aiGradientEnd`、`aiGlow`，另加 `aiGradientAngle`（`glass`/`dark` 需要不同角度）

**按钮（3 + 3）**：`buttonPrimary`、`buttonSecondary`、`buttonDisabled`��另加 `buttonPrimaryText`、`buttonSecondaryText`、`buttonRadius`

**卡片（3 + 2）**：`cardRadius`、`cardShadow`、`cardBlur`，另加 `cardBorder`（描边宽度与颜色的组合值）、`cardRadiusVariant`（不对称圆角，`cute` 用，其他主题回落为 `cardRadius`）

**页面（2 + 2）**：`pagePadding`、`sectionSpacing`，另加 `pageBottomSafe`（TabBar 让位高度，现状固定 `180rpx`）、`navBarBackground` / `navBarTextStyle`（供 `setNavigationBarColor` 使用，`navBarTextStyle` 取值限 `black` \| `white`）

**字体（3 + 3）**：`titleSize`、`bodySize`、`smallSize`，另加 `eyebrowSize`、`titleWeight`、`titleLetterSpacing`

**动效（2 + 2）**：`transitionDuration`、`animationType`，另加 `transitionEasing`、`glowAnimation`（是否开启光晕呼吸，布尔）

`animationType` 枚举：`bounce`（弹跳，`cute`）、`glow`（发光，`glass`）、`fade`（淡入淡出，`light`）、`neon`（霓虹，`dark`）。

合计 40 个语义 Token。`theme/tokens.js` 导出键名数组，`ThemeManager` 初始化时逐主题校验键完整性与取值类型，缺失或类型错误时抛出可定位的错误（开发期 `console.error` + 回落到 `cute` 对应键）。

### 3.4 硬编码禁令

页面与组件的 `.wxss` **禁止**出现：

- 十六进制颜色（`#RGB` / `#RRGGBB` / `#RRGGBBAA`）
- `rgb()` / `rgba()` 字面量
- 颜色关键字（`white`、`black`、`red` 等）
- 字面量圆角、阴影、间距、字号（必须走 token；`0`、`50%`、`999rpx`（完全胶囊）、`100%` 等纯结构值除外）

正确写法：

```css
.card { background: var(--card-background); border-radius: var(--card-radius); }
```

`app.wxss` 是唯一允许出现"变量兜底值"的文件（`var(--x, <fallback>)`），用于基础库不支持或注入失败时的降级；兜底值取 `cute` 主题对应值。

### 3.5 静态校验（新增门禁）

扩展 `scripts/validate.js`，`pnpm validate` 增加三项检查，任一失败即退出码 1：

1. **颜色硬编码扫描**：遍历除 `app.wxss` 外的全部 `.wxss`，命中禁令正则即报错，输出 `文件:行号:片段`。
2. **Token 完整性**：加载 4 套皮肤，逐一比对 `tokens.js` 键名清单，报告缺失/多余键。
3. **对比度校验**：对每套主题校验 `textPrimary` 对 `background`、`textPrimary` 对 `cardBackground`、`buttonPrimaryText` 对 `buttonPrimary` 的对比度不低于 4.5:1，`textSecondary` 对 `background` 不低于 3:1（半透明色按其在对应背景上的合成结果计算）。

现有两项校验（页面 4 文件齐备、JSON 可解析）保持不变。

---

## 4. 四套主题规格

四套主题必须在**底色、圆角、阴影语言、按钮形态、卡片材质、动效类型**六个维度上同时不同，不允许只换色相。

### 4.1 Theme 1：温馨可爱风 `cute`（默认）

**关键词**：宠物、陪伴、治愈、温暖。观感目标：像宠物朋友圈。

| Token | 取值 |
| --- | --- |
| `primary` | `#FF9FB5` |
| `secondary` | `#FFD166` |
| `background` | `#FFF8F2` |
| `surface` | `#FFFDFA` |
| `cardBackground` | `#FFFFFF` |
| `textPrimary` | `#3A2C2C` |
| `textSecondary` | `#8A7470` |
| `border` | `#F3DCD5` |
| `divider` | `#F7E7E1` |
| `success` / `warning` / `error` / `disabled` | `#4FB783` / `#F2A93B` / `#F06B5D` / `#D8CCC8` |
| `successSurface` / `errorSurface` | `#E8F7EE` / `#FDEBE7` |
| `aiGradientStart` / `aiGradientEnd` / `aiGlow` | `#FFB3C7` / `#FFD98A` / `rgba(255,159,181,.45)` |
| `buttonPrimary` / `buttonPrimaryText` | `#FF9FB5` / `#FFFFFF` |
| `buttonSecondary` / `buttonSecondaryText` | `#FFF1E6` / `#3A2C2C` |
| `buttonDisabled` | `#EFE4E0` |
| `buttonRadius` | `999rpx`（胶囊） |
| `cardRadius` / `cardRadiusVariant` | `24rpx` / `24rpx 24rpx 48rpx 24rpx` |
| `cardShadow` | `0 12rpx 32rpx rgba(214,150,150,.18)`（软阴影、轻微浮起） |
| `cardBlur` | `0`（不用玻璃） |
| `pagePadding` / `sectionSpacing` | `32rpx` / `48rpx` |
| `titleSize` / `bodySize` / `smallSize` | `48rpx` / `28rpx` / `22rpx` |
| `transitionDuration` / `animationType` | `240ms` / `bounce` |

**布局差异**：卡片可用不对称圆角（`cardRadiusVariant`）；头像全部圆形；玩法卡与空状态允许出现装饰元素（猫爪/狗爪、宠物贴纸）；hero 使用柔和渐变底而非硬描边投影。装饰元素以本地 SVG/PNG 资源实现，仅在 `cute` 主题下渲染（通过 `themeId === 'cute'` 判定），其他主题隐藏。

### 4.2 Theme 2：透明玻璃科技风 `glass`

**关键词**：AI、未来、科技、高级。观感目标：未来 AI 创作工具。

| Token | 取值 |
| --- | --- |
| `primary` | `#7C6BFF` |
| `secondary` | `#37D8F0` |
| `background` | `linear-gradient(160deg,#1B1B4F 0%,#221E68 45%,#101034 100%)` |
| `surface` | `rgba(255,255,255,.10)` |
| `cardBackground` | `rgba(255,255,255,.15)` |
| `textPrimary` | `#F4F5FF` |
| `textSecondary` | `rgba(244,245,255,.66)` |
| `border` | `rgba(255,255,255,.22)` |
| `divider` | `rgba(255,255,255,.14)` |
| `success` / `warning` / `error` / `disabled` | `#4BE3A2` / `#FFC24B` / `#FF6B81` / `rgba(255,255,255,.28)` |
| `successSurface` / `errorSurface` | `rgba(75,227,162,.16)` / `rgba(255,107,129,.18)` |
| `aiGradientStart` / `aiGradientEnd` / `aiGlow` | `#7C6BFF` / `#37D8F0` / `rgba(124,107,255,.55)` |
| `buttonPrimary` | `linear-gradient(120deg,#7C6BFF,#37D8F0)` |
| `buttonPrimaryText` / `buttonSecondary` / `buttonSecondaryText` | `#0B0B24` / `rgba(255,255,255,.12)` / `#F4F5FF` |
| `buttonDisabled` | `rgba(255,255,255,.14)` |
| `buttonRadius` | `28rpx` |
| `cardRadius` | `28rpx` |
| `cardShadow` | `0 16rpx 48rpx rgba(8,8,40,.45)` |
| `cardBlur` | `20px`（`backdrop-filter: blur(20px)`） |
| `pagePadding` / `sectionSpacing` | `32rpx` / `44rpx` |
| `titleSize` / `bodySize` / `smallSize` | `46rpx` / `28rpx` / `22rpx` |
| `transitionDuration` / `animationType` / `glowAnimation` | `280ms` / `glow` / `true` |

**布局差异**：全部卡片半透明 + 模糊；页面底为渐变（紫蓝→深蓝）；主行动按钮（"立即生成"、"支付解锁"）叠加渐变 + 阴影 + 光晕三层效果。

**降级要求**：`backdrop-filter` 在部分安卓 WebView / 低版本基础库不生效。必须提供降级：检测不支持时把 `cardBackground` 替换为不透明的近似色（`#2A2760`）��并把 `cardBlur` 置 `0`；降级判定结果缓存在 `ThemeManager`，不逐帧检测。

### 4.3 Theme 3：极简高级亮色 `light`

**关键词**：高级、专业、品牌感。参照 Apple / Linear / Notion。

| Token | 取值 |
| --- | --- |
| `primary` | `#111111` |
| `secondary` | `#2563EB`（accent） |
| `background` | `#FFFFFF` |
| `surface` | `#FAFAFA` |
| `cardBackground` | `#FFFFFF` |
| `textPrimary` | `#111111` |
| `textSecondary` | `#6B7280` |
| `border` | `#E5E7EB` |
| `divider` | `#F3F4F6` |
| `success` / `warning` / `error` / `disabled` | `#10804F` / `#B45309` / `#B42318` / `#D1D5DB` |
| `successSurface` / `errorSurface` | `#F0FDF4` / `#FEF2F2` |
| `aiGradientStart` / `aiGradientEnd` / `aiGlow` | `#2563EB` / `#7C3AED` / `rgba(37,99,235,.18)` |
| `buttonPrimary` / `buttonPrimaryText` | `#111111` / `#FFFFFF` |
| `buttonSecondary` / `buttonSecondaryText` | `#FFFFFF` / `#111111`（配 `border` 细边） |
| `buttonDisabled` | `#F3F4F6` |
| `buttonRadius` | `14rpx` |
| `cardRadius` | `16rpx` |
| `cardShadow` | `0 2rpx 8rpx rgba(17,17,17,.06)`（轻阴影 + 细边框） |
| `cardBlur` | `0` |
| `pagePadding` / `sectionSpacing` | `40rpx` / `64rpx`（大量留白） |
| `titleSize` / `bodySize` / `smallSize` | `44rpx` / `28rpx` / `22rpx` |
| `transitionDuration` / `animationType` | `180ms` / `fade` |

**布局差异**：减少装饰，不出现贴纸、印章、双线描边；卡片靠细边框而非阴影划分；分区靠留白而非分割线；`cute` 的装饰元素在此主题一律不渲染。

### 4.4 Theme 4：极简高级暗色 `dark`

**关键词**：高级、沉浸、夜间创作。参照 Apple Dark Mode / 摄影类应用。

| Token | 取值 |
| --- | --- |
| `primary` | `#8B7BFF` |
| `secondary` | `#5B8CFF` |
| `background` | `#0F1115` |
| `surface` | `#14171E` |
| `cardBackground` | `#181B22` |
| `textPrimary` | `#F5F6F8` |
| `textSecondary` | `#9BA3AF` |
| `border` | `#262A33` |
| `divider` | `#1E222A` |
| `success` / `warning` / `error` / `disabled` | `#3DD68C` / `#F5B547` / `#FF6A5E` / `#3A3F4A` |
| `successSurface` / `errorSurface` | `rgba(61,214,140,.14)` / `rgba(255,106,94,.16)` |
| `aiGradientStart` / `aiGradientEnd` / `aiGlow` | `#8B7BFF` / `#5B8CFF` / `rgba(139,123,255,.5)` |
| `buttonPrimary` / `buttonPrimaryText` | `#8B7BFF` / `#0F1115` |
| `buttonSecondary` / `buttonSecondaryText` | `#1E222A` / `#F5F6F8` |
| `buttonDisabled` | `#262A33` |
| `buttonRadius` | `16rpx` |
| `cardRadius` | `18rpx` |
| `cardShadow` | `0 8rpx 24rpx rgba(0,0,0,.5)` |
| `cardBlur` | `0` |
| `pagePadding` / `sectionSpacing` | `36rpx` / `56rpx` |
| `titleSize` / `bodySize` / `smallSize` | `44rpx` / `28rpx` / `22rpx` |
| `transitionDuration` / `animationType` / `glowAnimation` | `200ms` / `neon` / `true` |

**布局差异**：作品图片区域占比放大（图片卡取消内边距，图片贴边并压暗周边）；AI 生成相关控件加霓虹描边/外发光；导航栏文字为白色（`navBarTextStyle: white`）。

### 4.5 主题差异对照（验收依据）

| 维度 | cute | glass | light | dark |
| --- | --- | --- | --- | --- |
| 页面底 | 奶油暖色纯色 | 紫蓝渐变 | 纯白 | 近黑 |
| 卡片材质 | 白底 + 软阴影 | 半透明 + 模糊 | 白底 + 细边框 | 深灰底 + 深阴影 |
| 主圆角 | 24rpx（含不对称） | 28rpx | 16rpx | 18rpx |
| 按钮形态 | 胶囊 | 渐变发光 | 直角感小圆角 | 中圆角实色 |
| 装饰元素 | 有（爪印/贴纸） | 有（光晕/星点） | 无 | 极少（霓虹描边） |
| 动效 | bounce | glow | fade | neon |

---

## 5. 页面设计要求

### 5.0 通用规范（适用于全部 21 页 + 主题选择页）

**页面骨架**：每页统一为 `page-meta`（注入 token）+ `.page` 容器。`.page` 的内边距取 `var(--page-padding)`，底部预留 `var(--page-bottom-safe)`；TabBar 页额外加 `env(safe-area-inset-bottom)`。

**信息层级**：`eyebrow`（全大写英文小标，`--eyebrow-size`）→ `title`（`--title-size` / `--title-weight`）→ `muted`（说明文字，`--body-size` / `--text-secondary`）→ 内容区。分区间距统一 `var(--section-spacing)`，禁止逐页微调。

**状态四态**：每个有远程数据的页面必须显式覆盖 loading / empty / error / 正常四态，且四态都走主题化组件（`t-skeleton` / `t-empty` / `t-notice`），不再用裸文本"加载中…"。当前 `index`、`pets`、`works` 各自手写的加载与错误文案统一替换。

**按钮层级**：主行动（每屏最多 1 个）用 `t-button type="primary"`；次级用 `secondary`；破坏性操作（删除账户、删除档案、���闭分享、退订）用 `danger`；行内小操作用 `size="mini"` 的 `ghost`。禁止再使用原生 `type="primary"`。

**图片区**：所有宠物照片与作品图统一 `mode="aspectFill"` + `--card-radius` 圆角 + `--border` 细边（`glass` 主题下为半透明边）。图片加载中显示 token 化占位底色（`--surface`），失败显示 `t-empty` 的小尺寸变体。

**触控与反馈**：可点击元素最小可点区域 88rpx × 88rpx；点击态由 `animationType` 决定（bounce=缩放 0.96，glow=光晕增强，fade=不透明度 0.85，neon=描边亮度提升），时长取 `--transition-duration`。

**滚动与安全区**：长列表页（`works`、`photos`、`orders`、`memorials`、`commerce`）滚动到底部时内容不被 TabBar 或 Home Indicator 遮挡。

---

### 5.1 玩法首页 `pages/index/index`（TabBar 1）

现状：hero（`eyebrow` + 双行标题 + 说明 + 印章）+ "今天想把它变成什么？" + 玩法卡列表（`code`、价格、`name`、`tagline`、"开始制作 →"）。

要求：
1. **hero 主题化**：`cute` 用暖色渐变 + 爪印装饰 + 圆角不对称；`glass` 用玻璃卡叠在渐变底上 + 星点光晕；`light` 去掉装饰只留大字与留白；`dark` 用深底 + 作品缩略图作为背景（低透明度）。��有 `box-shadow: 14rpx 16rpx 0` 的硬投影只保留在 `cute`。
2. **`seal` 印章元素**改为主题条件渲染：`cute` 保留，`glass` 换为发光圆环，`light` / `dark` 不渲染。
3. **玩法卡**统一为 `t-card`：顶部左 `code` 徽标（`t-tag`）、右价格徽标（免费/¥N，`--secondary` 底），主区玩法名（`--title-size` 降一级）、副标题 `tagline`，底部行动条。价格徽标在 `glass` / `dark` 下用渐变底。
4. **首屏必须出现作品感**：玩法卡支持可选示例图（若接口无图则用 token 化占位渐变），避免纯文字列表的工具感。
5. loading 用 3 张骨架卡替代当前"玩法正在上架…"；error 用 `t-notice type="error"` 并提供"重试"。

### 5.2 创作流程 `pages/create/create`（四态单页）

现状：`stage` 在 `profile` / `photos` / `generating` / `result` 间切换，同页承载全部表单。

要求：
1. **加步骤指示器**：顶部 `t-steps`（档案 → 选照片 → 生成 → 完成），当前步高亮用 `--primary`，已完成用 `--success`。这是本页最主要的体验改造点，当前用户无法感知流程位置。
2. **表单区**统一 `t-field`（label 在上、控件在下），`picker` 触发区用 `t-select` 样式（右侧箭头 + `--border` 细边），消除现状 `input` / `.input` 两套底色。
3. **照片选择区**：历史照片与新增照片合并为一个九宫格，新增入口作为格内第一个"＋"瓦片（现状分成两个 grid + 一个虚线框，割裂）。选中态用 `--primary` 描边 + 右下角勾选徽标，不再用固定橙色。计数条（`已选 N / M`）常驻在网格下方，达上限时变 `--warning`。
4. **生成中态**：全屏居中进度视觉，进度数字用 `--title-size` 加大；动效按主题分化——`cute` 为爪印逐个点亮，`glass` 为光晕环旋转，`light` 为细线进度条，`dark` 为霓虹脉冲。排队位次与预计秒数作为副文本。上传进度（`uploadProgress`）与生成进度视觉上区分（两段式）。
5. **结果态**：作品图占据主视觉（宽度撑满、`--card-radius`），标题副标题居中，主按钮"查看、下载与分享"，次按钮"再做一个"（返回 `photos` 步）。
6. 错误条统一 `t-notice`，替换当前页内自定义 `.error`（左侧色条 + 浅底）。

### 5.3 作品柜 `pages/works/works`（TabBar 2）

现状：三个 `picker` 平铺 + 任务卡与作品卡混合的纵向列表。

要求：
1. **筛选区**改为横向可滚动 `t-filter-chip` 组（宠物 / 玩法 / 状态），选中态用 `--primary` 填充；点击弹出 `t-action-sheet` 选择，替代裸 `picker`。筛选区吸顶。
2. **列表改双列瀑布卡**（作品是图片内容，纵向单行列表浪费首屏）：卡内图片撑满宽、下方两行文字（玩法 code + 标题）、右上角状态角标（`待解锁` / `高清版` / `生成中 N%` / `失败`）。`dark` 主题下卡片间距收紧、图片占比更大。
3. **进行中任务**置顶为独立横向区块（`t-card` 变体，带进度条），失败任务卡内提供"重新尝试"次级按钮，用 `--error` 语义色而非固定橙。
4. `empty` 区分两种文案：无任何作品（引导去首页选玩法）与筛选无结果（提供"清空筛选"）。现状只有一种。

### 5.4 作品详情 `pages/work/work`

现状：预览（图或视频）+ 标题副标题 + 解锁/保存/下载 + 分享三按钮 + 历史版本按钮组。

要求：
1. **作品优先**：预览区顶到导航栏下沿，占据首屏 60% 以上；`dark` / `glass` 主题下预览区外的界面压暗，形成"看片"氛围。
2. **未解锁态**必须有明确的付费视觉：预览图加主题化蒙层（`cute` 柔和白纱 + 爪印水印；`glass` 磨砂 + 光晕；`light` 细网格 + 中央锁标；`dark` 压暗 + 霓虹锁标），主按钮"支付解锁高清"用 AI 渐变（`--ai-gradient-*`）+ 光晕，是全页唯一强视觉按钮。
3. **操作区**改为底部固定操作条（主按钮 + 图标次级操作：保存/分享/更多），替代当前竖排 4–5 个等宽按钮的按钮墙。分享的三种状态（未开启 / 已开启可重置 / 可关闭）收进"更多"的 `t-action-sheet`。
4. **历史版本**改为横向缩略图滚动条（每项显示 `v{N}` 与缩略图），当前版本高亮；替代现状 `size="mini"` 按钮串。
5. 视频作品用 `t-video` 包装，控件条颜色按主题（亮色主题控件深色、暗色主题控件浅色）。

### 5.5 订单与退款 `pages/orders/orders`

现状：金额 + 状态英文原文 + 退款按钮。

要求：
1. 每单一张 `t-card`：左侧金额（`--title-size` 降一级）、右侧状态 `t-tag`。**状态必须中文化并映射语义色**：`paid` → 已支付（`--success`）、`pending` → 待支付（`--warning`）、`refunded` → 已退款（`--text-secondary`）、`failed` → 支付失败（`--error`）。当前直接渲染英文状态码，属于体验缺陷，本期一并修正（纯展示层映射，不动接口）。
2. 退款为破坏性操作：改用 `t-button type="danger" size="mini"`，点击先弹 `t-dialog` 二次确认，说明"退 50%"规则。
3. 补 empty 态（无订单时引导去首页）与 error 态；现状 error 是裸文本。

### 5.6 我的 `pages/me/me`（TabBar 3）

现状：标题 + 额度/退款面板 + 通知面板 + 8 个入口行挤在一个 panel 内。

要求：
1. **顶部账户卡**：头像（圆形，取默认宠物头像或占位）+ 显示名 + 会员标识；`glass` / `dark` 下用渐变或霓虹描边。
2. **额度可视化**：今日免费额度改为 `t-progress` 环形或条形（已用/总量），配文字；替代当前 `3 / 5` 纯文本行。额度耗尽时用 `--warning`。
3. **通知**：最多展示 2 条，超出显示"查看全部"；每条带未读点（`--primary`）。
4. **8 个入口分三组**（创作：AI/互动/视频、纪念空间；资产：订单、宠物档案、照片库；账户：会员与年度报告、账户与隐私、登录与退出），组间用 `--section-spacing` 分隔，组内用 `--divider`。每行左侧图标 + 标题，右侧箭头；破坏性入口（退出登录）单独置底并用 `--error` 文字色。当前 8 行等权重平铺，找不到重点。
5. 入口图标需 4 套主题都清晰：使用单色图标 + `--text-primary` 着色，不用彩色位图。

### 5.7 宠物档案 `pages/pets/pets`

现状：编辑表单（头像 + 5 个字段）与档案列表同页，列表行内挤 3 个 `mini` 按钮。

要求：
1. 编辑表单改为 `t-popup` 半屏弹层（从底部升起），不与列表同屏堆叠；弹层内字段统一 `t-field`，头像区居中且圆形（`cute` 加爪印边框）。
2. 列表每项一张 `t-card`：左头像、中名字 + 物种/日期、右默认标记；`isDefault` 用 `t-tag` 而非文字。
3. 三个操作（编辑/设为默认/删除）改为右滑操作或"更多"菜单，行内只保留主操作，消除按钮墙。删除走 `t-dialog` 二次确认。
4. `lifeStage === 'memorial'`（纪念档案）需有区别于普通档案的视觉：卡片降饱和 + 纪念标识，四套主题下都保持克制（不用亮色标签）。
5. 现状自定义 `.error` / `.notice` 两个提示块统一为 `t-notice`。

### 5.8 照片库 `pages/photos/photos`

现状：宠物 `picker` + 九宫格 + 每图下方一个"删除"按钮。

要求：
1. 宠物切换改为顶部横向 `t-tab`（宠物头像 + 名字），替代 `picker`。
2. 九宫格间距用 token；图片正方形裁切、`--card-radius`。
3. 删除按钮从每格常驻改为**批量管理模式**：右上角"管理"进入选择态，勾选后底部出现"删除所选"（`danger`）。当前每张图下挂一个按钮，视觉噪音大且易误触。
4. 空态引导"去创作时上传照片"，并说明照片来源。
5. 点击图片进入全屏预览（`wx.previewImage`），当前无预览能力。

### 5.9 账户与隐私 `pages/account/account`

现状：一个输入框 + 三个按钮（保存资料 / 导出数据 / 删除账户）垂直堆叠，删除账户与保存同权重。

要求：
1. 资料区一张 `t-card`：显示名 `t-field` + "保存"主按钮。
2. **数据与隐私区**独立分组：导出数据用 `secondary`；��除账户置于页面最底部的"危险区"（`--error` 描边卡 + 说明文案 + `danger` 按钮 + `t-dialog` 二次确认，确认文案需说明不可恢复）。
3. 操作结果统一 `t-notice`，替换现状裸 `message` 文本。

### 5.10 创作方式选择 `pages/growth/growth`

现状：三张卡（PL-10 / PL-15 / PL-19），仅编号 + 标题 + 说明。

要求：
1. 三卡改为**大图入口卡**：每卡带能体现玩法结果的主题化视觉（AI 肖像=四宫格示意、互动页=星尘渐变、视频=胶片条），高度不等分以形成节奏。
2. 编号（PL-10 等）作为 `t-tag` 弱化处理，不作为主视觉；当前编号是内部编码，用户不关心。
3. `glass` / `dark` 主题下三卡使用 AI 渐变边框，强化"创作"氛围。

### 5.11 AI 四选一参数 `pages/ai-create/ai-create`

现状：宠物 `picker` + 照片九宫格 + 玩法/风格/提示词方向三个 `picker` + 自定义提示词 `textarea` + 生成按钮。

要求：
1. **玩法与风格改为可视化选择**：横向卡片选择器（缩略示意图 + 名称），替代文字 `picker`。风格是本页最影响结果的选项，必须可预览。
2. 提示词方向用 `t-chip` 单选组；选"自己描述"时展开 `textarea`（带 1000 字计数）。
3. 照片选择区与 5.2 第 3 条统一实现（同一组件）。
4. 生成按钮为 AI 主行动：渐变 + 光晕（`--ai-*`），禁用态取 `--button-disabled`；按钮上标注消耗额度或价格。
5. 未选照片时的引导按钮"先去上传照片"改为空态组件内的行动，避免与主按钮并列。

### 5.12 AI 任务与四选一 `pages/ai-run/ai-run`

现状：queued/processing/failed/cancelled/succeeded 五态；成功态为 2×2 候选网格 + 解锁 + 重抽。

要求：
1. **等待态**：圆形进度视觉主题化（���状 `state-no` 是固定虚线绿圆）；展示排队位次或尝试次数、预计秒数、Provider 提示；"取消任务"为 `ghost` 次级按钮。四主题动效分别为 bounce / glow / fade / neon。
2. **四选一网格**是本页核心：2×2 等分，图片正方形，选中态用 `--primary` 粗描边 + 角标序号 + 轻微抬升；现状固定 `#fff1b7` 底 + `8rpx 9rpx 0 #f56643` 硬投影只保留在 `cute`。支持点击放大预览。
3. 候选卡右下角显示序号 `01`–`04`；已选中并归档的状态文案保留。
4. **底部固定操作条**：主按钮"支付解锁选中结果"（AI 渐变），次按钮"重抽一组（剩 N）"，剩余 0 次时禁用并说明。解锁后追加"保存高清图 / 创建分享 / 查看作品档案"三项，收进操作条的次级区，不再垂直堆四个按钮。
5. 失败态展示 `errorCode` 时需人类可读映射，并保留"恢复并重试"主按钮；取消态说明"未产生订单或权益扣减"。
6. `message` 提示条统一 `t-notice`。

### 5.13 互动页创建 `pages/interactive-create/interactive-create`

现状：宠物 + 照片（1–6）+ 标题 + 文案 + 主题 `picker` + 实时预览卡 + 创建按钮。

要求：
1. **实时预览必须保留并强化**：预览卡是本页价值所在，改为固���比例（3:4）卡片，随标题/文案/主题输入即时更新。
2. 互动页自身的三种场景主题（深夜星尘 / 清晨草地 / 暖色日落）是**内容主题，与全局 UI 主题相互独立**，不得混用同一套 token。场景主题的渐变值单独放在 `theme/scene-presets.js`，不参与全局主题切换；文档与代码注释需明确这一区分（当前 `.theme-stardust` 等类名与全局主题概念易混淆，需重命名为 `.scene-stardust`）。
3. 场景主题选择改为三个色卡预览（显示实际渐变），替代文字 `picker`。
4. 标题 60 字、文案 180 字上限显示计数。
5. 预览卡内文字颜色需依据场景渐变自动取深/浅，保证对比度（现状固定 `#fff`）。

### 5.14 互动页编辑与分享 `pages/interactive/interactive`

现状：编辑面板 + 场景卡（可点击收集星尘）+ 星尘计数 + 分享/撤销/导出 MP4/查看作品四个按钮；`publicMode` 时只展示场景。

要求：
1. **编辑态与预览态分离**：默认进入预览态（只见场景卡与"收集星尘"），编辑入口收在右上角，点击后从底部升起 `t-popup` 编辑面板。现状编辑面板常驻在场景卡上方，把核心互动挤到下半屏。
2. **星尘互动反馈**：点击场景卡时在点击位置生成星尘粒子动画，计数用数字滚动过渡；动效强度按 `animationType` 分级（`fade` 主题下最克制）。
3. `publicMode`（访客通过分享链接进入）必须隐藏全部编辑与运营入口，只保留场景与星尘互动；访客态使用**固定的默认全局主题**（`cute`），不读取访客本地主题偏好，保证分享观感一致（详见 9.4）。
4. 分享/撤销/导出四个操作收进底部操作条 + `t-action-sheet`；导出中显示进度百分比并禁用重复提交。
5. 场景卡的不对称圆角与硬投影只在 `cute` 主题保留，其余主题按各自卡片语言渲染。

### 5.15 视频项目创建 `pages/video-create/video-create`

现状：宠物 + 项目名 + 片尾字幕 + BGM `picker` + 照片九宫格（多选）+ 创建按钮。

要求：
1. **照片顺序可见且可调**：视频依赖照片顺序，选中态必须显示序号（1、2、3…）而非仅"已选"，并支持长按拖动排序。这是当前最关键的功能性视觉缺失。
2. BGM 选择改为列表项 + 试听按钮（若资源支持），替代文字 `picker`；"无音乐"作为默认项。
3. 项目名与片尾字幕用 `t-field`；字幕给出字数上限提示。
4. 创建按钮显示已选张数，并在少于最小张数时禁用 + 说明。

### 5.16 视频渲染与字幕 `pages/video/video`

现状：状态 `eyebrow` + 标题 + 进度条 + 字幕 `textarea` + 5 个操作按钮平铺。

要求：
1. **进度条主题化**：轨道 `--divider`、填充 `--primary`（`glass` / `dark` 用 AI 渐变 + 光晕）；渲染中显示百分比数字与状态文案（排队 / 渲染中 / 成功 / 失败）。现状固定橙色填充。
2. 渲染成功后在页面顶部显示成片预览（`t-video`），而非仅一个"查看作品与解锁"按钮。
3. **按钮按状态互斥显示**，只留当前可用的 1 个主操作 + 1 个次操作：草稿态=保存/提交渲染；进行中=取消；失败=重试；成功=查看作品。现状 5 个按钮同屏平铺且部分互斥。
4. 字幕编辑区用 `t-textarea`，聚焦时高亮边框（`--primary`）。

### 5.17 纪念空间 `pages/memorials/memorials`

现状：创建表单（宠物 picker + 标题 + 故事 + 照片网格）与已有空间列表同页；每个空间行内挂 4 个 `mini` 按钮（纪念册/纪念视频/星尘页/隐藏）。

要求：
1. **情绪基调优先**：本页在四套主题下都必须降低饱和度与装饰强度——`cute` 不出现爪印贴纸与跳跃动效，`glass` 降低光晕强度，动效统一降级为 `fade`。这是硬性约束，不随 `animationType` 变化。
2. 创建入口改为顶部"新建纪念空间"按钮 → `t-popup` 表单，与列表分离。
3. 列表每项一张 `t-card`：标题 + 主题 + 生命周期状态（`t-tag`：正常/已隐藏）+ 可见性（私密/公开）。状态与可见性需中文化。
4. 三个衍生品操作（纪念册/纪念视频/星尘页）收进卡内"生成纪念物"的 `t-action-sheet`；"隐藏/恢复"作为卡右上角的更多菜单项。消除 4 按钮平铺。
5. 无留言、无排名、无营销弹窗的既有约束保持不变，并在本页样式上禁止使用促销类视觉（价格红标、倒计时、闪动）。

### 5.18 纪念空间分享页 `pages/memorial-share/memorial-share`

现状：标题 + 宠物名 + 只读照片双列 + 故事文本 + 一句说明。

要求：
1. 访客页固定使用默认主题（`cute`）的克制变体，不读取访客本地主题（同 9.4）；页面不出现主题切换入口。
2. 排版以阅读为主：故事文本行高 ≥1.8、`--body-size`、两侧留白加大；照片双列改为按原始比例的纵向流，保留完整构图（不裁切）。
3. 顶部导航栏背景与页面一致，标题为空间名。
4. 加载态用骨架屏，失败态用 `t-empty`（文案："这个纪念空间可能已关闭分享"），替代现状裸 `.error` 文本。
5. 不出现任何商业转化入口、留言与排名。

### 5.19 会员与年度报告 `pages/commerce/commerce`

现状：一个 `navigator` 文本链 + 4 个按钮一行（月会员/年会员/订阅提醒/生成年度报告）+ 三段列表（会员/订阅/报告）。

要求：
1. **会员改为方案对比卡**：月会员 ¥25 / 年会员 ¥199 两张并列卡，年卡标注推荐与折算优势（`t-tag`）；卡内列权益要点。当前 4 按钮一行无法承载付费决策。
2. 已有会员状态卡显示当前方案、状态、额度进度（`t-progress`：`used/quota`）。
3. 订阅提醒与年度报告各自独立分区，用 `--section-spacing` 分隔；订阅项右侧"退订"为 `ghost danger`，需二次确认。
4. 年度报告项显示年份 + 预览版/高清版 `t-tag`，未解锁时"支付解锁"用 AI 渐变按钮。
5. "进入实体纪念品订单"的裸 `navigator` 文本改为标准入口行（图标 + 标题 + 箭头）。
6. 状态字段（`status`、`event_type`）中文化映射。

### 5.20 实体纪念品下单 `pages/physical/physical`

现状：作品 `picker` + 用 `wx:for` 循环生成的 5 个输入框（placeholder 直接是 `name`/`phone`/`province` 等英文字段名）+ 下单按钮 + 订单列表。

要求：
1. **收货表单必须显式化**：五个字段改为独立 `t-field`，中文 label 与占位（收货人、手机号、省份、城市、详细地址），手机号用 `type="number"`。现状把英文字段名当占位文案，属明确缺陷，本期修正（仅改展示与 label，提交字段名不变）。
2. 作品选择改为缩略图选择器（横向滚动，显示已解锁作品的图与标题），替代文字 `picker`；无可选作品时显示空态并引导先解锁作品。
3. 下单按钮显示金额（¥39.90）并在提交中显示 loading；提交前用 `t-dialog` 确认收货信息摘要。
4. 订单列表每项显示 SKU、状态（中文化）、物流单号或"等待履约"，状态用 `t-tag` 语义色。

### 5.21 登录/注册 `pages/login/login`

现状：模式切换两个 `mini` 按钮 + 账号/密码/昵称/邀请码字段 + 提交按钮；已登录时显示退出。

要求：
1. 顶部品牌区：Logo/宠物插画（`cute` 用插画，`light` / `dark` 用文字标识，`glass` 用发光标识）+ 一句价值说明。
2. 登录/注册切换改为 `t-segment` 分段控件，替代两个按钮。
3. 字段用 `t-field`；密码域带显示/隐藏切换；注册态的密码规则（至少 10 位含字母和数字）常驻为帮助文案而非仅占位。
4. 邀请码字段仅在 `inviteRequired` 时出现，并说明来源。
5. 环境不支持账号密码登录时（`!enabled`），用 `t-notice` 说明并突出微信登录路径。
6. 已登录态：显示当前账号 + "返回首页"主按钮 + "退出登录"（`danger ghost`）。
7. `message` 统一 `t-notice`，区分成功/失败语义色。

### 5.22 主题选择页 `pages/theme/theme`（新增）

见第 6 章。

### 5.23 页面改造优先级

| 批次 | 页面 | 依据 |
| --- | --- | --- |
| P0 | `index`、`create`、`works`、`work`、`me` + `custom-tab-bar` | 主链路与 TabBar，覆盖 80% 使用时长 |
| P1 | `ai-create`、`ai-run`、`growth`、`theme`（新增） | AI 创作链路 + 主题入口 |
| P2 | `interactive-create`、`interactive`、`video-create`、`video`、`memorials`、`memorial-share` | 增值玩法与分享落地 |
| P3 | `pets`、`photos`、`orders`、`account`、`commerce`、`physical`、`login` | 配置与交易类 |

每批次结束后必须四套主题全量走查，不允许跨批次积压视觉债。

---

## 6. 主题切换功能与主题选择页

### 6.1 ThemeManager 接口

`theme/manager.js` 导出单例，接口如下（签名为需求约定，实现不得改变语义）：

| 方法 | 说明 |
| --- | --- |
| `getThemeId()` | 返回当前主题 id（`cute` \| `glass` \| `light` \| `dark`） |
| `getTheme()` | 返回当前主题的完整 token 对象（已应用降级） |
| `getCssVars()` | 返回可直接给 `page-style` 的 CSS 变量字符串 |
| `listThemes()` | 返回 4 项元信息（id、name、description、预览用取色） |
| `setTheme(id)` | 切换主题：校验 id → 写内存 → 写缓存 → 更新导航栏 → 广播订阅者；非法 id 直接忽略并告警 |
| `subscribe(fn)` | 注册变更回调，返回取消订阅函数 |
| `init()` | `app.onLaunch` 调用：读缓存 → 校验 → 落 `globalData.themeId` → 探测 `backdrop-filter` 支持度 |

### 6.2 持久化

- 缓存键 `petbaby_theme`，值为主题 id 字符串，使用 `wx.setStorageSync`。
- 与既有键（`petbaby_session`、`petbaby_session_source`）并列，不复用、不嵌套。
- 缓存缺失、值非法、读取异常时一律回落 `cute`，并覆写为合法值。
- 退出登录**不清除**主题偏好（主题是设备级偏好，非账号数据）；`wx.clearStorage` 类操作若存在需白名单保留该键。
- 主题偏好不上传服务端，不进入数据导出/删除流程（不属于个人数据）。

### 6.3 全局注入与即时生效

1. `app.js` 的 `onLaunch` 首先调用 `ThemeManager.init()`，早于 `wx.login`，确保首屏无闪色。`globalData` 新增 `themeId`。
2. 每个页面 wxml 顶部统一：
   ```xml
   <page-meta page-style="{{themeStyle}}">
     <navigation-bar background-color="{{navBg}}" front-color="{{navFront}}" />
   </page-meta>
   ```
   `themeStyle` / `navBg` / `navFront` 由公共页面混入（`theme/page-mixin.js`）在 `onLoad` 注入，并在 `subscribe` 回调中 `setData` 更新。页面业务代码不手写主题逻辑。
3. **已打开页面栈全部更新**：切换时通过 `getCurrentPages()` 对每个页面实例触发混入的更新方法，保证返回上级页面时不残留旧主题（仅依赖 `onShow` 会导致栈内页面短暂闪色，不满足要求）。
4. **自定义 TabBar 单独处理**：`custom-tab-bar` 订阅 ThemeManager，在回调中 `setData` 自身的 style 字符串（组件不在 page 节点下，无法继承 `page-style` 注入的变量）。
5. **导航栏**：切换时调用 `wx.setNavigationBarColor({ backgroundColor: navBarBackground, frontColor: navBarTextStyle === 'white' ? '#ffffff' : '#000000' })`。`app.json` 的静态 `navigationBarBackgroundColor` 保留为 `cute` 取值作为冷启动兜底。
6. **切换过渡**：切换瞬间允许 `--transition-duration` 的颜色过渡，不允许出现白屏、闪黑或整页重载。
7. 切换不触发任何网络请求，不重置页面数据与滚动位置，不影响进行中的上传或生成任务。

### 6.4 主题选择页

路径 `pages/theme/theme`，追加到 `app.json` 的 `pages` 末尾（不改动既有顺序），入口在"我的 → 账户组 → 外观主题"。

要求：
1. 四张预览卡（2×2 网格），**每张卡用该主题自身的 token 渲染**（真实底色、真实卡片材质、真实按钮样式、真实圆角），不是纯色块。卡内含缩略版"标题 + 一段说明 + 一个主按钮 + 一个标签"，让用户直接看出差异。
2. 当前主题卡显示选中态（勾选角标 + `--primary` 描边）。
3. 点击即时切换（无需"保存"按钮），切换后本页与 TabBar 立即随之变化——本页是切换效果的最佳演示场��
4. 每张卡下方一行主题名 + 一句描述：温馨可爱（陪伴治愈）、玻璃科技（AI 未来感）、极简亮色（专业克制）、极简暗色（夜间沉浸）。
5. `glass` 卡在降级设备上需展示降级后的实际效果，不做虚假预览。
6. 页面提供一句说明："主题只影响本设备的显示，不影响已生成的作品。"

---

## 7. 公共组件要求

当前仓库无 `components/` 目录，需新建。所有组件为微信自定义组件，`styleIsolation` 取默认 `isolated`，主题变量通过页面根节点继承进入（`page-meta` 注入在 page 上，组件内可读 `var(--*)`）。组件自身 `.wxss` 同样受第 3.4 节硬编码禁令约束。

| 组件 | 目录 | 关键要求 |
| --- | --- | --- |
| `t-button` | `components/button` | `type`: primary / secondary / ghost / danger；`size`: normal / mini；支持 `loading`、`disabled`、`block`；primary 在 `glass`/`dark` 下自动叠加 AI 渐变与光晕；替换全部原生 `type="primary"` |
| `t-card` | `components/card` | `variant`: default / image / glass；自动应用 `--card-radius` / `--card-shadow` / `--card-blur` / `--card-border`；`cute` 下支持 `cardRadiusVariant` |
| `t-navbar` | `components/navbar` | 自定义导航栏（返回 + 标题 + 右侧插槽），与 `--nav-bar-background` 一致；用于需要沉浸式的页面（`work`、`interactive`、`memorial-share`） |
| TabBar | `custom-tab-bar`（改造） | 订阅 ThemeManager；`cute` 胶囊悬浮、`glass` 玻璃条、`light` 细边白底、`dark` 深底霓虹指示；选中项用 `--primary` |
| `t-dialog` | `components/dialog` | 标题 + 正文 + 取消/确认；`danger` 变体用于破坏性确认；遮罩透明度按主题 |
| `t-popup` | `components/popup` | 底部升起半屏容器，圆角取 `--card-radius`，用于表单弹层与操作面板 |
| `t-action-sheet` | `components/action-sheet` | 操作列表，破坏性项用 `--error` |
| `t-loading` | `components/loading` | 加载指示，形态按 `animationType`（bounce 爪印 / glow 光环 / fade 细线 / neon 脉冲） |
| `t-skeleton` | `components/skeleton` | 骨架屏，底色 `--surface`，微光扫过按主题开关 |
| `t-empty` | `components/empty` | 插画 + 说明 + 可选行动按钮；`cute` 用宠物插画，`light`/`dark` 用线性图标 |
| `t-notice` | `components/notice` | `type`: info / success / warning / error；底色取对应 `*Surface`，左侧色条取语义色；替换现有 4 处自定义错误块 |
| `t-tag` | `components/tag` | 状态徽标，语义色 + 弱化底；用于订单、作品、会员、纪念空间状态 |
| `t-field` | `components/field` | label + 控件 + 帮助/错误文案；统一 `input` / `textarea` / select 触发区外观 |
| `t-progress` | `components/progress` | 条形与环形两种；填充在 `glass`/`dark` 下用 AI 渐变 |
| `t-steps` | `components/steps` | 流程指示，用于 `create` 页 |
| `t-photo-grid` | `components/photo-grid` | 照片九宫格 + 选择态 + 序号 + "＋"入口 + 长按排序；被 `create` / `ai-create` / `interactive-create` / `video-create` / `photos` / `memorials` 复用 |

组件禁止固定颜色。反例与正例：

```css
/* 错误 */ .card { background: white; }
/* 正确 */ .card { background: var(--card-background); }
```

组件需在四套主题下逐一走查，产出对照截图作为交付物。

---

## 8. 技术实现要求

1. **技术栈不变**：微信原生小程序 + 原生 JS，无构建、无预处理器、无第三方 UI 库。
2. **不做大规模重写**：按第 5.23 节批次渐进改造；每批次只动样式层与结构包装，不重写页面 JS 的数据流。
3. **不影响数据逻辑**：`services/api.js`、各页 `Page` 的 `data` 字段名、事件处理函数名与调用顺序保持不变。允许新增视觉相关的 `data` 字段（如 `themeStyle`）与展示映射函数（如状态中文化），不允许改动提交给接口的字段与取值。
4. **基础库要求**：最低 2.9.0（`page-meta`）；`project.config.json` 需声明并在 `docs/delivery/03-miniprogram-release.md` 记录。低于该版本时 `app.wxss` 的 `var()` 兜底值生效，页面以 `cute` 外观运行且不崩溃。
5. **包体约束**：新增 theme 与 components 后主包体积增量不超过 300KB；装饰类图片资源优先内联 SVG 或使用远端 CDN，不进主包。
6. **性能约束**：主题切换端到端（点击到全部可见节点完成变色）不超过 300ms；切换过程不产生 `setData` 大对象（每次注入的 CSS 变量字符串控制在 2KB 内）；`page-mixin` 的订阅需在 `onUnload` 取消，防止内存泄漏。
7. **兼容性**：iOS / Android 真机各至少一台，覆盖 `glass` 的 `backdrop-filter` 支持与降级两种情况。
8. **代码风格**：遵循 `AGENTS.md`；token 键名 camelCase，CSS 变量 kebab-case，组件目录小写连字符。

---

## 9. 边界与约束决策

以下为需求原文未覆盖、但实现前必须确定的点。均已给出决策，如评审有异议在此处修订。

### 9.1 默认主题与首次进入

新用户默认 `cute`。冷启动读缓存在 `onLaunch` 完成，首屏不出现主题闪变。

### 9.2 主题是设备级偏好

不随账号同步，不上传服务端，换设备不继承。理由：无需为纯外观偏好增加接口与迁移成本，且本期明确不动接口契约。

### 9.3 场景主题与 UI 主题隔离

互动页的三种场景主题（星尘/草地/日落）是**内容属性**，属于作品数据，全局 UI 主题切换不得改变已创建互动页的场景外观。命名上必须区分（`scene-*` 与 `theme-*`），避免后续误改（见 5.13）。

### 9.4 分享落地页的主题

`memorial-share`、以及 `interactive` 的 `publicMode` 访客视图固定使用默认主题（`cute`）的克制变体。理由：分享给他人的内容观感必须由内容而非访客本地偏好决定；同时避免访客首次进入时因无缓存而闪色。

### 9.5 纪念场景的动效降级

`memorials`、`memorial-share` 与纪念类作品详情强制 `fade` 动效、禁用装饰贴纸与促销视觉，覆盖当前主题的 `animationType`。这是产品调性硬约束，不作为可配置项。

### 9.6 系统深色模式

本期不自动跟随。`ThemeManager` 预留 `auto` 模式的扩展位（不实现、不在 UI 暴露），后续如接入则映射 `light` / `dark`。

### 9.7 主题数量的扩展

新增主题 = 新增 `theme/themes/<id>.js` + 在 `listThemes()` 注册，不改任何页面。主题选择页的网格需能容纳 4 项以上（超过 4 项时改为可滚动网格）。

### 9.8 与既有硬编码的处置

现有 102 处字面量全部迁移为 token 引用，不保留兼容旧值的开关。迁移期间以第 3.5 节的静态校验作为回归门禁。

---

## 10. 与 Web 端的关系

`apps/platform`（Next.js）本期不改造。为避免两端设计语言分叉，约定：

1. 本期产出的 Token 键名与语义为**跨端唯一标准**，后续 Web 端接入时复用同一套键名（映射到 CSS 变量或 Tailwind theme）。
2. Web 端接入前，`apps/platform` 的样式改动不得引入与本文档冲突的新语义命名。
3. 分享落地页（Web 侧的 `/share`、`/memorial/share`、`/interactive/share`）与小程序端分享页的视觉需在 Web 接入时对齐 `cute` 默认外观。

---

## 11. 交付阶段与产出物

每阶段结束需可独立验证，`pnpm validate` 全绿方可进入下一阶段。

| 阶段 | 内容 | 产出物 | 出口条件 |
| --- | --- | --- | --- |
| Phase 1 | 现状分析与方案确认 | 本文档第 2 章（已完成实测：21 页清单、102 处硬编码、注入方案选型） | 需求评审通过 |
| Phase 2 | Theme System 基建 | `theme/tokens.js`、`theme/manager.js`、`theme/index.js`、`theme/page-mixin.js`、`app.wxss` 重写为变量映射、`scripts/validate.js` 三项新校验 | 一套主题（`cute`）跑通注入 + 校验脚本可用 |
| Phase 3 | 四套主题皮肤 | `themes/cute.js`、`glass.js`、`light.js`、`dark.js`；`glass` 降级逻辑；对比度校验通过 | 四套主题 token 完整、切换可用、TabBar 与导航栏同步 |
| Phase 4 | 公共组件 + 页面改造 | `components/` 16 个组件；21 页按 5.23 批次改造；主题选择页 | 全部页面零硬编码、四套主题走查通过 |
| Phase 5 | 动效、交互与细节 | 四套动效实现、点击反馈、骨架屏、空/错态、真机适配、四套主题全页截图集 | 第 12 章验收标准全部满足 |

Phase 1 完成后需**等待确认**再进入 Phase 2；Phase 2 起可连续执行，每阶段结束提交一次可运行版本。

---

## 12. 验收标准

功能性：

1. 用户可在主题选择页自由切换 4 套主题，点击即生效。
2. 切换后**所有已打开页面**（含页面栈内的上级页面）、TabBar 与导航栏立即变化，返回上级不残留旧主题。
3. 主题偏好在杀进程重启、重新登录后仍保持。
4. 切换过程不产生网络请求，不中断进行中的上传/生成/渲染任务，不重置页面数据与滚动位置。

代码质量：

5. 全部 `.wxss`（除 `app.wxss` 的 `var()` 兜底）零颜色硬编码，`pnpm validate` 的三项新校验通过。
6. 四套主题各自 40 个 token 完整，无缺键、无类型错误。
7. 所有公共组件与 21 个页面均无固定颜色，原生 `type="primary"` 按钮已全部替换。

视觉质量：

8. 四套主题在底色、卡片材质、圆角、按钮形态、装饰元素、动效六个维度均可区分（对照第 4.5 节表）。
9. 每套主题的文字对比度满足第 3.5 节阈值。
10. 达到可商业上线的完成度：无错位、无溢出、无低对比度不可读区域、无未处理的加载/空/错状态。
11. 第 5 章逐页要求全部落地，包括 `create` 的步骤指示器、`works` 的双列卡、`work` 的未解锁蒙层与底部操作条、`video-create` 的照片序号排序、`orders`/`physical` 的中文化与字段修正、`memorials` 的情绪降级。
12. 装饰与动效在纪念相关页面按 9.5 强制降级。

兼容性：

13. iOS 与 Android 真机各验证一台；`glass` 主题的模糊生效与降级两种表现均可用。
14. 基础库低于 2.9.0 时以 `cute` 外观正常运行，不崩溃、不白屏。

交付物：

15. 四套主题 × 全部页面的走查截图集，随 Phase 5 一并提交。
16. `docs/delivery/03-miniprogram-release.md` 补充基础库版本要求；本文档随实现同步更新差异。

---

## 13. 执行前置

开始编码前必须先完成 Phase 1 的分析确认（第 2 章已给出实测结论），评审通过后再动代码。改造过程中如发现本文档与实际代码冲突，以代码实测为准并回写本文档，不得静默偏离。

---

## 14. 实现差异记录

实现过程中与本文档正文不一致的决策，逐条记录在此，正文保持原判不改写。

| # | 文档原定 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 1 | 导航栏跟随主题（7 章 `t-navbar`） | 导航栏底色与字色走 `wx.setNavigationBarColor`，在 `page-mixin` 的 `onShow` 同步；`t-navbar` 只用于需要沉浸式的页面 | `<navigation-bar>` 组件需基础库 2.29.2，与 8.4 的 2.9.0 下限冲突 |
| 2 | 组件目录名 `GlassBottomSheet.vue`（`theme-2.md` 七章） | 尚未实现；玻璃蒙层需求（`theme-2.md`）不在本期范围 | 本期只交付 Theme System，沉浸式蒙层作为后续需求单独排期 |
| 3 | 5.11 / 5.21 提到的 `t-chip`、`t-segment` | 未新增为公共组件，由 `ai-create` / `login` 页内实现，样式仍只读 token | 第 7 章组件表未登记这两个组件；仅两处使用，抽取收益低于维护成本 |
| 4 | 5.13-2 场景主题类名 `.theme-stardust` | 重命名为 `.scene-*`，取值集中在 `theme/scene-presets.js`，以内联 style 注入 | 与全局 UI 主题概念隔离，避免 token 与内容属性混用 |
| 5 | 3.3 token 清单 | 实际 45 个 token（正文分组合计 40，实现中补齐 `successSurface`/`errorSurface`/`cardRadiusVariant`/`transitionEasing`/`glowAnimation` 等派生所需键） | 组件层需要成对的语义底色与动效开关，缺这些键会退回硬编码 |
| 6 | 5.20 收货地址 | 仅改 label 与占位为中文，提交字段名沿用 `name`/`phone`/`province`/`city`/`detail` | 8.3 要求不改动提交给接口的字段与取值 |

尚未完成（Phase 5 剩余）：四套主题 × 全部页面的走查截图集、iOS/Android 真机各一台的兼容性验证，两项都依赖真机与开发者工具，需人工执行。

