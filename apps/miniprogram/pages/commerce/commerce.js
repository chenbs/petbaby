const wallet = require("../../services/wallet");
const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

const EVENT_TEXT = { birthday: "生日提醒", got_home: "到家纪念日提醒", holiday: "节日提醒", on_this_day: "去年今日提醒" };
/*
 * `authorization_required` 是用户在微信弹层里点了拒绝，`consumed` 是那条
 * 一次性授权已经换过一次推送 —— 两者都不是错误状态，文案不能报错味，
 * 但必须让用户知道「要再授权一次才会再收到」。
 */
const SUB_STATUS_TEXT = { active: "已授权", scheduled: "已排期", sent: "已发送", consumed: "已用完，可再次授权", failed: "发送失败", unsubscribed: "已退订", authorization_required: "未授权", rejected: "未授权" };
const SUB_STATUS_TONE = { active: "success", scheduled: "success", sent: "neutral", consumed: "neutral", failed: "error", unsubscribed: "neutral", authorization_required: "warning", rejected: "warning" };

function dateText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

themedPage(Object.assign({}, wallet.walletSheetMethods, {
  data: { walletSheet: { visible: false, required: 0, balance: 0, shortfall: 0 },
    subscriptions: [],
    reports: [],
    loading: true,
    reportBusy: false, walletCosts: {},
    unlockingId: "",
    cancelTarget: null,
    message: "",
    error: ""
  },

  onShow() { this.load(); },

  load() {
    this.setData({ loading: this.data.loading, error: "" });
    Promise.all([api.request("/api/subscriptions"), api.request("/api/annual-reports"), wallet.getWallet()])
      .then(([subscriptions, reports, balance]) => this.setData({
        loading: false, walletCosts: balance.costs || {},
        subscriptions: subscriptions.map((item) => {
          const status = item.status;
          const scheduled = dateText(item.scheduledAt || item.scheduled_at);
          return Object.assign({}, item, {
            eventText: EVENT_TEXT[item.eventType || item.event_type] || "纪念日提醒",
            statusText: SUB_STATUS_TEXT[status] || status,
            statusTone: SUB_STATUS_TONE[status] || "neutral",
            scheduledText: scheduled ? "计划提醒时间 " + scheduled : "",
            cancellable: status !== "unsubscribed"
          });
        }),
        reports
      }))
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  remind() { this.subscribe("birthday", "已订阅生日提醒"); },

  /**
   * 「去年今日」的推送授权（改造项 E2）。
   *
   * 服务端补了授权门之后，没有这个入口整个推送就永远不会发生 ——
   * 授权只能由用户在微信弹层里给，产品不能代替他勾。
   *
   * 授权是**单次消耗品**：推送一次后要重新授权，所以这个按钮常驻而不是
   * 「已订阅就隐藏」。
   */
  remindOnThisDay() { this.subscribe("on_this_day", "已开启去年今日提醒"); },

  /**
   * 统一走微信授权弹层再落库。
   *
   * `wx.requestSubscribeMessage` 的结果决定 `wechatAuthorization`：
   * 直接写死 accept 会在用户点「拒绝」时仍然记成已授权，
   * 那正是服务端授权门要防的那种记录。
   * 未配置模板 ID（本地/测试机）时 API 会失败，按 accept 落库以便联调 ——
   * 生产的模板 ID 缺失有 preflight 兜住。
   */
  subscribe(eventType, successText) {
    this.setData({ message: "", error: "" });
    const templateId = (config.subscribeTemplateIds || {})[eventType];
    const send = (authorization) => api.request("/api/subscriptions", { method: "POST", data: { eventType, consent: true, wechatAuthorization: authorization } })
      .then(() => { this.setData({ message: authorization === "accept" ? successText : "未获得推送授权，可稍后再试" }); this.load(); })
      .catch((error) => this.setData({ error: error.message }));
    if (!templateId || !wx.requestSubscribeMessage) return send("accept");
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => send(result[templateId] === "accept" ? "accept" : result[templateId] === "ban" ? "ban" : "reject"),
      fail: () => send("reject")
    });
  },

  askCancel(event) {
    const target = this.data.subscriptions.filter((item) => item.id === event.currentTarget.dataset.id)[0];
    if (target) this.setData({ cancelTarget: target });
  },
  closeCancel() { this.setData({ cancelTarget: null }); },
  confirmCancel() {
    const target = this.data.cancelTarget;
    this.setData({ cancelTarget: null, message: "", error: "" });
    if (!target) return;
    api.request("/api/subscriptions/" + target.id, { method: "DELETE" })
      .then(() => { this.setData({ message: "已退订" }); this.load(); })
      .catch((error) => this.setData({ error: error.message }));
  },

  report() {
    if (this.data.reportBusy) return;
    const key = "mp-annual-report-" + Date.now();
    const year = new Date().getFullYear();
    this.setData({ reportBusy: true, message: "", error: "" });
    return wallet.withDongan(this, () => api.request("/api/annual-reports", { method: "POST", data: { year, idempotencyKey: key } }))
      .then(() => { this.setData({ message: "年度报告已生成" }); this.load(); })
      .catch((error) => this.setData({ error: error.code === "WALLET_TOPUP_CANCELLED" ? "" : error.message }))
      .finally(() => this.setData({ reportBusy: false }));
  },
  unlock(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.unlockingId) return;
    this.setData({ unlockingId: id, message: "", error: "" });
    return wallet.withDongan(this, () => api.request("/api/annual-reports/" + id, { method: "PATCH", data: { action: "unlock" } }))
      .then(() => { this.setData({ message: "高清版已解锁" }); this.load(); })
      .catch((error) => this.setData({ error: error.code === "WALLET_TOPUP_CANCELLED" ? "" : error.message }))
      .finally(() => this.setData({ unlockingId: "" }));
  },

  goPhysical() { wx.navigateTo({ url: "/pages/physical/physical" }); }
}));
