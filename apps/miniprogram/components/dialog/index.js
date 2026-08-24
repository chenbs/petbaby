/**
 * t-dialog：主题化确认弹窗，替换 wx.showModal（需求 12.7）。
 * 删除类操作传 danger，确认按钮走 error 语义色。
 */
Component({
  options: { multipleSlots: true },
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "" },
    content: { type: String, value: "" },
    confirmText: { type: String, value: "确认" },
    cancelText: { type: String, value: "取消" },
    danger: { type: Boolean, value: false },
    anim: { type: String, value: "fade" }
  },
  methods: {
    handleConfirm() { this.triggerEvent("confirm"); },
    handleCancel() { this.triggerEvent("cancel"); },
    noop() { /* 阻止点击穿透到遮罩 */ }
  }
});
