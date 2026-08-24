const { themedPage } = require("../../theme/page-mixin");
const companion = require("../../services/companion");
const service = require("../service");

/**
 * 岛日记。每天一条短句，可翻阅。
 *
 * **模板拼装，不用大模型**（22 号文 4.2）：日记是每天必现的内容，用模型的话每天都有
 * 一次说错话的机会（尤其踩 4.1 #9 健康状态 / #12 诊疗措辞），而模板可被门禁全量扫描。
 * 所以这一页只负责展示服务端拼好的文案，**端上不拼、不改、不补**。
 *
 * 里程碑取 100/365/1000、不含第 1 天，与 `domain/companion.ts` 同一套口径（4.2）。
 * 那也是服务端算的 —— 端上重算会与时间线里的标签走散。
 */

/** 条目类型的中文标签。kind 与 `island_events.kind` 一致 */
const KIND_LABEL = { diary: "今天", milestone: "里程碑", offline: "这几天", on_this_day: "去年今日" };

themedPage({
  data: {
    loading: true,
    error: "",
    entries: [],
    cursor: "",
    /** 没有更多了。翻到底不给「加载失败」那类错觉 */
    exhausted: false,
    loadingMore: false,
    /**
     * 已达成的里程碑（100/365/1000，不含第 1 天）。
     *
     * **只列已达成的**（4.2）：未达成的读作「还差 20 天」，是 4.1 #7 禁掉的催促。
     * 放日记页而不是首屏 HUD：里程碑是回看的东西，而 HUD 要极简（2.3 只给一行）。
     */
    milestones: []
  },

  onLoad() { this.reload(); },

  /**
   * 下拉刷新。**`diary.json` 必须同时有 `enablePullDownRefresh: true`** ——
   * 少了那一行这个回调永远不触发，而页面看不出任何异常（早先就是这样）。
   */
  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  /** 触底翻页。日记会一天天累积，不能一次全拉 */
  onReachBottom() { this.loadMore(); },

  reload() {
    this.setData({ loading: true, error: "", cursor: "", exhausted: false });
    this.loadMilestones();
    return service.loadDiary("")
      .then((result) => this.setData({
        loading: false,
        entries: this.decorate(result.entries || result.items || []),
        cursor: result.cursor || "",
        exhausted: !result.cursor
      }))
      .catch((error) => this.setData({ loading: false, error: error.message || "日记加载失败" }));
  },

  /**
   * 里程碑走岛快照，不另开接口。
   *
   * **失败时静默**：里程碑是这一页的补充区块，而日记是主体 —— 取不到就不显示那块，
   * 不该让它的错误盖掉已经加载出来的日记（两个请求各自成败，与首屏素材逐张独立同一判断）。
   *
   * 不传 petId：日记页从岛内进来，岛上只有那一只宠物，服务端按岛取。
   */
  loadMilestones() {
    return service.loadIsland("")
      .then((snapshot) => this.setData({
        milestones: service.reachedMilestones(snapshot, companion.milestoneLabel)
      }))
      .catch(() => undefined);
  },

  loadMore() {
    if (this.data.loadingMore || this.data.exhausted || !this.data.cursor) return;
    this.setData({ loadingMore: true });
    service.loadDiary(this.data.cursor)
      .then((result) => {
        const more = this.decorate(result.entries || result.items || []);
        this.setData({
          loadingMore: false,
          entries: this.data.entries.concat(more),
          cursor: result.cursor || "",
          exhausted: !result.cursor
        });
      })
      .catch((error) => this.setData({ loadingMore: false, error: error.message }));
  },

  /**
   * 只加展示用的标签，**不动文案本身**。
   *
   * 文案由服务端按模板拼好（4.2），端上再加工等于绕过门禁 11–15 的全量扫描 ——
   * 那套扫描的前提正是「模板可穷举」。
   */
  decorate(entries) {
    return (entries || []).map((entry) => Object.assign({}, entry, {
      kindLabel: KIND_LABEL[entry.kind] || "",
      /*
       * 日期只取到日。服务端下发的字段是 `date`，已由 `asDateKey` 归一成
       * `YYYY-MM-DD`；端上不再解析成 Date —— 日历日无时区，转来转去会在东八区
       * 退回前一天（健康线踩过一次，CLAUDE.md 已记录）。
       */
      dateText: String(entry.date || "").slice(0, 10)
    }));
  },

  goIsland() { wx.navigateBack(); }
});
