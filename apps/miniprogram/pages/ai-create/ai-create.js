const api = require("../../services/api");
const { displayMediaTree: withPrivatePreviews } = require("../../services/photo-files");
const { themedPage } = require("../../theme/page-mixin");
const { pluginSample, imageEntries } = require("../../services/sample-assets");
const { selectBossTemplates } = require("../../services/home-effect-ids");
const { uploadOnePhoto } = require("../../services/quick-upload");

themedPage({
  data: {
    flowSteps: ["选效果", "选照片"],
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    entries: [], entryId: "", entryTitle: "", templates: [], carouselTemplates: [], templateId: "", effectScrollTarget: "", effectScrollLeft: 0, activeTemplate: null,
    artPlugin: null, sceneOptions: [], sceneId: "window-morning", selectedScene: null,
    stage: "samples",
    ownerPhotos: [], ownerPhotoIds: [], authorizationConfirmed: false,
    unlockPrice: null, previewUrl: "", previewShape: "card", candidateCount: 1, artPackages: [],
    busy: false, error: "", loading: true, catalogLoading: true
  },
  onLoad(query) {
    this._query = query || {};
    this._initialPhotoIds = query && query.photoIds ? query.photoIds.split(",").filter(Boolean) : [];
    this.loadCatalog();
  },
  loadCatalog() {
    const query = this._query;
    this.setData({ catalogLoading: true, error: "" });
    Promise.all([
      api.request("/api/pets").then(withPrivatePreviews),
      api.request("/api/image-templates"),
      api.request("/api/owner-photos"),
      api.request("/api/plugins"),
      // 麻麻精选与首页同源：后台配置优先，接口不可用时用端上内置清单。
      api.request("/api/home-curation").catch(() => null),
      // 写真套餐价格与写真馆同源；拿不到就不显示套餐卡，不挡单张制作
      api.request("/api/art-photo-bundles/packages").catch(() => null)
    ]).then((results) => {
      const packs = results[5] || {};
      this.setData({ artPackages: ["ten", "all"].filter((id) => packs[id] && typeof packs[id].amount === "number").map((id) => ({ id, label: packs[id].label || (id === "ten" ? "精选 10 套" : "全部套餐"), price: "¥" + packs[id].amount, count: packs[id].count })) });
      const curation = results[4] && results[4].lead ? results[4] : null;
      this._bossIds = curation ? [curation.lead.templateId].concat(curation.templateIds) : null;
      const pets = results[0] || [];
      const entries = imageEntries(results[1] && results[1].entries);
      const artSource = (results[3] || []).find((item) => item.id === "pl-10");
      const artPlugin = artSource ? pluginSample(artSource) : null;
      const unlockPrice = artSource && artSource.pricing && artSource.pricing.unlockPrice || null;
      const sceneOptions = artPlugin && artPlugin.samples && artPlugin.samples.sceneOptions
        ? artPlugin.samples.sceneOptions.map((item) => Object.assign({}, item, { url: artPlugin.samples.sceneUrls && artPlugin.samples.sceneUrls[item.id] || "" }))
        : [];
      const selectedPet = query && query.petId ? pets.find((item) => item.id === query.petId) : pets.find((item) => item.isDefault) || pets[0];
      if (query && query.petId && !selectedPet) throw new Error("这只宠物的档案不可用，请重新选择");
      const entry = entries.find((item) => item.id === query.entryId)
        || entries.find((item) => item.templates.some((template) => template.templateId === query.templateId))
        || entries.find((item) => item.id === "art") || entries[0];
      const templates = entry && entry.id === "boss" ? selectBossTemplates(entries, this._bossIds) : entry ? entry.templates : [];
      const template = templates.find((item) => item.templateId === query.templateId) || templates[0];
      const sceneId = query && query.sceneId && sceneOptions.some((item) => item.id === query.sceneId)
        ? query.sceneId : sceneOptions.length ? sceneOptions[0].id : "window-morning";
      this.setData({
        pets,
        petId: selectedPet ? selectedPet.id : "",
        petText: selectedPet ? selectedPet.name : "",
        entries,
        entryId: entry ? entry.id : "",
        entryTitle: entry ? entry.id === "boss" ? "麻麻精选" : entry.title : "",
        templates,
        carouselTemplates: templates.filter((item) => item.templateId !== "pet-art-photo"),
        templateId: template ? template.templateId : "",
        effectScrollTarget: template && template.templateId !== "pet-art-photo" ? "effect-" + template.templateId : "",
        activeTemplate: template || null,
        artPlugin,
        sceneOptions,
        sceneId,
        selectedScene: sceneOptions.find((item) => item.id === sceneId) || null,
        unlockPrice,
        candidateCount: template && template.candidateCount || 1,
        stage: (query && query.entryId === "human" && !query.templateId) || (template && template.templateId === "pet-art-photo" && !query.sceneId) ? "samples" : "photos",
        loading: false,
        catalogLoading: false
      });
      this.syncPreview();
      if (wx.setNavigationBarTitle && template) wx.setNavigationBarTitle({ title: entry && entry.id === "human" && !query.templateId ? entry.title : template.templateId === "pet-art-photo" ? "宠物艺术写真" : template.title });
      if (selectedPet) this.loadPhotos(selectedPet.id);
      return withPrivatePreviews(results[2] || []);
    }).then((ownerPhotos) => this.setData({ ownerPhotos })).catch((error) => this.setData({ error: error.message, loading: false, catalogLoading: false }));
  },
  /**
   * 照片阶段的大图预览。容器比例跟着素材走，避免把 9:16 样片裁成 3:4：
   * 写真场景（3:4）→ card 铺满；竖版模板（9:16）→ portrait，在 3:4 框里完整显示；横版模板 → wide（16:9）。
   */
  syncPreview() {
    const template = this.data.activeTemplate;
    const art = this.data.templateId === "pet-art-photo";
    const scene = this.data.selectedScene;
    const previewUrl = art ? scene && scene.url || "" : template && template.sampleUrl || "";
    const previewShape = art ? "card" : template && template.sampleShape === "wide" ? "wide" : "portrait";
    this.setData({ previewUrl, previewShape, effectScrollTarget: "effect-" + (art ? this.data.sceneId : this.data.templateId), effectScrollLeft: this.centeredScrollLeft(art) });
  },
  /**
   * 缩略图条把选中项滚到正中（scroll-into-view 只会贴左）。
   * 尺寸与 wxss 一致：缩略图 134rpx + 右边距 16rpx，条宽 = 屏宽 - 两侧 32rpx 页边距。
   */
  centeredScrollLeft(art) {
    const list = art ? this.data.sceneOptions : this.data.carouselTemplates;
    const current = art ? this.data.sceneId : this.data.templateId;
    const index = (list || []).findIndex((item) => (art ? item.id : item.templateId) === current);
    if (index < 0) return 0;
    const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : null) || {};
    const rpx = (info.windowWidth || 375) / 750;
    const thumb = 134 * rpx, pitch = 150 * rpx, strip = (info.windowWidth || 375) - 64 * rpx;
    // 加一个随机小数，保证连续两次算出同一值时 scroll-left 仍会生效（用户手动滑走后再点同一张）
    return Math.max(0, Math.round(index * pitch - (strip - thumb) / 2)) + Math.random() * 0.01;
  },
  loadPhotos(petId) {
    const request = this._photoRequest = (this._photoRequest || 0) + 1;
    this.setData({ loading: true });
    api.request("/api/photos?petId=" + encodeURIComponent(petId))
      .then(withPrivatePreviews)
      .then((photos) => { if (request !== this._photoRequest || petId !== this.data.petId) return; const photoIds = this._initialPhotoIds || this.data.photoIds; this._initialPhotoIds = null; if (photoIds.length > 1 || photoIds.some((value) => !photos.some((photo) => photo.id === value))) { this.setData({ photos, photoIds: [], loading: false }); throw new Error("请选择当前宠物的一张可用照片"); } this.setData({ photos, photoIds: photoIds.length ? photoIds : photos[0] ? [photos[0].id] : [], loading: false }); })
      .catch((error) => { if (request === this._photoRequest) this.setData({ error: error.message, loading: false }); });
  },
  onShow() { if (this.data.petId && !this.data.busy) this.loadPhotos(this.data.petId); },
  onHide() { this._photoRequest = (this._photoRequest || 0) + 1; },
  choosePetChip(event) { this.choosePet({ detail: { value: event.currentTarget.dataset.index } }); },
  /** 首格「＋」：拍照或从相册选一张，传完刷新列表并自动选中。 */
  uploadPetPhoto() {
    const pet = this.data.pets.find((item) => item.id === this.data.petId);
    if (!pet || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    uploadOnePhoto(pet, "ai-create")
      .then((photoId) => { if (!photoId) return; this._initialPhotoIds = [photoId]; this.loadPhotos(pet.id); })
      .catch((error) => this.setData({ error: error.message }))
      .finally(() => this.setData({ busy: false }));
  },
  openPets() { wx.navigateTo({ url: "/pages/pets/pets" }); },
  choosePet(event) {
    if (this.data.busy) return;
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this._initialPhotoIds = null;
    this.setData({ petId: pet.id, petText: pet.name, photos: [], photoIds: [], error: "" });
    this.loadPhotos(pet.id);
  },
  chooseEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    const templates = entry && entry.id === "boss" ? selectBossTemplates(this.data.entries, this._bossIds) : entry ? entry.templates : [];
    const template = templates[0];
    this.setData({
      entryId: id,
      entryTitle: entry ? entry.id === "boss" ? "麻麻精选" : entry.title : "",
      templates,
      carouselTemplates: templates.filter((item) => item.templateId !== "pet-art-photo"),
      templateId: template ? template.templateId : "",
      effectScrollTarget: template && template.templateId !== "pet-art-photo" ? "effect-" + template.templateId : "",
      activeTemplate: template || null,
      ownerPhotoIds: [],
      authorizationConfirmed: false
    });
  },
  chooseTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const template = this.data.templates.find((item) => item.templateId === id);
    if (!template) return;
    if (template.templateId === this.data.templateId && this.data.stage === "photos") return;
    this.setData({ templateId: id, activeTemplate: template, candidateCount: template.candidateCount || 1, ownerPhotoIds: [], authorizationConfirmed: false, stage: "photos", error: "" });
    this.syncPreview();
    if (wx.setNavigationBarTitle && template) wx.setNavigationBarTitle({ title: template.title });
  },
  onTemplateImageError(event) {
    const { id, src } = event.currentTarget.dataset;
    const index = this.data.templates.findIndex((item) => item.templateId === id && item.sampleUrl === src);
    if (index < 0) return;
    const patch = { ["templates[" + index + "].sampleUrl"]: "" };
    const carouselIndex = this.data.carouselTemplates.findIndex((item) => item.templateId === id && item.sampleUrl === src);
    if (carouselIndex >= 0) patch["carouselTemplates[" + carouselIndex + "].sampleUrl"] = "";
    if (this.data.activeTemplate && this.data.activeTemplate.templateId === id) patch["activeTemplate.sampleUrl"] = "";
    this.setData(patch);
  },
  chooseScene(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.sceneOptions.some((item) => item.id === id)) return;
    const entering = this.data.stage !== "photos";
    this.setData({ sceneId: id, selectedScene: this.data.sceneOptions.find((item) => item.id === id), stage: "photos", error: "" });
    this.syncPreview();
    // 从样片墙进来时回到顶部；在照片阶段的缩略图条里切换时留在原位
    if (entering) this.scrollTop();
  },
  /**
   * 单张写真页里的套餐入口（2026-10）：首页「写真也值得收藏」点进来是单张，这里给出「多拍几套更划算」。
   * 精选套餐以当前场景打头、再按写真馆顺序补满；全部套餐直接带上全部场景。
   */
  chooseArtPackage(event) {
    const pack = (this.data.artPackages || []).find((item) => item.id === event.currentTarget.dataset.id);
    if (!pack) return;
    const all = (this.data.sceneOptions || []).map((item) => item.id);
    const picked = pack.id === "all" ? all : [this.data.sceneId].concat(all.filter((id) => id !== this.data.sceneId)).slice(0, pack.count);
    if (picked.length !== pack.count) return wx.showToast({ title: "写真场景还没加载完，稍后再试", icon: "none" });
    wx.navigateTo({ url: "/pages/art-photo-bundle/art-photo-bundle?package=" + pack.id + "&sceneIds=" + encodeURIComponent(picked.join(",")) });
  },
  scrollTop() { if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 180 }); },
  continueToPhotos() { if (this.data.activeTemplate) { this.setData({ stage: "photos", error: "" }); this.syncPreview(); this.scrollTop(); } },
  changeSample() {
    if (this.data.templateId === "pet-art-photo" && this._query && this._query.sceneId) return wx.switchTab({ url: "/pages/art-photo/art-photo" });
    this.setData({ stage: "samples", error: "" });
    this.scrollTop();
  },
  onSceneImageError(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.sceneOptions.findIndex((item) => item.id === id);
    if (index >= 0) {
      const patch = { ["sceneOptions[" + index + "].url"]: "" };
      if (this.data.selectedScene && this.data.selectedScene.id === id) patch["selectedScene.url"] = "";
      this.setData(patch);
      this.syncPreview();
    }
  },
  togglePhoto(event) {
    const id = event.detail.id;
    this.setData({ photoIds: this.data.photoIds[0] === id ? [] : [id], error: "" });
  },
  toggleOwnerPhoto(event) {
    const id = event.detail.id;
    this.setData({ ownerPhotoIds: this.data.ownerPhotoIds[0] === id ? [] : [id], error: "" });
  },
  toggleAuthorization(event) {
    const values = event.detail.value || [];
    this.setData({ authorizationConfirmed: values.indexOf("confirmed") >= 0, error: "" });
  },
  uploadOwnerPhoto() {
    if (!this.data.authorizationConfirmed) return this.setData({ error: "请先确认照片中的本人已同意用于本次 AI 生图" });
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const selected = result.tempFiles && result.tempFiles[0];
        if (!selected) return;
        this.setData({ busy: true, error: "" });
        const filename = selected.tempFilePath.split("/").pop() || "owner-photo.jpg";
        api.upload("/api/owner-photos", selected.tempFilePath, { filename, authorizationConfirmed: "true" })
          .then((photo) => withPrivatePreviews([photo]))
          .then((items) => this.setData({ ownerPhotos: items.concat(this.data.ownerPhotos), ownerPhotoIds: [items[0].id], busy: false }))
          .catch((error) => this.setData({ error: error.message, busy: false }));
      }
    });
  },
  removeOwnerPhoto(event) {
    const id = event.detail.id;
    this.setData({ busy: true, error: "" });
    api.request("/api/owner-photos/" + encodeURIComponent(id), { method: "DELETE" })
      .then(() => this.setData({ ownerPhotos: this.data.ownerPhotos.filter((item) => item.id !== id), ownerPhotoIds: this.data.ownerPhotoIds[0] === id ? [] : this.data.ownerPhotoIds, busy: false }))
      .catch((error) => this.setData({ error: error.message, busy: false }));
  },
  create() {
    if (this.data.busy || this.data.loading) return;
    const template = this.data.activeTemplate;
    if (!template || !this.data.petId || this.data.photoIds.length !== 1) return this.setData({ error: "请选择模板、宠物和 1 张宠物身份照" });
    if (template.templateId === "pet-art-photo" && !this.data.sceneOptions.some((item) => item.id === this.data.sceneId)) return this.setData({ error: "写真场景暂不可用，请重新加载" });
    if (template.subjectMode === "owner-pet" && (!this.data.authorizationConfirmed || this.data.ownerPhotoIds.length !== 1)) return this.setData({ error: "人宠模板需要 1 张已授权的主人照片" });
    this.setData({ busy: true, error: "" });
    api.request("/api/ai-runs", { method: "POST", data: {
      pluginId: "pl-10",
      templateId: template.templateId,
      petId: this.data.petId,
      photoIds: this.data.photoIds,
      ownerPhotoIds: template.subjectMode === "owner-pet" ? this.data.ownerPhotoIds : [],
      authorizationConfirmed: template.subjectMode === "owner-pet" && this.data.authorizationConfirmed,
      options: { scene: this.data.sceneId },
      promptVersion: "template-" + template.version,
      modelVersion: "provider-v1",
      idempotencyKey: "mp-" + Date.now() + "-" + template.templateId + "-" + this.data.photoIds[0]
    } })
      .then((run) => wx.redirectTo({ url: "/pages/ai-run/ai-run?id=" + run.id }))
      .catch((error) => this.setData({ busy: false, error: error.message }));
  },
  openPhotos() { wx.navigateTo({ url: this.data.petId ? "/pages/photos/photos?petId=" + this.data.petId : "/pages/pets/pets" }); }
});
