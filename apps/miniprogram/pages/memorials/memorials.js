const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");
const { SCENE_PRESETS } = require("../../theme/scene-presets");

const LIFECYCLE_TEXT = { hidden: "已隐藏", restored: "正常", active: "正常", normal: "正常" };
const LIFECYCLE_TONE = { hidden: "neutral" };
const VISIBILITY_TEXT = { public: "公开", private: "私密" };
const PRODUCT_ACTIONS = [
  { key: "album", label: "生成纪念册", description: "把照片与故事排成可翻阅的册子" },
  { key: "video", label: "生成纪念视频", description: "照片与字幕合成一段短片" },
  { key: "stardust", label: "生成星尘页", description: "可点击收集星尘的互动页" }
];

function sceneName(id) {
  const scene = SCENE_PRESETS.filter((item) => item.id === id)[0];
  return scene ? scene.name : id || "星尘";
}

/** 时间轴节点日期，形如 2026·07·21（方案 E 时间轴形态的写法） */
function formatDate(value) {
  const date = companion.startOfLocalDay(value);
  if (!date) return "";
  const pad = (number) => (number < 10 ? "0" + number : String(number));
  return `${date.getFullYear()}·${pad(date.getMonth() + 1)}·${pad(date.getDate())}`;
}

themedPage({ mood: "memorial" }, {
  data: {
    items: [],
    pets: [],
    petLabels: [],
    photos: [],
    petId: "",
    petName: "",
    title: "",
    story: "",
    selected: [],
    loading: true,
    creating: false,
    formOpen: false,
    productsFor: "",
    moreFor: "",
    productActions: PRODUCT_ACTIONS,
    moreActions: [],
    message: "",
    error: ""
  },

  /**
   * 从宠物档案的「纪念空间」按钮进来时带 petId（改造项 L4）。
   *
   * 不带就回落到第一只 —— 与 pages/timeline 同一条约定：
   * 带了 id 就看那一只，否则点非默认宠物会看到错的那只。
   */
  onLoad(options) {
    const petId = options && options.petId;
    if (petId) this.setData({ petId });
  },

  onShow() { this.load(); },

  load() {
    this.setData({ loading: !this.data.items.length, error: "" });
    Promise.all([api.request("/api/memorials"), api.request("/api/pets")])
      .then(([items, pets]) => {
        const petById = {};
        for (const pet of pets) petById[pet.id] = pet;
        const current = this.data.petId ? petById[this.data.petId] : pets[0];
        this.setData({
          loading: false,
          pets,
          petLabels: pets.map((pet) => pet.name),
          petId: current ? current.id : "",
          petName: current ? current.name : "",
          items: items.map((item) => {
            const pet = petById[item.petId];
            /*
             * 陪伴天数在这一页按拍板走**过去式且不递增**：
             * 截止日取该宠物的离开日期（memorialSince），拿不到就退回这个纪念空间的
             * 创建时间 —— 两者本是同一次操作写下的。
             *
             * 绝不能省掉截止日让它算到今天：那样「陪伴了 N 天」会每天继续往上涨，
             * 而对这一页的用户来说，那件事已经结束了。
             */
            const until = (pet && pet.memorialSince) || item.createdAt;
            const days = pet ? companion.daysSince(companion.anchorOf(pet), until) : 0;
            return Object.assign({}, item, {
              themeText: sceneName(item.theme),
              petName: item.petName || (pet ? pet.name : ""),
              lifecycleText: LIFECYCLE_TEXT[item.lifecycle || item.status] || "正常",
              lifecycleTone: LIFECYCLE_TONE[item.lifecycle || item.status] || "success",
              visibilityText: VISIBILITY_TEXT[item.visibility || "private"] || "私密",
              companionDays: days,
              companionText: days ? `陪伴了 ${days} 天` : "",
              dateText: formatDate(item.createdAt)
            });
          })
        });
        if (current && !this.data.photos.length) this.loadPhotos(current.id);
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },

  loadPhotos(id) {
    api.request("/api/photos?petId=" + encodeURIComponent(id))
      .then((photos) => this.setData({ photos, selected: [] }))
      .catch(() => this.setData({ photos: [], selected: [] }));
  },

  openForm() { this.setData({ formOpen: true, message: "" }); },
  closeForm() { this.setData({ formOpen: false }); },

  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petName: pet.name });
    this.loadPhotos(pet.id);
  },

  onTitle(event) { this.setData({ title: event.detail.value }); },
  onStory(event) { this.setData({ story: event.detail.value }); },

  togglePhoto(event) {
    const id = event.detail.id;
    const selected = this.data.selected.slice();
    const index = selected.indexOf(id);
    if (index >= 0) selected.splice(index, 1);
    else if (selected.length < 9) selected.push(id);
    this.setData({ selected });
  },

  create() {
    if (!this.data.petId || !this.data.title || this.data.creating) return;
    this.setData({ creating: true, error: "" });
    api.request("/api/memorials", {
      method: "POST",
      data: { petId: this.data.petId, title: this.data.title, story: this.data.story, theme: "stardust", photoIds: this.data.selected }
    })
      .then(() => {
        this.setData({ creating: false, formOpen: false, title: "", story: "", selected: [], message: "纪念空间已创建" });
        this.load();
      })
      .catch((error) => this.setData({ creating: false, error: error.message }));
  },

  openProducts(event) { this.setData({ productsFor: event.currentTarget.dataset.id }); },
  closeProducts() { this.setData({ productsFor: "" }); },

  chooseProduct(event) {
    const id = this.data.productsFor;
    this.setData({ productsFor: "", message: "", error: "" });
    if (!id) return;
    api.request("/api/memorials/" + id + "/products", { method: "POST", data: { product: event.detail.key } })
      .then(() => this.setData({ message: "已提交生成，稍后可在作品柜查看" }))
      .catch((error) => this.setData({ error: error.message }));
  },

  openMore(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.items.filter((entry) => entry.id === id)[0];
    if (!item) return;
    const hidden = (item.lifecycle || item.status) === "hidden";
    this.setData({
      moreFor: id,
      moreActions: [{
        key: hidden ? "restored" : "hidden",
        label: hidden ? "恢复空间" : "隐藏空间",
        description: hidden ? "重新在列表与分享页中可见" : "从列表与分享页中收起，不会删除内容"
      }]
    });
  },
  closeMore() { this.setData({ moreFor: "", moreActions: [] }); },

  chooseMore(event) {
    const id = this.data.moreFor;
    const next = event.detail.key;
    this.setData({ moreFor: "", moreActions: [], error: "" });
    if (!id) return;
    api.request("/api/memorials/" + id + "/lifecycle", { method: "POST", data: { lifecycle: next, reason: "用户操作" } })
      .then(() => this.load())
      .catch((error) => this.setData({ error: error.message }));
  }
});
