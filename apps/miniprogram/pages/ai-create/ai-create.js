const api = require("../../services/api");
const { displayMediaTree: withPrivatePreviews } = require("../../services/photo-files");
const { themedPage } = require("../../theme/page-mixin");

themedPage({
  data: {
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    entries: [], entryId: "", templates: [], templateId: "", activeTemplate: null,
    artPlugin: null, sceneOptions: [], sceneId: "window-morning",
    ownerPhotos: [], ownerPhotoIds: [], authorizationConfirmed: false,
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
      api.request("/api/pets"),
      api.request("/api/image-templates"),
      api.request("/api/owner-photos"),
      api.request("/api/plugins")
    ]).then((results) => {
      const pets = results[0] || [];
      const entries = (results[1] && results[1].entries) || [];
      const artPlugin = (results[3] || []).find((item) => item.id === "pl-10") || null;
      const sceneOptions = artPlugin && artPlugin.samples && artPlugin.samples.sceneOptions
        ? artPlugin.samples.sceneOptions.map((item) => Object.assign({}, item, { url: artPlugin.samples.sceneUrls && artPlugin.samples.sceneUrls[item.id] || "" }))
        : [];
      const selectedPet = query && query.petId ? pets.find((item) => item.id === query.petId) : pets.find((item) => item.isDefault) || pets[0];
      if (query && query.petId && !selectedPet) throw new Error("这只宠物的档案不可用，请重新选择");
      const entry = entries.find((item) => item.id === "art") || entries[0];
      const template = entry && entry.templates[0];
      this.setData({
        pets,
        petId: selectedPet ? selectedPet.id : "",
        petText: selectedPet ? selectedPet.name : "",
        entries,
        entryId: entry ? entry.id : "",
        templates: entry ? entry.templates : [],
        templateId: template ? template.templateId : "",
        activeTemplate: template || null,
        artPlugin,
        sceneOptions,
        sceneId: sceneOptions.length ? sceneOptions[0].id : "window-morning",
        loading: false,
        catalogLoading: false
      });
      if (selectedPet) this.loadPhotos(selectedPet.id);
      return withPrivatePreviews(results[2] || []);
    }).then((ownerPhotos) => this.setData({ ownerPhotos })).catch((error) => this.setData({ error: error.message, loading: false, catalogLoading: false }));
  },
  loadPhotos(petId) {
    const request = this._photoRequest = (this._photoRequest || 0) + 1;
    this.setData({ loading: true });
    api.request("/api/photos?petId=" + encodeURIComponent(petId))
      .then(withPrivatePreviews)
      .then((photos) => { if (request !== this._photoRequest || petId !== this.data.petId) return; const photoIds = this._initialPhotoIds || this.data.photoIds; this._initialPhotoIds = null; if (photoIds.length > 1 || photoIds.some((value) => !photos.some((photo) => photo.id === value))) { this.setData({ photos, photoIds: [], loading: false }); throw new Error("请选择当前宠物的一张可用照片"); } this.setData({ photos, photoIds, loading: false }); })
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
  chooseEntry(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item.id === id);
    const template = entry && entry.templates[0];
    this.setData({
      entryId: id,
      templates: entry ? entry.templates : [],
      templateId: template ? template.templateId : "",
      activeTemplate: template || null,
      ownerPhotoIds: [],
      authorizationConfirmed: false
    });
  },
  chooseTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const template = this.data.templates.find((item) => item.templateId === id);
    this.setData({ templateId: id, activeTemplate: template || null, ownerPhotoIds: [], authorizationConfirmed: false });
  },
  onTemplateImageError(event) {
    const { id, src } = event.currentTarget.dataset;
    const index = this.data.templates.findIndex((item) => item.templateId === id && item.sampleUrl === src);
    if (index >= 0) this.setData({ ["templates[" + index + "].sampleUrl"]: "" });
  },
  chooseScene(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.sceneOptions.some((item) => item.id === id)) return;
    this.setData({ sceneId: id, error: "" });
  },
  onSceneImageError(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.sceneOptions.findIndex((item) => item.id === id);
    if (index >= 0) this.setData({ ["sceneOptions[" + index + "].url"]: "" });
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
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos?petId=" + this.data.petId }); }
});
