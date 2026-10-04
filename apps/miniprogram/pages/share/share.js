const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");

/*
 * 公开分享落地页（2026-09 新增）。
 *
 * 原来作品分享卡指向 /pages/work/work?id=，那一页按所有者校验，好友打开只会看到错误。
 * 这里改为按分享 token 读取公开接口：免登录、只读、字段已由服务端白名单裁剪。
 * 页面底部是「给我家的也做一个」，直接带到同款玩法。
 */
function absolute(url) {
  if (!url) return "";
  return url.indexOf("/") === 0 ? config.apiBaseUrl + url : url;
}

themedPage({
  data: { loading: true, error: "", work: null, imageUrl: "" },
  onLoad(query) {
    this.token = query.token || "";
    this.code = query.code || "";
    if (!this.token) return this.setData({ loading: false, error: "分享链接不完整，请让好友重新分享一次" });
    this.load();
  },
  load() {
    this.setData({ loading: true, error: "" });
    const suffix = this.code ? "?code=" + encodeURIComponent(this.code) : "";
    api.request("/api/share/" + encodeURIComponent(this.token) + suffix)
      .then((work) => {
        this.setData({ work, imageUrl: absolute(work.outputUrl || work.coverUrl), loading: false });
        wx.setNavigationBarTitle({ title: work.pet && work.pet.name ? work.pet.name + "的作品" : "好友的作品" });
        this.track("visit");
      })
      .catch((error) => this.setData({ loading: false, error: error.statusCode === 401 ? "这份作品设置了访问码，请向好友索取" : error.message || "分享已关闭或不存在" }));
  },
  /** 分享来源统计：访客标识只存在本机，用来去重，不关联任何账号信息。 */
  track(eventName) {
    let visitorKey = wx.getStorageSync("petbaby_share_visitor");
    if (!visitorKey) { visitorKey = "mp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); wx.setStorageSync("petbaby_share_visitor", visitorKey); }
    api.request("/api/share/" + encodeURIComponent(this.token) + "/events", { method: "POST", data: { eventName, source: "miniprogram", visitorKey, accessCode: this.code || undefined } }).catch(() => undefined);
  },
  onImageError() { this.setData({ imageUrl: "" }); },
  preview() { if (this.data.imageUrl) wx.previewImage({ urls: [this.data.imageUrl], showmenu: false }); },
  makeSame() {
    const work = this.data.work;
    if (work) api.request("/api/share/" + encodeURIComponent(this.token) + "/cta?format=json&source=miniprogram" + (this.code ? "&code=" + encodeURIComponent(this.code) : "")).catch(() => undefined);
    if (!work) return wx.switchTab({ url: "/pages/index/index" });
    if (work.pluginId === "pl-10") return wx.switchTab({ url: "/pages/index/index" });
    if (work.pluginCategory === "video") return wx.navigateTo({ url: "/pages/video-create/video-create" });
    wx.navigateTo({ url: "/pages/create/create?pluginId=" + encodeURIComponent(work.pluginId) });
  },
  onShareAppMessage() {
    const work = this.data.work;
    return {
      title: work && work.pet ? work.pet.name + "的" + work.pluginName + "，你家的也来试试？" : "麻麻抱我",
      path: "/pages/share/share?token=" + encodeURIComponent(this.token),
      imageUrl: this.data.imageUrl || undefined
    };
  },
  onShareTimeline() {
    const work = this.data.work;
    return { title: work && work.pet ? work.pet.name + "的" + work.pluginName : "麻麻抱我", query: "token=" + encodeURIComponent(this.token) };
  }
});
