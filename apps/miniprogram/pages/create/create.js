const { displayMediaTree } = require("../../services/photo-files");
const api = require("../../services/api");
const { preparePhoto, createUploadSession, requestId } = require("../../services/photo-upload-session");
const { themedPage } = require("../../theme/page-mixin");

// 选项值 → 中文文案。picker 只显示中文，请求仍然发送原始枚举值。
const SPECIES = { values: ["cat", "dog", "other"], labels: ["猫咪", "狗狗", "其他"] };
const GENDER = { values: ["unknown", "female", "male"], labels: ["未填写", "女孩子", "男孩子"] };
const DATE_TYPE = { values: ["birthday", "got_home"], labels: ["生日", "到家日"] };
const DOCUMENT = { values: ["identity", "passport", "household", "vaccine", "bundle"], labels: ["身份证", "护照", "户口页", "疫苗册", "全套证件"] };
const STYLE = { values: ["classic", "arthouse", "hongkong"], labels: ["经典大片", "文艺影展", "港风复古"] };
const COMPOSITION = { values: ["portrait", "closeup", "ensemble"], labels: ["竖版主角", "特写脸庞", "群像合照"] };
const THEME = { values: ["growth", "birthday", "healing", "holiday"], labels: ["成长记录", "生日纪念", "治愈日常", "节日相册"] };
const STEPS = ["填档案", "选照片", "生成中", "完成"];
const TIER_NAME = { basic: "基础", advanced: "进阶", annual: "年度" };
const STAGE_INDEX = { profile: 0, photos: 1, generating: 2, result: 3 };
/** 走方案 C 沉浸表单的步骤（见 syncLabels 里 formStage 的说明） */
const FORM_STAGES = ["profile", "photos"];

function labelOf(map, value) {
  const index = map.values.indexOf(value);
  return index >= 0 ? map.labels[index] : map.labels[0];
}

/**
 * 「再攒多少进下一档」的文案。
 *
 * **按「你可以做什么」而不是「你不足以做什么」**（L3 的措辞要求）：
 * 「再攒 11 张就能做进阶版 ¥39.9」是邀请，「照片不足 21 张，无法制作进阶版」
 * 是拒绝 —— 而用户此刻正打算给自己的宠物做点东西。
 */
function nextTierText(pricing) {
  const next = pricing && pricing.nextTier;
  if (!next) return "";
  const price = (pricing.tierPrices || {})[next.tier];
  const target = (TIER_NAME[next.tier] || next.tier) + "版" + (price ? " ¥" + price : "");
  if (next.tier === "advanced" && next.photosNeeded) return "再攒 " + next.photosNeeded + " 张照片，就能做" + target + "。";
  if (next.daysNeeded) return "照片跨度再满 " + next.daysNeeded + " 天，就能做" + target + "。";
  return "";
}

themedPage({
  data: {
    steps: STEPS,
    stepIndex: 0,
    speciesLabels: SPECIES.labels,
    genderLabels: GENDER.labels,
    dateTypeLabels: DATE_TYPE.labels,
    documentLabels: DOCUMENT.labels,
    styleLabels: STYLE.labels,
    compositionLabels: COMPOSITION.labels,
    themeLabels: THEME.labels,
    speciesText: SPECIES.labels[0],
    genderText: GENDER.labels[0],
    dateTypeText: DATE_TYPE.labels[0],
    documentText: DOCUMENT.labels[0],
    styleText: STYLE.labels[0],
    compositionText: COMPOSITION.labels[0],
    themeText: THEME.labels[0],
    petText: "",
    photoTiles: [],
    selectedTileIds: [],
    photoHint: "",
    pluginId: "pet-id-card",
    plugin: null,
    stage: "profile",
    formStage: true,
    pets: [],
    pet: null,
    name: "",
    species: "cat",
    gender: "unknown",
    dateType: "birthday",
    birthday: "",
    existingPhotos: [],
    selectedExistingIds: [],
    newPhotos: [],
    documentType: "identity",
    style: "classic",
    composition: "portrait",
    theme: "growth",
    review: "",
    coverTitle: "",
    uploadProgress: 0,
    task: null,
    work: null,
    // 档位与价格在制作前展示（改造项 L3）。服务端 /api/pets/{id}/pricing 是唯一来源，
    // 端上不自己按照片数算档 —— 展示价与实收价由两份代码算出来必然走散。
    pricing: null,
    pricingText: "",
    pricingHint: "",
    busy: false,
    error: ""
  },

  onLoad(query) {
    const pluginId = query.pluginId || "pet-id-card";
    this.setData({ pluginId });
    this._sessionToken = wx.getStorageSync("petbaby_session");
    Promise.all([api.request("/api/plugins"), api.request("/api/pets").then(displayMediaTree), api.request("/api/account")]).then((result) => {
      const plugin = result[0].find((item) => item.id === pluginId);
      const pets = result[1];
      this._draftKey = "petbaby_create_" + result[2].id + "_" + pluginId;
      const draft = query.petId ? {} : wx.getStorageSync(this._draftKey) || {};
      const terminal = draft.task && ["succeeded", "failed"].indexOf(draft.task.status) >= 0;
      const pendingTask = draft.task && !terminal ? { id: draft.task.id, status: draft.task.status || "queued" } : null;
      this._submission = terminal ? null : draft.submission || null;
      const pet = pets.find((item) => item.id === (query.petId || draft.petId));
      if (query.petId && !pet) throw new Error("这只宠物的档案不可用，请重新选择");
      if (!plugin) throw new Error("这个玩法暂时不可用");
      this.setData({
        plugin,
        pets,
        pet: pet || null,
        stage: pendingTask && pet ? "generating" : pet ? "photos" : "profile",
        task: pendingTask,
        selectedExistingIds: query.photoIds ? query.photoIds.split(",").filter(Boolean) : draft.selectedExistingIds || [],
        newPhotos: draft.newPhotos || [],
        documentType: draft.documentType || "identity",
        style: draft.style || "classic",
        composition: draft.composition || "portrait",
        theme: draft.theme || "growth",
        review: draft.review || "",
        coverTitle: draft.coverTitle || ""
      });
      this.syncLabels();
      if (pet) this.loadPhotoLibrary();
      if (pendingTask && pet) { this.setData({ busy: true }); this._pollGeneration = (this._pollGeneration || 0) + 1; this.poll(pendingTask.id, this._pollGeneration); }
    }).catch((error) => this.setData({ error: error.message }));
  },

  /** 把枚举值翻成中文，并同步步骤条与照片格数据。 */
  syncLabels() {
    const plugin = this.data.plugin;
    const limit = plugin ? plugin.input.photos : { min: 1, max: 9 };
    this.setData({
      stepIndex: STAGE_INDEX[this.data.stage] || 0,
      // 只有填表的两步走方案 C 的沉浸表单（背景虚化成目标产出图）。
      // generating 需要完整进度信息、result 要让作品占满主视觉，两者都不适合塞进玻璃面板。
      formStage: FORM_STAGES.indexOf(this.data.stage) >= 0,
      speciesText: labelOf(SPECIES, this.data.species),
      genderText: labelOf(GENDER, this.data.gender),
      dateTypeText: labelOf(DATE_TYPE, this.data.dateType),
      documentText: labelOf(DOCUMENT, this.data.documentType),
      styleText: labelOf(STYLE, this.data.style),
      compositionText: labelOf(COMPOSITION, this.data.composition),
      themeText: labelOf(THEME, this.data.theme),
      petText: this.data.pet ? this.data.pet.name : "",
      photoHint: `已选 ${this.data.selectedExistingIds.length + this.data.newPhotos.length}/${limit.max} 张，至少 ${limit.min} 张`
    });
    this.syncTiles();
  },

  /**
   * 图库照片与本次新拍照片合并成一个九宫格。
   * 新照片的 id 用 `new:序号` 标记，toggle 时据此区分删除来源。
   */
  syncTiles() {
    const existing = this.data.existingPhotos.map((item) => ({ id: item.id, url: item.url }));
    const fresh = this.data.newPhotos.map((item, index) => ({ id: "new:" + index, url: item.path }));
    this.setData({
      photoTiles: existing.concat(fresh),
      selectedTileIds: this.data.selectedExistingIds.concat(fresh.map((item) => item.id))
    });
  },

  saveDraft() {
    const pet = this.data.pet;
    if (!pet || !this._draftKey || wx.getStorageSync("petbaby_session") !== this._sessionToken) return;
    wx.setStorageSync(this._draftKey, {
      petId: pet.id,
      selectedExistingIds: this.data.selectedExistingIds,
      newPhotos: this.data.newPhotos,
      documentType: this.data.documentType,
      style: this.data.style,
      composition: this.data.composition,
      theme: this.data.theme,
      review: this.data.review,
      coverTitle: this.data.coverTitle,
      submission: this._submission || null,
      // 只保存可恢复轮询所需的任务 ID/状态，不把候选、正文或作品对象写进草稿。
      task: this.data.task && this.data.task.id ? { id: this.data.task.id, status: this.data.task.status } : null
    });
  },

  setName(event) { this.setData({ name: event.detail.value, error: "" }); },
  setSpecies(event) { this.setData({ species: SPECIES.values[Number(event.detail.value)] }); this.syncLabels(); },
  setGender(event) { this.setData({ gender: GENDER.values[Number(event.detail.value)] }); this.syncLabels(); },
  setDateType(event) { this.setData({ dateType: DATE_TYPE.values[Number(event.detail.value)] }); this.syncLabels(); },
  setBirthday(event) { this.setData({ birthday: event.detail.value }); },
  setReview(event) { this.setData({ review: event.detail.value }); this.saveDraft(); },
  setCoverTitle(event) { this.setData({ coverTitle: event.detail.value }); this.saveDraft(); },
  setDocumentType(event) { this.setData({ documentType: DOCUMENT.values[Number(event.detail.value)] }); this.syncLabels(); this.saveDraft(); },
  setStyle(event) { this.setData({ style: STYLE.values[Number(event.detail.value)] }); this.syncLabels(); this.saveDraft(); },
  setComposition(event) { this.setData({ composition: COMPOSITION.values[Number(event.detail.value)] }); this.syncLabels(); this.saveDraft(); },
  setTheme(event) { this.setData({ theme: THEME.values[Number(event.detail.value)] }); this.syncLabels(); this.saveDraft(); },
  backToPhotos() { this.setData({ stage: "photos", error: "" }); this.syncLabels(); },

  choosePet(event) {
    if (this.data.busy) return;
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ pet, stage: "photos", selectedExistingIds: [], newPhotos: [] });
    this.loadPhotoLibrary();
    this.syncLabels();
    this.saveDraft();
  },

  savePet() {
    if (this.data.busy) return;
    if (!this.data.name.trim()) return this.setData({ error: "请填写宠物名字" });
    this.setData({ busy: true, error: "" });
    api.request("/api/pets", { method: "POST", data: { name: this.data.name, species: this.data.species, gender: this.data.gender, birthday: this.data.birthday, dateType: this.data.dateType, lifeStage: "active" } }).then(displayMediaTree)
      .then((pet) => {
        this.setData({ pet, pets: this.data.pets.concat([pet]), stage: "photos", busy: false });
        this.loadPhotoLibrary();
        this.syncLabels();
        this.saveDraft();
      })
      .catch((error) => this.setData({ error: error.message, busy: false }));
  },

  loadPhotoLibrary() {
    if (!this.data.pet) return;
    const petId = this.data.pet.id;
    const version = this._photoRequest = (this._photoRequest || 0) + 1;
    api.request("/api/photos?petId=" + petId).then(displayMediaTree).then((items) => {
      if (version !== this._photoRequest || !this.data.pet || petId !== this.data.pet.id) return;
      const selected = this.data.selectedExistingIds;
      if (selected.some((id) => !items.some((item) => item.id === id))) this.setData({ error: "部分已选照片不可用，请重新确认素材", selectedExistingIds: [] });
      this.setData({ existingPhotos: items.map((item) => Object.assign({}, item, { selected: selected.indexOf(item.id) >= 0 })) });
      this.syncLabels();
    }).catch((error) => { if (version === this._photoRequest && this.data.pet && petId === this.data.pet.id) this.setData({ error: error.message }); });
    this.loadPricing();
  },

  /**
   * 取本次交付物的档位与价格（L3）。
   *
   * 分档看的是这只宠物的**积累总量**而不是本次选了几张，所以只在换宠物时拉一次，
   * 不跟着勾选状态重算。报价失败时明确提示，不能使用旧宠物的报价。
   */
  loadPricing() {
    const pet = this.data.pet;
    const version = this._photoRequest;
    if (!pet) return this.setData({ pricing: null, pricingText: "", pricingHint: "" });
    api.request("/api/pets/" + pet.id + "/pricing?pluginId=" + encodeURIComponent(this.data.pluginId)).then(displayMediaTree)
      .then((pricing) => {
        if (version !== this._photoRequest || !this.data.pet || pet.id !== this.data.pet.id) return;
        if (pricing.free) return this.setData({ pricing: null, pricingText: "", pricingHint: "" });
        const tierName = pricing.tiered && pricing.specTier ? (TIER_NAME[pricing.specTier] || "") + "版 · " : "";
        const hints = [];
        if (pricing.tiered && pricing.accumulation) hints.push("已积累 " + pricing.accumulation.photoCount + " 张照片，跨度 " + pricing.accumulation.spanDays + " 天。");
        if (pricing.isMember && pricing.memberSaving > 0) hints.push("会员价，比单买省 ¥" + pricing.memberSaving + "。");
        else hints.push(nextTierText(pricing));
        this.setData({
          pricing,
          pricingText: tierName + pricing.label + " ¥" + pricing.amount,
          pricingHint: hints.filter(Boolean).join("")
        });
      })
      .catch(() => { if (version === this._photoRequest && this.data.pet && pet.id === this.data.pet.id) this.setData({ pricing: null, pricingText: "暂不可报价，请稍后重试", pricingHint: "" }); });
  },

  /** 九宫格点选：图库照片切换选中，新拍照片直接移除。 */
  toggleTile(event) {
    if (this.data.busy) return;
    const id = event.detail.id;
    if (String(id).indexOf("new:") === 0) {
      const target = Number(String(id).split(":")[1]);
      this.setData({ newPhotos: this.data.newPhotos.filter((item, index) => index !== target) });
      this.syncLabels();
      this.saveDraft();
      return;
    }
    const next = this.data.selectedExistingIds.slice();
    const index = next.indexOf(id);
    if (index >= 0) next.splice(index, 1);
    else if (next.length + this.data.newPhotos.length < this.data.plugin.input.photos.max) next.push(id);
    else return this.setData({ error: "最多只能选 " + this.data.plugin.input.photos.max + " 张照片" });
    this.setData({ selectedExistingIds: next, error: "", existingPhotos: this.data.existingPhotos.map((item) => Object.assign({}, item, { selected: next.indexOf(item.id) >= 0 })) });
    this.syncLabels();
    this.saveDraft();
  },

  choosePhotos() {
    if (this.data.busy) return;
    // 新照片改为追加而非覆盖，剩余额度要同时扣掉已选图库照片与已拍照片
    const remaining = this.data.plugin.input.photos.max - this.data.selectedExistingIds.length - this.data.newPhotos.length;
    if (remaining <= 0) return this.setData({ error: "最多只能选 " + this.data.plugin.input.photos.max + " 张照片" });
    wx.chooseMedia({
      count: Math.min(9, remaining),
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (result) => {
        const petId = this.data.pet.id;
        this.setData({ busy: true, error: "" });
        try {
          for (const file of result.tempFiles) {
            const prepared = Object.assign(await preparePhoto(file), { requestId: requestId(), state: "ready", attempted: false });
            if (this.data.pet.id !== petId || this._closed) return;
            this.setData({ newPhotos: this.data.newPhotos.concat([prepared]) }); this.syncLabels(); this.saveDraft();
          }
        } catch (error) { this.setData({ error: error.message }); }
        finally { this.setData({ busy: false }); }
      }
    });
  },


  async uploadOne(photo, index) {
    const account = await api.request("/api/account");
    const pet = this.data.pet;
    photo.requestId = photo.requestId || requestId();
    const session = createUploadSession({ accountId: account.id, petId: pet.id, petName: pet.name, entry: "create",
      dependencies: {
        read: () => ({ sessionId: photo.requestId, items: [Object.assign({}, photo, { state: photo.state || "ready", attempted: Boolean(photo.attempted), progress: photo.progress || 0 })] }),
        write: (_, value) => { Object.assign(photo, value.items[0]); this.saveDraft(); }
      },
      onChange: (state) => { const item = state.items[0]; this.setData({ uploadProgress: Math.round((index * 100 + item.progress) / Math.max(1, this.data.newPhotos.length)) }); },
      onLoginRequired: () => wx.navigateTo({ url: "/pages/login/login" })
    });
    this._upload = session;
    const state = await session.run();
    this._upload = null;
    const item = state.items[0];
    if (this._closed || item.state !== "saved") throw new Error(item.error || "保存结果待核对，回来后可以继续");
    return { id: item.photoId };
  },
  onShow() { this._closed = false; if (this.data.task && this.data.stage === "generating") { this._pollGeneration = (this._pollGeneration || 0) + 1; this.poll(this.data.task.id, this._pollGeneration); } else if (this.data.pet && !this.data.busy) this.loadPhotoLibrary(); },
  onHide() { this._closed = true; this._photoRequest = (this._photoRequest || 0) + 1; this._pollGeneration = (this._pollGeneration || 0) + 1; if (this._pollTimer) clearTimeout(this._pollTimer); if (this._upload) this._upload.stop(); this.saveDraft(); },
  onUnload() { this.onHide(); },

  generate() {
    if (this.data.busy) return;
    const plugin = this.data.plugin;
    const count = this.data.selectedExistingIds.length + this.data.newPhotos.length;
    if (!this.data.pet || count < plugin.input.photos.min || count > plugin.input.photos.max) return this.setData({ error: "请选择 " + plugin.input.photos.min + "-" + plugin.input.photos.max + " 张照片" });
    this.setData({ busy: true, error: "", uploadProgress: 0 });
    const uploaded = [];
    const uploadNext = (index) => {
      if (index >= this.data.newPhotos.length) return Promise.resolve();
      return this.uploadOne(this.data.newPhotos[index], index, 0).then((photo) => { uploaded.push(photo); return uploadNext(index + 1); });
    };
    uploadNext(0).then(() => {
      if (this._closed) throw new Error("上传已暂停，回来后可继续");
      let options = {};
      if (this.data.pluginId === "pet-id-card") options = { documentType: this.data.documentType };
      if (this.data.pluginId === "pet-movie-poster") options = { style: this.data.style, composition: this.data.composition, review: this.data.review || undefined };
      if (this.data.pluginId === "pet-time-album") options = { voice: "pet", theme: this.data.theme, coverTitle: this.data.coverTitle || undefined };
      const input = { pluginId: this.data.pluginId, petId: this.data.pet.id, photoIds: this.data.selectedExistingIds.concat(uploaded.map((item) => item.id)), options };
      const signature = JSON.stringify(input);
      if (!this._submission || this._submission.signature !== signature) this._submission = { signature, key: requestId() };
      this.saveDraft();
      return api.request("/api/generations", { method: "POST", data: Object.assign({}, input, { idempotencyKey: this._submission.key }) }).then(displayMediaTree);
    }).then((task) => {
      this.setData({ task, stage: "generating" });
      this.saveDraft();
      this.syncLabels();
      this.pollCount = 0;
      this._pollGeneration = (this._pollGeneration || 0) + 1;
      this.poll(task.id, this._pollGeneration);
    }).catch((error) => this.setData({ error: error.message || error.errMsg, busy: false }));
  },

  poll(taskId, generation) {
    const currentGeneration = generation || this._pollGeneration || 0;
    if (this._closed || currentGeneration !== (this._pollGeneration || 0)) return;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    const delay = Math.min(5000, 800 * Math.pow(1.45, this.pollCount || 0));
    this.pollCount = (this.pollCount || 0) + 1;
    api.requestWithRetry("/api/generations/" + taskId, {}, 2).then(displayMediaTree).then((task) => {
      if (this._closed || currentGeneration !== (this._pollGeneration || 0)) return;
      this.setData({ task });
      if (task.status === "succeeded") {
        this._submission = null;
        this.setData({ task: null, work: task.work, stage: "result", busy: false });
        this.saveDraft();
        this.syncLabels();
        api.request("/api/events", { method: "POST", data: { name: "previewed", pluginId: this.data.pluginId, channel: "miniprogram", metadata: {} } }).catch(() => undefined);
      } else if (task.status === "failed") {
        // 失败任务不能继续复用同一幂等键，否则服务端会持续返回原 failed 任务。
        this._submission = null;
        this.setData({ task: null, error: "生成失败，免费次数已返还", stage: "photos", busy: false });
        this.saveDraft();
        this.syncLabels();
      }
      else this._pollTimer = setTimeout(() => this.poll(taskId, currentGeneration), delay);
    }).catch((error) => {
      if (this._closed || currentGeneration !== (this._pollGeneration || 0)) return;
      this.setData({ error: error.message, stage: "photos", busy: false }); this.syncLabels();
    });
  },

  openWork() { if (this.data.work) wx.navigateTo({ url: "/pages/work/work?id=" + this.data.work.id }); }
});
