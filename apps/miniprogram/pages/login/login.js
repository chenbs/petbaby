const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

themedPage({
  data: { mode: "login", accountName: "", password: "", displayName: "", inviteCode: "", inviteRequired: false, enabled: true, authenticated: false, accountLabel: "", message: "", messageType: "error", busy: false },
  onShow() {
    api.request("/api/auth/session")
      .then((session) => {
        const authenticated = Boolean(session.authenticated);
        this.setData({ authenticated, enabled: Boolean(session.passwordAuth && session.passwordAuth.enabled), inviteRequired: Boolean(session.passwordAuth && session.passwordAuth.inviteRequired) });
        if (!authenticated) return this.setData({ accountLabel: "" });
        // 已登录态展示当前账号（需求 5.21-6）；取不到时退回中性文案，不打断页面
        api.request("/api/account")
          .then((profile) => this.setData({ accountLabel: "当前账号：" + (profile.displayName || profile.accountName || "已登录用户") }))
          .catch(() => this.setData({ accountLabel: "可以直接返回首页开始创作。" }));
      })
      .catch(() => this.setData({ message: "无法连接服务端，请检查 API 域名配置", messageType: "error" }));
  },
  goHome() { wx.reLaunch({ url: "/pages/index/index" }); },
  switchMode(event) { this.setData({ mode: event.currentTarget.dataset.mode, message: "" }); },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  submit() {
    const login = this.data.mode === "login";
    if (this.data.accountName.trim().length < 3) return this.setData({ message: "账号至少 3 位", messageType: "error" });
    if (!login && this.data.password.length < 10) return this.setData({ message: "注册密码至少 10 位，且需含字母和数字", messageType: "error" });
    const data = login
      ? { accountName: this.data.accountName.trim(), password: this.data.password }
      : { accountName: this.data.accountName.trim(), password: this.data.password, displayName: this.data.displayName || undefined, inviteCode: this.data.inviteCode || undefined };
    this.setData({ busy: true, message: "" });
    api.request(login ? "/api/auth/password/login" : "/api/auth/password/register", { method: "POST", data })
      .then((session) => {
        wx.setStorageSync("petbaby_session", session.sessionToken);
        wx.setStorageSync("petbaby_session_source", "password");
        getApp().globalData.loggedIn = true;
        wx.reLaunch({ url: "/pages/index/index" });
      })
      .catch((error) => this.setData({ busy: false, message: error.message || "登录失败，请稍后再试", messageType: "error" }));
  },
  logout() {
    api.request("/api/auth/logout", { method: "POST" }).catch(() => undefined).then(() => {
      wx.removeStorageSync("petbaby_session");
      wx.removeStorageSync("petbaby_session_source");
      getApp().globalData.loggedIn = false;
      this.setData({ authenticated: false, message: "已退出登录", messageType: "info" });
    });
  }
});
