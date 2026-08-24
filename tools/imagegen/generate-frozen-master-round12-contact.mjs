/** Build the 59/63/64 original-effect-to-candidate review sheet without model calls. */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { expansionJobs, expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RUN_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "remediation-20260820-round12");
const OUTPUT = path.join(RUN_ROOT, "replacement-master-candidates-comparison.png");
const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");
const sequences = new Map([
  ["action-giant-companion", 59],
  ["character-snow-leopard", 63],
  ["character-white-tiger", 64],
]);
const items = [...sequences].map(([templateId, sequence]) => {
  const job = expansionJobs.find((item) => item.templateId === templateId);
  if (!job) throw new Error(`缺少模板 ${templateId}`);
  const spec = expansionOutputSpecs[job.orientation];
  return {
    sequence,
    job,
    candidate: path.join(RUN_ROOT, "master-candidates", `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}.png`),
  };
});

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

const cardWidth = 760;
const imageWidth = 350;
const imageHeight = 620;
const headerHeight = 32;
const labelHeight = 72;
const gap = 20;
const pageHeader = 70;
const cardHeight = headerHeight + imageHeight + labelHeight;
const composites = [];
composites.push({ input: Buffer.from(`<svg width="${cardWidth + gap * 2}" height="${pageHeader}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#101820"/><text x="20" y="29" fill="#fff" font-size="20" font-family="Arial, Microsoft YaHei">59 / 63 / 64 返工母版候选</text><text x="20" y="52" fill="#9fb0bf" font-size="12" font-family="Arial, Microsoft YaHei">左：最原始效果参考图　右：灵算新候选；请求中未使用冻结母版</text></svg>`), left: 0, top: 0 });
for (const [index, item] of items.entries()) {
  const top = pageHeader + gap + index * (cardHeight + gap);
  const [effect, candidate] = await Promise.all([
    sharp(item.job.effectReferencePath).resize(imageWidth, imageHeight, { fit: "contain", background: "#f4f6f7" }).png().toBuffer(),
    sharp(item.candidate).resize(imageWidth, imageHeight, { fit: "contain", background: "#f4f6f7" }).png().toBuffer(),
  ]);
  composites.push({ input: Buffer.from(`<svg width="${cardWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#dfe5e9"/><text x="15" y="21" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei">最原始效果参考图</text><text x="395" y="21" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei">灵算新候选母版</text></svg>`), left: gap, top });
  composites.push({ input: effect, left: gap + 10, top: top + headerHeight });
  composites.push({ input: candidate, left: gap + 400, top: top + headerHeight });
  composites.push({ input: Buffer.from(`<svg width="${cardWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16202a"/><text x="14" y="27" fill="#fff" font-size="17" font-family="Arial, Microsoft YaHei">${item.sequence}. ${escapeXml(item.job.title)}</text><text x="14" y="52" fill="#9fb0bf" font-size="12" font-family="Arial">${escapeXml(item.job.templateId)} · ${escapeXml(item.job.version)} · pending-review</text></svg>`), left: gap, top: top + headerHeight + imageHeight });
}
await mkdir(path.dirname(OUTPUT), { recursive: true });
await sharp({ create: { width: cardWidth + gap * 2, height: pageHeader + gap + items.length * (cardHeight + gap), channels: 4, background: "#e8edf1" } }).composite(composites).png({ compressionLevel: 9 }).toFile(OUTPUT);
console.log(path.relative(ROOT, OUTPUT).replaceAll("\\", "/"));
