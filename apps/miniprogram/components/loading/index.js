/**
 * t-loading：加载指示。形态按 animationType 分化（需求 7）：
 *   bounce → 爪印逐个点亮   glow → 光环旋转   fade → 细线进度   neon → 霓虹脉冲
 * 可选 progress（0-100）用于生成/渲染进度；不传则为不确定态。
 */
Component({
  properties: {
    anim: { type: String, value: "fade" },
    label: { type: String, value: "" },
    progress: { type: Number, value: -1 },
    size: { type: String, value: "normal" }
  }
});
