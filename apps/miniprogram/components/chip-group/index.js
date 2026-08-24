/**
 * t-chip-group：横向 chip 选择器。
 *
 * 收口 ai-create / interactive-create / video-create 里各写一遍的 .option / .bgm-option。
 * 适用范围由 UI 重构方案 3.3 界定：选项 ≤4 个且「不描述视觉结果」时才用 chip，
 * 一旦选项决定出图观感（风格、场景配色）必须换 t-card-select 上缩略图。
 *
 * options  [{ id, label, hint? }]
 * value    当前选中 id；multi 为真时接受 id 数组
 */
Component({
  properties: {
    options: { type: Array, value: [] },
    value: { type: null, value: "" },
    multi: { type: Boolean, value: false },
    anim: { type: String, value: "fade" }
  },
  data: { picked: [] },
  observers: {
    "value, multi": function (value, multi) {
      const picked = multi ? (Array.isArray(value) ? value : []) : [value];
      this.setData({ picked: picked.filter((item) => item !== "" && item !== null && item !== undefined) });
    }
  },
  methods: {
    handleTap(event) {
      const id = event.currentTarget.dataset.id;
      if (!this.data.multi) {
        if (id === this.data.value) return;
        this.triggerEvent("change", { value: id });
        return;
      }
      const current = Array.isArray(this.data.value) ? this.data.value.slice() : [];
      const at = current.indexOf(id);
      if (at >= 0) current.splice(at, 1); else current.push(id);
      this.triggerEvent("change", { value: current });
    }
  }
});
