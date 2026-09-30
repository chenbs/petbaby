const api = require("../../services/api");
const config = require("../../config");
const payment = require("../../services/payment");
const { manifest } = require("../../services/sample-assets");
const { themedPage } = require("../../theme/page-mixin");

const ITEM_STATUS = { queued: "等待制作", processing: "正在制作", succeeded: "已完成", failed: "制作失败", cancelled: "已取消" };
const FINAL_STATUS = ["completed", "partial", "failed", "cancelled"];

function downloadItem(batchId, itemId, preview) {
  const url = config.apiBaseUrl + "/api/art-photo-bundles/" + encodeURIComponent(batchId) + "/items/" + encodeURIComponent(itemId) + (preview ? "?preview=1" : "");
  return new Promise((resolve, reject) => wx.downloadFile({
    url,
    header: { authorization: "Bearer " + wx.getStorageSync("petbaby_session"), "x-petbaby-client": "miniprogram" },
    success(result) {
      if (result.statusCode !== 200 || !result.tempFilePath) return reject(new Error("成片暂时无法读取，请稍后重试"));
      wx.getImageInfo({
        src: result.tempFilePath,
        success(info) {
          if (["jpeg", "jpg", "png", "webp"].indexOf(info.type) < 0) return reject(new Error("成片格式暂不支持保存"));
          resolve(result.tempFilePath);
        },
        fail: () => reject(new Error("成片文件暂时无法打开"))
      });
    },
    fail: () => reject(new Error("成片下载失败，请检查网络"))
  }));
}

themedPage({
  data: {
    batch: null, items: [], loading: true, busy: false, savingId: "", error: "", message: "", albumDenied: false,
    progressText: "", progressWidth: "0%", paid: false, finished: false
  },
  onLoad(query) { this.batchId = query.id || ""; },
  onShow() { this._visible = true; this.load(); },
  onHide() { this._visible = false; this.stopPolling(); this._loadVersion = (this._loadVersion || 0) + 1; },
  onUnload() { this._visible = false; this.stopPolling(); this._loadVersion = (this._loadVersion || 0) + 1; },
  onPullDownRefresh() {
    this._previewRetryAt = {};
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  stopPolling() { if (this._pollTimer) clearTimeout(this._pollTimer); this._pollTimer = null; },
  schedulePoll(batch) {
    this.stopPolling();
    if (!this._visible || !batch || !batch.order || batch.order.status !== "paid" || FINAL_STATUS.indexOf(batch.status) >= 0) return;
    this._pollTimer = setTimeout(() => this.load(), 4000);
  },
  async load() {
    if (!this.batchId) { this.setData({ loading: false, error: "写真套餐链接无效，请从写真页重新进入" }); return; }
    const version = this._loadVersion = (this._loadVersion || 0) + 1;
    try {
      const batch = await api.request("/api/art-photo-bundles/" + encodeURIComponent(this.batchId));
      if (!this._visible || version !== this._loadVersion) return;
      const paid = Boolean(batch.order && batch.order.status === "paid" && batch.status !== "cancelled");
      const done = Number(batch.completedCount || 0) + Number(batch.failedCount || 0);
      const items = batch.items.map((item) => Object.assign({}, item, {
        number: item.position + 1,
        sampleUrl: manifest.scenes[item.sceneId] || "",
        previewUrl: paid && this._previewPaths && this._previewPaths[item.id] || "",
        statusText: ITEM_STATUS[item.status] || item.status
      }));
      this.setData({ batch, items, paid, finished: FINAL_STATUS.indexOf(batch.status) >= 0,
        progressText: done + " / " + batch.totalCount + " 张已处理", progressWidth: batch.totalCount ? Math.round(done / batch.totalCount * 100) + "%" : "0%",
        loading: false, error: "" });
      this.schedulePoll(batch);
      if (paid) this.loadPreviews();
    } catch (error) { if (this._visible && version === this._loadVersion) this.setData({ loading: false, error: error.message || "写真进度暂时无法读取" }); }
  },
  async loadPreviews() {
    if (this._downloadingPreviews) return;
    this._downloadingPreviews = true;
    this._previewPaths = this._previewPaths || {};
    this._previewRetryAt = this._previewRetryAt || {};
    const pending = this.data.items.filter((item) => item.status === "succeeded" && !this._previewPaths[item.id] && (!this._previewRetryAt[item.id] || this._previewRetryAt[item.id] < Date.now()));
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const item = pending[next++];
        try {
          const path = await downloadItem(this.batchId, item.id, true);
          if (!this._visible || !this.data.paid) return;
          this._previewPaths[item.id] = path;
          const index = this.data.items.findIndex((current) => current.id === item.id && current.status === "succeeded");
          if (index >= 0) this.setData({ ["items[" + index + "].previewUrl"]: path });
        } catch (error) { this._previewRetryAt[item.id] = Date.now() + 30000; }
      }
    };
    try { await Promise.all([worker(), worker(), worker()]); }
    finally { this._downloadingPreviews = false; }
  },
  retryPayment() {
    const batch = this.data.batch;
    if (!batch || !batch.order || batch.order.status !== "pending" || this.data.busy) return;
    this.setData({ busy: true, error: "", message: "" });
    payment.pay("growth", batch.order.id).then(() => this.load())
      .catch((error) => this.setData({ error: error.message || "付款未完成，可稍后继续" }))
      .finally(() => this.setData({ busy: false }));
  },
  preview(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item || !item.previewUrl) return;
    wx.previewImage({ current: item.previewUrl, urls: this.data.items.map((entry) => entry.previewUrl).filter(Boolean) });
  },
  save(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item || item.status !== "succeeded" || !this.data.paid || this.data.savingId) return;
    this.setData({ savingId: item.id, error: "", message: "", albumDenied: false });
    downloadItem(this.batchId, item.id, false).then((filePath) => new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })))
      .then(() => this.setData({ message: item.title + "已保存到手机相册" }))
      .catch((error) => {
        const denied = /auth|deny|denied/i.test(error.errMsg || "");
        this.setData({ error: denied ? "尚未获得相册权限，请在设置中允许后重试" : error.message || "保存失败，请重试", albumDenied: denied });
      })
      .finally(() => this.setData({ savingId: "" }));
  },
  albumSettings() { wx.openSetting({}); },
  goArtPhoto() { wx.switchTab({ url: "/pages/art-photo/art-photo" }); }
});
