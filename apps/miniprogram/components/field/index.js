/**
 * t-field：表单字段。label 在上、控件在下，统一 input / textarea / select 触发区外观。
 *
 * control  input | textarea | select | slot
 * select 只渲染触发区外观（右侧箭头 + 细边），实际选择由页面用 picker 包裹本组件承担，
 * 这样既统一了外观又不改变页面既有的 bindchange 数据流。
 */
Component({
  options: { multipleSlots: true },
  properties: {
    label: { type: String, value: "" },
    control: { type: String, value: "input" },
    value: { type: String, value: "" },
    placeholder: { type: String, value: "" },
    help: { type: String, value: "" },
    error: { type: String, value: "" },
    maxlength: { type: Number, value: 140 },
    showCount: { type: Boolean, value: false },
    password: { type: Boolean, value: false },
    inputType: { type: String, value: "text" },
    disabled: { type: Boolean, value: false },
    required: { type: Boolean, value: false }
  },
  data: { focused: false, revealed: false },
  methods: {
    handleInput(event) { this.triggerEvent("change", { value: event.detail.value }); },
    handleFocus() { this.setData({ focused: true }); },
    handleBlur(event) { this.setData({ focused: false }); this.triggerEvent("blur", { value: event.detail.value }); },
    toggleReveal() { this.setData({ revealed: !this.data.revealed }); }
  }
});
