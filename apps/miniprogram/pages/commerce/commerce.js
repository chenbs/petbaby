const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

/*
 * 套餐名、价格、权益一律从 /api/membership-plans 读（改造项 M3）。
 *
 * 原先这里有一个写死的 PLANS 数组：月会员 ¥25 / 年会员 ¥199，权益写着
 * 「每月生成额度加量」「额度按月自动重置」。而迁移 0020 已经把月会员置 inactive
 * （点了直接 409）、年费改成 ¥128、并从权益 JSON 里删掉了 monthlyQuota ——
 * 「额度加量」是 D6 判定的负向卖点（每月 10 次比免费用户每天 1 次还少）。
 *
 * 端上写死价格必然与迁移走散，而走散的表现是「界面承诺一个价、实际扣另一个」。
 * 所以这个文件不再有任何套餐常量。
 */

const PERIOD_TEXT = { month: "月", year: "年" };

const MEMBER_STATUS_TEXT = { pending: "待支付", active: "生效中", expired: "已过期", cancelled: "已取消" };
const MEMBER_STATUS_TONE = { pending: "warning", active: "success", expired: "neutral", cancelled: "neutral" };
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

themedPage({
  data: {
    plans: [],
    memberships: [],
    subscriptions: [],
    reports: [],
    loading: true,
    buyingPlan: "",
    unlockingId: "",
    cancelTarget: null,
    message: "",
    error: ""
  },

  onShow() { this.load(); },

  load() {
    this.setData({ loading: this.data.loading, error: "" });
    Promise.all([api.request("/api/membership-plans"), api.request("/api/memberships"), api.request("/api/subscriptions"), api.request("/api/annual-reports")])
      .then(([plans, memberships, subscriptions, reports]) => this.setData({
        loading: false,
        plans: plans.map((item) => Object.assign({}, item, {
          priceText: "¥" + item.amount + " / " + (PERIOD_TEXT[item.period] || item.period),
          // 「省多少」由服务端按权益单买价算，端上不再自己拼「比月付省 ¥101」
          // 那类算式 —— 那个数字在套餐改版后就成了假的。
          //
          // 省额为 0 时（按「只做一件交付物」算下来定价高于权益价值）改给回本件数：
          // 那是用户能自己算的账，而「省 ¥N」在他只做一件时是假的。
          hint: item.saving > 0
            ? "单买这些权益约 ¥" + item.singleBuyValue + "，省 ¥" + item.saving
            : item.breakEven ? "做 " + item.breakEven + " 件画册或短片即回本" : "",
          // 只有一个套餐在售时不给「更划算」标签：没有比较对象的比较级是空话。
          badge: plans.length > 1 && item.period === "year" ? "更划算" : "",
          benefitTexts: (item.benefits || []).map((benefit) => benefit.text)
        })),
        memberships: memberships.map((item) => Object.assign({}, item, {
          // 套餐名由服务端按 membership_plan_versions.label 下发，
          // 端上不再留 { monthly: "月会员" } 这种翻译表 —— 那是第二份副本。
          planText: item.planLabel || item.plan,
          statusText: MEMBER_STATUS_TEXT[item.status] || item.status,
          statusTone: MEMBER_STATUS_TONE[item.status] || "neutral",
          benefitTexts: (item.benefits || []).map((benefit) => benefit.text),
          // 年报免费解锁余量。新权益不卖生成次数，原先的 used/quota 进度条
          // 在 ¥69 套餐下永远是 0/0，看起来像坏了，已去掉。
          remainingText: item.status === "active" && typeof item.annualReportRemaining === "number"
            ? "年度报告免费解锁剩余 " + item.annualReportRemaining + " 次"
            : "",
          expiresText: dateText(item.expiresAt || item.expires_at) ? "有效期至 " + dateText(item.expiresAt || item.expires_at) : ""
        })),
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

  member(event) {
    const plan = event.currentTarget.dataset.plan;
    if (this.data.buyingPlan) return;
    this.setData({ buyingPlan: plan, message: "", error: "" });
    api.request("/api/memberships", { method: "POST", data: { plan } })
      .then((item) => {
        const id = item.orderId || item.order_id;
        return id ? api.request("/api/growth-orders/" + id + "/pay", { method: "POST" }) : item;
      })
      .then(() => { this.setData({ buyingPlan: "", message: "会员已开通" }); this.load(); })
      .catch((error) => this.setData({ buyingPlan: "", error: error.message }));
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
    this.setData({ message: "", error: "" });
    api.request("/api/annual-reports", { method: "POST", data: { year: new Date().getFullYear() } })
      .then(() => { this.setData({ message: "年度报告已生成" }); this.load(); })
      .catch((error) => this.setData({ error: error.message }));
  },

  /*
   * 年报解锁可能**不产生订单**：会员的 annualReport 权益命中时服务端直接解锁并
   * 返回 `{ unlocked: true, viaEntitlement: true }`（改造项 M4）。
   * 无条件拿 order.id 去支付会对 undefined 发请求，表现是解锁成功却报错。
   */
  unlock(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.unlockingId) return;
    this.setData({ unlockingId: id, message: "", error: "" });
    api.request("/api/annual-reports/" + id, { method: "PATCH", data: { action: "unlock" } })
      .then((result) => {
        if (result && result.id) return api.request("/api/growth-orders/" + result.id + "/pay", { method: "POST" }).then(() => "高清版已解锁");
        return result && result.viaEntitlement ? "已用会员权益解锁高清版" : "高清版已解锁";
      })
      .then((message) => { this.setData({ unlockingId: "", message }); this.load(); })
      .catch((error) => this.setData({ unlockingId: "", error: error.message }));
  },

  goPhysical() { wx.navigateTo({ url: "/pages/physical/physical" }); }
});
