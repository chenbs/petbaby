/** Build local approval sheets for the pet-to-human batch. No model calls. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  HUMANIZATION_ROOT,
  humanizationComparisons,
  humanizationIdentities,
  humanizationTemplates,
  ROOT,
} from "./humanization-catalog.mjs";

throw new Error("PET_HUMAN_SCHEME_RETIRED: 旧宠物人化方案已撤回，不再生成审核图");

const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");
const identityById = new Map(humanizationIdentities.map((item) => [item.identityId, item]));
const REVIEW_ROOT = path.join(HUMANIZATION_ROOT, "review");

function relative(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function labelSvg(width, height, title, detail = "", dark = false) {
  const background = dark ? "#18211e" : "#ffffff";
  const foreground = dark ? "#ffffff" : "#17201d";
  const secondary = dark ? "#c9d5d0" : "#58645f";
  return Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/><text x="16" y="30" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="${foreground}">${escapeXml(title)}</text>${detail ? `<text x="16" y="52" font-family="Arial, sans-serif" font-size="14" fill="${secondary}">${escapeXml(detail)}</text>` : ""}</svg>`);
}

async function fit(file, width, height) {
  return sharp(file).resize(width, height, { fit: "contain", background: "#e7ebe8" }).png().toBuffer();
}

async function saveSheet(name, width, height, composites, metadata) {
  const body = await sharp({ create: { width, height, channels: 3, background: "#dfe5e1" } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const file = path.join(REVIEW_ROOT, name);
  await writeFile(file, body);
  return { path: relative(file), width, height, sha256: sha256(body), ...metadata };
}

await mkdir(REVIEW_ROOT, { recursive: true });
const outputs = [];

const detailTile = { width: 520, height: 680 };
const detailLabel = 64;
const detailGap = 24;
const detailMargin = 28;
for (let page = 0; page < 2; page += 1) {
  const items = humanizationTemplates.slice(page * 6, page * 6 + 6);
  const width = detailMargin * 2 + detailTile.width * 3 + detailGap * 2;
  const header = 92;
  const rowHeight = detailLabel + detailTile.height + detailGap;
  const height = header + rowHeight * items.length + detailMargin;
  const composites = [{ input: labelSvg(width, header, `PET-HUMAN APPROVAL ${page + 1}/2`, "MASTER  |  PRIVATE HUMAN IDENTITY  |  TWO-STAGE CANDIDATE", true), left: 0, top: 0 }];
  for (let row = 0; row < items.length; row += 1) {
    const item = items[row];
    const identity = identityById.get(item.identityId);
    const top = header + row * rowHeight;
    const columns = [
      ["MASTER", item.master],
      [`IDENTITY / ${item.identityId}`, identity.card],
      [`CANDIDATE / ${item.templateId}`, item.candidate],
    ];
    for (let column = 0; column < columns.length; column += 1) {
      const left = detailMargin + column * (detailTile.width + detailGap);
      composites.push({ input: labelSvg(detailTile.width, detailLabel, columns[column][0], item.title), left, top });
      composites.push({ input: await fit(columns[column][1], detailTile.width, detailTile.height), left, top: top + detailLabel });
    }
  }
  outputs.push(await saveSheet(`approval-detail-${page + 1}.png`, width, height, composites, { kind: "detailed-approval", page: page + 1 }));
}

const overviewTile = { width: 390, height: 610 };
const overviewLabel = 48;
const overviewGap = 20;
const overviewMargin = 28;
const overviewWidth = overviewMargin * 2 + overviewTile.width * 4 + overviewGap * 3;
const overviewHeader = 92;
const overviewHeight = overviewHeader + 3 * (overviewLabel + overviewTile.height + overviewGap) + overviewMargin;
const overview = [{ input: labelSvg(overviewWidth, overviewHeader, "PET-HUMAN APPROVAL OVERVIEW", "A01-A12 are anonymous two-stage candidates; all remain pending-review.", true), left: 0, top: 0 }];
const blindKey = [];
for (let index = 0; index < humanizationTemplates.length; index += 1) {
  const item = humanizationTemplates[index];
  const code = `A${String(index + 1).padStart(2, "0")}`;
  const column = index % 4;
  const row = Math.floor(index / 4);
  const left = overviewMargin + column * (overviewTile.width + overviewGap);
  const top = overviewHeader + row * (overviewLabel + overviewTile.height + overviewGap);
  overview.push({ input: labelSvg(overviewTile.width, overviewLabel, code), left, top });
  overview.push({ input: await fit(item.candidate, overviewTile.width, overviewTile.height), left, top: top + overviewLabel });
  blindKey.push({ code, templateId: item.templateId, identityId: item.identityId });
}
outputs.push(await saveSheet("approval-overview.png", overviewWidth, overviewHeight, overview, { kind: "anonymous-overview" }));

const comparison = humanizationComparisons[0];
const comparisonTemplate = humanizationTemplates.find((item) => item.templateId === "human-breezy-fence");
const comparisonIdentity = identityById.get(comparisonTemplate.identityId);
const compareTile = { width: 410, height: 650 };
const compareLabel = 55;
const compareMargin = 24;
const compareGap = 20;
const compareHeader = 100;
const compareWidth = compareMargin * 2 + compareTile.width * 4 + compareGap * 3;
const compareHeight = compareHeader + compareLabel + compareTile.height + compareMargin;
const comparisonColumns = [
  ["MASTER", comparisonTemplate.master],
  ["IDENTITY", comparisonIdentity.card],
  ["OPTION A", comparison.direct],
  ["OPTION B", comparison.twoStage],
];
const compareComposites = [{ input: labelSvg(compareWidth, compareHeader, "BLIND PIPELINE COMPARISON", "Which option better preserves both pet-derived identity and the master?", true), left: 0, top: 0 }];
for (let index = 0; index < comparisonColumns.length; index += 1) {
  const left = compareMargin + index * (compareTile.width + compareGap);
  compareComposites.push({ input: labelSvg(compareTile.width, compareLabel, comparisonColumns[index][0]), left, top: compareHeader });
  compareComposites.push({ input: await fit(comparisonColumns[index][1], compareTile.width, compareTile.height), left, top: compareHeader + compareLabel });
}
outputs.push(await saveSheet("blind-pipeline-comparison.png", compareWidth, compareHeight, compareComposites, { kind: "blind-pipeline-comparison" }));

await writeFile(path.join(REVIEW_ROOT, "blind-key.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  overview: blindKey,
  comparison: { optionA: "direct-pet-reference", optionB: "two-stage-human-identity", expectedWinner: "optionB" },
}, null, 2)}\n`, "utf8");

await writeFile(path.join(REVIEW_ROOT, "approval-form.md"), `# 宠物人化首批审批表\n\n> 当前状态：全部 pending-review。请先看 approval-overview.png，再按需打开两张 detail 图核对母版、身份卡和成图。\n\n## 总门禁\n\n- [ ] 第一眼仍是完整、自然、可信的人类\n- [ ] 没有兽耳、兽鼻、毛脸、尾巴或动物器官拼贴\n- [ ] 眼睛、脸宽、鼻口比例、神态和配色能对应身份卡\n- [ ] 构图、姿势、服装、场景、光影和风格没有被重做\n- [ ] 无水印、畸形肢体、额外人物或明显生成瑕疵\n\n## 逐项审批\n\n| 编号 | 模板 | 身份 | 通过 | 需重做 | 备注 |\n| --- | --- | --- | --- | --- | --- |\n${blindKey.map((item) => `| ${item.code} | ${item.templateId} | ${item.identityId} | [ ] | [ ] | |`).join("\n")}\n\n## 链路判断\n\n- [ ] 对照图选择 A\n- [ ] 对照图选择 B\n- [ ] 同意默认采用“两阶段：宠物照 -> 私有人形身份卡 -> 冻结母版”\n\n## 审批结论\n\n- [ ] 12 张全部通过，可以进入冻结与对象存储灌入\n- [ ] 部分通过，仅冻结通过项\n- [ ] 整批不通过，继续调身份翻译或母版保持强度\n`, "utf8");

await writeFile(path.join(REVIEW_ROOT, "manifest.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  generatedBy: "local-sharp-composite",
  modelCall: false,
  outputs,
  files: {
    blindKey: relative(path.join(REVIEW_ROOT, "blind-key.json")),
    approvalForm: relative(path.join(REVIEW_ROOT, "approval-form.md")),
  },
}, null, 2)}\n`, "utf8");

for (const output of outputs) console.log(output.path);
