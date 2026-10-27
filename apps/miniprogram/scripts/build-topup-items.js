/**
 * 虚拟支付「道具管理」用的 6 张充值道具图（2026-10-27）。
 *
 * 只给微信后台上传用，不进小程序包（scripts/ 在 packOptions 里被忽略）。
 * 512×512 PNG：暖色底 + 冻干方块（复用 build-dongan-icons 的 pet 配色）+ 颗数，首充档加角标。
 *
 * 用法：node scripts/build-topup-items.js  → 输出到 output/topup-items/
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(require.resolve("sharp", { paths: [path.resolve(__dirname, "../../platform")] }));
const { PALETTE, colorIcon } = require("./build-dongan-icons");

const ITEMS = [
  { id: "fd_topup_6_first", units: 12, first: true },
  { id: "fd_topup_6", units: 6 },
  { id: "fd_topup_18", units: 22 },
  { id: "fd_topup_38", units: 50 },
  { id: "fd_topup_68", units: 95 },
  { id: "fd_topup_128", units: 188 }
];

const FONT = "Noto Sans CJK SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif";

function card(item) {
  const corner = item.first
    ? `<g transform="translate(512 0)"><path d="M-200 0 H0 V200 Z" fill="#D2452E"/><text x="-62" y="70" fill="#FFFFFF" font-family="${FONT}" font-size="40" font-weight="900" text-anchor="middle" transform="rotate(45 -62 70)">首充</text></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs><radialGradient id="bg" cx="0.5" cy="0.38" r="0.75"><stop offset="0" stop-color="#FFF4E2"/><stop offset="1" stop-color="#FFD9A8"/></radialGradient></defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  ${corner}
  <text x="256" y="440" fill="#7A3E12" font-family="${FONT}" font-size="96" font-weight="900" text-anchor="middle">${item.units}<tspan font-size="56" dx="8">颗</tspan></text>
</svg>`;
}

async function main() {
  const out = path.join(__dirname, "../output/topup-items");
  fs.mkdirSync(out, { recursive: true });
  const coin = await sharp(Buffer.from(colorIcon(PALETTE.pet))).resize(300, 300).png().toBuffer();
  for (const item of ITEMS) {
    const base = await sharp(Buffer.from(card(item))).png().toBuffer();
    await sharp(base).composite([{ input: coin, left: 106, top: 40 }]).png({ compressionLevel: 9 }).toFile(path.join(out, item.id + ".png"));
  }
  console.log("Built " + ITEMS.length + " topup item images in " + out);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
