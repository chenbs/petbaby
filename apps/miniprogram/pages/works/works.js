const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

const STATUS = { values: ["all", "processing", "failed", "locked", "unlocked", "expired"], labels: ["全部状态", "生成中", "生成失败", "待解锁", "已解锁", "已过期"] };
const TASK_TEXT = { queued: "排队中", processing: "生成中", failed: "生成失败" };

themedPage({
  data: {
    works: [], tasks: [], pets: [], plugins: [],
    petNames: ["全部宠物"], pluginNames: ["全部玩法"], statusLabels: STATUS.labels,
    petId: "", pluginId: "", status: "all",
    petText: "全部宠物", pluginText: "全部玩法", statusText: STATUS.labels[0],
    loading: true, error: ""
  },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 1 });
    this.load();
  },
  load() {
    this.setData({ loading: true, error: "" });
    Promise.all([api.request("/api/works"), api.request("/api/generations"), api.request("/api/pets"), api.request("/api/plugins")]).then((result) => {
      this.allWorks = result[0]; this.allTasks = result[1];
      this.setData({
        pets: result[2],
        plugins: result[3],
        petNames: ["全部宠物"].concat(result[2].map((item) => item.name)),
        pluginNames: ["全部玩法"].concat(result[3].map((item) => item.name)),
        loading: false
      });
      this.filter();
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  choosePet(event) {
    const index = Number(event.detail.value);
    this.setData({ petId: index ? this.data.pets[index - 1].id : "", petText: this.data.petNames[index] });
    this.filter();
  },
  choosePlugin(event) {
    const index = Number(event.detail.value);
    this.setData({ pluginId: index ? this.data.plugins[index - 1].id : "", pluginText: this.data.pluginNames[index] });
    this.filter();
  },
  chooseStatus(event) {
    const index = Number(event.detail.value);
    this.setData({ status: STATUS.values[index], statusText: STATUS.labels[index] });
    this.filter();
  },
  resetFilters() {
    this.setData({ petId: "", pluginId: "", status: "all", petText: "全部宠物", pluginText: "全部玩法", statusText: STATUS.labels[0] });
    this.filter();
  },
  filter() {
    const petId = this.data.petId; const pluginId = this.data.pluginId; const status = this.data.status; const now = Date.now();
    const works = (this.allWorks || []).filter((work) => {
      if (petId && work.petId !== petId || pluginId && work.pluginId !== pluginId) return false;
      if (status === "locked" && !work.locked || status === "unlocked" && work.locked) return false;
      if (status === "expired" && (!work.locked || !work.expiresAt || new Date(work.expiresAt).getTime() >= now)) return false;
      return ["all", "locked", "unlocked", "expired"].indexOf(status) >= 0;
    }).map((work) => {
      const expired = Boolean(work.locked && work.expiresAt && new Date(work.expiresAt).getTime() < now);
      return Object.assign({}, work, {
        statusText: expired ? "已过期" : work.locked ? "待解锁" : "已解锁",
        statusTone: expired ? "error" : work.locked ? "warning" : "success"
      });
    });
    const tasks = (this.allTasks || []).filter((task) => {
      if (["queued", "processing", "failed"].indexOf(task.status) < 0 || petId && task.petId !== petId || pluginId && task.pluginId !== pluginId) return false;
      return status === "all" || status === "processing" && task.status !== "failed" || status === "failed" && task.status === "failed";
    }).map((task) => Object.assign({}, task, { statusText: TASK_TEXT[task.status] || task.status }));
    // 有筛选条件但结果为空时，空状态要引导「清空筛选」而不是「去创作」
    this.setData({ works, tasks, filtered: Boolean(petId || pluginId || status !== "all") });
  },
  open(event) { wx.navigateTo({ url: "/pages/work/work?id=" + event.currentTarget.dataset.id }); },
  retry(event) { const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id); if (task) wx.navigateTo({ url: "/pages/create/create?pluginId=" + task.pluginId }); },
  goCreate() { wx.switchTab({ url: "/pages/index/index" }); },
  /** 空状态按钮：有筛选条件时清空筛选，否则去创作（WXML 不支持动态事件名） */
  handleEmptyAction() { if (this.data.filtered) this.resetFilters(); else this.goCreate(); }
});
