/**
 * t-progress：进度展示。shape=bar 用于生成/渲染进度条，shape=ring 用于额度环（需求 5.6.2）。
 * 环形用 conic-gradient 绘制，机型不支持时会退化成整圈底色，读数文字仍然可见。
 */
Component({
  properties: {
    percent: { type: Number, value: 0 },
    shape: { type: String, value: "bar" },
    tone: { type: String, value: "primary" },
    label: { type: String, value: "" },
    valueText: { type: String, value: "" },
    showValue: { type: Boolean, value: false }
  },
  data: { safePercent: 0, ringStyle: "" },
  observers: {
    "percent": function (value) { this.sync(value); }
  },
  attached() { this.sync(this.data.percent); },
  methods: {
    sync(value) {
      const safePercent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      const paint = this.data.tone === "ai" ? "var(--ai-gradient-start)" : this.data.tone === "success" ? "var(--success)" : "var(--primary)";
      this.setData({
        safePercent,
        ringStyle: `background:conic-gradient(${paint} ${safePercent}%, var(--divider) ${safePercent}%)`
      });
    }
  }
});
