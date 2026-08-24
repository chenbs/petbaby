/**
 * t-photo-grid：照片九宫格。被 create / ai-create / interactive-create / video-create / photos / memorials 复用。
 *
 * photos      [{ id, url, selected }]，由页面维护（不改页面既有数据字段语义）
 * selectedIds 选中顺序数组；ordered=true 时格内角标显示序号而非「已选」
 * addable     首格渲染「＋」入口（合并历史与新增照片，避免两个割裂的 grid）
 * manageable  管理模式下每格显示勾选框，用于批量删除
 * reorderable 长按进入排序：再点另一格即交换位置（视频依赖照片顺序，需求 5.15.1）
 *
 * 事件：add / toggle{id} / preview{id} / reorder{from,to} / remove{index}
 */
Component({
  properties: {
    photos: { type: Array, value: [] },
    selectedIds: { type: Array, value: [] },
    max: { type: Number, value: 9 },
    addable: { type: Boolean, value: false },
    ordered: { type: Boolean, value: false },
    manageable: { type: Boolean, value: false },
    reorderable: { type: Boolean, value: false },
    removable: { type: Boolean, value: false },
    previewable: { type: Boolean, value: true },
    anim: { type: String, value: "fade" },
    columns: { type: Number, value: 3 }
  },
  data: { tiles: [], dragIndex: -1 },
  observers: {
    "photos, selectedIds, ordered": function (photos, selectedIds) {
      const ids = selectedIds || [];
      this.setData({
        tiles: (photos || []).map((photo) => {
          const order = ids.indexOf(photo.id);
          return Object.assign({}, photo, { order: order >= 0 ? order + 1 : 0, picked: order >= 0 || Boolean(photo.selected) });
        })
      });
    }
  },
  methods: {
    handleAdd() { this.triggerEvent("add"); },

    handleTap(event) {
      const id = event.currentTarget.dataset.id;
      const index = Number(event.currentTarget.dataset.index);
      // 排序模式下的第二次点击 = 与拖起项交换
      if (this.data.dragIndex >= 0) {
        const from = this.data.dragIndex;
        this.setData({ dragIndex: -1 });
        if (from !== index) this.triggerEvent("reorder", { from, to: index });
        return;
      }
      this.triggerEvent("toggle", { id, index });
    },

    handleLongPress(event) {
      if (this.data.reorderable) {
        this.setData({ dragIndex: Number(event.currentTarget.dataset.index) });
        wx.vibrateShort({ type: "light", fail: () => undefined });
        return;
      }
      if (this.data.previewable) this.preview(event);
    },

    handlePreview(event) { this.preview(event); },

    preview(event) {
      if (!this.data.previewable) return;
      const id = event.currentTarget.dataset.id;
      const urls = this.data.tiles.map((item) => item.url).filter(Boolean);
      const current = (this.data.tiles.find((item) => item.id === id) || {}).url;
      if (!current) return;
      wx.previewImage({ urls, current, fail: () => undefined });
      this.triggerEvent("preview", { id });
    },

    handleRemove(event) { this.triggerEvent("remove", { index: Number(event.currentTarget.dataset.index), id: event.currentTarget.dataset.id }); }
  }
});
