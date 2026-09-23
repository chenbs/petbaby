const api = require("../../services/api");
const { recordSession } = require("../../services/record-events");
const { themedPage } = require("../../theme/page-mixin");
const { companionText } = require("../../services/companion");
const { displayMediaTree } = require("../../services/photo-files");
const SOURCES = { manual: "你设置的日期", exif: "照片里的拍摄时间", upload: "按上传时间记录" };
const TAGS = { today: "今天的样子", first: "第一次", walk: "散步", birthday: "生日", learned: "学会了", keep: "只是想留着" };
const ANCHOR_LABEL = { birthday: "出生", got_home: "到家", created: "建档" };

themedPage({
  data: {
    pets: [], petId: "", petText: "", companion: "", anchorLabel: "", totalDays: 0,
    groups: [], milestones: [], totalCount: 0, nextCursor: "", loading: true, loadingMore: false, error: "", empty: false,
    filmYears: [new Date().getFullYear(), new Date().getFullYear() - 1], filmYear: new Date().getFullYear(),
    filmDurations: [10, 20, 30], filmDuration: 20, filmBusy: false, filmHint: "", filmPreview: null, filmPricing: null
  },
  onLoad(options) { this._tracking = recordSession(); this.setData({ petId: options.petId || "" }); },
  onShow() { this._visible = true; this.reload(); },
  onHide() { this._visible = false; this._view = (this._view || 0) + 1; },
  onUnload() { this.onHide(); },
  async reload() {
    const view = this._view = (this._view || 0) + 1;
    this.setData({ loading: true, error: "", groups: [], nextCursor: "", filmPreview: null, filmPricing: null, filmBusy: false });
    try {
      const pets = await api.request("/api/pets");
      if (!this._visible || view !== this._view) return;
      this.setData({ pets });
      const pet = this.data.petId ? pets.find((item) => item.id === this.data.petId) : pets.find((item) => item.isDefault) || pets[0];
      if (this.data.petId && !pet) throw new Error("这只宠物的档案不可用，请重新选择");
      if (!pet) return this.setData({ loading: false, empty: true, petText: "", companion: "" });
      this.setData({ petId: pet.id, petText: pet.name });
      await this.load(false, view);
    } catch (error) { if (view === this._view) this.setData({ loading: false, error: error.message, empty: false }); }
  },
  choosePet(event) {
    if (this.data.filmBusy) return;
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petText: pet.name, filmHint: "" }); this.reload();
  },
  async load(append, view) {
    if (append && (this.data.loadingMore || !this.data.nextCursor)) return;
    view = view || this._view;
    const petId = this.data.petId;
    const pet = this.data.pets.find((item) => item.id === petId);
    this.setData({ loadingMore: Boolean(append) });
    try {
      const timeline = await api.request("/api/pets/" + petId + "/timeline?pageSize=50" + (append ? "&cursor=" + encodeURIComponent(this.data.nextCursor) : "")).then(displayMediaTree);
      if (!this._visible || view !== this._view || petId !== this.data.petId) return;
      const entries = append ? this._entries.concat(timeline.entries) : timeline.entries;
      this._entries = entries;
      if (this._tracking) this._tracking.viewed(petId, "timeline");
      const groups = [];
      entries.forEach((entry) => {
        const year = entry.date.slice(0, 4);
        const item = Object.assign({}, entry, { key: entry.photo.id, sourceText: SOURCES[entry.dateSource], tagTexts: (entry.photo.tags || []).map((code) => TAGS[code]) });
        const last = groups[groups.length - 1];
        if (last && last.year === year) last.items.push(item); else groups.push({ year, items: [item] });
      });
      this.setData({ groups, nextCursor: timeline.nextCursor || "", totalCount: timeline.totalCount, totalDays: timeline.totalDays,
        milestones: timeline.milestones || [], anchorLabel: ANCHOR_LABEL[timeline.anchorType] || "建档",
        companion: companionText(pet, timeline.totalDays), loading: false, loadingMore: false, empty: timeline.totalCount === 0, error: "",
        filmYears: Array.from(new Set([new Date().getFullYear()].concat(entries.map((entry) => Number(entry.date.slice(0, 4)))))).sort((a, b) => b - a) });
    } catch (error) { if (view === this._view) this.setData({ error: error.message, loading: false, loadingMore: false }); }
  },
  more() { return this.load(true); },
  chooseFilmYear(event) { if (!this.data.filmBusy) this.setData({ filmYear: Number(event.currentTarget.dataset.year), filmPreview: null, filmHint: "" }); },
  chooseFilmDuration(event) { if (!this.data.filmBusy) this.setData({ filmDuration: Number(event.currentTarget.dataset.duration), filmPreview: null, filmHint: "" }); },
  async createFilm() {
    if (this.data.filmBusy || !this.data.petId) return;
    const petId = this.data.petId, view = this._view;
    if (this._tracking) this._tracking.deliverable(petId, "pl-19", "timeline");
    this.setData({ filmBusy: true, filmHint: "" });
    try {
      const result = await Promise.all([
        api.request("/api/annual-films?petId=" + petId + "&year=" + this.data.filmYear + "&durationSeconds=" + this.data.filmDuration).then(displayMediaTree),
        api.request("/api/pets/" + petId + "/pricing?pluginId=pl-19")
      ]);
      if (view !== this._view) return;
      if (!result[0].photos.length) throw new Error(this.data.filmYear + " 年还没有可用照片，可以先收好照片或校正日期");
      this.setData({ filmPreview: result[0], filmPricing: result[1] });
    } catch (error) { if (view === this._view) this.setData({ filmHint: error.message || "暂时无法确认素材和报价，请重试" }); }
    finally { if (view === this._view) this.setData({ filmBusy: false }); }
  },
  async confirmFilm() {
    const preview = this.data.filmPreview, view = this._view;
    if (this.data.filmBusy || !preview || preview.petId !== this.data.petId) return;
    this.setData({ filmBusy: true, filmHint: "" });
    try {
      const film = await api.request("/api/annual-films", { method: "POST", data: { petId: preview.petId, year: preview.year, durationSeconds: preview.durationSeconds, photoIds: preview.photos.map((photo) => photo.id) } });
      if (view === this._view) this.setData({ filmPreview: null, filmHint: "已为 " + film.petName + " 开始渲染，使用确认的 " + film.shots + " 张照片。完成后到作品库查看。" });
    } catch (error) { if (view === this._view) this.setData({ filmHint: error.message }); }
    finally { if (view === this._view) this.setData({ filmBusy: false }); }
  },
  openDetail(event) { wx.navigateTo({ url: "/pages/photos/photos?petId=" + this.data.petId + "&photoId=" + event.currentTarget.dataset.id }); },
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos?mode=record&entry=timeline" + (this.data.petId ? "&petId=" + this.data.petId : "") }); }
});
