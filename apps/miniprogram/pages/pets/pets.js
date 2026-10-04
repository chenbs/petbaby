const { displayMediaTree } = require("../../services/photo-files");
const api = require("../../services/api");
const config = require("../../config");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");

const SPECIES = { values: ["cat", "dog", "other"], labels: ["猫咪", "狗狗", "其他"] };
const GENDER = { values: ["unknown", "female", "male"], labels: ["未填写", "女孩子", "男孩子"] };
const DATE_TYPE = { values: ["birthday", "got_home"], labels: ["生日", "到家日"] };
/*
 * 三态而非两态（改造方案 C3）。`senior`（晚年）是新增的中间态：
 * 原先从「陪伴中」直接跳到「已离开」，中间那段最需要陪伴的时间产品是缺席的，
 * 而纪念线的可达性与画册/短片的调性切换都靠它判断。
 *
 * **只能用户手动选，不按年龄推断** —— 品种间寿命差异极大。
 */
const STAGE = { values: ["active", "senior", "memorial"], labels: ["陪伴中", "晚年", "已离开"] };

function labelOf(map, value) {
  const index = map.values.indexOf(value);
  return index >= 0 ? map.labels[index] : map.labels[0];
}

themedPage({
  data: {
    pets: [], editing: null, loading: true, saving: false, error: "", message: "", removeTarget: null,
    speciesLabels: SPECIES.labels, genderLabels: GENDER.labels, dateTypeLabels: DATE_TYPE.labels, stageLabels: STAGE.labels,
    editSpeciesText: "", editGenderText: "", editDateTypeText: "", editStageText: ""
  },
  onLoad(query) { this._returnToRecord = query.returnToRecord === "1"; if (query.mode === "create") this.newPet(); },
  onShow() { this.reload(); },
  newPet() {
    this.setData({ editing: { name: "", species: "cat", gender: "unknown", birthday: "", dateType: "birthday", lifeStage: "active" }, error: "", message: "" });
    this.syncEditLabels();
  },
  record(event) { wx.navigateTo({ url: "/pages/photos/photos?mode=record&entry=pets&petId=" + encodeURIComponent(event.currentTarget.dataset.id) }); },
  reload() {
    const view = this._petView = (this._petView || 0) + 1;
    return api.request("/api/pets").then(displayMediaTree)
      .then((pets) => {
        if (view !== this._petView) return;
        const items = pets.map((pet) => {
          const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
          return Object.assign({}, pet, {
            speciesText: labelOf(SPECIES, pet.species),
            stageText: labelOf(STAGE, pet.lifeStage),
            dateText: pet.birthday ? labelOf(DATE_TYPE, pet.dateType) + " " + pet.birthday : "",
            counts: pet.counts || { works: 0, photos: 0, memorials: 0 },
            imageUrl: pet.avatarUrl || "",
            coverUrl: "",
            companionDays: days,
            companionText: companion.companionText(pet, days),
            showMemorial: pet.lifeStage === "senior" || pet.lifeStage === "memorial"
          });
        });
        this.setData({ loading: false, pets: items });
        items.filter((pet) => pet.counts.photos > 0).forEach((pet) => {
          api.request("/api/photos?petId=" + encodeURIComponent(pet.id) + "&pageSize=1&order=uploaded")
            .then(displayMediaTree)
            .then((page) => {
              if (view !== this._petView) return;
              const index = this.data.pets.findIndex((item) => item.id === pet.id);
              const first = (page.items || []).find((item) => item.url);
              if (index < 0 || !first) return;
              const current = this.data.pets[index];
              this.setData({ ["pets[" + index + "].coverUrl"]: first.url, ["pets[" + index + "].imageUrl"]: current.imageUrl || first.url });
            })
            .catch(() => undefined);
        });
      })
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },
  edit(event) {
    const editing = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    this.setData({ editing: Object.assign({}, editing), error: "", message: "" });
    this.syncEditLabels();
  },
  onAvatarError(event) {
    const { kind, id, src } = event.currentTarget.dataset;
    if (kind === "editing" && this.data.editing && this.data.editing.avatarUrl === src) this.setData({ "editing.avatarUrl": "" });
    if (kind === "list") {
      const index = this.data.pets.findIndex((pet) => pet.id === id && pet.imageUrl === src);
      if (index >= 0) this.setData({ ["pets[" + index + "].imageUrl"]: this.data.pets[index].coverUrl && this.data.pets[index].coverUrl !== src ? this.data.pets[index].coverUrl : "" });
    }
  },
  /** 成长时间线：按拍摄时间看这只宠物的全部照片 */
  timeline(event) {
    wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
    /** 纪念空间。只在 senior / memorial 的宠物上出现（L4），不主动推送 */
  memorial(event) {
    wx.navigateTo({ url: "/pages/memorials/memorials?petId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  cancel() { if (!this.data.saving) this.setData({ editing: null }); },
  /** 编辑抽屉里的枚举值同步成中文 */
  syncEditLabels() {
    const editing = this.data.editing || {};
    this.setData({
      editSpeciesText: labelOf(SPECIES, editing.species),
      editGenderText: labelOf(GENDER, editing.gender),
      editDateTypeText: labelOf(DATE_TYPE, editing.dateType),
      editStageText: labelOf(STAGE, editing.lifeStage)
    });
  },
  inputName(event) { this.setData({ "editing.name": event.detail.value }); },
  /*
   * 四个枚举改用 chip 后，下标来自 `dataset.index` 而不是 picker 的
   * `detail.value` —— 忘记改这里的话点击不报错、只是选中项永远是第一个。
   */
  chooseSpecies(event) { this.setData({ "editing.species": SPECIES.values[Number(event.currentTarget.dataset.index)] }); this.syncEditLabels(); },
  chooseGender(event) { this.setData({ "editing.gender": GENDER.values[Number(event.currentTarget.dataset.index)] }); this.syncEditLabels(); },
  chooseDateType(event) { this.setData({ "editing.dateType": DATE_TYPE.values[Number(event.currentTarget.dataset.index)] }); this.syncEditLabels(); },
  chooseDate(event) { this.setData({ "editing.birthday": event.detail.value }); },
  chooseStage(event) { this.setData({ "editing.lifeStage": STAGE.values[Number(event.currentTarget.dataset.index)] }); this.syncEditLabels(); },
  save() {
    const pet = this.data.editing;
    if (this.data.saving) return;
    if (!pet || !pet.name.trim()) return this.setData({ error: "请填写宠物名字" });
    this.setData({ saving: true, error: "" });
    return api.request(pet.id ? "/api/pets/" + pet.id : "/api/pets", { method: pet.id ? "PATCH" : "POST", data: { name: pet.name, species: pet.species, gender: pet.gender, birthday: pet.birthday || "", dateType: pet.dateType || "birthday", lifeStage: pet.lifeStage || "active" } }).then(displayMediaTree)
      .then((saved) => {
        this.setData({ editing: null, saving: false, message: "档案已保存" });
        if (!pet.id && this._returnToRecord) {
          this.getOpenerEventChannel().emit("petCreated", { petId: saved.id });
          wx.navigateBack();
        } else this.reload();
      })
      .catch((error) => {
        this.setData({ saving: false, error: error.message });
        if (!pet.id && (!error.statusCode || error.statusCode >= 500)) {
          this.setData({ editing: null, error: "保存结果待确认，请先查看档案列表；若已出现，请使用已有档案，不要重复新建。" });
          this.reload();
        }
      });
  },
  avatar() {
    const pet = this.data.editing;
    if (!pet || !pet.id) return;
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["album", "camera"], success: (result) => {
      wx.uploadFile({
        url: config.apiBaseUrl + "/api/pets/" + pet.id + "/avatar",
        filePath: result.tempFiles[0].tempFilePath,
        name: "file",
        header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + wx.getStorageSync("petbaby_session") },
        success: (response) => {
          const body = JSON.parse(response.data);
          if (response.statusCode < 300) { this.setData({ editing: body.data, message: "头像已更新" }); this.syncEditLabels(); this.reload(); }
          else this.setData({ error: body.error.message });
        }
      });
    } });
  },
  /** 「…」菜单：纪念空间只对 senior / memorial 出现（与原规则一致），删除标为危险项。 */
  openMore(event) {
    const id = event.currentTarget.dataset.id;
    const pet = (this.data.pets || []).find((item) => item.id === id);
    if (!pet) return;
    const actions = [];
    if (!pet.isDefault) actions.push({ key: "default", label: "设为默认" });
    if (pet.showMemorial) actions.push({ key: "memorial", label: "纪念空间", description: "把一起的日子安静地收好" });
    actions.push({ key: "remove", label: "删除档案", danger: true });
    this._moreId = id;
    this.setData({ moreVisible: true, morePetName: pet.name, moreActions: actions });
  },
  closeMore() { this.setData({ moreVisible: false }); },
  chooseMore(event) {
    const key = event.detail.key;
    const target = { currentTarget: { dataset: { id: this._moreId } } };
    this.setData({ moreVisible: false });
    if (key === "default") this.setDefault(target);
    if (key === "memorial") this.memorial(target);
    if (key === "remove") this.askRemove(target);
  },
  setDefault(event) { api.request("/api/pets/" + event.currentTarget.dataset.id, { method: "POST" }).then(displayMediaTree).then(() => this.reload()); },
  askRemove(event) {
    const target = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    if (target) this.setData({ removeTarget: target });
  },
  cancelRemove() { this.setData({ removeTarget: null }); },
  confirmRemove() {
    const target = this.data.removeTarget;
    if (!target) return;
    this.setData({ removeTarget: null });
    api.request("/api/pets/" + target.id, { method: "DELETE" }).then(displayMediaTree)
      .then(() => { wx.showToast({ title: "档案已删除", icon: "none" }); this.reload(); })
      .catch((error) => this.setData({ error: error.message }));
  },
  goCreate() { this.newPet(); }
});
