const api = require("../../services/api");
const acquisition = require("../../services/acquisition");
const { themedPage } = require("../../theme/page-mixin");

/*
 * 邀请好友（2026-10-12）。
 *
 * 好友从你分享的卡片进来、新建账号并建好宠物档案后，你得赠送冻干。
 * 颗数、每日上限、有效期全部来自 /api/invites，端上不写死。
 * 分享卡片直接带上邀请码（inv 参数）；其他页面的分享卡片也会带，这一页只是把规则讲清楚、给一个显眼的入口。
 */
themedPage({
  data: { loading: true, error: "", invite: null, rule: "", progress: "" },
  onShow() { this.load(); },
  load() {
    this.setData({ loading: !this.data.invite, error: "" });
    return api.request("/api/invites")
      .then((invite) => {
        acquisition.rememberInviteCode(invite.code);
        this.setData({
          loading: false,
          invite,
          rule: "好友建好宠物档案，你得 " + invite.unitsPerInvite + " 颗冻干，" + invite.rewardDays + " 天内有效；每天最多 " + invite.dailyCap + " 颗。",
          progress: invite.joined ? "已有 " + invite.joined + " 位好友加入，其中 " + invite.qualified + " 位建好了档案" : "还没有好友通过你的邀请加入"
        });
      })
      .catch((error) => this.setData({ loading: false, error: error.message || "邀请信息加载失败" }));
  },
  onShareAppMessage() {
    return { title: "给你家的毛孩子也拍一组照片吧", path: acquisition.withInvite("/pages/index/index") };
  },
  onShareTimeline() {
    return { title: "麻麻抱我 · 宠物照片创作与陪伴记录", query: acquisition.withInviteQuery("") };
  }
});
