const api = require("../../services/api");
const { displayMediaTree, displayPhotos } = require("../../services/photo-files");
const { themedPage } = require("../../theme/page-mixin");
const { manifest } = require("../../services/sample-assets");
const { uploadOnePhoto } = require("../../services/quick-upload");
const wallet = require("../../services/wallet");
const { openPetCreator, remind } = require("../../services/pet-onboarding");

/** 写真套餐两档：10 张 12 颗、20 张 20 颗（2026-10-08）。 */
const PACK_COUNT = { ten: 10, twenty: 20 };

themedPage(Object.assign({}, wallet.walletSheetMethods, {
  data: {
    packageMode: "ten", priceText: "", sceneIds: [], scenes: [],
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    loading: true, photosLoading: false, busy: false, error: "",
    walletSheet: { visible: false, required: 0, balance: 0, shortfall: 0 }
  },
  onLoad(query) {
    const mode = query.package === "twenty" ? "twenty" : "ten";
    let sceneIds;
    try { sceneIds = decodeURIComponent(query.sceneIds || "").split(",").filter(Boolean); }
    catch (error) { return this.setData({ loading: false, error: "写真场景链接无效，请返回写真页重新选择" }); }
    const expected = PACK_COUNT[mode];
    if (sceneIds.length !== expected || new Set(sceneIds).size !== expected || sceneIds.some((id) => !manifest.scenes[id])) return this.setData({ loading: false, error: "写真场景数量不对，请返回写真页重新选择" });
    // 颗数与扣费同源，从服务端取，端上不写死。
    api.request("/api/art-photo-bundles/packages").then((packages) => { const pack = packages && packages[mode]; if (pack) this.setData({ priceText: wallet.costText(pack.cost) }); }).catch(() => undefined);
    this.setData({ packageMode: mode, sceneIds,
      scenes: sceneIds.map((id) => ({ id, url: manifest.scenes[id] || "" })) });
    api.request("/api/pets").then(displayMediaTree).then((pets) => {
      const pet = pets.find((item) => item.isDefault) || pets[0];
      this.setData({ pets, petId: pet ? pet.id : "", petText: pet ? pet.name : "", loading: false });
      if (pet) this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ loading: false, error: error.message }));
  },
  onShow() { if (this.data.petId && !this.data.loading && !this.data.busy) this.loadPhotos(this.data.petId); },
  choosePetChip(event) { this.choosePet({ detail: { value: event.currentTarget.dataset.index } }); },
  /** 首格「＋」就地上传：传完刷新列表并自动选中这一张（原先要跳去照片库再回来）。 */
  uploadPetPhoto() {
    const pet = this.data.pets.find((item) => item.id === this.data.petId);
    if (!pet || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    uploadOnePhoto(pet, "art-photo-bundle")
      .then((photoId) => { if (!photoId) return; this._pickAfterLoad = photoId; this.loadPhotos(pet.id); })
      .catch((error) => this.setData({ error: error.message }))
      .finally(() => this.setData({ busy: false }));
  },
  /** 没有档案时直接打开新建抽屉；建成后回到这里并选中新宠物。 */
  openPets() { if (!this.data.busy) openPetCreator((petId) => this.useNewPet(petId)); },
  useNewPet(petId) {
    return api.request("/api/pets").then(displayMediaTree).then((pets) => {
      const pet = pets.find((item) => item.id === petId);
      if (!pet) return;
      this.setData({ pets, petId: pet.id, petText: pet.name, photos: [], photoIds: [], error: "" });
      this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ error: error.message }));
  },
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
      .then((photos) => { if (request !== this._photoRequest || petId !== this.data.petId) return; const picked = this._pickAfterLoad; this._pickAfterLoad = ""; const photoIds = picked && photos.some((item) => item.id === picked) ? [picked] : this.data.photoIds.length ? this.data.photoIds : photos[0] ? [photos[0].id] : []; this.setData({ photos, photoIds, photosLoading: false }); })
      .catch((error) => { if (request === this._photoRequest) this.setData({ error: error.message, photosLoading: false }); });
  },
  togglePhoto(event) {
    const id = event.detail.id;
    this.setData({ photoIds: this.data.photoIds[0] === id ? [] : [id], error: "" });
  },
  openPhotos() { if (!this.data.petId) return this.openPets(); wx.navigateTo({ url: "/pages/photos/photos?petId=" + encodeURIComponent(this.data.petId) }); },
  submit() {
    if (this.data.busy) return;
    if (this.data.loading || this.data.photosLoading) return;
    // 缺什么就带用户去补，按钮不再置灰没反应
    if (!this.data.pets.length) { remind("先给它建一份档案"); return this.openPets(); }
    if (!this.data.petId) return remind("先选一只宠物");
    if (!this.data.photos.length) return this.uploadPetPhoto();
    if (this.data.photoIds.length !== 1) return remind("先选 1 张清晰正脸照");
    if (!this._requestKey) this._requestKey = "mp-art-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    this.setData({ busy: true, error: "" });
    // 先扣冻干再逐张制作；余额不足弹零食柜，到账后用同一个幂等键重放。
    wallet.withDongan(this, () => api.request("/api/art-photo-bundles", { method: "POST", data: {
      package: this.data.packageMode, petId: this.data.petId, photoId: this.data.photoIds[0], sceneIds: this.data.sceneIds, idempotencyKey: this._requestKey
    } })).then((result) => wx.redirectTo({ url: "/pages/art-photo-result/art-photo-result?id=" + encodeURIComponent(result.batch.id) }))
      .catch((error) => this.setData({ busy: false, error: error.code === "WALLET_TOPUP_CANCELLED" ? "" : error.message || error.errMsg || "提交失败，请重试" }));
  }
}));
