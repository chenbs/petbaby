const api = require("../../services/api");
const { displayMediaTree, displayPhotos } = require("../../services/photo-files");
const { themedPage } = require("../../theme/page-mixin");
const { manifest } = require("../../services/sample-assets");

themedPage({
  data: {
    packageMode: "ten", priceText: "¥9.9", sceneIds: [], scenes: [],
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    loading: true, photosLoading: false, busy: false, error: ""
  },
  onLoad(query) {
    const mode = query.package === "all" ? "all" : "ten";
    let sceneIds;
    try { sceneIds = decodeURIComponent(query.sceneIds || "").split(",").filter(Boolean); }
    catch (error) { return this.setData({ loading: false, error: "写真场景链接无效，请返回写真页重新选择" }); }
    const expected = mode === "all" ? 24 : 10;
    if (sceneIds.length !== expected || new Set(sceneIds).size !== expected || sceneIds.some((id) => !manifest.scenes[id])) return this.setData({ loading: false, error: "写真场景数量不对，请返回写真页重新选择" });
    this.setData({ packageMode: mode, priceText: mode === "all" ? "¥19.9" : "¥9.9", sceneIds,
      scenes: sceneIds.map((id) => ({ id, url: manifest.scenes[id] || "" })) });
    api.request("/api/pets").then(displayMediaTree).then((pets) => {
      const pet = pets.find((item) => item.isDefault) || pets[0];
      this.setData({ pets, petId: pet ? pet.id : "", petText: pet ? pet.name : "", loading: false });
      if (pet) this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ loading: false, error: error.message }));
  },
  onShow() { if (this.data.petId && !this.data.loading && !this.data.busy) this.loadPhotos(this.data.petId); },
  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet || this.data.busy) return;
    this.setData({ petId: pet.id, petText: pet.name, photoIds: [], photos: [], error: "" });
    this.loadPhotos(pet.id);
  },
  loadPhotos(petId) {
    const request = this._photoRequest = (this._photoRequest || 0) + 1;
    this.setData({ photosLoading: true });
    api.request("/api/photos?petId=" + encodeURIComponent(petId) + "&pageSize=50&order=library").then((page) => displayPhotos(page.items || []))
      .then((photos) => { if (request === this._photoRequest && petId === this.data.petId) this.setData({ photos, photosLoading: false }); })
      .catch((error) => { if (request === this._photoRequest) this.setData({ error: error.message, photosLoading: false }); });
  },
  togglePhoto(event) {
    const id = event.detail.id;
    this.setData({ photoIds: this.data.photoIds[0] === id ? [] : [id], error: "" });
  },
  openPhotos() { wx.navigateTo({ url: this.data.petId ? "/pages/photos/photos?petId=" + encodeURIComponent(this.data.petId) : "/pages/pets/pets" }); },
  submit() {
    if (this.data.busy) return;
    if (!this.data.petId || this.data.photoIds.length !== 1) return this.setData({ error: "请先选择宠物和一张清晰的身份照片" });
    if (!this._requestKey) this._requestKey = "mp-art-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    this.setData({ busy: true, error: "" });
    api.request("/api/art-photo-bundles", { method: "POST", data: {
      package: this.data.packageMode, petId: this.data.petId, photoId: this.data.photoIds[0], sceneIds: this.data.sceneIds, idempotencyKey: this._requestKey
    } }).then((result) => {
      this._batchId = result.batch.id;
      return require("../../services/payment").pay("growth", result.order.id);
    }).then(() => wx.redirectTo({ url: "/pages/art-photo-result/art-photo-result?id=" + encodeURIComponent(this._batchId) }))
      .catch((error) => {
        if (this._batchId) return wx.redirectTo({ url: "/pages/art-photo-result/art-photo-result?id=" + encodeURIComponent(this._batchId) });
        this.setData({ busy: false, error: error.message || error.errMsg || "提交失败，请重试" });
      });
  }
});
