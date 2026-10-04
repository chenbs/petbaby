/**
 * 把 theme/themes/*.js 的 `skin` 对象同步成 app.wxss 里的 `.skin-<id>{}` 变量块（2026-09 皮肤层）。
 *
 * 为什么要写进 app.wxss 而不是注入：page-style 注入串有 2KB 硬门禁，四套主题都已接近上限；
 * 结构变量与颜色无关、只随主题切换，用根节点类名承载即可，零注入开销。
 * 生成区块由标记包住，重复运行只替换标记之间的内容。validate 第 11 项会校验两处逐字一致。
 *
 * 用法：node scripts/build-skin-css.js
 */
const fs = require("node:fs");
const path = require("node:path");
const themes = require("../theme");

const START = "/* ---------- skin:start（由 scripts/build-skin-css.js 生成，勿手改） ---------- */";
const END = "/* ---------- skin:end ---------- */";

function render() {
  const blocks = themes.THEMES.map((theme) => {
    const lines = Object.entries(theme.skin || {}).map(([name, value]) => `  ${name}: ${value};`);
    return `.skin-${theme.id} {\n${lines.join("\n")}\n}`;
  });
  return [START, ...blocks, END].join("\n");
}

function main() {
  const file = path.join(__dirname, "../app.wxss");
  const source = fs.readFileSync(file, "utf8");
  const block = render();
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  const next = start >= 0 && end > start
    ? source.slice(0, start) + block + source.slice(end + END.length)
    : source.trimEnd() + "\n\n" + block + "\n";
  fs.writeFileSync(file, next);
  console.log("Synced skin blocks for " + themes.THEMES.map((theme) => theme.id).join(", "));
}

if (require.main === module) main();
module.exports = { render, START, END };
