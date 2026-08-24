/**
 * t-skeleton：骨架屏。替换「加载中…」纯文字（需求 5.1.4 / 5.3.3）。
 * type  card（卡片列表）| list（行列表）| grid（照片网格）| text（文本段）
 */
Component({
  properties: {
    type: { type: String, value: "card" },
    count: { type: Number, value: 3 }
  },
  data: { slots: [] },
  observers: {
    count(value) {
      const total = Math.max(1, Math.min(12, Number(value) || 1));
      this.setData({ slots: Array.from({ length: total }, (item, index) => index) });
    }
  },
  attached() {
    const total = Math.max(1, Math.min(12, Number(this.data.count) || 1));
    this.setData({ slots: Array.from({ length: total }, (item, index) => index) });
  }
});
