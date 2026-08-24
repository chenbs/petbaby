const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

const STATUS_TEXT = { queued: "排队中", processing: "生成中", succeeded: "已完成", failed: "生成失败", cancelled: "已取消" };
const REROLL_REASONS = [
  { id: "owner-not-like", label: "主人不像", ownerOnly: true },
  { id: "pet-not-like", label: "宠物不像" },
  { id: "composition", label: "构图偏离" }
];

// 沉浸式结果确认区用 navigationStyle: "custom"，导航栏同步无效，交给 immersive 跳过
themedPage({ immersive: true }, {
  data: { run: null, candidates: [], busy: false, message: "", messageType: "info", sharePath: "", loading: true, statusText: "", confirmCancel: false, immersive: false, selectedUrl: "", humanMode: false, rerollReasons: REROLL_REASONS.filter((item) => !item.ownerOnly), rerollReason: "composition" },
  onLoad(query) { this.runId = query.id; this.poll(); },
  onUnload() { if (this.timer) clearTimeout(this.timer); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  load() {
    return api.requestWithRetry("/api/ai-runs/" + this.runId, {}, 2).then((run) => {
      const candidates = (run.candidates || []).map((item, index) => Object.assign({}, item, {
        number: index + 1,
        url: config.apiBaseUrl + "/api/ai-runs/" + this.runId + "/candidates/" + encodeURIComponent(item.id)
      }));
      this.setData(Object.assign({ candidates, loading: false }, this.deriveRun(run, candidates)));
      return run;
    });
  },
  /**
   * run → 页面派生字段。只有「已完成且已选中」才走沉浸式：
   * 候选网格与全屏背景互斥：普通玩法四选一，宠物人化二选一。
   */
  deriveRun(run, candidateList) {
    const candidates = candidateList || this.data.candidates;
    const immersive = run.status === "succeeded" && Boolean(run.selectedId);
    const selected = immersive ? candidates.filter((item) => item.id === run.selectedId)[0] : null;
    const ownerMode = run.roleInputs && run.roleInputs.subjectMode === "owner-pet";
    const humanMode = run.roleInputs && run.roleInputs.subjectMode === "pet-human";
    return { run, statusText: STATUS_TEXT[run.status] || run.status, immersive, selectedUrl: selected ? selected.url : "", humanMode, rerollReasons: REROLL_REASONS.filter((item) => !item.ownerOnly || ownerMode) };
  },
  poll() { this.load().then((run) => { if (run.status === "queued" || run.status === "processing") this.timer = setTimeout(() => this.poll(), 1600); }).catch((error) => this.setData({ message: error.message, messageType: "error", loading: false })); },
  select(event) { this.setData({ busy: true }); api.request("/api/ai-runs/" + this.runId, { method: "PATCH", data: { action: "select", candidateId: event.currentTarget.dataset.id } }).then((run) => this.setData(Object.assign({ busy: false, message: "已选定这一张，解锁只对应它。", messageType: "success" }, this.deriveRun(run)))).catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" })); },
  chooseRerollReason(event) { this.setData({ rerollReason: event.currentTarget.dataset.id }); },
  reroll() { if (this.data.humanMode) return; this.setData({ busy: true }); api.request("/api/ai-runs/" + this.runId + "/reroll", { method: "POST", data: { reason: this.data.rerollReason } }).then((run) => { this.setData(Object.assign({ busy: false, message: "新一组候选已排队。", messageType: "info" }, this.deriveRun(run))); this.poll(); }).catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" })); },
  retry() { this.setData({ busy: true }); api.request("/api/ai-runs/" + this.runId, { method: "PATCH", data: { action: "retry" } }).then((run) => { this.setData(Object.assign({ busy: false }, this.deriveRun(run))); this.poll(); }).catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" })); },
  askCancel() { this.setData({ confirmCancel: true }); },
  dismissCancel() { this.setData({ confirmCancel: false }); },
  cancel() {
    this.setData({ confirmCancel: false });
    api.request("/api/ai-runs/" + this.runId, { method: "PATCH", data: { action: "cancel" } })
      .then((run) => this.setData(Object.assign({ message: "已取消，额度已返还。", messageType: "info" }, this.deriveRun(run))))
      .catch((error) => this.setData({ message: error.message, messageType: "error" }));
  },
  unlock() { this.setData({ busy: true, message: "" }); api.request("/api/ai-runs/" + this.runId + "/unlock", { method: "POST" }).then((run) => { this.setData(this.deriveRun(run)); return api.request("/api/orders/" + run.order.id + "/prepare", { method: "POST" }).then((prepared) => ({ run, prepared })); }).then((result) => { const params = result.prepared.clientParams; if (params.mode === "development") return api.request("/api/orders/" + result.run.order.id + "/pay", { method: "POST" }); return new Promise((resolve, reject) => wx.requestPayment(Object.assign({}, params, { success: resolve, fail: reject }))); }).then(() => this.load()).then(() => this.setData({ busy: false, message: "支付成功，高清权益已生效。", messageType: "success" })).catch((error) => this.setData({ busy: false, message: error.message || error.errMsg, messageType: "error" })); },
  save() { const run = this.data.run; if (!run || !run.selectedUnlocked || !run.selectedId) return; this.setData({ busy: true }); wx.downloadFile({ url: config.apiBaseUrl + "/api/ai-runs/" + this.runId + "/candidates/" + encodeURIComponent(run.selectedId), header: { authorization: "Bearer " + wx.getStorageSync("petbaby_session") }, success: (result) => wx.saveImageToPhotosAlbum({ filePath: result.tempFilePath, success: () => wx.showToast({ title: "已保存" }) }), complete: () => this.setData({ busy: false }) }); },
  share() { const run = this.data.run; if (!run || !run.workId) return; api.request("/api/works/" + run.workId + "/share", { method: "POST", data: { expiresInHours: 168 } }).then((result) => { const path = config.apiBaseUrl + result.path; this.setData({ sharePath: path, message: "分享已开启，链接已复制。", messageType: "success" }); wx.setClipboardData({ data: path }); }).catch((error) => this.setData({ message: error.message, messageType: "error" })); },
  openWork() { const run = this.data.run; if (run && run.workId) wx.navigateTo({ url: "/pages/work/work?id=" + run.workId }); }
});
