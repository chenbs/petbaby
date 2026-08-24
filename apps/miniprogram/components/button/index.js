/**
 * t-button：统一按钮。替换全部原生 `<button type="primary">`（需求 7 / 12.7）。
 *
 * type    primary（主行动）| secondary（次级）| ghost（幽灵）| ai（AI 渐变）| danger（危险）
 *         cta（底部常驻转化按钮，UI 重构方案 3.2）
 * size    normal | mini
 * price   仅 cta 生效。方案要求「CTA 必带价格」，用低透明度做次要处理 ——
 *         保持价格透明可见的同时减少心理阻力，比藏起来更利于转化。
 * 形态、圆角、点击反馈全部由当前主题 token 决定；组件内不出现任何固定颜色。
 */
Component({
  options: { multipleSlots: true },
  properties: {
    type: { type: String, value: "primary" },
    size: { type: String, value: "normal" },
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    block: { type: Boolean, value: false },
    // 由页面透传 animType，决定 :active 反馈形态（bounce / glow / fade / neon）
    anim: { type: String, value: "fade" },
    ariaLabel: { type: String, value: "" },
    price: { type: String, value: "" }
  },
  methods: {
    handleTap() {
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent("tap");
    }
  }
});
