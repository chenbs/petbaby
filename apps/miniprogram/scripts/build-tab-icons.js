/**
 * 底栏与功能图标（2026-09 改版）：用统一的 24px 线性图标替换 ✦ ▣ ◈ ◉ 这类 Unicode 字形。
 *
 * `<image>` 对本地 SVG 的支持依赖基础库版本（下限 2.19.2），所以这里把 SVG 栅格化成 @3x PNG。
 * 每个图标出两态：未选中用中性灰，选中用墨色实心笔画；各主题的专属配色在 `skins` 里覆盖。
 *
 * 用法：node scripts/build-tab-icons.js（依赖 apps/platform 的 sharp，不单独安装）
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(require.resolve("sharp", { paths: [path.resolve(__dirname, "../../platform")] }));

const ICONS = {
  home: '<path d="M4 10.8 12 4.5l8 6.3V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2h-6v5.2H5.5A1.5 1.5 0 0 1 4 19z"/>',
  create: '<path d="M11 3.5l1.7 4.6 4.8 1.7-4.8 1.7L11 16.1l-1.7-4.6-4.8-1.7 4.8-1.7z"/><path d="M18 14.5l.8 2.1 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  works: '<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><path d="m4 16 4.5-4.5 3.5 3.5 2.5-2.5 5 4.5"/><circle cx="15.5" cy="9" r="1.6"/>',
  me: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>'
};

/*
 * 页面内的功能图标（2026-10）：首页名片的相机键、导航栏品牌爪印、「我的」入口行的图标块。
 * 每套主题一种颜色，避免在 WXSS 里给 PNG 染色（小程序不支持 mask 染色）。
 */
const GLYPHS = {
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.3" r="3.3"/>',
  paw: '<ellipse cx="7" cy="9" rx="1.8" ry="2.4"/><ellipse cx="11" cy="6.5" rx="1.8" ry="2.4"/><ellipse cx="15.5" cy="7" rx="1.8" ry="2.4"/><ellipse cx="18.5" cy="11" rx="1.6" ry="2.1"/><path d="M12 11.5c-3 0-5.5 3.3-5.5 5.6 0 1.6 1.3 2.4 2.8 2.4 1.1 0 1.8-.5 2.7-.5s1.6.5 2.7.5c1.5 0 2.8-.8 2.8-2.4 0-2.3-2.5-5.6-5.5-5.6z"/>',
  "ic-photo": '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.3" r="3.3"/>',
  "ic-book": '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  "ic-cross": '<path d="M12 8v8M8 12h8"/><rect x="3.5" y="3.5" width="17" height="17" rx="5"/>',
  "ic-heart": '<path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/>',
  "ic-bag": '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  "ic-crown": '<path d="m4 8 4 4 4-6 4 6 4-4-1.5 10h-13z"/>',
  "ic-gear": '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
  "ic-lock": '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  "ic-user": '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
  "ic-bell": '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  "ic-share": '<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  "ic-magic": '<path d="M11 3.5l1.7 4.6 4.8 1.7-4.8 1.7L11 16.1l-1.7-4.6-4.8-1.7 4.8-1.7z"/><path d="M18 14.5l.8 2.1 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'
};

/*
 * 四套皮肤的图标配色。未选中统一用对各自底色 ≥ 3:1 的次级色；选中用各主题的强调色。
 * 「＋记录」按钮的图标画在主按钮色块上，所以它用按钮文字色。
 * camera：首页名片相机键（橘子汽水画在浅橘按钮上用墨蓝；手账画在相纸上用墨黑；赛博 / 影院是描边键，用主色）。
 * brand：导航栏爪印用 primary；ink：入口图标用 textPrimary；sticker：画在贴纸色块上的图标（额度条）。
 * lock 画在主按钮上，与「＋」同色。
 */
const SKINS = {
  pet: { idle: "#5B6178", active: "#1F2540", plus: "#1F2540", camera: "#1F2540", brand: "#B7401A", ink: "#1F2540", sticker: "#1F2540", cap: "round" },
  film: { idle: "#6B6258", active: "#C2381F", plus: "#FFFDF8", camera: "#211E1B", brand: "#C2381F", ink: "#211E1B", sticker: "#B42318", cap: "round" },
  brand: { idle: "#93A1AD", active: "#D4FF3A", plus: "#0E1016", camera: "#D4FF3A", brand: "#D4FF3A", ink: "#EAF2F5", sticker: "#0E1016", cap: "square" },
  night: { idle: "#B8AFA0", active: "#FFC94A", plus: "#1A1508", camera: "#FFC94A", brand: "#FFC94A", ink: "#F6F1E7", sticker: "#1A1508", cap: "round" }
};

function svg(body, color, width, cap) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="${cap}" stroke-linejoin="${cap === "square" ? "miter" : "round"}">${body}</svg>`;
}

async function main() {
  for (const [skin, colors] of Object.entries(SKINS)) {
    const dir = path.join(__dirname, "../assets/icons", skin);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(ICONS)) {
      if (name === "plus") {
        await sharp(Buffer.from(svg(body, colors.plus, 2.4, colors.cap))).png({ palette: true, compressionLevel: 9 }).toFile(path.join(dir, "plus.png"));
        continue;
      }
      await sharp(Buffer.from(svg(body, colors.idle, 1.8, colors.cap))).png({ palette: true, compressionLevel: 9 }).toFile(path.join(dir, name + ".png"));
      await sharp(Buffer.from(svg(body, colors.active, 2.2, colors.cap))).png({ palette: true, compressionLevel: 9 }).toFile(path.join(dir, name + "-on.png"));
    }
    for (const [name, body] of Object.entries(GLYPHS)) {
      const color = { camera: colors.camera, paw: colors.brand, lock: colors.plus, "ic-magic": colors.sticker }[name] || colors.ink;
      await sharp(Buffer.from(svg(body, color, 2, colors.cap))).png({ palette: true, compressionLevel: 9 }).toFile(path.join(dir, name + ".png"));
    }
  }
  console.log("Built tab icons for " + Object.keys(SKINS).join(", "));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { ICONS, GLYPHS, SKINS };
