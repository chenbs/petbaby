const api = require("../../services/api");
const acquisition = require("../../services/acquisition");
const { clearRecordDrafts } = require("../../services/photo-upload-session");
const { themedPage } = require("../../theme/page-mixin");

/*
 * 登录与退出（2026-10-11 起只有微信登录）。
 * 小程序不提供账号密码注册与登录：账号唯一标识是当前小程序的 openid，由 wx.login → /api/auth/wechat 换取。
 * app.js 启动时已静默登录一次；这里给静默登录失败（网络、授权）后的用户一个手动重试的入口。
 */
themedPage({
  data: { authenticated: false, accountLabel: "", message: "", messageType: "error", busy: false },
  onShow() {
    api.request("/api/auth/session")
      .then((session) => {
        const authenticated = Boolean(session.authenticated);
        this.setData({ authenticated });
        if (!authenticated) return this.setData({ accountLabel: "" });
        // 已登录态展示当前账号（需求 5.21-6）；取不到时退回中性文案，不打断页面
        api.request("/api/account")
          .then((profile) => this.setData({ accountLabel: "当前账号：" + (profile.displayName || "微信用户") }))
          .catch(() => this.setData({ accountLabel: "可以直接返回首页开始创作。" }));
      })
      .catch(() => this.setData({ message: "无法连接服务端，请检查网络后重试", messageType: "error" }));
  },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  openLegal(event) { wx.navigateTo({ url: "/pages/legal/legal?doc=" + event.currentTarget.dataset.doc }); },
  wechatLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, message: "" });
    wx.login({
      timeout: 8000,
      success: (result) => {
        if (!result.code) return this.loginFailed("没有拿到微信登录凭证，请稍后再试");
        api.request("/api/auth/wechat", { method: "POST", data: acquisition.loginPayload(result.code) })
          .then((session) => {
            wx.setStorageSync("petbaby_session", session.sessionToken);
            getApp().globalData.loggedIn = true;
            wx.reLaunch({ url: "/pages/index/index" });
          })
          .catch((error) => this.loginFailed(error.message || "微信登录失败，请稍后再试"));
      },
      fail: () => this.loginFailed("微信登录被中断，请稍后再试")
    });
  },
  loginFailed(message) {
    this.setData({ busy: false, message, messageType: "error" });
  },
  logout() {
    api.request("/api/auth/logout", { method: "POST" }).catch(() => undefined).then(() => {
      clearRecordDrafts();
      wx.removeStorageSync("petbaby_session");
      acquisition.clearInviteCode();
      getApp().globalData.loggedIn = false;
      this.setData({ authenticated: false, message: "已退出登录", messageType: "info" });
    });
  }
});
