const { displayMediaTree } = require("../../services/photo-files");
const payment = require("../../services/payment");
const api = require("../../services/api");
const originals = require("../../services/originals");
const { themedPage } = require("../../theme/page-mixin");

/** 面板内展示用的短日期。作品详情只关心到分钟，避免整串 ISO 文本撑破一行。 */
function formatMoment(value) {
  if (!value) return "";
  const text = String(value);
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (matched) return `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`;
  return text.slice(0, 16);
}

/** 档位显示名。与服务端 domain/pricing.ts 的 PriceTier 枚举对齐 */
const TIER_NAME = { basic: "基础", advanced: "进阶", annual: "年度" };

/**
 * 「再攒多少进下一档」。按「你可以做什么」而不是「你不足以做什么」——
 * L3 的措辞要求，与 pages/create 同一套说法。
 */
function nextTierText(pricing) {
  const next = pricing && pricing.nextTier;
  if (!next) return "";
  const price = (pricing.tierPrices || {})[next.tier];
  const target = (TIER_NAME[next.tier] || next.tier) + "版" + (price ? " ¥" + price : "");
  if (next.tier === "advanced" && next.photosNeeded) return "再攒 " + next.photosNeeded + " 张照片，下次可做" + target + "。";
  if (next.daysNeeded) return "照片跨度再满 " + next.daysNeeded + " 天，下次可做" + target + "。";
  return "";
}

// 沉浸式版式：navigationStyle 为 custom，导航栏同步无效，交给 immersive 跳过
themedPage({ immersive: true }, {
  data: { work: null, versions: [], error: "", busy: false, loading: true, confirmRevoke: false, priceText: "", priceHint: "", createdText: "", shareExpiresText: "", sheetState: "half", sheetBackgroundVideo: "", sheetBackgroundImage: "", sheetPoster: "", sheetTitle: "" },
  onLoad(query) { this.workId = query.id; if (wx.showShareMenu) wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] }); this.reload(); },
  onBackgroundError() { if (this.data.work) this.setData({ error: "作品预览暂时无法显示，请稍后重试" }); },
  reload() {
    this.setData({ loading: !this.data.work, error: "" });
    Promise.all([api.requestWithRetry("/api/works/" + this.workId, {}, 2).then(displayMediaTree), api.request("/api/works/" + this.workId + "/versions").then(displayMediaTree)])
      .then((result) => {
        const work = result[0];
        const photoUrl = work.photo && work.photo.url ? work.photo.url : "";
        const sheetBackgroundVideo = work.assetKind === "video" ? work.outputUrl || "" : "";
        const sheetBackgroundImage = work.assetKind === "video" ? "" : work.assetKind === "pdf" || work.assetKind === "h5" ? photoUrl : work.outputUrl || photoUrl;
        this.setData({
          work,
          sheetBackgroundVideo,
          sheetBackgroundImage,
          sheetPoster: photoUrl,
          sheetTitle: work.title || "",
          versions: result[1],
          loading: false,
          createdText: formatMoment(work.createdAt),
          shareExpiresText: formatMoment(work.shareExpiresAt)
        });
        if (work.locked) this.loadPricing(work);
        else this.setData({ priceText: "", priceHint: "" });
      })
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },

  /**
   * 解锁价与档位（改造项 L3）。
   *
   * 原实现读 `work.unlockPrice` —— `PublicWork` 上**没有这个字段**
   * （价格在 `work.plugin.pricing.unlockPrice`），所以按钮永远走兜底文案
   * 兜底文案，用户点进支付才知道要花多少钱。
   *
   * 而 manifest 的 unlockPrice 对分档玩法只是**基础价**，直接显示它会让
   * 一个 80 张照片的用户看到 ¥19.9 却被收 ¥49。所以价格只能来自服务端的
   * `/api/pets/{id}/pricing`，它与下单走同一个计价函数。
   */
  loadPricing(work) {
    api.request("/api/pets/" + work.petId + "/pricing?pluginId=" + encodeURIComponent(work.pluginId)).then(displayMediaTree)
      .then((pricing) => {
        if (pricing.free) return this.setData({ priceText: "保存高清原图", priceHint: "" });
        const tier = pricing.tiered && pricing.specTier ? (TIER_NAME[pricing.specTier] || "") + "版 · " : "";
        const hints = [];
        if (pricing.tiered && pricing.accumulation) hints.push("已积累 " + pricing.accumulation.photoCount + " 张照片，跨度 " + pricing.accumulation.spanDays + " 天。");
        if (pricing.isMember && pricing.memberSaving > 0) hints.push("会员价，比单买省 ¥" + pricing.memberSaving + "。");
        else hints.push(nextTierText(pricing));
        this.setData({
          priceText: "¥" + pricing.amount + " 保存" + tier + "高清原图",
          priceHint: hints.filter(Boolean).join("")
        });
      })
      // 取不到价时回落到不带金额的文案：显示一个错的价比不显示更糟。
      .catch(() => this.setData({ priceText: "保存高清原图", priceHint: "" }));
  },
  // 档位只作记录，页面行为不依赖它；组件内部已完成全部视觉联动
  handleStateChange(event) { this.setData({ sheetState: event.detail.to }); },
  unlock() {
    const work = this.data.work;
    if (!work) return;
    this.setData({ busy: true, error: "" });
    api.request("/api/orders", { method: "POST", data: { workId: work.id, sku: work.pluginId + "-single" } }).then((order) => payment.pay("work", order.id)).then(() => { this.setData({ busy: false }); this.reload(); }).catch((error) => this.setData({ error: error.message || error.errMsg, busy: false }));
  },
  saveImage() { this.saveOriginal("image"); },
  downloadVideo() { this.saveOriginal("video"); },
  /** 保存原图到相册。生成类作品首次保存会先确认标识说明（见 services/originals.js）。 */
  saveOriginal(kind) {
    const work = this.data.work;
    if (!work || this.data.busy) return;
    if (work.locked) return wx.showToast({ title: "请先保存高清原图", icon: "none" });
    this.setData({ busy: true, error: "" });
    originals.saveOriginal("/api/works/" + work.id + "/download?format=" + kind, kind)
      .then((result) => { if (result === "saved") wx.showToast({ title: kind === "video" ? "视频已保存" : "已保存" }); })
      .catch((error) => this.setData({ error: error.message }))
      .finally(() => this.setData({ busy: false }));
  },
  share() { api.request("/api/works/" + this.workId + "/share", { method: "POST", data: { expiresInHours: 168 } }).then(displayMediaTree).then(() => { this.setData({ "work.public": true }); wx.showToast({ title: "分享已开启" }); }).catch((error) => this.setData({ error: error.message })); },
  resetShare() { api.request("/api/works/" + this.workId + "/share", { method: "POST", data: { expiresInHours: 168, resetToken: true } }).then(displayMediaTree).then(() => wx.showToast({ title: "分享已重置" })); },
  askRevoke() { this.setData({ confirmRevoke: true }); },
  cancelRevoke() { this.setData({ confirmRevoke: false }); },
  revoke() {
    this.setData({ confirmRevoke: false });
    api.request("/api/works/" + this.workId + "/revoke-share", { method: "POST" }).then(displayMediaTree)
      .then(() => { this.setData({ "work.public": false }); wx.showToast({ title: "已停止分享", icon: "none" }); })
      .catch((error) => this.setData({ error: error.message }));
  },
  restore(event) { api.request("/api/works/" + this.workId + "/versions", { method: "POST", data: { versionId: event.currentTarget.dataset.id } }).then(displayMediaTree).then(() => { wx.showToast({ title: "版本已恢复" }); this.reload(); }); },
  /*
   * 分享卡指向公开落地页 pages/share（按 token 读，好友免登录可看）。
   * 还没开启分享时先开一个 7 天链接；开不出来就退回首页，不再把好友带到只有本人能打开的作品页。
   */
  onShareAppMessage() {
    const work = this.data.work;
    const title = work && work.pet ? work.pet.name + "的" + (work.plugin && work.plugin.name || "作品") + "，你家的也来试试？" : "麻麻抱我";
    const fallback = { title, path: "/pages/index/index" };
    if (!work) return fallback;
    const toShare = (token) => ({ title, path: "/pages/share/share?token=" + encodeURIComponent(token) });
    if (work.public && work.shareToken) return toShare(work.shareToken);
    return { title, path: "/pages/index/index", promise: api.request("/api/works/" + this.workId + "/share", { method: "POST", data: { expiresInHours: 168 } }).then((result) => { this.setData({ "work.public": true, "work.shareToken": result.token }); return toShare(result.token); }).catch(() => fallback) };
  },
  onShareTimeline() {
    const work = this.data.work;
    if (!work || !work.shareToken) return { title: "麻麻抱我" };
    return { title: work.title, query: "token=" + encodeURIComponent(work.shareToken) };
  }
});
