const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

const BGM = [
  { id: "none", label: "不加音乐", hint: "只有画面" },
  { id: "calm", label: "安静", hint: "钢琴，慢" },
  { id: "bright", label: "明亮", hint: "轻快，跳" }
];

/**
 * 成片总时长三档。服务端的单一事实来源在
 * `apps/platform/src/domain/video-duration.ts`，小程序没法共享模块，
 * 这里是对照实现 —— 改档位或上限必须两边同步，否则端上允许选的张数
 * 会被服务端以 VIDEO_DURATION_MISMATCH 拒掉。
 *
 * 单张停留 = 总时长 ÷ 张数，下限 1 秒。硬约束其实是两段 fade 之和 0.9 秒，
 * 但取整到 1 秒是为了留余量：0.909 秒（10 秒 ÷ 11 张）只比 fade 多 9 毫秒，
 * 画面刚淡入完就开始淡出，观感仍然是黑场。
 * 于是 10 秒档 ≤10 张，20/30 秒档受 20 张的绝对上限约束。
 */
const MIN_PHOTO_SECONDS = 1;
const MAX_PHOTOS = 20;
const DURATIONS = [10, 20, 30];

/** 某档时长下的张数上限。与服务端 maxPhotosFor 同一算式 */
function maxPhotosFor(seconds) {
  return Math.max(1, Math.min(MAX_PHOTOS, Math.floor(seconds / MIN_PHOTO_SECONDS)));
}

/** chip 选项：把「最多几张」直接写在选项里，用户选之前就知道代价 */
const DURATION_OPTIONS = DURATIONS.map(function (seconds) {
  return { id: String(seconds), label: seconds + " 秒", hint: "最多 " + maxPhotosFor(seconds) + " 张" };
});

themedPage({
  data: {
    pets: [], petId: "", petText: "", photos: [], selected: [],
    title: "我们的日常电影", caption: "", bgm: "none", bgmOptions: BGM,
    durationSeconds: 20, durationValue: "20", durationOptions: DURATION_OPTIONS, maxPhotos: maxPhotosFor(20),
    error: "", busy: false, loading: true, durationText: "20 秒成片"
  },
  onLoad() {
    api.request("/api/pets").then((pets) => {
      const pet = pets.find((item) => item.isDefault) || pets[0];
      this.setData({ pets, petId: pet ? pet.id : "", petText: pet ? pet.name : "", loading: false });
      if (pet) this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  loadPhotos(id) {
    api.request("/api/photos?petId=" + encodeURIComponent(id))
      .then((photos) => { this.setData({ photos, selected: [] }); this.syncDuration(); })
      .catch((error) => this.setData({ error: error.message }));
  },
  /**
   * 成片时长由用户选，这里只回答「当前张数配这个时长，每张停多久」。
   *
   * 超上限时给出明确提示而不是悄悄截断：截断等于替用户丢掉他选好的照片。
   */
  syncDuration() {
    const count = this.data.selected.length;
    const total = this.data.durationSeconds;
    const limit = maxPhotosFor(total);
    if (!count) return this.setData({ durationText: total + " 秒成片", maxPhotos: limit });
    if (count > limit) {
      return this.setData({
        maxPhotos: limit,
        durationText: total + " 秒最多放 " + limit + " 张",
        error: total + " 秒的片子最多放 " + limit + " 张照片，当前选了 " + count + " 张。取消几张，或把时长调长。"
      });
    }
    this.setData({ maxPhotos: limit, durationText: total + " 秒 · 每张约 " + (total / count).toFixed(1) + " 秒", error: "" });
  },
  chooseDuration(event) {
    const seconds = Number(event.detail.value);
    if (!seconds) return;
    this.setData({ durationSeconds: seconds, durationValue: String(seconds) });
    this.syncDuration();
  },
  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petText: pet.name });
    this.loadPhotos(pet.id);
  },
  toggle(event) {
    const id = event.detail.id;
    const selected = this.data.selected.slice();
    const index = selected.indexOf(id);
    const limit = maxPhotosFor(this.data.durationSeconds);
    if (index >= 0) selected.splice(index, 1);
    else if (selected.length < limit) selected.push(id);
    else return this.setData({ error: this.data.durationSeconds + " 秒的片子最多放 " + limit + " 张照片。把时长调长可以多放几张。" });
    this.setData({ selected, error: "", photos: this.data.photos.map((photo) => Object.assign({}, photo, { selected: selected.indexOf(photo.id) >= 0 })) });
    this.syncDuration();
  },
  inputTitle(event) { this.setData({ title: event.detail.value }); },
  inputCaption(event) { this.setData({ caption: event.detail.value }); },
  chooseBgm(event) { this.setData({ bgm: event.currentTarget.dataset.id }); },
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos" }); },
  create() {
    if (!this.data.petId || !this.data.selected.length) return this.setData({ error: "请先选择照片" });
    const limit = maxPhotosFor(this.data.durationSeconds);
    if (this.data.selected.length > limit) return this.setData({ error: this.data.durationSeconds + " 秒的片子最多放 " + limit + " 张照片，取消几张再创建。" });
    this.setData({ busy: true, error: "" });
    api.request("/api/video-projects", { method: "POST", data: { petId: this.data.petId, title: this.data.title, photoIds: this.data.selected, durationSeconds: this.data.durationSeconds, captions: this.data.caption ? [this.data.caption] : [], bgm: this.data.bgm, transitions: this.data.selected.map(() => "fade") } })
      .then((project) => wx.redirectTo({ url: "/pages/video/video?id=" + project.id }))
      .catch((error) => this.setData({ busy: false, error: error.message }));
  }
});
