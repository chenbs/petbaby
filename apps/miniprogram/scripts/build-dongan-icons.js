/**
 * 冻干图标「爪印冻干 · J 厚切方块」（2026-10-08 定稿，见 docs/ui-refactor/2026-10-06-鸡胸肉付费UI/preview.html）。
 *
 * 每套主题出两张 @3x PNG（144px）：
 *   fd-coin.png       彩色版：受光面、侧面、暗面三档明暗 + 压进去的爪印 + 气孔
 *   fd-coin-mono.png  单色线稿：画在主按钮色块上，用按钮文字色，避免与按钮底同色而消失
 *
 * 渐变在 PNG 里保留，所以不能像 build-tab-icons 那样只出描边图标。配色取预览页各主题的 --m-* 值。
 *
 * 用法：node scripts/build-dongan-icons.js（依赖 apps/platform 的 sharp）
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(require.resolve("sharp", { paths: [path.resolve(__dirname, "../../platform")] }));

const PALETTE = {
  pet: { fill: "#F7E0B8", top: "#FFF0D6", shade: "#E6BF86", deep: "#CF9A5A", line: "#7A3E12", mark: "#C48A4A", hi: "#FFFFFF", mono: "#1F2540" },
  film: { fill: "#EFDCBB", top: "#FAEED8", shade: "#D6B98C", deep: "#BE9C68", line: "#211E1B", mark: "#9A6534", hi: "#FFFDF8", mono: "#FFFDF8" },
  brand: { fill: "rgba(212,255,58,.12)", top: "rgba(212,255,58,.28)", shade: "rgba(212,255,58,.06)", deep: "rgba(212,255,58,0)", line: "#D4FF3A", mark: "#3DE8FF", hi: "none", mono: "#0E1016" },
  night: { fill: "#F3DCAE", top: "#FFF1D2", shade: "#CFA66A", deep: "#B07F40", line: "#1A1508", mark: "#A8742F", hi: "rgba(255,255,255,.8)", mono: "#1A1508" }
};

const PAW = "M12 11.8C14 11.8 15.6 13.3 15.6 15C15.6 16.4 14.4 17.2 13.4 17.2C12.8 17.2 12.5 16.9 12 16.9S11.2 17.2 10.6 17.2C9.6 17.2 8.4 16.4 8.4 15C8.4 13.3 10 11.8 12 11.8Z";
const TOES = [[8.5, 10.6, -20], [10.8, 8.4, -6], [13.2, 8.4, 6], [15.5, 10.6, 20]];
function paw(fill) {
  const toes = TOES.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="1.1" ry="${a === -6 || a === 6 ? 1.45 : 1.4}" transform="rotate(${a} ${x} ${y})" fill="${fill}"/>`).join("");
  return `<path d="${PAW}" fill="${fill}"/>${toes}`;
}
function pore(x, y, r, fill) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`; }

function colorIcon(c) {
  const stroke = `stroke="${c.line}" stroke-width="1.3" stroke-linejoin="round"`;
  const lip = c.hi === "none" ? "" : `<g transform="translate(0 0.8)">${paw(c.hi)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="-0.5 -0.5 25 25">
  <defs>
    <radialGradient id="a" cx="0.34" cy="0.26" r="0.85"><stop offset="0" stop-color="${c.top}"/><stop offset="0.58" stop-color="${c.fill}"/><stop offset="1" stop-color="${c.shade}"/></radialGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.shade}"/><stop offset="1" stop-color="${c.deep}"/></linearGradient>
  </defs>
  <ellipse cx="12.4" cy="21.7" rx="8.2" ry="1.4" fill="${c.line}" opacity="0.14"/>
  <g transform="rotate(-8 12 12)">
    <rect x="3.8" y="4.4" width="16.4" height="15.6" rx="3.2" fill="url(#b)" ${stroke}/>
    ${pore(6.6, 18.4, 0.42, c.mark)}${pore(10.2, 18.8, 0.42, c.mark)}${pore(13.8, 18.8, 0.42, c.mark)}${pore(17.4, 18.4, 0.42, c.mark)}
    <rect x="3.8" y="3.4" width="16.4" height="13.4" rx="3.2" fill="url(#a)" ${stroke}/>
    ${c.hi === "none" ? "" : `<path d="M5.3 11V7.1C5.3 5.8 6.1 4.9 7.4 4.9H11.2" fill="none" stroke="${c.hi}" stroke-width="1.1" stroke-linecap="round"/>`}
    <g transform="translate(12 10.2) scale(.74) translate(-12 -12.1)">${lip}${paw(c.mark)}</g>
    ${pore(6.4, 14.6, 0.5, c.mark)}${pore(17.6, 14.4, 0.55, c.mark)}${pore(17.4, 6, 0.45, c.mark)}
  </g>
</svg>`;
}

function monoIcon(color) {
  const stroke = `fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="-0.5 -0.5 25 25">
  <g transform="rotate(-8 12 12)">
    <rect x="3.8" y="4.4" width="16.4" height="15.6" rx="3.2" ${stroke}/>
    <rect x="3.8" y="3.4" width="16.4" height="13.4" rx="3.2" ${stroke}/>
    <g transform="translate(12 10.2) scale(.74) translate(-12 -12.1)">${paw(color)}</g>
  </g>
</svg>`;
}

async function main() {
  for (const [theme, colors] of Object.entries(PALETTE)) {
    const dir = path.join(__dirname, "../assets/icons", theme);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(Buffer.from(colorIcon(colors))).png({ compressionLevel: 9 }).toFile(path.join(dir, "fd-coin.png"));
    await sharp(Buffer.from(monoIcon(colors.mono))).png({ palette: true, compressionLevel: 9 }).toFile(path.join(dir, "fd-coin-mono.png"));
  }
  console.log("Built dongan icons for " + Object.keys(PALETTE).join(", "));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { PALETTE, colorIcon, monoIcon };
