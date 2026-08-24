/**
 * 岛的 HUD 内容变量。
 *
 * 走 `theme/scene-presets.js` 的既有先例：**内容属性、内联注入、与主题 token 刻意隔离**。
 * 换 UI 主题不改变岛的外观 —— 岛的奶白底板与草地色是「这座岛长什么样」，
 * 不是「这个 App 用哪套皮肤」（22 号文 2.2）。
 *
 * 只出四个变量，因为 HUD 只有一处需要跳出 token 体系：**底板**。
 * 其余（文字层级、胶囊、阴影、间距）全部走既有 token 与组件，岛不新增 UI 元件体系 ——
 * 否则 `validate.js` 第 3 / 8 项会拦（`.wxss` 不许出现 `rgba(`，`var()` 必须有来源）。
 *
 * **底板不是可选项**（2.3 / 2.5.1）：16 种昼夜×天气组合下没有任何单一字色能全域达标，
 * 最暗的「雨+夜」深色字 3.23:1、白字 4.13:1 双双不达标。底板把文字与场景明度解耦。
 * `scripts/validate.js` 的门禁 16 既校验合成后对比度，也断言底板本身存在 ——
 * 后者是防「顺手把这层优化掉」。
 */

const ambient = require("./scene/ambient");

/**
 * 变量名前缀取 `--island-`，与 `--scene-*`（互动纪念场景）区分开：
 * 两套都是内容变量但服务不同模块，共用前缀会让 validate 的来源检查分不清谁该有谁。
 */
/**
 * 底板两档的不透明度。
 *
 * 分两档是因为用途不同：顶部一行是**读**（0.82，让场景仍透出来一点，画面不被切成两半），
 * 动作胶囊与提示是**点**（0.94，可点的东西视觉上必须站得住）。
 * 抽成常量而不是写在下面的字面量里，是为了让门禁 16 能遍历「每个字色 × 每档底板」——
 * 那 16 种组合的对比度必须逐个算，见 `ISLAND_TEXT_ON_PLATE`。
 */
const PLATE_ALPHA = { plate: ambient.HUD_PLATE.opacity, solid: 0.94 };

/**
 * 次级文字的不透明度。
 *
 * **0.75 而不是 0.7。** 0.7 是最初的取值，实算下来在最暗的组合（夜+晴压在树丛色
 * `#5F7A4E` 上）只有 4.23:1 —— 不达标，而门禁 16 当时只校验主文字色 @1.0，
 * 放它过去了。0.75 在同一处得 4.80:1，全 32 种组合（4 昼夜 × 4 天气 × 2 档底板 …
 * 逐地表算）的最低值都过 4.5。
 *
 * 再往下压不是不能，但次级文字本就是要「弱一点」的，0.75 已经能读出层级差；
 * 而**为了层级差牺牲可读性是反的** —— 层级可以靠字号（这里已经压到 `--small-size`）。
 */
const INK_SOFT_ALPHA = 0.75;

const ISLAND_VARS = {
  /** HUD 底板色。奶白 —— 贴合这套画风的器物色，深色底板会显得突兀 */
  "--island-plate": ambient.toRgba(ambient.HUD_PLATE.color, PLATE_ALPHA.plate),
  /** 底板上的文字色。与 cocoa900 同值，不新开一套 */
  "--island-ink": ambient.HUD_PLATE.textColor,
  /** 次级文字：主文字色降透明度，而不是另取一个灰 —— 底板半透明，另取灰会在浅底上发飘 */
  "--island-ink-soft": ambient.toRgba(ambient.HUD_PLATE.textColor, INK_SOFT_ALPHA),
  /** 动作胶囊的底。比 HUD 底板更实一点：胶囊要能被点，视觉上必须站得住 */
  "--island-plate-solid": ambient.toRgba(ambient.HUD_PLATE.color, PLATE_ALPHA.solid)
};

/**
 * 门禁 16 要遍历的「字色 × 底板」组合。
 *
 * **这张表是门禁的输入，不是文档。** 早先门禁只按 `HUD_PLATE.textColor` @1.0 压在
 * 0.82 底板上算一种组合，而 `.wxss` 里实际用着四种（主/次文字 × 两档底板）——
 * `--island-ink-soft` 因此带着 4.23:1 过了门禁。判据是**凡进 `.wxss` 的字色都要算**，
 * 所以这里逐条登记，新增变量时漏登记会被下面的 `assertVarsCovered` 抓到。
 *
 * `textAlpha` 是文字自身的不透明度（半透明文字要先与底板合成再算对比度），
 * `plateAlpha` 是它所在底板那一档的不透明度。
 */
const ISLAND_TEXT_ON_PLATE = [
  { text: "--island-ink", plate: "--island-plate", textAlpha: 1, plateAlpha: PLATE_ALPHA.plate },
  { text: "--island-ink", plate: "--island-plate-solid", textAlpha: 1, plateAlpha: PLATE_ALPHA.solid },
  { text: "--island-ink-soft", plate: "--island-plate", textAlpha: INK_SOFT_ALPHA, plateAlpha: PLATE_ALPHA.plate },
  { text: "--island-ink-soft", plate: "--island-plate-solid", textAlpha: INK_SOFT_ALPHA, plateAlpha: PLATE_ALPHA.solid }
];

/**
 * 断言上表覆盖了全部注入变量。
 *
 * 加一个 `--island-ink-*` 或 `--island-plate-*` 却忘了登记进 `ISLAND_TEXT_ON_PLATE` 时，
 * 门禁 16 会照样通过 —— 与「只校验一种组合」是同一个静默失效，所以正面断言一次。
 * 返回未覆盖的变量名清单，空数组表示齐备。
 */
function uncoveredVars() {
  const covered = {};
  for (const pair of ISLAND_TEXT_ON_PLATE) { covered[pair.text] = true; covered[pair.plate] = true; }
  return Object.keys(ISLAND_VARS).filter((name) => !covered[name]);
}

/** 内联变量串，供 WXML 的 style 属性使用。与 `getSceneStyle()` 同一形态 */
function getIslandStyle() {
  return Object.keys(ISLAND_VARS).map((name) => name + ":" + ISLAND_VARS[name]).join(";") + ";";
}

module.exports = {
  ISLAND_VARS: ISLAND_VARS,
  PLATE_ALPHA: PLATE_ALPHA,
  INK_SOFT_ALPHA: INK_SOFT_ALPHA,
  ISLAND_TEXT_ON_PLATE: ISLAND_TEXT_ON_PLATE,
  uncoveredVars: uncoveredVars,
  getIslandStyle: getIslandStyle
};
