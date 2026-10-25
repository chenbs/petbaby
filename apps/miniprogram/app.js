const config = require("./config");
const api = require("./services/api");
const theme = require("./theme/manager");
const acquisition = require("./services/acquisition");

App({
  globalData: { apiBaseUrl: config.apiBaseUrl, loggedIn: false, themeId: "pet" },
  onLaunch(options) {
    // 主题必须早于任何网络请求落地，确保首屏不出现主题闪变（需求 6.3.1）。
    this.globalData.themeId = theme.init();
    const existing = wx.getStorageSync("petbaby_session");
    if (existing) this.globalData.loggedIn = true;
    // 2026-10-11 起小程序只有微信登录；清掉旧版本账号密码登录留下的会话来源标记。
    wx.removeStorageSync("petbaby_session_source");
    // 渠道归因：登录前先记下场景值、投放标记与邀请码，新建账号那次由服务端采用（迁移 0044）。
    acquisition.capture(options);
    /*
     * 启动静默登录。首页 onShow 与这里几乎同时发生：首次扫码进入时本地还没有会话，
     * 首页请求会先于登录完成而拿到 401（表现为顶部「登录状态已失效」，切个 tab 回来又好了）。
     * 所以把登录做成 loginReady，services/api.js 的每个请求都先等它落定再发。
     */
    this.globalData.loginReady = new Promise((resolve) => {
      wx.login({
        timeout: 8000,
        success: (result) => {
          if (!result.code) return resolve();
          api.request("/api/auth/wechat", { method: "POST", data: acquisition.loginPayload(result.code) })
            .then((session) => {
              wx.setStorageSync("petbaby_session", session.sessionToken);
              this.globalData.loggedIn = true;
              resolve();
              // 缓存自己的邀请码：之后各页分享卡片同步拼上 inv 参数
              api.request("/api/invites").then((invite) => acquisition.rememberInviteCode(invite.code)).catch(() => undefined);
            })
            .catch((error) => {
              // 封禁账号：清掉旧会话，进入任何需要登录的页面时由 services/api.js 统一跳到登录页提示
              if (error && error.code === "ACCOUNT_SUSPENDED") { wx.removeStorageSync("petbaby_session"); this.globalData.loggedIn = false; return resolve(); }
              this.globalData.loggedIn = Boolean(existing);
              resolve();
            });
        },
        fail: () => resolve()
      });
    });
  }
});
