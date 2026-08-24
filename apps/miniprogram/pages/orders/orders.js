const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

const STATUS_TEXT = { paid: "已支付", pending: "待支付", refunded: "已退款", refunding: "退款中", failed: "支付失败", cancelled: "已取消" };
const STATUS_TONE = { paid: "success", pending: "warning", refunded: "neutral", refunding: "warning", failed: "error", cancelled: "neutral" };

themedPage({
  data: { orders: [], error: "", loading: true, busy: false, refundTarget: null },
  onShow() { this.load(); },
  load() {
    this.setData({ loading: !this.data.orders.length, error: "" });
    api.requestWithRetry("/api/orders/list", {}, 2)
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
    if (order) this.setData({ refundTarget: order });
  },
  cancelRefund() { this.setData({ refundTarget: null }); },
  confirmRefund() {
    const target = this.data.refundTarget;
    if (!target) return;
    this.setData({ refundTarget: null, busy: true, error: "" });
    api.request("/api/orders/" + target.id + "/refund", { method: "POST", data: { reason: "dissatisfied" } })
      .then(() => { this.setData({ busy: false }); wx.showToast({ title: "退款已提交", icon: "none" }); this.load(); })
      .catch((error) => this.setData({ error: error.message, busy: false }));
  },
  goCreate() { wx.switchTab({ url: "/pages/index/index" }); }
});
