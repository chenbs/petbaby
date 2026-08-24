/**
 * 互动纪念场景配色。
 *
 * 这些颜色是**内容属性**，不是 UI 主题：用户在创建时选「星尘/草地/日落」，
 * 选中的氛围要跟着这件作品走，换 UI 主题不该改变它已经做好的纪念场景。
 * 因此它们不进 theme/tokens.js，而是以内联 style 注入，
 * 只作用于场景画布本身，页面其余部分照常读主题变量。
 */
const SCENE_PRESETS = [
  { id: "stardust", name: "星尘", hint: "深空蓝紫，安静", sky: "#141B3D", glow: "#8E7CFF", ink: "#F4F2FF", dust: "#FFE9A8" },
  { id: "meadow", name: "草地", hint: "黄昏草绿，温和", sky: "#1C3326", glow: "#7FC98B", ink: "#F1FBF3", dust: "#FFF3C4" },
  { id: "sunset", name: "日落", hint: "橘粉暖调，柔软", sky: "#3B1E2B", glow: "#FF9A76", ink: "#FFF4EE", dust: "#FFD9A0" }
];

function getScene(id) {
  return SCENE_PRESETS.filter((item) => item.id === id)[0] || SCENE_PRESETS[0];
}

/** 生成场景画布的内联变量串，供 WXML 的 style 属性使用。 */
function getSceneStyle(id) {
  const scene = getScene(id);
  return [
    "--scene-sky:" + scene.sky,
    "--scene-glow:" + scene.glow,
    "--scene-ink:" + scene.ink,
    "--scene-dust:" + scene.dust
  ].join(";") + ";";
}

module.exports = { SCENE_PRESETS, getScene, getSceneStyle };
