const api = require("../../services/api");
const payment = require("../../services/payment");
const { themedPage } = require("../../theme/page-mixin");

const STATUS_TEXT = { paid: "已支付", pending: "待支付", refunded: "已退款", refunding: "退款中", failed: "支付失败", cancelled: "已取消" };
const STATUS_TONE = { paid: "success", pending: "warning", refunded: "neutral", refunding: "warning", failed: "error", cancelled: "neutral" };

themedPage({
  data: { orders: [], error: "", loading: true, busy: false, refundTarget: null },
  onShow() { this.load(); },
  load() {
    this.setData({ loading: !this.data.orders.length, error: "" });
    api.requestWithRetry("/api/payments/orders", {}, 2)
      .then((orders) => this.setData({
        loading: false,
        orders: orders.map((order) => Object.assign({}, order, {
          statusText: STATUS_TEXT[order.status] || order.status,
          statusTone: STATUS_TONE[order.status] || "neutral",
          // orders.amount 是 numeric(10,2) 元，不是分，直接保留两位
          amountText: "¥" + Number(order.amount).toFixed(2),
          refundedText: order.refundedAmount > 0 ? "已退 ¥" + Number(order.refundedAmount).toFixed(2) : ""
        }))
      }))
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },
  askRefund(event) {
    const order = this.data.orders.find((item) => item.id === event.currentTarget.dataset.id);
    if (order) this.setData({ refundTarget: order, refundDescription: order.paymentKind === "work" ? "每位用户可申请一次效果不满意退款，退回订单金额的 50%。Apple 订单请在 Apple 购买记录中申请。" : "申请退回此订单尚未退还的金额。到账后相关权益将收回；Apple 订单请在 Apple 购买记录中申请。" });
  },
  pay(event) {
    const order = this.data.orders.find((item) => item.id === event.currentTarget.dataset.id);
    if (!order || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    payment.pay(order.paymentKind, order.id).then(() => { this.setData({ busy: false }); this.load(); })
      .catch((error) => this.setData({ busy: false, error: error.message }));
  },
  refreshOrder(event) {
    const order = this.data.orders.find((item) => item.id === event.currentTarget.dataset.id);
    if (!order) return;
    const paths = { work: "/api/orders/", growth: "/api/growth-orders/", physical: "/api/physical-orders/" };
    api.request(paths[order.paymentKind] + order.id + "/status").then(() => this.load())
      .catch((error) => this.setData({ error: error.message }));
  },
  cancelRefund() { this.setData({ refundTarget: null }); },
  confirmRefund() {
    const target = this.data.refundTarget;
    if (!target) return;
    this.setData({ refundTarget: null, busy: true, error: "" });
    const paths = { work: "/api/orders/", growth: "/api/growth-orders/", physical: "/api/physical-orders/" };
    api.request(paths[target.paymentKind] + target.id + "/refund", { method: "POST", data: { reason: target.paymentKind === "work" ? "dissatisfied" : "requested" } })
      .then(() => { this.setData({ busy: false }); wx.showToast({ title: "退款已提交", icon: "none" }); this.load(); })
      .catch((error) => this.setData({ error: error.message, busy: false }));
  },
  goCreate() { wx.switchTab({ url: "/pages/index/index" }); }
});
