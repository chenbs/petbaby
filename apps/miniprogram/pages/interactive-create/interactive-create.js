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
  onLoad() {
    api.request("/api/pets").then((pets) => {
      const pet = pets.find((item) => item.isDefault) || pets[0];
      this.setData({ pets, petId: pet ? pet.id : "", petText: pet ? pet.name : "", loading: false });
      if (pet) this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  loadPhotos(id) {
    api.request("/api/photos?petId=" + encodeURIComponent(id))
      .then((photos) => this.setData({ photos, photoIds: [] }))
      .catch((error) => this.setData({ error: error.message }));
  },
  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petText: pet.name });
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
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos" }); },
  create() {
    if (!this.data.petId || !this.data.photoIds.length) return this.setData({ error: "请选择宠物和 1-6 张照片" });
    this.setData({ busy: true, error: "" });
    api.request("/api/interactive-sessions", { method: "POST", data: { pluginId: "pl-15", petId: this.data.petId, photoIds: this.data.photoIds, snapshot: { title: this.data.title, copy: this.data.copy, theme: this.data.theme, stardust: 0 } } })
      .then((session) => wx.redirectTo({ url: "/pages/interactive/interactive?id=" + session.id }))
      .catch((error) => this.setData({ busy: false, error: error.message }));
  }
});
