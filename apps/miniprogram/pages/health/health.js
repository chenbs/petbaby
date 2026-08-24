const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

/**
 * 健康助手。
 *
 * **这是分诊不是问诊/诊断** —— 定位与红线见
 * `docs/product/16-竞品分析与产品复盘.md` 第三章、`17-产品改造方案.md` 3.7。
 *
 * 端上要守住的三条：
 * 1. 页面文案不出现「诊断」「确诊」「问诊」「治愈」；
 * 2. 免责声明由服务端下发（`advisory.disclaimer`），**不在端上写死** ——
 *    两端各写一份文案，改法务口径时必然漏一处；
 * 3. 免责声明与结论同屏、不折叠。
 *
 * 已建纪念空间（`lifeStage === 'memorial'`）的宠物不出现在选择列表里：
 * 服务端也会拦（HEALTH_UNAVAILABLE_MEMORIAL），但只靠服务端拦
 * 会让用户看到入口、点进去报错。
 */

const LEVEL_TEXT = {
  emergency: "建议立即就医",
  urgent_24h: "建议 24 小时内就医",
  observe: "暂可观察",
  routine: "通常无需担心",
};

/** 紧急档用强调色，其余用中性色 —— 不靠颜色制造焦虑，但紧急必须显眼。 */
const LEVEL_TONE = {
  emergency: "danger",
  urgent_24h: "accent",
  observe: "neutral",
  routine: "neutral",
};

/**
 * 记录类型。枚举必须与服务端 `careSchema` 的 kind 一致。
 *
 * 只枚举**类型**不枚举**项目**：类型是四种固定动作，而疫苗品牌与驱虫药组合
 * 太多，给候选清单等于在推荐具体药物（红线 2）。项目名由用户自己填。
 */
const CARE_KINDS = [
  { value: "vaccine", label: "疫苗" },
  { value: "deworm_internal", label: "体内驱虫" },
  { value: "deworm_external", label: "体外驱虫" },
  { value: "checkup", label: "体检" },
];

/** 今天的日期串，供体重记录的默认值。纯日期按本地零点，与服务端同口径 */
function todayString() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

themedPage({
  data: {
    pets: [],
    petIndex: 0,
    description: "",
    sessions: [],
    result: null,
    loading: true,
    busy: false,
    error: "",
    /*
     * 体重记录与趋势（改造项 L6）。趋势由服务端算并随列表下发 ——
     * 「±1% 算持平」「5% 以上值得提一句」两个阈值只有一份，
     * 端上自己算会在改阈值时出现「小程序说持平、档案 PDF 说增加了」。
     *
     * **趋势是事实陈述不是评价**：只给「较上次 +6.2%」，不给「偏胖」。
     * BMI 与肥胖评级接近诊断（红线），端上同样不得出现这类词。
     */
    weights: [],
    recentWeights: [],
    weightTrend: null,
    weightNote: "",
    weightInput: "",
    weightDate: todayString(),
    weightBusy: false,
    /*
     * 免疫与驱虫记录（改造项 L5 的数据来源）。
     *
     * **只记事实**：打了什么、哪天打的、下次哪天。不记「是否达标」——
     * 那是评价性判断，接近诊断。项目名由用户自己填，产品不给候选清单，
     * 因为给清单就等于在推荐具体疫苗或驱虫药（红线 2）。
     */
    careRecords: [],
    careKindIndex: 0,
    careLabel: "",
    careDate: todayString(),
    careDueDate: "",
    careBusy: false,
    careKindLabels: CARE_KINDS.map((item) => item.label),
    /*
     * 健康档案（改造项 L1）。**是就医准备材料不是体检报告** ——
     * 内容全部来自用户自己录入的记录，不含任何结论性判断。
     * 会员权益无限导出，非会员单买；不可分享（健康线的产出是私密记录）。
     */
    documents: [],
    documentBusy: false,
    documentHint: "",
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const pets = await api.request("/api/pets");
      // 已离开的宠物不进入健康功能（红线 10）。
      const active = (pets || []).filter((pet) => pet.lifeStage !== "memorial");
      const index = Math.min(this.data.petIndex, Math.max(0, active.length - 1));
      const petId = active[index] ? active[index].id : active[0] && active[0].id;
      const sessions = petId ? await api.request("/api/health-sessions?petId=" + petId) : [];
      this.setData({
        pets: active,
        petIndex: index,
        sessions: (sessions || []).map((item) => this.decorate(item)),
        loading: false,
      });
      if (petId) { this.loadWeights(petId); this.loadCare(petId); this.loadDocuments(petId); }
      else this.setData({ weights: [], recentWeights: [], weightTrend: null, weightNote: "", careRecords: [], documents: [] });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "加载失败" });
    }
  },

  /**
   * 取体重记录与趋势。**失败静默**：这是辅助区块，
   * 拉不到不该挡住分诊本身 —— 那是这一页的主功能。
   */
  loadWeights(petId) {
    api.request("/api/pets/" + petId + "/weights")
      .then((result) => {
        const records = (result && result.records) || [];
        this.setData({
          weights: records,
          // 1000 克以上给公斤（幼猫增重以十克计，小于 1 公斤时克才有意义）
          recentWeights: records.slice(0, 5).map((item) => Object.assign({}, item, {
            weightText: item.weightGrams >= 1000 ? Number((item.weightGrams / 1000).toFixed(1)) + " 公斤" : item.weightGrams + " 克",
          })),
          weightTrend: (result && result.trend) || null,
          weightNote: (result && result.note) || "",
        });
      })
      .catch(() => undefined);
  },

  /**
   * 取免疫 / 驱虫记录。同体重：失败静默，不挡住分诊主功能。
   *
   * 到期状态在端上标（`dueText`）而不在服务端：那只是把两个日期串比一下，
   * 而服务端已经在 L5 的提示里判过一次 —— 两处判的是不同的事
   * （这里是「列表上怎么显示」，那里是「要不要推通知」）。
   */
  loadCare(petId) {
    const today = todayString();
    api.request("/api/pets/" + petId + "/care")
      .then((records) => this.setData({
        careRecords: (records || []).map((item) => Object.assign({}, item, {
          kindText: (CARE_KINDS.filter((kind) => kind.value === item.kind)[0] || {}).label || item.kind,
          // 只陈述事实：到期日是哪天、过没过。不写「该打了」这类指令。
          dueText: item.dueOn ? (item.dueOn < today ? "已过期 · " + item.dueOn : "下次 " + item.dueOn) : "",
          overdue: Boolean(item.dueOn && item.dueOn < today),
        })),
      }))
      .catch(() => undefined);
  },

  chooseCareKind(event) { this.setData({ careKindIndex: Number(event.detail.value) }); },
  inputCareLabel(event) { this.setData({ careLabel: event.detail.value }); },
  chooseCareDate(event) { this.setData({ careDate: event.detail.value }); },
  chooseCareDueDate(event) { this.setData({ careDueDate: event.detail.value }); },

  /** 记一次免疫 / 驱虫。到期日可留空 —— 一次性项目没有下次，留空即不提醒。 */
  saveCare() {
    const pet = this.data.pets[this.data.petIndex];
    if (!pet) return;
    const label = String(this.data.careLabel).trim();
    if (!label) return this.setData({ error: "填一下项目名，比如「猫三联」" });
    this.setData({ careBusy: true, error: "" });
    const data = { kind: CARE_KINDS[this.data.careKindIndex].value, label, performedOn: this.data.careDate };
    if (this.data.careDueDate) data.dueOn = this.data.careDueDate;
    api.request("/api/pets/" + pet.id + "/care", { method: "POST", data })
      .then(() => { this.setData({ careBusy: false, careLabel: "", careDueDate: "" }); this.loadCare(pet.id); })
      .catch((error) => this.setData({ careBusy: false, error: error.message || "保存失败" }));
  },

  /** 删一条。填错日期的记录会一直触发到期提示，必须能删。 */
  deleteCare(event) {
    const pet = this.data.pets[this.data.petIndex];
    const id = event.currentTarget.dataset.id;
    if (!pet || !id) return;
    api.request("/api/pets/" + pet.id + "/care/" + id, { method: "DELETE" })
      .then(() => this.loadCare(pet.id))
      .catch((error) => this.setData({ error: error.message || "删除失败" }));
  },

  /** 已导出的健康档案列表。失败静默，同体重与免疫。 */
  loadDocuments(petId) {
    api.request("/api/health-documents?petId=" + petId)
      .then((documents) => this.setData({
        documents: (documents || []).map((item) => Object.assign({}, item, {
          kindText: item.kind === "annual" ? (item.year || "") + " 年度健康记录" : "健康档案",
          dateText: String(item.createdAt || "").slice(0, 10),
        })),
      }))
      .catch(() => undefined);
  },

  /**
   * 导出健康档案（L1）。
   *
   * 无权益时服务端返回 402 并带上价格 —— **不静默给残缺版本**：
   * 先给文件再要钱、或给一个删了内容的版本，都比明确告价更糟。
   * 402 的错误文案直接透出（含单买价），不在端上写死金额。
   */
  exportDocument() {
    const pet = this.data.pets[this.data.petIndex];
    if (!pet || this.data.documentBusy) return;
    this.setData({ documentBusy: true, documentHint: "", error: "" });
    api.request("/api/health-documents", { method: "POST", data: { petId: pet.id } })
      .then(() => { this.setData({ documentBusy: false, documentHint: "已导出，可以下载带去医院。" }); this.loadDocuments(pet.id); })
      .catch((error) => this.setData({ documentBusy: false, documentHint: error.message || "导出失败" }));
  },

  /** 下载 PDF 并交给系统打开。健康档案不可分享，只能本人下载。 */
  downloadDocument(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.downloadFile({
      url: config.apiBaseUrl + "/api/health-documents/" + id + "/download",
      header: { authorization: "Bearer " + wx.getStorageSync("petbaby_session") },
      success: (result) => wx.openDocument({ filePath: result.tempFilePath, fileType: "pdf", showMenu: true }),
      fail: () => this.setData({ documentHint: "下载失败，请稍后再试" }),
    });
  },

  inputWeight(event) { this.setData({ weightInput: event.detail.value }); },
  chooseWeightDate(event) { this.setData({ weightDate: event.detail.value }); },

  /**
   * 记一次体重。公斤输入 → 克存储：`weight_grams` 是整数，
   * 浮点公斤会出现 4.1+0.2 != 4.3 的显示问题（见迁移 0018 的说明）。
   */
  saveWeight() {
    const pet = this.data.pets[this.data.petIndex];
    if (!pet) return;
    const kilograms = Number(this.data.weightInput);
    if (!Number.isFinite(kilograms) || kilograms <= 0) return this.setData({ error: "请填写体重，单位公斤" });
    this.setData({ weightBusy: true, error: "" });
    api.request("/api/pets/" + pet.id + "/weights", {
      method: "POST",
      data: { weightGrams: Math.round(kilograms * 1000), measuredOn: this.data.weightDate },
    })
      .then(() => { this.setData({ weightBusy: false, weightInput: "" }); this.loadWeights(pet.id); })
      .catch((error) => this.setData({ weightBusy: false, error: error.message || "保存失败" }));
  },

  decorate(session) {
    return Object.assign({}, session, {
      levelText: LEVEL_TEXT[session.triageLevel] || LEVEL_TEXT.observe,
      levelTone: LEVEL_TONE[session.triageLevel] || "neutral",
      dateText: String(session.createdAt || "").slice(0, 10),
    });
  },

  choosePet(event) {
    // 切宠物时清掉上一只的体重与趋势，否则会短暂显示错的宠物的数字
    this.setData({ petIndex: Number(event.currentTarget.dataset.index), result: null, weights: [], recentWeights: [], weightTrend: null, weightNote: "", careRecords: [], documents: [], documentHint: "" });
    this.load();
  },

  inputDescription(event) {
    this.setData({ description: event.detail.value });
  },

  async submit() {
    const pet = this.data.pets[this.data.petIndex];
    if (!pet) return this.setData({ error: "先建一个宠物档案" });
    if (String(this.data.description).trim().length < 4) return this.setData({ error: "多描述一些症状，比如持续了多久" });
    this.setData({ busy: true, error: "", result: null });
    try {
      const session = await api.request("/api/health-sessions", {
        method: "POST",
        data: { petId: pet.id, description: this.data.description },
      });
      this.setData({ result: this.decorate(session), description: "", busy: false });
      this.load();
    } catch (error) {
      this.setData({ busy: false, error: error.message || "暂时不可用，请稍后再试" });
    }
  },

  goWeights() {
    const pet = this.data.pets[this.data.petIndex];
    if (pet) wx.navigateTo({ url: "/pages/pets/pets" });
  },
});
