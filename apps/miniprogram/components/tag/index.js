/**
 * t-tag：状态徽标。用于订单/任务/作品状态，统一中文文案由页面映射后传入。
 * tone  neutral | success | warning | error | accent
 */
Component({
  properties: {
    tone: { type: String, value: "neutral" },
    text: { type: String, value: "" },
    size: { type: String, value: "normal" }
  }
});
