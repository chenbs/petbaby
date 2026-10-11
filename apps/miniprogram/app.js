const config = require("./config");
const api = require("./services/api");
const theme = require("./theme/manager");

App({
  globalData: { apiBaseUrl: config.apiBaseUrl, loggedIn: false, themeId: "pet" },
  onLaunch() {
    // 主题必须早于任何网络请求落地，确保首屏不出现主题闪变（需求 6.3.1）。
    this.globalData.themeId = theme.init();
    const existing = wx.getStorageSync("petbaby_session");
    if (existing) this.globalData.loggedIn = true;
    // 2026-10-11 起小程序只有微信登录；清掉旧版本账号密码登录留下的会话来源标记。
    wx.removeStorageSync("petbaby_session_source");
    wx.login({
      timeout: 8000,
      success: (result) => {
        if (!result.code) return;
        api.request("/api/auth/wechat", { method: "POST", data: { code: result.code } })
          .then((session) => { wx.setStorageSync("petbaby_session", session.sessionToken); this.globalData.loggedIn = true; })
          .catch(() => { this.globalData.loggedIn = Boolean(existing); });
      }
    });
  }
});
