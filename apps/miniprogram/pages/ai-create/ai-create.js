const api = require("../../services/api");
const { displayMediaTree: withPrivatePreviews } = require("../../services/photo-files");
const { themedPage } = require("../../theme/page-mixin");
const { pluginSample, imageEntries } = require("../../services/sample-assets");
const { selectBossTemplates } = require("../../services/home-effect-ids");
const { uploadOnePhoto } = require("../../services/quick-upload");
const wallet = require("../../services/wallet");
const { openPetCreator, remind } = require("../../services/pet-onboarding");

themedPage(Object.assign({}, wallet.walletSheetMethods, {
  data: {
    flowSteps: ["选效果", "选照片"],
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    entries: [], entryId: "", entryTitle: "", templates: [], carouselTemplates: [], templateId: "", effectScrollTarget: "", effectScrollLeft: 0, activeTemplate: null,
    artPlugin: null, sceneOptions: [], sceneId: "window-morning", selectedScene: null,
    stage: "samples",
    ownerPhotos: [], ownerPhotoIds: [], authorizationConfirmed: false,
    costText: "", previewUrl: "", previewShape: "card", candidateCount: 1, artPackages: [],
    walletBalance: 0, walletLoaded: false, walletSheet: { visible: false, required: 0, balance: 0, shortfall: 0 },
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
      // 套餐按冻干计价（2026-10-08）：颗数从服务端取；第三行写比单张省多少
      const singleCost = packs.single && packs.single.cost;
      const saving = (pack) => { const percent = singleCost ? Math.round((1 - pack.cost / (pack.count * singleCost)) * 100) : 0; return percent > 0 ? "比单张省 " + percent + "%" : ""; };
      this.setData({ artPackages: ["ten", "twenty"].filter((id) => packs[id] && typeof packs[id].cost === "number").map((id) => ({ id, label: packs[id].label, price: wallet.costText(packs[id].cost), count: packs[id].count, saving: saving(packs[id]) })) });
      const curation = results[4] && results[4].lead ? results[4] : null;
      this._bossIds = curation ? [curation.lead.templateId].concat(curation.templateIds) : null;
      const pets = results[0] || [];
      const entries = imageEntries(results[1] && results[1].entries);
      const artSource = (results[3] || []).find((item) => item.id === "pl-10");
      const artPlugin = artSource ? pluginSample(artSource) : null;
      const sceneOptions = artPlugin && artPlugin.samples && artPlugin.samples.sceneOptions
        ? artPlugin.samples.sceneOptions.map((item) => Object.assign({}, item, {
          url: artPlugin.samples.sceneUrls && artPlugin.samples.sceneUrls[item.id] || "",
          // 大预览用原图分辨率的高清样片，缩略图条继续用小图
          hdUrl: artPlugin.samples.sceneHdUrls && artPlugin.samples.sceneHdUrls[item.id] || ""
        }))
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
        costText: template ? typeof template.donganCost === "number" ? wallet.costText(template.donganCost) : "" : "",
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
    // 大预览按 2–3 倍屏要 ~900 像素宽，用高清样片；缩略图只有 420 / 330 宽，放大后会发虚
    const previewUrl = art ? scene && (scene.hdUrl || scene.url) || "" : template && (template.hdUrl || template.sampleUrl) || "";
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
  onShow() {
    if (this.data.petId && !this.data.busy) this.loadPhotos(this.data.petId);
    this.refreshWallet().then(() => this.setData({ walletLoaded: true }));
  },
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
  /** 没有档案时直接打开新建抽屉；建成后回到这里并选中新宠物，接着选照片。 */
  openPets() { if (!this.data.busy) openPetCreator((petId) => this.useNewPet(petId)); },
  useNewPet(petId) {
    return api.request("/api/pets").then(withPrivatePreviews).then((pets) => {
      const pet = pets.find((item) => item.id === petId);
      if (!pet) return;
      this._initialPhotoIds = null;
      this.setData({ pets, petId: pet.id, petText: pet.name, photos: [], photoIds: [], error: "" });
      this.loadPhotos(pet.id);
    }).catch((error) => this.setData({ error: error.message }));
  },
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
    this.setData({ templateId: id, activeTemplate: template, costText: wallet.costText(template.donganCost || 2), candidateCount: template.candidateCount || 1, ownerPhotoIds: [], authorizationConfirmed: false, stage: "photos", error: "" });
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
   * 单张写真页里的套餐入口（2026-10）：首页样片点进来是单张，这里给出「一次拍一组」。
   * 2026-10-09 起不再按写真馆顺序替用户补满（用户没挑过的被算进套餐，莫名其妙）：
   * 切回创作页「宠物写真」，选好档位、只勾上当前这套，剩下的由用户自己挑或点「帮我挑满」。
   */
  chooseArtPackage(event) {
    const pack = (this.data.artPackages || []).find((item) => item.id === event.currentTarget.dataset.id);
    if (!pack) return;
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) app.globalData.artPackage = { mode: pack.id, sceneIds: this.data.sceneId ? [this.data.sceneId] : [] };
    wx.switchTab({ url: "/pages/art-photo/art-photo" });
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
    if (!template) return remind("先选一个效果");
    /*
     * 按钮不再因缺宠物 / 缺照片置灰（点了没反应）：缺什么就直接带用户去补。
     * 没有档案 → 打开新建抽屉；有档案没照片 → 拉起拍照 / 相册；有照片没选 → 提示选一张。
     */
    if (!this.data.pets.length) { remind("先给它建一份档案"); return this.openPets(); }
    if (!this.data.petId) return remind("先选一只宠物");
    if (!this.data.photos.length) return this.uploadPetPhoto();
    if (this.data.photoIds.length !== 1) return remind("先选 1 张照片");
    if (template.templateId === "pet-art-photo" && !this.data.sceneOptions.some((item) => item.id === this.data.sceneId)) return this.setData({ error: "写真场景暂不可用，请重新加载" });
    if (template.subjectMode === "owner-pet" && !this.data.authorizationConfirmed) return remind("先勾选主人照片授权");
    if (template.subjectMode === "owner-pet" && this.data.ownerPhotoIds.length !== 1) return remind(this.data.ownerPhotos.length ? "先选 1 张主人照片" : "先上传 1 张主人照片");
    this.setData({ busy: true, error: "" });
    /*
     * 先扣冻干再出图：余额不足时弹零食柜，付款到账后用同一个幂等键重放，等于「到账后自动开始」。
     * 幂等键在按下「开始」时就定下来，重放不会重复扣。
     */
    const idempotencyKey = "mp-" + Date.now() + "-" + template.templateId + "-" + this.data.photoIds[0];
    wallet.withDongan(this, () => api.request("/api/ai-runs", { method: "POST", data: {
      pluginId: "pl-10",
      templateId: template.templateId,
      petId: this.data.petId,
      photoIds: this.data.photoIds,
      ownerPhotoIds: template.subjectMode === "owner-pet" ? this.data.ownerPhotoIds : [],
      authorizationConfirmed: template.subjectMode === "owner-pet" && this.data.authorizationConfirmed,
      options: { scene: this.data.sceneId },
      promptVersion: "template-" + template.version,
      modelVersion: "provider-v1",
      idempotencyKey
    } }))
      .then((run) => wx.redirectTo({ url: "/pages/ai-run/ai-run?id=" + run.id }))
      .catch((error) => this.setData({ busy: false, error: error.code === "WALLET_TOPUP_CANCELLED" ? "" : error.message }));
  },
  openPhotos() { if (!this.data.petId) return this.openPets(); wx.navigateTo({ url: "/pages/photos/photos?petId=" + this.data.petId }); }
}));
