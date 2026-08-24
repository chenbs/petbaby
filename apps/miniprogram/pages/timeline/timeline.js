const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");
const { daysSince, anchorOf, companionText } = require("../../services/companion");

/**
 * 成长时间线。
 *
 * 「第几天」由服务端算好下发（`/api/pets/[id]/timeline`），端上不重算 ——
 * 服务端的口径来自 `src/domain/companion.ts`，与本页顶部的陪伴天数
 * 同一套规则。两边各算一次就会出现「顶部写第 743 天、列表里那张写第 742 天」。
 *
 * 起算日语义要说清：有生日说「出生后第 N 天」，只有到家日说「到家后」，
 * 两者都没有就只能从建档日算，那时不该假装知道更早的事。
 */

const ANCHOR_LABEL = { birthday: "出生", got_home: "到家", created: "建档" };

/**
 * 叙事年度视频的时长档（改造项 E5）。
 *
 * 三档口径的单一事实来源在服务端 `domain/video-duration.ts`，这里是端上副本 ——
 * 小程序拿不到那个模块。服务端 `normalizeDuration` 会把非法值归一，
 * 所以端上多一档少一档不会出错，只会让用户选不到。
 */
const FILM_DURATIONS = [10, 20, 30];

/** 可选年份：今年与去年。更早的年份用户大概不会在这个入口找 */
function filmYearOptions() {
  const year = new Date().getFullYear();
  return [year, year - 1];
}

themedPage({
  data: {
    pets: [], petId: "", petText: "",
    anchorLabel: "", companion: "", totalDays: 0,
    groups: [], milestones: [],
    loading: true, error: "", empty: false,
    // E5：叙事年度视频入口
    filmYears: filmYearOptions(),
    filmYear: filmYearOptions()[0],
    filmDurations: FILM_DURATIONS,
    filmDuration: FILM_DURATIONS[1],
    filmBusy: false,
    filmHint: ""
  },
  onLoad(options) {
    // 从 pets 页带 petId 进来时看的就是那只，别回落到默认宠物。
    const wanted = options && options.petId;
    api.request("/api/pets").then((pets) => {
      const pet = (wanted && pets.find((item) => item.id === wanted))
        || pets.find((item) => item.isDefault)
        || pets[0];
      this.setData({ pets, petId: pet ? pet.id : "", petText: pet ? pet.name : "", loading: Boolean(pet) });
      if (pet) this.load(pet);
      else this.setData({ loading: false, empty: true });
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petText: pet.name, loading: true, groups: [] });
    this.load(pet);
  },
  /**
   * 按年份分组。一条平铺的长列表读不出「哪一年」，
   * 而时间线的意义正是让人看见跨度。
   */
  load(pet) {
    api.request("/api/pets/" + encodeURIComponent(pet.id) + "/timeline")
      .then((timeline) => {
        const groups = [];
        for (const entry of timeline.entries || []) {
          const year = String(entry.date || "").slice(0, 4) || "更早";
          // wx:key 需要标量，照片 id 是这里唯一稳定的标识
          const item = Object.assign({}, entry, { key: entry.photo && entry.photo.id });
          const last = groups[groups.length - 1];
          if (last && last.year === year) last.items.push(item);
          else groups.push({ year, items: [item] });
        }
        const days = daysSince(anchorOf(pet), pet.memorialSince);
        this.setData({
          groups,
          milestones: timeline.milestones || [],
          totalDays: timeline.totalDays || 0,
          anchorLabel: ANCHOR_LABEL[timeline.anchorType] || "建档",
          companion: companionText(pet, days),
          loading: false,
          empty: !(timeline.entries || []).length,
          error: ""
        });
      })
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },
  /*
   * chip 的下标来自 dataset 而不是 picker 的 detail.value ——
   * 从 picker 改过来时忘了这一处不会报错，只是选中项永远是第一个
   * （见 CLAUDE.md 的 UI 重构约定）。这里直接取值而非下标。
   */
  chooseFilmYear(event) { this.setData({ filmYear: Number(event.currentTarget.dataset.year), filmHint: "" }); },
  chooseFilmDuration(event) { this.setData({ filmDuration: Number(event.currentTarget.dataset.duration), filmHint: "" }); },

  /**
   * 入队一条叙事年度视频（E5）。
   *
   * 只负责入队，不在这里轮询渲染进度：叙事视频是四段 filtergraph，
   * 而 `processNextVideo` 的队列并发是 1 —— 渲染可能要几十秒到几分钟，
   * 让用户停在这一页等是错的。入队成功后引导去作品库看。
   *
   * 服务端限频是每分钟 3 条（足够试三个时长档），撞上了会返回 429，
   * 错误文案直接透出，不自己编。
   */
  createFilm() {
    if (this.data.filmBusy) return;
    this.setData({ filmBusy: true, filmHint: "", error: "" });
    api.request("/api/annual-films", { method: "POST", data: { year: this.data.filmYear, durationSeconds: this.data.filmDuration } })
      .then((film) => {
        this.setData({
          filmBusy: false,
          filmHint: "已开始渲染" + (film && film.shots ? "，用了 " + film.shots + " 张照片" : "") + "。完成后会出现在作品库里。"
        });
      })
      .catch((error) => this.setData({ filmBusy: false, filmHint: error.message || "生成失败，请稍后再试" }));
  },

  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos" }); }
});
