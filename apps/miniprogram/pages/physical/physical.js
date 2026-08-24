const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

const SKU_TEXT = { "art-print-a4": "A4 艺术微喷", "memorial-album": "精装纪念册" };
const STATUS_TEXT = {
  pending: "待支付",
  paid: "已支付",
  producing: "制作中",
  shipped: "已发货",
  completed: "已完成",
  cancelled: "已取消",
  after_sale: "售后处理中",
  refunded: "已退款"
};
const STATUS_TONE = {
  pending: "warning",
  paid: "success",
  producing: "warning",
  shipped: "accent",
  completed: "success",
  cancelled: "neutral",
  after_sale: "warning",
  refunded: "neutral"
};

themedPage({
  data: {
    works: [],
    orders: [],
    workId: "",
    workTitle: "",
    address: { name: "", phone: "", province: "", city: "", detail: "" },
    canSubmit: false,
    loading: true,
    submitting: false,
    confirming: false,
    confirmText: "",
    message: "",
    error: ""
  },

  onShow() { this.load(); },

  load() {
    this.setData({ loading: !this.data.works.length && !this.data.orders.length, error: "" });
    Promise.all([api.request("/api/works?locked=false"), api.request("/api/physical-orders")])
      .then(([works, orders]) => {
        const list = works.map((work) => Object.assign({}, work, { coverUrl: work.outputUrl || (work.photo && work.photo.url) || "" }));
        const current = list.filter((work) => work.id === this.data.workId)[0] || list[0];
        this.setData({
          loading: false,
          works: list,
          workId: current ? current.id : "",
          workTitle: current ? current.title : "",
          orders: orders.map((order) => Object.assign({}, order, {
            skuText: SKU_TEXT[order.sku] || order.sku,
            statusText: STATUS_TEXT[order.status] || order.status,
            statusTone: STATUS_TONE[order.status] || "neutral",
            trackingText: order.tracking_no || order.trackingNo || "等待履约"
          }))
        });
        this.refreshSubmittable();
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  chooseWork(event) {
    const work = this.data.works.filter((item) => item.id === event.currentTarget.dataset.id)[0];
    if (!work) return;
    this.setData({ workId: work.id, workTitle: work.title });
    this.refreshSubmittable();
  },

  onField(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ ["address." + key]: event.detail.value });
    this.refreshSubmittable();
  },

  refreshSubmittable() {
    const address = this.data.address;
    const filled = ["name", "phone", "province", "city", "detail"].every((key) => String(address[key] || "").trim());
    this.setData({ canSubmit: Boolean(this.data.workId) && filled });
  },

  askConfirm() {
    if (!this.data.canSubmit) return;
    const address = this.data.address;
    this.setData({
      confirming: true,
      confirmText: `作品：${this.data.workTitle}\n收货人：${address.name}　${address.phone}\n地址：${address.province}${address.city}${address.detail}`
    });
  },
  cancelConfirm() { this.setData({ confirming: false }); },

  create() {
    this.setData({ confirming: false, submitting: true, message: "", error: "" });
    api.request("/api/physical-orders", { method: "POST", data: { workId: this.data.workId, sku: "art-print-a4", address: this.data.address } })
      .then((order) => api.request("/api/physical-orders/" + order.id + "/pay", { method: "POST" }))
      .then(() => {
        this.setData({ submitting: false, message: "下单成功，我们会尽快安排制作" });
        this.load();
      })
      .catch((error) => this.setData({ submitting: false, error: error.message }));
  },

  goWorks() { wx.switchTab({ url: "/pages/works/works" }); }
});
