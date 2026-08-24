const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

// 访客页固定默认主题 cute 的克制变体：不读访客本地主题偏好，保证分享观感一致（需求 9.4）；
// mood=memorial 同时把动效降为 fade、关闭装饰（需求 9.5）。
themedPage({ mood: "memorial", fixedTheme: "cute" }, {
  data: { item: null, photos: [], loading: true, error: "" },

  onLoad(options) {
    const token = options.token;
    api.request("/api/memorial-share/" + token)
      .then((item) => {
        this.setData({ item, photos: item.photos || [], loading: false });
        if (item.title) wx.setNavigationBarTitle({ title: item.title });
        api.request("/api/memorial-share/" + token, {
          method: "POST",
          data: { eventName: "visit", visitorKey: "mp-" + Date.now(), source: "miniprogram" }
        }).catch(() => undefined);
      })
      .catch((error) => this.setData({ loading: false, error: error.message }));
  }
});
