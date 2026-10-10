const wallet = require("../../services/wallet");
const api = require("../../services/api");
const config = require("../../config");
const originals = require("../../services/originals");
const params = require("../../services/params");
const { displayMediaTree } = require("../../services/photo-files");
const { pluginSample, imageEntries } = require("../../services/sample-assets");
const { themedPage } = require("../../theme/page-mixin");

/*
 * 制作与挑选（2026-10 按 prototype.html 第 4 节重做，替代原来的玻璃面板沉浸页）。
 *
 * 等待：模糊的样片 + 我的头像、三段进度、等的时候再挑几套写真。
 * 结果（2026-10 起每次只出 1 张）：出图即由服务端选中并归档进作品柜，这里大图展示，点一下放大；
 * 历史任务仍可能有 2 / 4 张候选，保留并排挑选的分支。底部抽屉写场景名与带价格的保存按钮。
 *
 * 2026-10-08 起先扣冻干再出图：结果直接是正式版，没有预览和二次付费；没有免费重拍，
 * 「再拍一张」是新任务、重新扣费，原结果保留。失败由系统自动重试 2 次，仍失败全额退还冻干。
 */
const REROLL_REASONS = [
  { id: "pet-not-like", label: "宠物不像" },
  { id: "owner-not-like", label: "主人不像", ownerOnly: true },
  { id: "composition", label: "换个构图" }
];
const RUNNING = ["queued", "processing"];

themedPage(Object.assign({}, wallet.walletSheetMethods, {
  data: {
    run: null, candidates: [], pet: null, petAvatarUrl: "", loading: true, busy: false, message: "", messageType: "info",
    humanMode: false, canReroll: false, costText: "", unlockText: "", confirmCancel: false, showSheet: false, selectedLabel: "",
    walletSheet: { visible: false, required: 0, balance: 0, shortfall: 0 },
    waitCoverUrl: "", waitStages: [], waitProgress: 0, suggestScenes: []
  },
  onLoad(query) {
    this.runId = query.id;
    if (!params.isUuid(this.runId)) return this.setData({ loading: false, message: "生成任务链接无效，请从作品柜重新打开。", messageType: "error" });
    this.loadContext().then(() => this.poll());
  },
  onUnload() { if (this.timer) clearTimeout(this.timer); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  /** 一次性的上下文：宠物头像、写真场景、模板名称与价格。失败不挡住任务本身。 */
  loadContext() {
    return Promise.all([
      api.request("/api/pets").then(displayMediaTree).catch(() => []),
      api.request("/api/plugins").catch(() => []),
      api.request("/api/image-templates").catch(() => ({ entries: [] }))
    ]).then((result) => {
      this._pets = result[0] || [];
      this._plugins = (result[1] || []).map(pluginSample);
      const art = this._plugins.find((item) => item.id === "pl-10");
      const samples = art && art.samples || {};
      this._scenes = (samples.sceneOptions || []).map((item) => ({ id: item.id, title: item.title, url: samples.sceneUrls && samples.sceneUrls[item.id] || "" }));
      this._templates = {};
      imageEntries(result[2] && Array.isArray(result[2].entries) ? result[2].entries : []).forEach((entry) => entry.templates.forEach((item) => { this._templates[item.templateId] = item; }));
    });
  },
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
  poll() {
    this.load().then((run) => { if (RUNNING.indexOf(run.status) >= 0) this.timer = setTimeout(() => this.poll(), 1600); })
      .catch((error) => this.setData({ message: error.message, messageType: "error", loading: false }));
  },

  /** 场景名（写真）或模板名（其余玩法），用于进度文案与抽屉标题。 */
  effectOf(run) {
    const sceneId = run.options && run.options.scene;
    const scene = (this._scenes || []).find((item) => item.id === sceneId);
    const templateId = run.roleInputs && run.roleInputs.templateId;
    const template = templateId && templateId !== "pet-art-photo" ? (this._templates || {})[templateId] : null;
    if (template) return { title: template.title, cover: template.sampleUrl };
    return { title: scene ? scene.title : "这组写真", cover: scene ? scene.url : "" };
  },

  deriveRun(run, candidateList) {
    const candidates = candidateList || this.data.candidates;
    const subjectMode = run.roleInputs && run.roleInputs.subjectMode;
    const humanMode = subjectMode === "pet-human";
    const pet = (this._pets || []).find((item) => item.id === run.petId) || null;
    const effect = this.effectOf(run);
    const name = pet ? pet.name : "我";
    const selected = candidates.find((item) => item.id === run.selectedId);
    const processing = run.status === "processing";
    const cost = Number(run.donganCost);
    return {
      run, humanMode, pet, petAvatarUrl: pet && pet.avatarUrl || "",
      // 「再拍一张」按原模板重新扣费；人化模板不支持换理由重拍
      canReroll: !humanMode && ["succeeded", "failed"].indexOf(run.status) >= 0,
      costText: wallet.costText(cost),
      // 冻干上线前的历史任务才会有未解锁的结果
      unlockText: wallet.costText(cost) + " · 保存高清原图",
      single: candidates.length <= 1,
      showSheet: run.status === "succeeded",
      selectedLabel: candidates.length <= 1 ? effect.title : selected ? "第 " + selected.number + " 张 · " + effect.title : "先挑一张喜欢的",
      waitCoverUrl: effect.cover,
      // 三段进度：排队时停在第一段，制作中走到第二段；出图后页面直接切到挑选
      waitStages: [
        { id: "know", label: "认出" + name + "的样子", state: processing ? "done" : "now" },
        { id: "dress", label: (humanMode ? "变成「" : "换上「") + effect.title + "」", state: processing ? "now" : "todo" },
        { id: "polish", label: "精修细节，出片", state: "todo" }
      ],
      waitProgress: processing ? 62 : 18,
      suggestScenes: (this._scenes || []).filter((item) => item.url && item.title !== effect.title).slice(0, 6)
    };
  },

  onCandidateImageError(event) {
    const { id, src } = event.currentTarget.dataset;
    const index = this.data.candidates.findIndex((item) => item.id === id && item.url === src);
    if (index >= 0) this.setData({ ["candidates[" + index + "].imageFailed"]: true });
  },

  /** 点一下选中；已选中的再点一下放大看。 */
  select(event) {
    const id = event.currentTarget.dataset.id;
    const candidate = this.data.candidates.find((item) => item.id === id);
    if (!candidate || candidate.imageFailed || this.data.busy) return;
    if (this.data.run.selectedId === id) {
      return wx.previewImage({ current: candidate.url, urls: this.data.candidates.filter((item) => !item.imageFailed).map((item) => item.url) });
    }
    if (this.data.run.order) return this.setData({ message: "订单已创建，不能再换这一张", messageType: "info" });
    this.setData({ busy: true, message: "" });
    api.request("/api/ai-runs/" + this.runId, { method: "PATCH", data: { action: "select", candidateId: id } })
      .then((run) => this.setData(Object.assign({ busy: false }, this.deriveRun(run))))
      .catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" }));
  },

  /** 重抽降级为文字链接：点开先选方向，再排队。 */
  chooseReroll() {
    if (!this.data.canReroll || this.data.busy) return;
    const ownerMode = this.data.run.roleInputs && this.data.run.roleInputs.subjectMode === "owner-pet";
    const reasons = REROLL_REASONS.filter((item) => !item.ownerOnly || ownerMode);
    wx.showActionSheet({
      itemList: reasons.map((item) => item.label),
      success: (result) => { const reason = reasons[result.tapIndex]; if (reason) this.reroll(reason.id); }
    });
  },
  /** 「再拍一张」：新任务、重新扣冻干；余额不足弹零食柜，到账后用同一个幂等键自动重放。 */
  reroll(reason) {
    this.setData({ busy: true, message: "" });
    const idempotencyKey = "mp-reroll-" + this.runId + "-" + Date.now();
    wallet.withDongan(this, () => api.request("/api/ai-runs/" + this.runId + "/reroll", { method: "POST", data: { reason, idempotencyKey } }))
      .then((run) => wx.redirectTo({ url: "/pages/ai-run/ai-run?id=" + run.id }))
      .catch((error) => this.setData({ busy: false, message: error.code === "WALLET_TOPUP_CANCELLED" ? "" : error.message, messageType: "error" }));
  },
  askCancel() { this.setData({ confirmCancel: true }); },
  dismissCancel() { this.setData({ confirmCancel: false }); },
  cancel() {
    this.setData({ confirmCancel: false });
    api.request("/api/ai-runs/" + this.runId, { method: "PATCH", data: { action: "cancel" } })
      .then((run) => this.setData(Object.assign({ message: "已取消，" + wallet.costText(Number(run.donganCost)) + "已退回。", messageType: "info" }, this.deriveRun(run))))
      .catch((error) => this.setData({ message: error.message, messageType: "error" }));
  },
  openSuggestScene(event) {
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  openArtStudio() { wx.switchTab({ url: "/pages/art-photo/art-photo" }); },

  /** 冻干上线前的历史任务：用冻干解锁（新任务出图即正式版，不会走到这里）。 */
  unlock() {
    this.setData({ busy: true, message: "" });
    wallet.withDongan(this, () => api.request("/api/ai-runs/" + this.runId + "/unlock", { method: "POST" }))
      .then(() => this.load())
      .then(() => this.setData({ busy: false, message: "可以保存高清原图了。", messageType: "success" }))
      .catch((error) => this.setData({ busy: false, message: error.code === "WALLET_TOPUP_CANCELLED" ? "" : error.message || error.errMsg, messageType: "error" }));
  },
  save() {
    const run = this.data.run;
    if (!run || !run.selectedUnlocked || !run.selectedId || this.data.busy) return;
    this.setData({ busy: true, message: "" });
    // original=1：交付原图；首次保存会先确认标识说明（服务端 428），用户放弃时不保存。
    originals.saveOriginal("/api/ai-runs/" + this.runId + "/candidates/" + encodeURIComponent(run.selectedId) + "?original=1")
      .then((result) => { if (result === "saved") wx.showToast({ title: "已保存" }); })
      .catch((error) => this.setData({ message: error.message, messageType: "error" }))
      .finally(() => this.setData({ busy: false }));
  },
  openWork() { const run = this.data.run; if (run && run.workId) wx.navigateTo({ url: "/pages/work/work?id=" + run.workId }); },

  /*
   * 「发给朋友看」：分享卡指向公开落地页 pages/share（好友免登录可看预览，不含原图）。
   * 还没开启分享时先开一个 7 天链接；开不出来就退回首页，不把好友带到只有本人能打开的页面。
   */
  onShareAppMessage() {
    const run = this.data.run;
    const name = this.data.pet ? this.data.pet.name : "我家毛孩子";
    const fallback = { title: name + "拍了一组新照片，你家的也来试试？", path: "/pages/index/index" };
    if (!run || !run.workId) return fallback;
    const toShare = (token) => ({ title: fallback.title, path: "/pages/share/share?token=" + encodeURIComponent(token) });
    if (this._shareToken) return toShare(this._shareToken);
    return Object.assign({}, fallback, {
      promise: api.request("/api/works/" + run.workId + "/share", { method: "POST", data: { expiresInHours: 168 } })
        .then((result) => { this._shareToken = result.token; return toShare(result.token); })
        .catch(() => fallback)
    });
  }
}));
