/**
 * t-navbar：自定义导航栏。用于需要沉浸式头图或标题跟随主题的页面。
 * 高度 = 状态栏高度 + 88rpx 标题区，避开刘海与胶囊按钮。
 */
Component({
  properties: {
    title: { type: String, value: "" },
    showBack: { type: Boolean, value: true },
    transparent: { type: Boolean, value: false },
    // inverse：标题与返回箭头改用玻璃面板文字色，配合 transparent 用于沉浸式页面
    tone: { type: String, value: "default" }
  },
  data: { statusBarHeight: 20 },
  attached() {
    let info = {};
    try { info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}; } catch (error) { info = {}; }
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },
  methods: {
    handleBack() {
      const pages = getCurrentPages() || [];
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: "/pages/index/index" });
    }
  }
});
