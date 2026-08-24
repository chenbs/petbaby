/**
 * t-steps：流程指示。用于 create 页四步（档案 → 选照片 → 生成 → 完成）。
 *
 * 形态为 N 段细线 + 当前步名（UI 重构方案 3.5），不再用数字圆圈铺开全部标签。
 * current 为已到达的步序号（从 0 开始），属性签名未变，调用方无需改动。
 */
Component({
  properties: {
    steps: { type: Array, value: [] },
    current: { type: Number, value: 0 }
  }
});
