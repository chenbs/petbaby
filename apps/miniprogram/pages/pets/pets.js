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
    pets: [], editing: null, loading: true, error: "", message: "", removeTarget: null,
    speciesLabels: SPECIES.labels, genderLabels: GENDER.labels, dateTypeLabels: DATE_TYPE.labels, stageLabels: STAGE.labels,
    editSpeciesText: "", editGenderText: "", editDateTypeText: "", editStageText: ""
  },
  onShow() { this.reload(); },
  reload() {
    api.request("/api/pets")
      .then((pets) => this.setData({
        loading: false,
        pets: pets.map((pet) => {
          // 已离开的宠物用离开日期封口，天数就此固定；陪伴中的算到今天
          const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
          return Object.assign({}, pet, {
            speciesText: labelOf(SPECIES, pet.species),
            stageText: labelOf(STAGE, pet.lifeStage),
            dateText: pet.birthday ? labelOf(DATE_TYPE, pet.dateType) + " " + pet.birthday : "",
            counts: pet.counts || { works: 0, photos: 0, memorials: 0 },
            /*
             * 方案 E 的留存钩子。已离开的宠物按拍板改过去式且不再递增
             * （见 memorials 页同一处理）：对这些用户，天数继续往上跳是冒犯。
             */
            companionDays: days,
            companionText: companion.companionText(pet, days),
            /*
             * 纪念空间入口只对 senior / memorial 出现（改造项 L4）。
             *
             * 原先它只在「我的」页固定展示、与生命阶段无关，于是纪念可达性
             * 对 senior 不成立 —— 而那正是需要它的那一段。
             * **只改可达性不加推送**：陪伴中的宠物旁边不出现这个按钮。
             */
            showMemorial: pet.lifeStage === "senior" || pet.lifeStage === "memorial",
            /*
             * 小岛入口。**memorial 不进岛**（22 号文 1.4 / 4.1 #11）：
             * 岛的核心机制是「亲密度日增、陪伴天数往上涨」，对已离开的宠物
             * 递增天数是明确的冒犯。纪念形态的对应能力是纪念空间，不是岛。
             *
             * 与 showMemorial 恰好互补但**不是取反** —— senior 两个按钮都有：
             * 晚年的宠物既能进岛，也该能到得了纪念空间。
             */
            showIsland: pet.lifeStage !== "memorial"
          });
        })
      }))
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },
  edit(event) {
    const editing = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    this.setData({ editing: Object.assign({}, editing), error: "", message: "" });
    this.syncEditLabels();
  },
  /** 成长时间线：按拍摄时间看这只宠物的全部照片 */
  timeline(event) {
    wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  /**
   * 宠物小岛。**必须带 petId** —— 不带的话点非默认宠物会看到错的那只
   * （pages/timeline 踩过同一处）。分包页面，路径以分包 root `/island/` 开头。
   */
  island(event) {
    wx.navigateTo({ url: "/island/index/index?petId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  /** 纪念空间。只在 senior / memorial 的宠物上出现（L4），不主动推送 */
  memorial(event) {
    wx.navigateTo({ url: "/pages/memorials/memorials?petId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  cancel() { this.setData({ editing: null }); },
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
    if (!pet || !pet.name.trim()) return this.setData({ error: "请填写宠物名字" });
    api.request("/api/pets/" + pet.id, { method: "PATCH", data: { name: pet.name, species: pet.species, gender: pet.gender, birthday: pet.birthday || "", dateType: pet.dateType || "birthday", lifeStage: pet.lifeStage || "active" } })
      .then(() => { this.setData({ editing: null, message: "档案已保存" }); this.reload(); })
      .catch((error) => this.setData({ error: error.message }));
  },
  avatar() {
    const pet = this.data.editing;
    if (!pet) return;
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
  setDefault(event) { api.request("/api/pets/" + event.currentTarget.dataset.id, { method: "POST" }).then(() => this.reload()); },
  askRemove(event) {
    const target = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    if (target) this.setData({ removeTarget: target });
  },
  cancelRemove() { this.setData({ removeTarget: null }); },
  confirmRemove() {
    const target = this.data.removeTarget;
    if (!target) return;
    this.setData({ removeTarget: null });
    api.request("/api/pets/" + target.id, { method: "DELETE" })
      .then(() => { wx.showToast({ title: "档案已删除", icon: "none" }); this.reload(); })
      .catch((error) => this.setData({ error: error.message }));
  },
  goCreate() { wx.switchTab({ url: "/pages/index/index" }); }
});
