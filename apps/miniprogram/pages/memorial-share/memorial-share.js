const api = require("../../services/api");
const config = require("../../config");
const params = require("../../services/params");
const { themedPage } = require("../../theme/page-mixin");

function downloadPublicPhoto(photo) {
  return new Promise((resolve) => wx.downloadFile({
    url: config.apiBaseUrl + photo.url,
    success(result) {
      resolve(Object.assign({}, photo, result.statusCode === 200
        ? { url: result.tempFilePath }
        : { url: "", imageError: "照片暂时无法读取" }));
    },
    fail() { resolve(Object.assign({}, photo, { url: "", imageError: "照片下载失败" })); }
  }));
}

// 访客页跟随访客自己的主题偏好；mood=memorial 只降低动效并关闭装饰。
themedPage({ mood: "memorial" }, {
  data: { item: null, photos: [], sections: [], loading: true, error: "" },

  onLoad(options) {
    const token = options.token;
    if (!params.isShareToken(token)) return this.setData({ loading: false, error: "分享链接缺少必要信息，请让分享者重新发送。" });
    return api.request("/api/memorial-share/" + token)
      .then((item) => {
        const sections = item.storySections || item.story_sections || [];
        this.setData({ item, sections, loading: false });
        if (item.title) wx.setNavigationBarTitle({ title: item.title });
        api.request("/api/memorial-share/" + token, {
          method: "POST",
          data: { eventName: "visit", visitorKey: "mp-" + Date.now(), source: "miniprogram" }
        }).catch(() => undefined);
        return Promise.all((item.photos || []).map(downloadPublicPhoto))
          .then((photos) => this.setData({ photos }));
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },
  onPhotoError(event) {
    const { id, src } = event.currentTarget.dataset;
    const index = this.data.photos.findIndex((item) => item.id === id && item.url === src);
    if (index >= 0) this.setData({ ["photos[" + index + "].url"]: "", ["photos[" + index + "].imageError"]: "照片暂时无法显示" });
  }
});
