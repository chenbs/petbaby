import { access, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const required = ["SITE_URL", "ICP_RECORD", "LEGAL_OPERATOR", "LEGAL_CONTACT", "LEGAL_ADDRESS", "LEGAL_PROCESSOR_DETAILS", "LEGAL_STORAGE_REGION"];
const problems = required.filter((name) => !process.env[name]?.trim()).map((name) => `${name} 未配置`);
if (process.env.LEGAL_APPROVED !== "true") problems.push("LEGAL_APPROVED 未确认，条款尚未批准生效");
if (process.env.MINIPROGRAM_QR_AVAILABLE !== "true") problems.push("MINIPROGRAM_QR_AVAILABLE 未开启");
try {
  const site = new URL(process.env.SITE_URL || "");
  if (site.protocol !== "https:" || site.hostname !== "www.babykitty.cn") problems.push("SITE_URL 必须为 https://www.babykitty.cn");
} catch { problems.push("SITE_URL 不是有效地址"); }
const assets = path.resolve(import.meta.dirname, "../public/assets");
try {
  const metadata = await sharp(path.join(assets, "miniprogram-qr.png")).metadata();
  if (metadata.format !== "png" || metadata.width < 430 || metadata.width !== metadata.height) problems.push("小程序码须为至少 430×430 的正方形 PNG");
} catch { problems.push("缺少真实小程序码 public/assets/miniprogram-qr.png"); }
for (const name of ["brand-logo.webp", "og-default.png"]) {
  try { await access(path.join(assets, name)); } catch { problems.push(`缺少品牌资源 ${name}`); }
}
if (process.argv.includes("--dist")) {
  for (const name of ["terms", "privacy"]) {
    const html = await readFile(path.resolve(import.meta.dirname, `../dist/legal/${name}/index.html`), "utf8");
    if (/本页尚未正式生效|待运营主体确认/.test(html)) problems.push(`构建产物 ${name} 仍未生效，检查构建环境变量`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("官网发布配置、真实码及品牌资源检查通过；扫码有效性仍须人工验收。");
}
