const { displayMediaTree } = require("../../services/photo-files");
const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");
const scenes = require("../../theme/scene-presets");

themedPage({
  data: {
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    title: "每一次想念，都在这里发光",
    copy: "把它最熟悉的样子，轻轻放进星光里。",
    theme: "stardust",
    // 场景主题是内容属性，与全局 UI 主题无关（见 theme/scene-presets.js）
    scenePresets: scenes.SCENE_PRESETS,
    sceneStyle: scenes.getSceneStyle("stardust"),
    busy: false, error: "", loading: true
  },
  onLoad(query) {
    this._initialPhotoIds = query && query.photoIds ? query.photoIds.split(",").filter(Boolean) : [];
    api.request("/api/pets").then(displayMediaTree).then((pets) => {
      const pet = query && query.petId ? pets.find((item) => item.id === query.petId) : pets.find((item) => item.isDefault) || pets[0];
      if (query && query.petId && !pet) throw new Error("这只宠物的档案不可用，请重新选择");
      this.setData({ pets, petId: pet ? pet.id : "", petText: pet ? pet.name : "", loading: false });
      if (pet) this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  loadPhotos(id) {
    const request = this._photoRequest = (this._photoRequest || 0) + 1;
    this.setData({ loading: true });
    api.request("/api/photos?petId=" + encodeURIComponent(id)).then(displayMediaTree)
      .then((photos) => { if (request !== this._photoRequest || id !== this.data.petId) return; const photoIds = this._initialPhotoIds || this.data.photoIds; this._initialPhotoIds = null; if (photoIds.length > 6 || photoIds.some((value) => !photos.some((photo) => photo.id === value))) { this.setData({ photos, photoIds: [], loading: false }); throw new Error("部分照片已不可用或超过 6 张，请重新确认素材"); } this.setData({ photos, photoIds, loading: false }); })
      .catch((error) => { if (request === this._photoRequest) this.setData({ error: error.message, loading: false }); });
  },
  onShow() { if (this.data.petId && !this.data.busy) this.loadPhotos(this.data.petId); },
  onHide() { this._photoRequest = (this._photoRequest || 0) + 1; },
  choosePet(event) {
    if (this.data.busy) return;
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this._initialPhotoIds = null;
    this.setData({ petId: pet.id, petText: pet.name, photos: [], photoIds: [], error: "" });
    this.loadPhotos(pet.id);
  },
  togglePhoto(event) {
    const id = event.detail.id;
    const ids = this.data.photoIds.slice();
    const index = ids.indexOf(id);
    if (index >= 0) ids.splice(index, 1);
    else if (ids.length < 6) ids.push(id);
    else return this.setData({ error: "最多选 6 张照片" });
    this.setData({ photoIds: ids, error: "", photos: this.data.photos.map((photo) => Object.assign({}, photo, { selected: ids.indexOf(photo.id) >= 0 })) });
  },
  inputTitle(event) { this.setData({ title: event.detail.value }); },
  inputCopy(event) { this.setData({ copy: event.detail.value }); },
  chooseScene(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ theme: id, sceneStyle: scenes.getSceneStyle(id) });
  },
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos?petId=" + this.data.petId }); },
  create() {
    if (this.data.busy || this.data.loading) return;
    if (!this.data.petId || !this.data.photoIds.length) return this.setData({ error: "请选择宠物和 1-6 张照片" });
    this.setData({ busy: true, error: "" });
    api.request("/api/interactive-sessions", { method: "POST", data: { pluginId: "pl-15", petId: this.data.petId, photoIds: this.data.photoIds, snapshot: { title: this.data.title, copy: this.data.copy, theme: this.data.theme, stardust: 0 } } })
      .then((session) => wx.redirectTo({ url: "/pages/interactive/interactive?id=" + session.id }))
      .catch((error) => this.setData({ busy: false, error: error.message }));
  }
});
