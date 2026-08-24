/**
 * t-card-select：带缩略图的选项网格。
 *
 * 存在理由是 UI 重构方案 3.3 的硬规则：凡选项决定出图观感（AI 风格、玩法、场景配色），
 * 必须让用户看到该选项的真实成品缩略图，不能用抽象渐变色块代替 ——
 * 色块只能表达「有区别」，无法表达「区别是什么」。
 *
 * 缩略图必须是同一只样板宠物的不同风格产出，否则用户会把「宠物不同」误读成风格差异。
 * 素材由 tools/imagegen 用生图接口批量产出，见该目录 prompts.mjs 的 MODEL_PET。
 *
 * options  [{ id, label, hint?, image? }]  image 缺失时退化为纯文字卡，不留空白占位
 * columns  每行列数，默认 2
 */
Component({
  properties: {
    options: { type: Array, value: [] },
    value: { type: String, value: "" },
    columns: { type: Number, value: 2 },
    anim: { type: String, value: "fade" }
  },
  methods: {
    handleTap(event) {
      const id = event.currentTarget.dataset.id;
      if (id === this.data.value) return;
      this.triggerEvent("change", { value: id });
    }
  }
});
