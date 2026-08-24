const config = require("./config");
const api = require("./services/api");
const theme = require("./theme/manager");

App({
  globalData: { apiBaseUrl: config.apiBaseUrl, loggedIn: false, themeId: "cute" },
  onLaunch() {
    // 主题必须早于任何网络请求落地，确保首屏不出现主题闪变（需求 6.3.1）。
    this.globalData.themeId = theme.init();
    const existing = wx.getStorageSync("petbaby_session");
    if (existing) this.globalData.loggedIn = true;
    // 账号密码登录优先：测试环境没有微信凭据，静默登录会失败并覆盖已有会话。
    if (wx.getStorageSync("petbaby_session_source") === "password") return;
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
