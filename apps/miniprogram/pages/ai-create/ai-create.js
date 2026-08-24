const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

function absoluteUrl(path) {
  return /^https?:\/\//.test(path || "") ? path : config.apiBaseUrl + path;
}

function withPrivatePreviews(items) {
  const session = wx.getStorageSync("petbaby_session");
  return Promise.all((items || []).map((item) => new Promise((resolve) => {
    wx.downloadFile({
      url: absoluteUrl(item.url),
      header: { authorization: "Bearer " + session },
      success(result) { resolve(Object.assign({}, item, { url: result.tempFilePath })); },
      fail() { resolve(item); }
    });
  })));
}

themedPage({
  data: {
    pets: [], petId: "", petText: "", photos: [], photoIds: [],
    entries: [], entryId: "", templates: [], templateId: "", activeTemplate: null,
    ownerPhotos: [], ownerPhotoIds: [], authorizationConfirmed: false,
    busy: false, error: "", loading: true
  },
  onLoad() {
    Promise.all([
      api.request("/api/pets"),
      api.request("/api/image-templates"),
      api.request("/api/owner-photos")
    ]).then((results) => {
      const pets = results[0] || [];
      const entries = (results[1] && results[1].entries) || [];
      const selectedPet = pets.find((item) => item.isDefault) || pets[0];
      const entry = entries[0];
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
        loading: false
      });
      if (selectedPet) this.loadPhotos(selectedPet.id);
      return withPrivatePreviews(results[2] || []);
    }).then((ownerPhotos) => this.setData({ ownerPhotos })).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  loadPhotos(petId) {
    api.request("/api/photos?petId=" + encodeURIComponent(petId))
      .then(withPrivatePreviews)
      .then((photos) => this.setData({ photos, photoIds: [] }))
      .catch((error) => this.setData({ error: error.message }));
  },
  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petText: pet.name });
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
    const template = this.data.activeTemplate;
    if (!template || !this.data.petId || this.data.photoIds.length !== 1) return this.setData({ error: "请选择模板、宠物和 1 张宠物身份照" });
    if (template.subjectMode === "owner-pet" && (!this.data.authorizationConfirmed || this.data.ownerPhotoIds.length !== 1)) return this.setData({ error: "人宠模板需要 1 张已授权的主人照片" });
    this.setData({ busy: true, error: "" });
    api.request("/api/ai-runs", { method: "POST", data: {
      pluginId: "pl-10",
      templateId: template.templateId,
      petId: this.data.petId,
      photoIds: this.data.photoIds,
      ownerPhotoIds: template.subjectMode === "owner-pet" ? this.data.ownerPhotoIds : [],
      authorizationConfirmed: template.subjectMode === "owner-pet" && this.data.authorizationConfirmed,
      promptVersion: "template-" + template.version,
      modelVersion: "provider-v1",
      idempotencyKey: "mp-" + Date.now() + "-" + template.templateId + "-" + this.data.photoIds[0]
    } })
      .then((run) => wx.redirectTo({ url: "/pages/ai-run/ai-run?id=" + run.id }))
      .catch((error) => this.setData({ busy: false, error: error.message }));
  },
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos" }); }
});
