const api = require("../../services/api");
const companion = require("../../services/companion");
const records = require("../../services/records");
const { displayMediaTree } = require("../../services/photo-files");
const { themedPage } = require("../../theme/page-mixin");
const { openPetPage } = require("../../services/pet-nav");

/*
 * 日常记录（2026-10）。
 *
 * 一只宠物每天发生了什么：吃喝、便便、呕吐、不舒服、用药、就医、体重、疫苗驱虫、洗护和小事。
 * 和备忘录不一样的地方都放在这一页上：
 *   - 每条挂在「陪伴第 N 天」上，连续记录天数就在标题下面；
 *   - 顶部只给可核对的事实：「上次呕吐 3 天前」「猫三联 5 天后到期」「用药第 2 / 5 天」；
 *   - 「给兽医看」把近两周的身体状况整理成一段文字，在诊室里直接给医生看；
 *   - 健康助手会读到这里的记录，结果也能一键记回来。
 *
 * 表单字段与选项由服务端 /api/record-kinds 下发（server/daily-log-kinds.ts），端上不写第二份。
 * 已离开的宠物不出现在这里（与健康助手同口径）：再出现「记一笔」是冒犯。
 */

const GROUPS = [
  { id: "", label: "全部" },
  { id: "body", label: "身体状况" },
  { id: "food", label: "吃喝" },
  { id: "medical", label: "用药就医" },
  { id: "care", label: "疫苗驱虫" },
  { id: "weight", label: "体重" },
  { id: "life", label: "生活" }
];

const CARE_KINDS = ["vaccine", "deworm_internal", "deworm_external", "checkup"];

/** onLoad 的参数是编码过的；经 pet-nav 返回时交过来的是原文。原文里有 % 时 decode 会抛错 */
function safeDecode(value) {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch (error) { return String(value); }
}

function iconOf(kind) {
  if (CARE_KINDS.indexOf(kind) >= 0) return "care";
  return kind;
}

themedPage({
  data: {
    loading: true, error: "", pets: [], petIndex: 0, pet: null, sealed: false,
    kinds: [], overview: null, headline: "", groups: GROUPS, group: "",
    days: [], nextCursor: "", loadingMore: false, empty: false,
    form: null, formBusy: false, formError: "",
    afterSave: null, urgent: null,
    summary: null, summaryBusy: false,
    removeTarget: null
  },

  onLoad(options) {
    this._query = options || {};
    this._petId = this._query.petId || "";
    if (this._query.group) this.setData({ group: this._query.group });
  },

  onShow() { this.reload(); },
  onHide() { this._view = (this._view || 0) + 1; },

  async reload() {
    const view = this._view = (this._view || 0) + 1;
    this.setData({ loading: true, error: "" });
    try {
      const [pets, kinds] = await Promise.all([api.request("/api/pets").then(displayMediaTree), records.loadKinds()]);
      if (view !== this._view) return;
      const requested = this._petId ? (pets || []).find((item) => item.id === this._petId) : null;
      if (this._petId && !requested) throw new Error("这只宠物的档案不可用，请重新选择");
      if (requested && requested.lifeStage === "memorial") {
        return this.setData({ loading: false, sealed: true, pet: requested, pets: [], kinds });
      }
      const active = (pets || []).filter((item) => item.lifeStage !== "memorial");
      const pet = requested || active.find((item) => item.isDefault) || active[0] || null;
      this.setData({ pets: active, petIndex: Math.max(0, active.indexOf(pet)), pet, kinds, sealed: false });
      if (!pet) return this.setData({ loading: false, empty: true, days: [] });
      this._petId = pet.id;
      await Promise.all([this.loadOverview(view), this.loadList(false, view)]);
      if (view !== this._view) return;
      this.setData({ loading: false });
      this.consumeQuery();
    } catch (error) {
      if (view === this._view) this.setData({ loading: false, error: error.message || "加载失败" });
    }
  },

  /** 从健康助手或首页带参进来：直接打开对应表单或就医摘要。只消费一次，返回本页时不再弹 */
  consumeQuery() {
    const query = this._query || {};
    this._query = {};
    if (query.action === "summary") return this.openSummary();
    if (query.kind) this.openForm({ currentTarget: { dataset: { kind: query.kind } } }, { note: safeDecode(query.note), healthSessionId: query.sessionId || "" });
  },

  async loadOverview(view) {
    const pet = this.data.pet;
    if (!pet) return;
    try {
      const overview = await api.request("/api/pets/" + pet.id + "/records/overview");
      if (view !== this._view) return;
      this.setData({ overview, headline: this.headlineOf(pet, overview) });
    } catch (error) { /* 概览是辅助区块，失败不挡住记录本身 */ }
  },

  headlineOf(pet, overview) {
    if (!overview || !overview.totalDays) return "从今天开始，替" + pet.name + "记下每天的小事";
    const parts = ["已记录 " + overview.totalDays + " 天"];
    if (overview.streakDays > 1) parts.push("连续 " + overview.streakDays + " 天");
    return parts.join(" · ");
  },

  async loadList(append, view) {
    const pet = this.data.pet;
    if (!pet || (append && (this.data.loadingMore || !this.data.nextCursor))) return;
    view = view || this._view;
    this.setData({ loadingMore: Boolean(append) });
    const query = "?pageSize=40" + (this.data.group ? "&group=" + this.data.group : "") + (append ? "&cursor=" + this.data.nextCursor : "");
    try {
      const page = await api.request("/api/pets/" + pet.id + "/records" + query).then(displayMediaTree);
      if (view !== this._view || pet.id !== (this.data.pet && this.data.pet.id)) return;
      this._items = (append ? this._items || [] : []).concat(page.items || []);
      this.setData({ days: this.groupByDay(pet, this._items), nextCursor: page.nextCursor || "", loadingMore: false, empty: !this._items.length });
    } catch (error) {
      if (view === this._view) this.setData({ loadingMore: false, error: error.message || "加载失败" });
    }
  },

  /** 按天分组，每天一个抬头：日期 + 陪伴第 N 天（与时间线同一套算法，services/companion） */
  groupByDay(pet, items) {
    const anchor = companion.anchorOf(pet);
    const today = records.today();
    const days = [];
    items.forEach((item) => {
      let day = days[days.length - 1];
      if (!day || day.date !== item.occurredOn) {
        const index = companion.daysSince(anchor, item.occurredOn);
        day = { date: item.occurredOn, label: item.occurredOn === today ? "今天" : item.occurredOn.slice(5).replace("-", " 月 ") + " 日", dayText: index ? "陪伴第 " + index + " 天" : "", items: [] };
        days.push(day);
      }
      day.items.push(Object.assign({}, item, { key: item.source + ":" + item.id, icon: iconOf(item.kind) }));
    });
    return days;
  },

  more() { return this.loadList(true); },

  choosePet(event) {
    const pet = this.data.pets[Number(event.currentTarget.dataset.index)];
    if (!pet || pet.id === this._petId) return;
    this._petId = pet.id;
    this._items = [];
    this.setData({ pet, petIndex: Number(event.currentTarget.dataset.index), overview: null, days: [], nextCursor: "", afterSave: null, urgent: null });
    this.reload();
  },

  chooseGroup(event) {
    const group = event.currentTarget.dataset.id || "";
    if (group === this.data.group) return;
    this._items = [];
    this.setData({ group, days: [], nextCursor: "" });
    this.loadList(false);
  },

  /* ---------- 记一笔 ---------- */

  openForm(event, preset) {
    const kind = event.currentTarget.dataset.kind;
    const spec = this.data.kinds.find((item) => item.kind === kind);
    if (!spec || !this.data.pet) return;
    const extra = preset || {};
    const values = Object.assign(records.emptyValues(spec), extra.values || {});
    this.setData({
      form: {
        kind, spec, values, title: "记一笔 · " + spec.label,
        occurredOn: records.today(), occurredTime: kind === "weight" || kind === "care" ? "" : records.nowTime(),
        withTime: kind !== "weight" && kind !== "care",
        note: extra.note || "", attachments: [], healthSessionId: extra.healthSessionId || ""
      },
      formError: "", afterSave: null, urgent: null
    });
  },

  closeForm() { if (!this.data.formBusy) this.setData({ form: null }); },
  chooseDate(event) { this.setData({ "form.occurredOn": event.detail.value }); },
  chooseTime(event) { this.setData({ "form.occurredTime": event.detail.value }); },
  clearTime() { this.setData({ "form.occurredTime": "" }); },
  inputNote(event) { this.setData({ "form.note": event.detail.value }); },

  setValue(key, value) {
    const values = Object.assign({}, this.data.form.values, { [key]: value });
    this.setData({ "form.values": values, formError: "" });
  },

  /** 单选再点一次是取消（选错了能退回「不填」） */
  pickChoice(event) {
    const { key, value, multiple } = event.currentTarget.dataset;
    const current = this.data.form.values[key];
    if (multiple) {
      const list = Array.isArray(current) ? current.slice() : [];
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1); else list.push(value);
      return this.setValue(key, list);
    }
    this.setValue(key, current === value ? "" : value);
  },

  toggleField(event) {
    const key = event.currentTarget.dataset.key;
    this.setValue(key, !this.data.form.values[key]);
  },

  stepCount(event) {
    const { key, step } = event.currentTarget.dataset;
    const field = this.data.form.spec.fields.find((item) => item.key === key);
    const next = Math.min(field.max, Math.max(field.min, Number(this.data.form.values[key] || field.defaultValue) + Number(step)));
    this.setValue(key, next);
  },

  inputField(event) { this.setValue(event.currentTarget.dataset.key, event.detail.value); },
  chooseFieldDate(event) { this.setValue(event.currentTarget.dataset.key, event.detail.value); },

  async addAttachment() {
    const form = this.data.form;
    if (!form || form.attachments.length >= 3 || this.data.formBusy) return;
    this.setData({ formBusy: true, formError: "" });
    try {
      const attachment = await records.pickAndUploadAttachment(this.data.pet.id);
      if (attachment && this.data.form) this.setData({ "form.attachments": this.data.form.attachments.concat([attachment]) });
    } catch (error) {
      this.setData({ formError: error.message || "照片没有传上去，请重试" });
    } finally { this.setData({ formBusy: false }); }
  },

  removeAttachment(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ "form.attachments": this.data.form.attachments.filter((item) => item.id !== id) });
  },

  async saveForm() {
    const form = this.data.form;
    const pet = this.data.pet;
    if (!form || !pet || this.data.formBusy) return;
    this.setData({ formBusy: true, formError: "" });
    try {
      const result = await api.request("/api/pets/" + pet.id + "/records", {
        method: "POST",
        data: {
          kind: form.kind, occurredOn: form.occurredOn, occurredTime: form.occurredTime || "",
          details: records.toDetails(form.spec, form.values), note: String(form.note || "").trim(),
          attachmentIds: form.attachments.map((item) => item.id),
          healthSessionId: form.healthSessionId || undefined
        }
      });
      const urgent = result && result.urgentAreas && result.urgentAreas.length ? { areas: result.urgentAreas.join("、") } : null;
      this.setData({
        form: null, formBusy: false, urgent,
        // 身体状况类记完后，顺手提示可以让健康助手结合记录看看；从健康助手记回来的不再提示
        afterSave: !urgent && form.spec.bodily && !form.healthSessionId ? { text: "记好了。想知道要不要去医院，健康助手会结合最近的记录一起看。" } : null
      });
      if (wx.showToast) wx.showToast({ title: "记好了", icon: "success" });
      this._items = [];
      const view = this._view;
      await Promise.all([this.loadOverview(view), this.loadList(false, view)]);
    } catch (error) {
      this.setData({ formBusy: false, formError: error.message || "保存失败，请重试" });
    }
  },

  /** 疗程中的药：一键记今天这次，药名和用量沿用起始那条 */
  logCourseDose(event) {
    const course = (this.data.overview && this.data.overview.courses || []).find((item) => item.logId === event.currentTarget.dataset.id);
    if (!course) return;
    this.openForm({ currentTarget: { dataset: { kind: "medication" } } }, { values: { name: course.name, dose: course.dose || "" } });
  },

  /* ---------- 删除 ---------- */

  askRemove(event) {
    const { id, source, title } = event.currentTarget.dataset;
    this.setData({ removeTarget: { id, source, title } });
  },
  cancelRemove() { this.setData({ removeTarget: null }); },
  async confirmRemove() {
    const target = this.data.removeTarget;
    const pet = this.data.pet;
    if (!target || !pet) return;
    this.setData({ removeTarget: null });
    try {
      await api.request("/api/pets/" + pet.id + "/records/" + target.id + "?source=" + target.source, { method: "DELETE" });
      this._items = (this._items || []).filter((item) => !(item.id === target.id && item.source === target.source));
      this.setData({ days: this.groupByDay(pet, this._items), empty: !this._items.length });
      this.loadOverview(this._view);
    } catch (error) { this.setData({ error: error.message || "删除失败" }); }
  },

  previewAttachment(event) {
    const { url, urls } = event.currentTarget.dataset;
    if (url) wx.previewImage({ current: url, urls: (urls || []).map((item) => item.url).filter(Boolean) });
  },

  /* ---------- 给兽医看 ---------- */

  async openSummary() {
    const pet = this.data.pet;
    if (!pet || this.data.summaryBusy) return;
    this.setData({ summaryBusy: true });
    try {
      const summary = await api.request("/api/pets/" + pet.id + "/records/visit-summary?days=14");
      this.setData({ summary: Object.assign({}, summary, { countsText: (summary.counts || []).join("，") }), summaryBusy: false });
    } catch (error) { this.setData({ summaryBusy: false, error: error.message || "整理失败，请重试" }); }
  },
  closeSummary() { this.setData({ summary: null }); },
  copySummary() {
    if (!this.data.summary) return;
    wx.setClipboardData({ data: this.data.summary.text });
  },

  /* ---------- 跳转 ---------- */

  openHealth() {
    if (this.data.pet) openPetPage("/pages/health/health", this.data.pet.id);
  },
  openPets() { wx.navigateTo({ url: "/pages/pets/pets?mode=create" }); },
  dismissTip() { this.setData({ afterSave: null, urgent: null }); }
});
