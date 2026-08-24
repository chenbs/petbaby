const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");
const service = require("../service");

const STATUS_TEXT = { queued: "排队中", processing: "生成中", succeeded: "已完成", failed: "生成失败", cancelled: "已取消" };

/** 轮询间隔。与 pages/ai-run 同值 —— 立绘约 45 秒，1.6 秒一次既不慢也不吵 */
const POLL_MS = 1600;

/**
 * 岛上宠物的 2D 形象。
 *
 * **沿用 `pages/ai-run` 的四选一交互**（22 号文 3.3：那套已经跑通，不另造一套），
 * 但走岛自己的接口（`/api/island/avatar`）与**独立日额度**（6.3：岛的额度用完不该影响
 * 做图，反之亦然）。
 *
 * **必须图生图**（2.6）：纯文生图只能得到「某只橘猫」，而判据与 PL-10 完全一致 ——
 * 用户拿到一张不是自家宠物的图，这个玩法就是坏的。所以这一页强制先选照片。
 *
 * **形象打 AI 标识但岛内实时渲染不叠标识**（2.6）：与既有「预览从已打标字节缩」
 * 同一口径，导出/分享物一定带标。这一页展示的候选来自服务端已打标的字节。
 */
themedPage({
  data: {
    loading: true,
    error: "",
    message: "",
    messageType: "info",
    busy: false,
    /** 可入岛的宠物。**memorial 已过滤** —— 服务端也拦，两处都要（1.4） */
    pets: [],
    petId: "",
    petName: "",
    /** 该宠物的照片，供选参考图 */
    photos: [],
    photoId: "",
    run: null,
    statusText: "",
    candidates: [],
    selectedId: ""
  },

  onLoad(query) {
    if (query && query.petId) this.setData({ petId: query.petId });
    this.loadPets();
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },

  loadPets() {
    api.request("/api/pets")
      .then((pets) => {
        /*
         * **端上过滤 memorial**（1.4）。服务端也会拦（`ISLAND_UNAVAILABLE_MEMORIAL`），
         * 但两处都要：只做端上隐藏则接口仍可调，只做服务端拦截则用户会看到入口
         * 点进去报错。岛的核心机制是亲密度日增与陪伴天数递增，对已离开的宠物
         * 递增天数是明确的冒犯。
         */
        const usable = service.selectablePets(pets);
        const chosen = usable.filter((pet) => pet.id === this.data.petId)[0] || usable[0];
        this.setData({
          loading: false,
          pets: usable,
          petId: chosen ? chosen.id : "",
          petName: chosen ? chosen.name : ""
        });
        if (chosen) this.loadPhotos(chosen.id);
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  loadPhotos(petId) {
    api.request("/api/photos?petId=" + encodeURIComponent(petId))
      .then((photos) => this.setData({
        /*
         * **用服务端下发的 `photo.url` 补域名，不自己按 id 拼**：
         * `/api/media/` 吃的是**对象键**而不是照片 id（见 `db/rows.ts` 的 `mapPhoto`），
         * 按 id 拼出来的地址一律 404，端上表现为整列裂图且不报错。
         *
         * 补域名是必须的：小程序 `<image src>` 遇到以 `/` 开头的值会当主包内
         * 本地文件找（CLAUDE.md 已记录这个坑）。
         */
        photos: (photos || []).map((photo) => Object.assign({}, photo, {
          url: config.apiBaseUrl + photo.url
        })),
        photoId: ""
      }))
      .catch(() => this.setData({ photos: [] }));
  },

  choosePet(event) {
    const pet = this.data.pets[Number(event.currentTarget.dataset.index)];
    if (!pet) return;
    this.setData({ petId: pet.id, petName: pet.name, run: null, candidates: [], message: "" });
    this.loadPhotos(pet.id);
  },

  choosePhoto(event) {
    this.setData({ photoId: event.currentTarget.dataset.id });
  },

  /** 提交生成。约 45 秒、四选一，与 ai-run 同一节奏 */
  submit() {
    if (!this.data.petId) return this.setData({ error: "先选一只宠物" });
    if (!this.data.photoId) return this.setData({ error: "选一张清晰的正脸照，形象要像它" });
    this.setData({ busy: true, error: "", message: "" });
    service.createAvatarRun(this.data.petId, this.data.photoId)
      .then((run) => {
        // 服务端返回的键是 `runId`（不是 `id`）—— 它不是一个资源对象而是一次提交的收据
        this.runId = run.runId;
        this.setData({ busy: false, message: "正在生成，大约 45 秒", messageType: "info" });
        this.poll();
      })
      .catch((error) => this.setData({ busy: false, error: error.message }));
  },

  poll() {
    if (!this.runId) return;
    service.loadAvatarRun(this.runId)
      .then((run) => {
        const candidates = (run.candidates || []).map((item, index) => Object.assign({}, item, {
          number: index + 1,
          url: config.apiBaseUrl + "/api/island/avatar/" + encodeURIComponent(this.runId) + "/candidates/" + encodeURIComponent(item.id)
        }));
        this.setData({
          run: run,
          candidates: candidates,
          selectedId: run.selectedId || "",
          statusText: STATUS_TEXT[run.status] || run.status
        });
        if (run.status === "queued" || run.status === "processing") this.timer = setTimeout(() => this.poll(), POLL_MS);
      })
      .catch((error) => this.setData({ error: error.message }));
  },

  /**
   * 选定候选。**用户确认后才入岛**（2.6），且允许重生成。
   * 选定即写 `island_pets.avatar_key`，返回岛首页时立绘就位。
   */
  select(event) {
    const candidateId = event.currentTarget.dataset.id;
    this.setData({ busy: true });
    service.selectAvatar(this.runId, candidateId)
      .then(() => {
        this.setData({ busy: false, selectedId: candidateId, message: "它已经住进小岛了", messageType: "success" });
        // 回到岛首页会重新拉快照，立绘随之更新
        setTimeout(() => wx.navigateBack(), 900);
      })
      .catch((error) => this.setData({ busy: false, error: error.message }));
  },

  /** 重生成。消耗独立额度，超额由服务端拦（6.3 建议每宠 1 次 + 2 次重生成） */
  regenerate() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.setData({ run: null, candidates: [], selectedId: "", message: "", error: "" });
    this.runId = null;
  },

  goPets() { wx.navigateTo({ url: "/pages/pets/pets" }); },
  goPhotos() { wx.navigateTo({ url: "/pages/photos/photos" }); }
});
