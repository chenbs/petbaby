const { displayMediaTree } = require("../../services/photo-files");
const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");
const { manifest, imageEntries } = require("../../services/sample-assets");

/*
 * 作品柜（2026-09 改版；2026-10 按 prototype.html after-works 对齐）。
 *
 * 所有产物收进一个柜子：普通作品、写真套餐成片（2×2 拼图卡）、趣测结果（贴纸色卡），
 * 按月分组混排在双列瀑布流里；正在制作的任务放在顶部横滑。
 * 作品图按原图比例显示（widthFix），分栏按估算高度放进较矮的一列。
 *
 * 作品长期保存，不再有「已过期」状态；卡片不显示版本号。
 */
const TABS = [
  { id: "all", label: "全部" },
  { id: "progress", label: "制作记录" },
  { id: "locked", label: "待保存" },
  { id: "art", label: "写真" },
  { id: "video", label: "短片" },
  { id: "fun", label: "趣测" }
];
const RUNNING = ["queued", "processing"];
/** 各类卡片的估算高宽比（图片 + 文字），只用于左右分栏，不决定实际尺寸。 */
const HEIGHT = { ai: 16 / 9, layout: 4 / 3, video: 4 / 3, bundle: 4 / 3, fun: 1.1, text: 0.3 };

function dateParts(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
function monthLabel(iso) {
  const date = dateParts(iso);
  return date ? date.getFullYear() + " 年 " + (date.getMonth() + 1) + " 月" : "更早";
}
function dayLabel(iso) {
  const date = dateParts(iso);
  return date ? (date.getMonth() + 1) + " 月 " + date.getDate() + " 日" : "";
}

/** 写真套餐成片：带登录态下载预览图（<image> 不能带 Authorization 头）。 */
function downloadBundlePreview(batchId, itemId) {
  return new Promise((resolve) => wx.downloadFile({
    url: config.apiBaseUrl + "/api/art-photo-bundles/" + encodeURIComponent(batchId) + "/items/" + encodeURIComponent(itemId) + "?preview=1",
    header: { authorization: "Bearer " + wx.getStorageSync("petbaby_session"), "x-petbaby-client": "miniprogram" },
    success: (result) => resolve(result.statusCode === 200 ? result.tempFilePath : ""),
    fail: () => resolve("")
  }));
}

themedPage({
  data: {
    tabs: TABS, tab: "all", pets: [], petId: "", petNames: ["全部宠物"], petText: "全部宠物",
    progress: [], groups: [], counts: {},
    loading: true, error: "", filtered: false
  },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 2 });
    this.load();
  },
  onHide() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } },
  onUnload() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } },
  load() {
    this.setData({ loading: !this.allWorks, error: "" });
    const optional = (path, fallback) => api.request(path).catch(() => fallback === undefined ? [] : fallback);
    return Promise.all([
      api.request("/api/works").then(displayMediaTree),
      api.request("/api/generations").then(displayMediaTree),
      api.request("/api/pets").then(displayMediaTree),
      api.request("/api/plugins"),
      optional("/api/ai-runs"),
      optional("/api/art-photo-bundles"),
      optional("/api/video-projects"),
      optional("/api/fun-test-results"),
      optional("/api/image-templates", { entries: [] })
    ]).then((result) => {
      this.allWorks = result[0] || [];
      const plugins = result[3] || [];
      this.pluginNames = Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin.name]));
      const pluginCover = (id) => manifest.plugins[id] || "";
      // 任务列表只返回模板标题，按标题找回样片作为进行中卡片的缩略图
      const templateByTitle = {};
      imageEntries(result[8] && Array.isArray(result[8].entries) ? result[8].entries : []).forEach((entry) => entry.templates.forEach((item) => { templateByTitle[item.title] = item.sampleUrl; }));
      this.allProgress = [].concat(
        (result[1] || []).filter((task) => RUNNING.concat("failed").indexOf(task.status) >= 0).map((task) => ({
          id: "gen-" + task.id, kind: "generation", targetId: task.id, pluginId: task.pluginId, petId: task.petId, status: task.status,
          title: this.pluginNames[task.pluginId] || "作品", thumb: pluginCover(task.pluginId),
          hint: task.status === "failed" ? "任务未完成，已退还冻干或免费玩法次数" : "大约还要 " + (task.estimatedSeconds || 15) + " 秒",
          percent: task.progress || 10
        })),
        (result[4] || []).map((run) => ({
          id: "run-" + run.id, kind: "run", targetId: run.id, pluginId: run.pluginId, petId: run.petId, status: run.status,
          title: run.title, thumb: templateByTitle[run.title] || pluginCover("pl-10"),
          hint: run.status === "succeeded" ? (run.candidateCount > 1 ? run.candidateCount + " 张已出，去挑一张" : "已经拍好，去看看") : run.status === "failed" ? "任务未完成，已退还冻干" : "离开也会继续做",
          percent: run.status === "succeeded" ? 100 : run.status === "processing" ? 62 : 15
        })),
        (result[5] || []).filter((batch) => batch.status !== "cancelled" && batch.completedCount < batch.totalCount).map((batch) => ({
          id: "art-" + batch.id, kind: "art", targetId: batch.id, status: "processing",
          title: "写真 " + batch.totalCount + " 套", thumb: pluginCover("pl-10"),
          hint: "已完成 " + batch.completedCount + " / " + batch.totalCount,
          percent: Math.round(batch.completedCount * 100 / Math.max(1, batch.totalCount))
        })),
        (result[6] || []).filter((project) => ["draft", "queued", "processing", "failed"].indexOf(project.status) >= 0).map((project) => ({
          id: "video-" + project.id, kind: "video", targetId: project.id, petId: project.pet_id, status: project.status,
          title: project.title || "宠物短片", thumb: pluginCover("pl-19"),
          hint: project.status === "draft" ? "草稿 · 继续编辑" : project.status === "failed" ? "任务未完成，已退还冻干" : "正在渲染",
          percent: project.status === "draft" ? 0 : 50
        }))
      );
      this.allBundles = (result[5] || []).filter((batch) => batch.completedCount > 0);
      this.allFun = (result[7] || []).map((item) => ({
        id: item.id, title: (item.outcome && item.outcome.name) || "趣测结果", createdAt: item.createdAt,
        cover: item.cover ? (manifest.funTests && manifest.funTests[item.cover]) || "/assets/fun-tests/" + item.cover + ".jpg" : ""
      }));
      this.setData({
        pets: result[2] || [],
        petNames: ["全部宠物"].concat((result[2] || []).map((item) => item.name)),
        loading: false
      });
      this.filter();
      this.loadBundleStacks();
      // 有正在制作的任务时轻量轮询，完成后自动出现在「全部」里。
      if (this._timer) clearTimeout(this._timer);
      if (this.allProgress.some((item) => RUNNING.indexOf(item.status) >= 0)) this._timer = setTimeout(() => this.load(), 5000);
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },

  /** 写真套餐卡的 2×2 拼图：每套取前四张已完成的成片预览，取不到时用对应场景的样片占位。 */
  loadBundleStacks() {
    this._stacks = this._stacks || {};
    const pending = (this.allBundles || []).filter((batch) => !this._stacks[batch.id]).slice(0, 6);
    if (!pending.length) return;
    Promise.all(pending.map((batch) => api.request("/api/art-photo-bundles/" + encodeURIComponent(batch.id))
      .then((detail) => {
        const items = (detail.items || []).filter((item) => item.status === "succeeded").slice(0, 4);
        return Promise.all(items.map((item) => downloadBundlePreview(batch.id, item.id).then((path) => path || manifest.scenes[item.sceneId] || "")))
          .then((urls) => { this._stacks[batch.id] = urls.filter(Boolean); });
      })
      .catch(() => { this._stacks[batch.id] = []; })))
      .then(() => this.filter());
  },

  chooseTab(event) { this.setData({ tab: event.currentTarget.dataset.id }); this.filter(); },
  choosePet(event) {
    const index = Number(event.detail.value);
    this.setData({ petId: index ? this.data.pets[index - 1].id : "", petText: this.data.petNames[index] });
    this.filter();
  },
  resetFilters() { this.setData({ tab: "all", petId: "", petText: "全部宠物" }); this.filter(); },

  /** 把作品、写真套餐、趣测结果统一成卡片，按月分组，再按估算高度分左右两列。 */
  filter() {
    const { tab, petId } = this.data;
    const byPet = (item) => !petId || !item.petId || item.petId === petId;
    const works = (this.allWorks || []).filter(byPet).filter((work) => {
      if (tab === "locked") return work.locked;
      if (tab === "art") return work.pluginId === "pl-10";
      if (tab === "video") return work.assetKind === "video";
      return tab === "all";
    }).map((work) => {
      const photoUrl = work.photo && work.photo.url || "";
      const ai = work.sourceKind === "ai";
      return {
        key: "work-" + work.id, kind: "work", id: work.id, createdAt: work.createdAt, petId: work.petId,
        cover: ["video", "pdf", "h5"].indexOf(work.assetKind) >= 0 ? photoUrl : work.outputUrl || photoUrl,
        title: work.title, meta: dayLabel(work.createdAt) + (work.plugin && work.plugin.name ? " · " + work.plugin.name : ""),
        badge: work.locked ? "待保存" : "", badgeTone: "warm",
        aiNotice: work.aiGenerated || ai ? work.aiNotice || "该内容由AI生成" : "",
        estimate: ai ? HEIGHT.ai : work.assetKind === "video" ? HEIGHT.video : HEIGHT.layout
      };
    });
    const bundles = tab === "all" || tab === "art" ? (this.allBundles || []).map((batch) => ({
      key: "bundle-" + batch.id, kind: "bundle", id: batch.id, createdAt: batch.createdAt,
      stack: (this._stacks && this._stacks[batch.id] || []).concat(["", "", "", ""]).slice(0, 4),
      title: "写真馆 · " + (batch.package === "all" || batch.totalCount > 10 ? "全部 " + batch.totalCount + " 套" : "精选 " + batch.totalCount + " 套"),
      meta: dayLabel(batch.createdAt) + " · 点开逐张保存",
      badge: batch.completedCount + " / " + batch.totalCount, badgeTone: "mint",
      aiNotice: "", estimate: HEIGHT.bundle
    })) : [];
    const fun = tab === "all" || tab === "fun" ? (this.allFun || []).map((item) => ({
      key: "fun-" + item.id, kind: "fun", id: item.id, createdAt: item.createdAt, cover: item.cover,
      title: item.title, meta: "趣测结果 · 可再次分享", badge: "", aiNotice: "", estimate: HEIGHT.fun
    })) : [];
    const cards = tab === "progress" ? [] : works.concat(bundles, fun).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const groups = [];
    for (const card of cards) {
      const month = monthLabel(card.createdAt);
      let group = groups[groups.length - 1];
      if (!group || group.month !== month) { group = { month, left: [], right: [], leftHeight: 0, rightHeight: 0 }; groups.push(group); }
      const height = card.estimate + HEIGHT.text;
      if (group.leftHeight <= group.rightHeight) { group.left.push(card); group.leftHeight += height; }
      else { group.right.push(card); group.rightHeight += height; }
    }
    const progress = (this.allProgress || []).filter(byPet).filter((item) => tab === "all" || tab === "progress" || (tab === "art" && item.kind === "art") || (tab === "video" && item.kind === "video"));
    const counts = {
      all: (this.allWorks || []).length + (this.allBundles || []).length + (this.allFun || []).length,
      progress: (this.allProgress || []).length,
      locked: (this.allWorks || []).filter((work) => work.locked).length
    };
    this.setData({ groups: groups.map((group) => ({ month: group.month, left: group.left, right: group.right })), progress, counts, filtered: Boolean(petId || tab !== "all") });
  },

  onCoverError(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    const groups = this.data.groups;
    for (let g = 0; g < groups.length; g += 1) {
      for (const side of ["left", "right"]) {
        const index = groups[g][side].findIndex((item) => item.key === key);
        if (index >= 0) return this.setData({ ["groups[" + g + "]." + side + "[" + index + "].imageFailed"]: true });
      }
    }
  },
  openItem(event) {
    const key = String(event.currentTarget.dataset.key || "");
    const id = key.slice(key.indexOf("-") + 1);
    if (key.indexOf("work-") === 0) return wx.navigateTo({ url: "/pages/work/work?id=" + id });
    if (key.indexOf("bundle-") === 0) return wx.navigateTo({ url: "/pages/art-photo-result/art-photo-result?id=" + encodeURIComponent(id) });
    if (key.indexOf("fun-") === 0) return wx.navigateTo({ url: "/pages/fun-tests/fun-tests?resultId=" + encodeURIComponent(id) });
  },
  openProgress(event) {
    const item = (this.allProgress || []).find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.kind === "run") return wx.navigateTo({ url: "/pages/ai-run/ai-run?id=" + item.targetId });
    if (item.kind === "art") return wx.navigateTo({ url: "/pages/art-photo-result/art-photo-result?id=" + item.targetId });
    if (item.kind === "video") return wx.navigateTo({ url: "/pages/video/video?id=" + item.targetId });
    wx.navigateTo({ url: "/pages/create/create?pluginId=" + item.pluginId });
  },
  goCreate() { wx.switchTab({ url: "/pages/art-photo/art-photo" }); },
  /** 空状态按钮：有筛选条件时清空筛选，否则去创作（WXML 不支持动态事件名） */
  handleEmptyAction() { if (this.data.filtered) this.resetFilters(); else this.goCreate(); }
});
