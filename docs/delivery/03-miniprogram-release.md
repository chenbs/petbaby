# 微信小程序调试、上传与发布手册

更新：2026-08-18 ｜ 目标读者：第一次上传/发布微信小程序的人 ｜ 目录：`apps/miniprogram/`（26 页：主包 23 + `island` 分包 3）

后端部署见 [`02-deployment-guide.md`](02-deployment-guide.md)。小程序不含业务逻辑，所有规则由 `apps/platform` 的 API 执行，因此**必须先有一个可访问的 HTTPS 后端**。

---

## 0. 先搞清楚三件事

**一、"上传"不等于"发布"。** 微信小程序的完整链路是：

```
本地代码
  │ ① 开发者工具「预览」→ 开发版，扫码只有开发者自己能看
  │ ② 开发者工具/CI「上传」→ 平台上出现一个「开发版本」
  │ ③ 公众平台把某个版本设为「体验版」→ 体验成员扫码可看（最多 15 人 / 90 人视认证情况）
  │ ④ 公众平台「提交审核」→ 微信人工审核，1-7 天
  │ ⑤ 审核通过后点「发布」→ 全网用户可搜索使用
```

上传只完成 ②。**② 之后不点「发布」，线上用户看不到任何变化**，所以上传是安全的。

**二、必须先有小程序 AppID。** 没有 AppID 只能在开发者工具的模拟器里调试（下面第 1 节），无法预览到真机、无法上传、无法发布。AppID 需要先注册小程序账号（个体工商户/企业主体 + 认证）。

**三、域名必须已备案且登记。** 微信要求 `request` / `uploadFile` / `downloadFile` 的域名：使用 HTTPS、域名已 ICP 备案、并在公众平台「开发管理 → 开发设置 → 服务器域名」里登记。**每月只能修改 5 次**，想清楚再填。

---

## 1. 阶段 A：还没有 AppID —— 在模拟器里连测试机

这一阶段能验证除微信登录、微信支付、订阅消息以外的全部功能。

### 1.1 安装开发者工具

到 [微信开发者工具下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 下载「稳定版 Stable Build」，安装后用微信扫码登录。

### 1.2 指向测试机 API

```bash
cd apps/miniprogram
cp config.local.example.js config.local.js
```

编辑 `config.local.js`：

```js
module.exports = {
  apiBaseUrl: "https://petbaby.example.com"
};
```

`config.local.js` 已在 `.gitignore` 里，不会提交。没有这个文件时代码回落到 `http://127.0.0.1:3000`。

### 1.3 结构自检

```bash
cd apps/miniprogram
corepack enable
pnpm install --frozen-lockfile
pnpm validate
```

`validate` 有十项通用门禁与岛专属门禁：`app.json` 里每个页面的 `js/json/wxml/wxss` 四文件齐备、所有 JSON 可解析、`.wxss` 零颜色/间距/圆角/字号硬编码（`app.wxss` 是唯一豁免文件）、四套主题 token 完整且类型正确、正文与按钮文字对比度达标、玻璃面板双极对比度、注入串不超 2KB、黏土内高光跟随卡面明暗、`var()` 引用的变量确有来源、**自定义组件在同页 `usingComponents` 注册**、**WXML 标签闭合**。这些门禁重点拦截「不报错但页面少一块或样式失效」的问题。末尾还会跑 `node --test`（陪伴天数、小岛昼夜天气、命中表、帧循环与素材缓存等；准确用例数只在 `../README.md` 维护）。

当前预期输出：`Mini Program structure is valid (26 pages，含分包 3, 4 themes, 57 tokens).` **加页面或改样式后必须跑一次。**

### 1.3.1 基础库版本要求

| 项     | 取值                                                    |
| ----- | ----------------------------------------------------- |
| 最低基础库 | **2.9.0**（`page-meta` 起始版本，主题变量靠它注入）                  |
| 声明位置  | `apps/miniprogram/project.config.json` 的 `libVersion` |
| 调试设置  | 开发者工具「详情 → 本地设置 → 调试基础库」选 2.9.0 做一次低版本回归              |

低于 2.9.0 时不会白屏也不会崩溃：`page-meta` 不生效，`app.wxss` 里的 `var()` 兜底值接管，整体以 `cute` 主题外观运行，主题选择页的切换不再实时反映到已打开页面。

这里的 2.9.0 只是当前页面与主题基线。完成 23 号文的虚拟支付改造后，付费能力要求基础库 **2.19.2+**，并需用 `wx.canIUse("requestVirtualPayment")` 给低版本用户明确升级提示；在该改造完成前不得公开虚拟商品付费入口。

`glass` 主题依赖 `backdrop-filter`。运行时由 `theme/manager.js` 探测支持情况，不支持时自动切到该主题的降级取值（不透明表面 + 更强描边），页面不出现"白到看不清"的空玻璃。真机验收需覆盖支持与降级两种表现。

### 1.4 导入并放开域名校验

1. 开发者工具 → 「导入项目」→ 目录选 `apps/miniprogram/`。
2. AppID 处选「测试号」或「使用游客身份/不使用 AppID」。
3. 打开右上角「详情 → 本地设置」，勾选：
   - ✅ **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**
   - ✅ 不使用 npm 模块（本项目不依赖 npm 构建）
4. 点「编译」。

### 1.5 在小程序里登录

`wx.login` 需要 AppID + AppSecret，这一阶段一定失败——代码已做兜底，不会报错也不会覆盖已有会话。用账号密码登录：

**「我的」→「登录与退出」→ 注册/登录**（账号规则同 Web：字母开头 3-32 位；密码 ≥10 位且含字母和数字；测试机需要邀请码，在 `deploy/.env.staging` 的 `PASSWORD_AUTH_INVITE_CODE`）。

### 1.6 模拟器里要验的

- 首页玩法列表能拉到（说明 `apiBaseUrl` 和 HTTPS 通了）。
- 创建宠物 → 选择本地图片上传 → 提交生成 → 轮询出图。
- 作品页解锁（测试机模拟支付）、保存到相册、分享卡片。
- 「我的」各入口：订单、宠物、照片、账户与隐私、纪念空间、会员。
- 断网/超时时有提示，不会白屏或死循环。

---

## 2. 阶段 B：拿到 AppID 之后

### 2.1 注册与认证（一次性）

1. [微信公众平台](https://mp.weixin.qq.com/) → 「立即注册」→ 选「小程序」。
2. 用一个**没有注册过公众平台的邮箱**，填主体信息（个体工商户需要营业执照、法人身份证、对公或法人银行卡验证）。
3. 完成主体认证。认证是后续开通微信支付、提高体验成员上限的前提。
4. 登录后在「设置 → 基本设置」补全小程序名称、头像、简介、服务类目。**服务类目直接影响审核结果**，宠物照片创意内容一般选「工具 → 图片/文字编辑」或「电商平台」相关类目，按实际付费形态选。
5. 「开发管理 → 开发设置」记下 **AppID**，生成并保存 **AppSecret**（只显示一次）。

### 2.2 登记服务器域名

「开发管理 → 开发设置 → 服务器域名 → 修改」，四处都填测试机/生产域名：

| 类型                | 填什么                           | 用途              |
| ----------------- | ----------------------------- | --------------- |
| request 合法域名      | `https://petbaby.example.com` | 所有 API 调用       |
| uploadFile 合法域名   | `https://petbaby.example.com` | 照片上传            |
| downloadFile 合法域名 | `https://petbaby.example.com` | 作品下载、保存相册       |
| socket 合法域名       | 留空                            | 本项目不用 WebSocket |

要求：HTTPS、已备案、不能带端口和路径。**每月限改 5 次**，建议一次把测试域名和生产域名都填上。

### 2.3 把 AppID 配到本地（不提交）

```bash
cd apps/miniprogram
cp project.private.config.example.json project.private.config.json
```

编辑 `project.private.config.json`：

```json
{
  "appid": "wx0000000000000000",
  "projectname": "petbaby-miniprogram"
}
```

`project.config.json` 里保持游客 `touristappid` 不动，真实 AppID 只写在 `project.private.config.json`（已 gitignore）。开发者工具会优先读私有配置。

### 2.4 配置后端的微信登录

在测试机上编辑 `deploy/.env.staging`：

```bash
WECHAT_APP_ID=wx0000000000000000
WECHAT_APP_SECRET=<你的 AppSecret>
```

然后 `./deploy/scripts/deploy.sh staging`。此后小程序启动时的 `wx.login` 静默登录就能成功，不再需要账号密码。

> 已经用账号密码登录过的手机会保留账号密码会话（本地 `petbaby_session_source=password`）。想切回微信登录，在「我的 → 登录与退出」里退出即可。

### 2.5 真机预览（开发版）

方式一（推荐，无需私钥）：开发者工具点「预览」→ 用微信扫码。**扫码后在手机上打开右上角「···」→ 开启「调试」**，否则未登记的域名会被拦。域名已登记的话不需要开调试。

方式二（命令行，需要上传私钥，见下节）：

```bash
cd apps/miniprogram
export MINIPROGRAM_APP_ID=wx0000000000000000
export MINIPROGRAM_PRIVATE_KEY_PATH=/secrets/private.wx0000000000000000.key
export MINIPROGRAM_API_BASE_URL=https://petbaby.example.com
pnpm preview
```

二维码输出到 `apps/miniprogram/preview-qrcode.png`（已 gitignore）。

---

## 3. 上传体验版

### 3.1 先拿到上传私钥并配 IP 白名单

1. 公众平台 →「开发管理 → 开发设置」→ 下拉到「小程序代码上传」。
2. 点「生成」下载密钥文件，命名如 `private.wx0000000000000000.key`。**保存在仓库外**（例如 `/secrets/`），权限 600，绝不提交。
3. 同一区块的「IP 白名单」里，加入**执行上传那台机器的公网出口 IP**。查法：在那台机器上执行 `curl -s ifconfig.me`。
   - 家里宽带 IP 会变，变了要重新加，否则报「invalid ip … not in whitelist」。
4. 「小程序代码上传」也可以选择关闭 IP 白名单校验，测试期可接受，正式发布建议开启。

### 3.2 方式一：开发者工具点「上传」

1. 确认 `config.local.js` 的 `apiBaseUrl` 是目标环境的域名（上传的是当前代码 + 当前配置）。
2. 点右上角「上传」。
3. 填**版本号**（如 `1.0.0`）和**项目备注**（如「测试机联调版」）。
4. 上传完成后，公众平台「管理 → 版本管理 → 开发版本」里会出现这个版本。

### 3.3 方式二：命令行上传（可复现，推荐）

```bash
cd apps/miniprogram
export MINIPROGRAM_APP_ID=wx0000000000000000
export MINIPROGRAM_PRIVATE_KEY_PATH=/secrets/private.wx0000000000000000.key
export MINIPROGRAM_API_BASE_URL=https://petbaby.example.com
export MINIPROGRAM_VERSION=1.0.0
export MINIPROGRAM_DESCRIPTION="测试机联调版"
pnpm upload
```

`scripts/ci.js` 会做三件事：校验三个必填变量、**用 `MINIPROGRAM_API_BASE_URL` 重写 `config.local.js`**（所以上传的包一定指向你声明的域名）、调 `miniprogram-ci` 上传。上传模式强制要求 HTTPS 地址，版本号必须是 `x.y.z`。

### 3.4 设为体验版

1. 公众平台 →「管理 → 版本管理 → 开发版本」，找到刚上传的版本 → 「选为体验版本」。
2. 「成员管理 → 体验成员」里把要测试的微信号加进去（未认证小程序上限 15 人）。
3. 体验成员在「版本管理 → 体验版」处扫码，或从微信「发现 → 小程序 → 我的小程序」进入。

到这一步为止，**线上用户完全无感**。真机验收就在体验版上做。

---

## 4. 提交审核与发布

### 4.1 提交审核前的门禁

以下任一项不满足，就只做体验版，不要提交审核：

- [ ] AppID 与目标环境一致，`request`/`uploadFile`/`downloadFile` 域名均已登记且为 HTTPS。
- [ ] 上传出口 IP 已在白名单（或已关闭校验）。
- [ ] 隐私政策、用户协议、退款规则、客服入口在小程序内可访问（对应 Web 的 `/legal/privacy`、`/legal/terms`、`/legal/refund`）。
- [ ] 公众平台「设置 → 服务内容声明 → 用户隐私保护指引」已填写并通过，且和实际收集的信息一致（本项目：相册/照片、用户昵称头像非必需、订单地址）。
- [ ] 涉及付费：微信支付商户号已开通并与小程序绑定，支付/退款回调为公网 HTTPS，且在**正式生产环境**完成过一次真实联调。**测试机的模拟支付不能作为审核依据。**
- [ ] AI 生成内容有明确标识（作品与分享页一致）。
- [ ] 至少一台 iPhone + 一台低端 Android 完成完整链路真机验证。
- [ ] 服务类目与实际功能匹配。

### 4.2 提交审核

1. 「管理 → 版本管理 → 开发版本」→ 目标版本 → 「提交审核」。
2. 逐页确认「功能页面」配置，填写**测试账号**（给审核员用的账号密码——正式生产如果关掉了账号密码登录，就要提供其他可登录方式或视频演示）和**补充说明**。
3. 提交后状态变为「审核中」，通常 1-7 天。被拒会给出具体条款，改完重新提交。

### 4.3 发布

审核通过后，「审核版本」处点「发布」。可选：

- **全量发布**：立即对所有用户生效。
- **分阶段发布**：按 1h/2h/4h/8h 逐步放量（推荐，出问题可中止）。

### 4.4 出问题怎么回退

- 「版本管理 → 线上版本 → 版本回退」可回到微信后台仍保留的上一个线上版本。
- 或者「重新提交上一个可用版本 + 加急审核」。
- 小程序回退**不会**回退后端。后端回滚见 [`02-deployment-guide.md`](02-deployment-guide.md) 第 4 节。

---

## 5. 常见报错

| 报错                                                  | 原因与处理                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `request:fail url not in domain list`               | 域名没登记，或没勾「不校验合法域名」/ 真机没开「调试」                                     |
| `invalid ip xxx, not in whitelist`                  | 上传机器出口 IP 不在白名单。`curl -s ifconfig.me` 查到后去公众平台添加                 |
| `invalid appid`                                     | `project.private.config.json` 或 `MINIPROGRAM_APP_ID` 与私钥所属小程序不一致 |
| `Private key not found`                             | `MINIPROGRAM_PRIVATE_KEY_PATH` 路径不对                              |
| `MINIPROGRAM_VERSION must use x.y.z format`         | 版本号格式必须是 `1.0.0`                                                 |
| `Upload requires an HTTPS MINIPROGRAM_API_BASE_URL` | 上传时不允许 http 地址                                                   |
| 启动后接口全部 401                                         | 会话过期。「我的 → 登录与退出」重新登录；配了 `WECHAT_APP_ID/SECRET` 后会自动静默登录         |
| 登录报「账号密码登录未启用」                                      | 后端 `PASSWORD_AUTH_ENABLED` 不是 `true`（正式生产默认关闭，这是预期行为）            |
| 上传图片失败 413                                          | 单张限 2.5MB，先在小程序里压缩                                               |
| 真机白屏、模拟器正常                                          | 多为基础库差异。代码已避免可选链/空值合并，新增代码也要遵守                                   |
| `pnpm validate` 报缺文件                                | 新页面必须同时有 `js/json/wxml/wxss` 四个文件，并登记进 `app.json`                |

---

## 6. 密钥与文件归属

| 文件                            | 是否提交         | 说明                                 |
| ----------------------------- | ------------ | ---------------------------------- |
| `project.config.json`         | 提交           | 保持游客 `touristappid`                |
| `project.private.config.json` | **不提交**      | 真实 AppID                           |
| `config.local.js`             | **不提交**      | API 域名；`pnpm preview/upload` 会自动重写 |
| `private.wx*.key`             | **不提交，放仓库外** | 上传私钥                               |
| `preview-qrcode.png`          | **不提交**      | 预览二维码                              |

AppSecret 只写进后端环境变量（`deploy/.env.staging` / `.env.production`），不进小程序代码、不进文档、不进聊天记录。
