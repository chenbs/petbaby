/**
 * t-empty：空状态。要求「插画 + 说明 + 行动按钮」（需求 5.3.4 等）。
 *
 * 插画为纯 CSS 单色线条（UI 重构方案 3.6 禁用 emoji）：不引入图片资源，
 * 吃 currentColor 自动跟随四套主题。icon 取 paw / photo / order / work / pet。
 */
Component({
  properties: {
    icon: { type: String, value: "paw" },
    title: { type: String, value: "这里还是空的" },
    description: { type: String, value: "" },
    actionText: { type: String, value: "" },
    anim: { type: String, value: "fade" },
    decor: { type: Boolean, value: false },
    /*
     * clay：在线条插画后面垫一块黏土底座（方案 J 的「只抽取质感层」用法）。
     * 默认关闭 —— 方案 3.6 要求空态克制，只有结果页与情感向场景才值得加质感。
     * 底座无描边（--shadow-clay 自带四层阴影、不需要边框），因此不会重新引入
     * 3.6 明确去掉的「与线条图形抢注意力的容器边框」。
     */
    clay: { type: Boolean, value: false }
  },
  methods: {
    handleAction() { this.triggerEvent("action"); }
  }
});
