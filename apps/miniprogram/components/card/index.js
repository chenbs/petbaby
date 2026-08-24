/**
 * t-card：统一卡片容器。四套主题的材质差异全部落在这里（需求 4.5）。
 *
 * variant  plain   常规卡，圆角取主题身份值 --card-radius
 *          variant 不对称圆角，cute 专用观感
 *          media   图片贴边，圆角随主题
 *          glass   强调玻璃材质
 *          hero    大图入口（UI 重构方案 A 方向首屏主角），圆角 --radius-lg
 *          grid    网格卡（作品墙、列表主力），圆角 --radius-md 固定不随主题漂移
 *          float   浮层面板，阴影 --shadow-float
 *          clay    黏土卡（J 方向局部），只用于结果页与空状态
 *          flat    满版出血（F 方向），无圆角无阴影无底色
 * blur     是否启用 backdrop-filter；页面透传 blurOk，false 时自动退回不透明底
 */
Component({
  properties: {
    variant: { type: String, value: "plain" },
    clickable: { type: Boolean, value: false },
    blur: { type: Boolean, value: true },
    anim: { type: String, value: "fade" },
    padded: { type: Boolean, value: true }
  },
  methods: {
    handleTap() {
      if (!this.data.clickable) return;
      this.triggerEvent("tap");
    }
  }
});
