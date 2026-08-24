/**
 * t-action-sheet：操作列表。收纳「更多」类操作，破坏性项用 --error。
 * actions: [{ key, label, description, danger, disabled }]
 */
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "" },
    actions: { type: Array, value: [] }
  },
  methods: {
    handleSelect(event) {
      const item = this.data.actions[Number(event.currentTarget.dataset.index)];
      if (!item || item.disabled) return;
      this.triggerEvent("select", { key: item.key, action: item });
    },
    handleClose() { this.triggerEvent("close"); },
    noop() { /* 阻止穿透 */ }
  }
});
