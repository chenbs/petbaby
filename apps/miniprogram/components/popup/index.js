/**
 * t-popup：底部抽屉。用于表单类操作（编辑档案、填写地址等）。
 */
Component({
  options: { multipleSlots: true },
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "" },
    anim: { type: String, value: "fade" }
  },
  methods: {
    handleClose() { this.triggerEvent("close"); },
    noop() { /* 阻止穿透 */ }
  }
});
