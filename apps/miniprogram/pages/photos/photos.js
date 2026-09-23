const api = require("../../services/api");
const { recordSession } = require("../../services/record-events");
const { themedPage } = require("../../theme/page-mixin");
const { createUploadSession, preparePhoto } = require("../../services/photo-upload-session");
const { displayPhotos, downloadPhoto, savePhotoToAlbum } = require("../../services/photo-files");

const TAGS = [
  { code: "today", label: "今天的样子" }, { code: "first", label: "第一次" },
  { code: "walk", label: "散步" }, { code: "birthday", label: "生日" },
  { code: "learned", label: "学会了" }, { code: "keep", label: "只是想留着" }
];
const SOURCES = { manual: "你设置的日期", exif: "照片里的拍摄时间", upload: "按上传时间记录" };
const STATES = { ready: "待上传", uploading: "上传中", saved: "已收好", checking: "待核对", failed: "待重试", deleted: "已移除" };

themedPage({
  data: {
    pets: [], petId: "", petText: "", photos: [], totalCount: 0, nextCursor: "", error: "", loading: true, loadingMore: false,
    manage: false, picked: [], removeCount: 0, recordMode: false, batchView: false,
    uploadItems: [], savedCount: 0, pendingCount: 0, uploading: false, preparing: false,
    detail: null, editCaption: "", editDate: "", editTags: [], tagOptions: TAGS, batchEditing: false, saving: false, albumDenied: false, message: ""
  },
  onLoad(query) {
    this._tracking = recordSession();
    this._wantedPhotoId = query.photoId || "";
    this._entry = ["index", "me", "pets", "timeline"].indexOf(query.entry) >= 0 ? query.entry : "photos";
    this.setData({ petId: query.petId || "", recordMode: query.mode === "record" });
  },
  onShow() { this._visible = true; this.load(); },
  onHide() { this._visible = false; if (this._session) this._session.stop(); },
  onUnload() { this._visible = false; this._loadId = (this._loadId || 0) + 1; if (this._session) this._session.stop(); },
  async load() {
    const loadId = this._loadId = (this._loadId || 0) + 1;
    this.setData({ loading: true, error: "", photos: [], nextCursor: "", batchView: false });
    try {
      const result = await Promise.all([api.request("/api/pets"), api.request("/api/account")]);
      if (!this._visible || loadId !== this._loadId) return;
      const pets = result[0], account = result[1];
      const petId = this.data.petId || (pets.find((item) => item.isDefault) || pets[0] || {}).id || "";
      const pet = pets.find((item) => item.id === petId);
      this.setData({ pets });
      if (petId && !pet) throw new Error("这只宠物的档案不可用，请重新选择宠物");
      this.setData({ petId, petText: pet ? pet.name : "", totalCount: pet && pet.counts ? pet.counts.photos : 0 });
      if (this.data.recordMode && this._tracking) this._tracking.opened(this._entry, petId);
      if (!pet) { this.setData({ loading: false }); return; }
      if (!this._session || this._session.petId !== petId || this._session.accountId !== account.id) {
        if (this._session) this._session.stop();
        this._session = createUploadSession({
          accountId: account.id, petId, petName: pet.name, entry: this._entry,
          onChange: (state) => { if (this._visible && this.data.petId === petId) this.syncUpload(state); },
          onLoginRequired: () => { this.setData({ error: "登录状态已失效，请登录后回来核对保存结果" }); wx.navigateTo({ url: "/pages/login/login" }); }
        });
      }
      await this._session.reconcile();
      await this.loadPage(false, loadId);
      if (this._wantedPhotoId && loadId === this._loadId) {
        const id = this._wantedPhotoId; this._wantedPhotoId = "";
        this.openDetail(id);
      }
    } catch (error) {
      if (loadId === this._loadId) this.setData({ loading: false, error: error.message, photos: [], detail: null });
    }
  },
  async loadPage(append, expectedLoadId) {
    const loadId = expectedLoadId || this._loadId;
    const petId = this.data.petId;
    if (!petId || (append && (!this.data.nextCursor || this.data.loadingMore))) return;
    const pageRequest = this._pageRequest = (this._pageRequest || 0) + 1;
    this.setData({ loadingMore: Boolean(append), ...(append ? {} : { nextCursor: "" }) });
    try {
      const page = await api.request("/api/photos?petId=" + petId + "&pageSize=50&order=library" + (append ? "&cursor=" + encodeURIComponent(this.data.nextCursor) : ""));
      const photos = await displayPhotos(page.items);
      if (!this._visible || loadId !== this._loadId || petId !== this.data.petId || pageRequest !== this._pageRequest) return;
      this.setData({ photos: append ? this.data.photos.concat(photos) : photos, totalCount: page.totalCount, nextCursor: page.nextCursor || "", loading: false, loadingMore: false });
    } catch (error) { if (loadId === this._loadId && pageRequest === this._pageRequest) this.setData({ error: error.message, loading: false, loadingMore: false }); }
  },
  more() { this.loadPage(true); },
  choosePet(event) {
    if (this.data.saving || this.data.preparing) return;
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet || pet.id === this.data.petId) return;
    const change = () => {
      if (this._session) this._session.stop();
      this.setData({ petId: pet.id, petText: pet.name, picked: [], manage: false, detail: null, uploadItems: [], savedCount: 0, pendingCount: 0, uploading: false, message: "" });
      this.load();
    };
    if (this.data.pendingCount) wx.showModal({ title: "切换宠物", content: "本批照片属于 " + this.data.petText + "。切换会停止当前上传，已发出的请求会保留待核对，不会改挂到另一只宠物。", success: (result) => { if (result.confirm) change(); } });
    else change();
  },
  newPet() {
    wx.navigateTo({ url: "/pages/pets/pets?mode=create&returnToRecord=1", events: { petCreated: (result) => this.setData({ petId: result.petId, recordMode: true }) } });
  },
  goCreate() { if (!this.data.petId) this.newPet(); else { this.setData({ recordMode: true }); if (this._tracking) this._tracking.opened(this._entry, this.data.petId); } },
  makeWork(event) {
    const petId = this.data.petId;
    if (!petId) return;
    const kind = event.currentTarget.dataset.kind;
    if (this._tracking) this._tracking.deliverable(petId, kind === "video" ? "pl-19" : "pet-time-album", "photos");
    const ids = this.data.picked.length ? this.data.picked : this._session ? this._session.snapshot().items.filter((item) => item.state === "saved").map((item) => item.photoId) : [];
    const suffix = "&petId=" + petId + (ids.length ? "&photoIds=" + encodeURIComponent(ids.join(",")) : "");
    if (kind === "video") return wx.navigateTo({ url: "/pages/video-create/video-create?entry=record" + suffix });
    wx.navigateTo({ url: "/pages/create/create?pluginId=pet-time-album&entry=record" + suffix });
  },
  async compare() {
    const petId = this.data.petId;
    try {
      const result = await api.request("/api/pets/" + petId + "/timeline?pageSize=1&includePair=1");
      if (petId !== this.data.petId) return;
      if (!result.growthPair) throw new Error("成长对比需要同一只宠物在两个不同记录日期的照片，可以先补好日期");
      if (this._tracking) this._tracking.deliverable(petId, "pl-23", "photos");
      wx.navigateTo({ url: "/pages/create/create?pluginId=pl-23&entry=record&petId=" + petId + "&photoIds=" + result.growthPair.earliest.photo.id + "," + result.growthPair.latest.photo.id });
    } catch (error) { if (petId === this.data.petId) this.setData({ error: error.message }); }
  },
  syncUpload(state) {
    this.setData({ uploadItems: state.items.map((item) => Object.assign({}, item, { stateText: STATES[item.state] })), savedCount: state.savedCount, pendingCount: state.pendingCount, uploading: state.running });
    if (state.pendingCount && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: "未完成的上传将停止，已发出的照片会在回来后核对保存结果。" });
    else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },
  choosePhotos(event) {
    if (this.data.uploading || this.data.preparing || !this._session) return;
    const replaceId = event && event.currentTarget && event.currentTarget.dataset.id;
    const remaining = replaceId ? 1 : 9 - this._session.items.length;
    if (remaining <= 0) return this.setData({ error: "这批已选 9 张，请先收好后再开始下一批" });
    wx.chooseMedia({ count: remaining, mediaType: ["image"], sourceType: ["album", "camera"], success: async (result) => {
      this.setData({ preparing: true, error: "" });
      const target = this._session;
      try {
        for (const file of result.tempFiles) {
          const prepared = await preparePhoto(file);
          if (target !== this._session) return;
          if (replaceId) target.replace(replaceId, prepared); else target.add([prepared]);
        }
      } catch (error) { this.setData({ error: error.message }); }
      finally { this.setData({ preparing: false }); }
    }, fail: (error) => { if (!/cancel/.test(error.errMsg || "")) this.setData({ error: "未能打开相册，请重试" }); } });
  },
  async savePhotos() {
    if (!this._session || this.data.uploading || this.data.preparing) return;
    const target = this._session;
    await target.run();
    if (target !== this._session || !this._visible) return;
    this.syncUpload(target.snapshot());
    this.setData({ message: this.data.savedCount ? "已收进 " + this.data.petText + " 的时间线，这次收好 " + this.data.savedCount + " 张" : "", batchView: false });
    await this.loadPage(false);
  },
  continueBatch() {
    if (this.data.pendingCount) return this.setData({ error: "请先核对或重试本批未完成的照片" });
    if (this._session) this._session.reset();
    this.setData({ message: "", recordMode: true });
  },
  cancelSelected(event) { if (this._session) this._session.remove(event.currentTarget.dataset.id); },
  async viewSaved() {
    const ids = this.data.uploadItems.filter((item) => item.state === "saved").map((item) => item.photoId);
    const petId = this.data.petId, loadId = this._loadId;
    this._pageRequest = (this._pageRequest || 0) + 1;
    try {
      const photos = await Promise.all(ids.map((id) => api.request("/api/photos/" + id)));
      const displayed = await displayPhotos(photos);
      if (petId === this.data.petId && loadId === this._loadId) this.setData({ photos: displayed, nextCursor: "", batchView: true });
    } catch (error) { this.setData({ error: error.message }); }
  },
  toggleManage() { this.setData({ manage: !this.data.manage, picked: [] }); },
  togglePick(event) {
    const id = event.detail.id;
    if (!this.data.manage) return this.openDetail(id);
    const picked = this.data.picked.slice();
    const index = picked.indexOf(id);
    if (index >= 0) picked.splice(index, 1); else picked.push(id);
    this.setData({ picked });
  },
  async openDetail(id) {
    const petId = this.data.petId;
    const detailRequest = this._detailRequest = (this._detailRequest || 0) + 1;
    try {
      const detail = await api.request("/api/photos/" + id);
      if (detail.petId !== petId || petId !== this.data.petId || !this._visible) return;
      const localUrl = await downloadPhoto(detail);
      if (petId !== this.data.petId || !this._visible || detailRequest !== this._detailRequest) return;
      this.setData({ detail: Object.assign({}, detail, { localUrl, sourceText: SOURCES[detail.memoryDateSource] }), batchEditing: false, editCaption: detail.caption || "", editDate: detail.memoryDate || "", editTags: detail.tags || [], albumDenied: false, error: "" });
      if (this._tracking) this._tracking.viewed(petId, "detail");
      this.syncTags();
    } catch (error) { this.setData({ error: error.message }); }
  },
  async editBatch() {
    const ids = this.data.uploadItems.filter((item) => item.state === "saved").map((item) => item.photoId);
    if (!ids.length) return;
    const petId = this.data.petId;
    try {
      const photos = await Promise.all(ids.map((id) => api.request("/api/photos/" + id)));
      if (petId !== this.data.petId) return;
      this._batchVersions = photos.map((photo) => ({ photoId: photo.id, version: photo.metadataVersion }));
      this.setData({ batchEditing: true, detail: null, editCaption: "", editDate: "", editTags: [], error: "" });
      this.syncTags();
    } catch (error) { this.setData({ error: error.message }); }
  },
  closeDetail() { if (!this.data.saving) this.setData({ detail: null, batchEditing: false }); },
  inputCaption(event) { this.setData({ editCaption: event.detail.value }); },
  chooseDate(event) { this.setData({ editDate: event.detail.value }); },
  clearDate() { this.setData({ editDate: "" }); },
  syncTags() { this.setData({ tagOptions: TAGS.map((tag) => Object.assign({}, tag, { selected: this.data.editTags.indexOf(tag.code) >= 0 })) }); },
  toggleTag(event) {
    const code = event.currentTarget.dataset.code, tags = this.data.editTags.slice(), index = tags.indexOf(code);
    if (index >= 0) tags.splice(index, 1); else if (tags.length < 3) tags.push(code); else return this.setData({ error: "每张最多选三个标签" });
    this.setData({ editTags: tags }); this.syncTags();
  },
  async saveMetadata() {
    if (this.data.saving || (!this.data.detail && !this.data.batchEditing)) return;
    this.setData({ saving: true, error: "" });
    const detail = this.data.detail, petId = this.data.petId;
    try {
      await api.request(detail ? "/api/photos/" + detail.id : "/api/pets/" + petId + "/photo-metadata", {
        method: "PATCH", data: Object.assign({ caption: this.data.editCaption, tags: this.data.editTags }, detail ? { version: detail.metadataVersion, memoryDate: this.data.editDate || null } : { photos: this._batchVersions })
      });
      this.setData({ detail: null, batchEditing: false, message: "记录已更新", picked: [], batchView: false });
      await this.loadPage(false);
    } catch (error) { this.setData({ error: error.message + (error.code === "PHOTO_VERSION_CONFLICT" ? "。请关闭并重新打开这张照片后修改。" : "") }); }
    finally { this.setData({ saving: false }); }
  },
  async download() {
    if (!this.data.detail || this.data.saving) return;
    this.setData({ saving: true, error: "", albumDenied: false });
    try { await savePhotoToAlbum(this.data.detail); wx.showToast({ title: "已保存到手机相册", icon: "none" }); }
    catch (error) { this.setData({ error: error.message, albumDenied: Boolean(error.albumDenied) }); }
    finally { this.setData({ saving: false }); }
  },
  albumSettings() { wx.openSetting({}); },
  previewDetail() { if (this.data.detail) wx.previewImage({ urls: [this.data.detail.localUrl] }); },
  askRemove() { if (this.data.picked.length) this.setData({ removeCount: this.data.picked.length }); },
  cancelRemove() { this.setData({ removeCount: 0 }); },
  async confirmRemove() {
    const ids = this.data.picked.slice();
    this.setData({ removeCount: 0, error: "" });
    const failed = [];
    for (const id of ids) {
      try { await api.request("/api/photos/" + id, { method: "DELETE" }); }
      catch (error) { failed.push(error.message); }
    }
    this.setData({ picked: [], manage: false, detail: null, batchView: false, message: "已从照片库移除 " + (ids.length - failed.length) + " 张", error: failed.join("；") });
    if (this._session) await this._session.reconcile();
    await this.loadPage(false);
  },
  timeline() { if (this.data.petId) wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + this.data.petId }); },
  home() { wx.switchTab({ url: "/pages/index/index" }); }
});
