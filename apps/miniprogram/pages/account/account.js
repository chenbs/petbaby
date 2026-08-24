const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

themedPage({
  data: {
    profile: null,
    name: "",
    loading: true,
    saving: false,
    deleting: false,
    confirmDelete: false,
    notice: "",
    noticeType: "info"
  },
  onLoad() {
    api.request("/api/account")
      .then((profile) => this.setData({ profile, name: profile.displayName || "", loading: false }))
      .catch((error) => this.setData({ loading: false, notice: error.message, noticeType: "error" }));
  },
  onName(event) { this.setData({ name: event.detail.value }); },
  clearNotice() { this.setData({ notice: "" }); },
  save() {
    if (!this.data.name.trim() || this.data.saving) return;
    this.setData({ saving: true, notice: "" });
    api.request("/api/account", { method: "PATCH", data: { displayName: this.data.name } })
      .then((profile) => this.setData({ profile, saving: false, notice: "资料已保存", noticeType: "success" }))
      .catch((error) => this.setData({ saving: false, notice: error.message, noticeType: "error" }));
  },
  exportData() {
    wx.showLoading({ title: "准备导出" });
    wx.downloadFile({
      url: config.apiBaseUrl + "/api/account/export",
      header: { authorization: "Bearer " + wx.getStorageSync("petbaby_session") },
      success: (result) => wx.openDocument({ filePath: result.tempFilePath, fileType: "json" }),
      fail: () => this.setData({ notice: "导出失败，请稍后再试", noticeType: "error" }),
      complete: () => wx.hideLoading()
    });
  },
  askDelete() { this.setData({ confirmDelete: true }); },
  cancelDelete() { this.setData({ confirmDelete: false }); },
  doDelete() {
    this.setData({ confirmDelete: false, deleting: true, notice: "" });
    api.request("/api/account/delete", { method: "POST" })
      .then(() => wx.reLaunch({ url: "/pages/index/index" }))
      .catch((error) => this.setData({ deleting: false, notice: error.message, noticeType: "error" }));
  }
});
