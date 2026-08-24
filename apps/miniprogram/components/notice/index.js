/**
 * t-notice：行内提示条。承接原来散落各页的 `.error` / `.message` / `.notice`（需求 12.7）。
 * type  info | success | warning | error
 */
Component({
  options: { multipleSlots: true },
  properties: {
    type: { type: String, value: "info" },
    message: { type: String, value: "" },
    closable: { type: Boolean, value: false }
  },
  methods: {
    handleClose() { this.triggerEvent("close"); }
  }
});
