/**
 * 人宠写真 v2（艺术棚拍重做）16 个镜头目检通过后登记；v1 的 16 个镜头从索引与部署清单里撤下（v1 从未提交或部署）。
 * 登记内容：：冻结母版（WebP q88）+ 独立键公开展示图（WebP q76），
 * 写入 masters/index.json、public-previews/index.json、deploy-assets.tsv，并推本地对象存储。
 * 打印 registry 片段，由人工并入 image-template-registry.ts。重复运行幂等。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { duoShots } from "./duo-photo-catalog.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const sharp = createRequire(path.join(root, "apps/platform/package.json"))("sharp");
const inputDir = path.join(root, "tools/imagegen/out/duo-v2");
const mastersDir = path.join(root, "tools/imagegen/out/reference-v1/masters");
const previewsDir = path.join(root, "tools/imagegen/out/reference-v1/public-previews");
const storageDir = path.join(root, "apps/platform/.data/objects");
const masterIndexFile = path.join(mastersDir, "index.json");
const previewIndexFile = path.join(previewsDir, "index.json");
const deployFile = path.join(root, "tools/imagegen/out/reference-v1/deploy-assets.tsv");
const masterIndex = JSON.parse(await readFile(masterIndexFile, "utf8"));
const previewIndex = JSON.parse(await readFile(previewIndexFile, "utf8"));
if (masterIndex.status !== "approved-frozen-master-set" || previewIndex.status !== "approved-public-preview-set") throw new Error("Sample indices are not ready");
if (duoShots.length !== 16) throw new Error("人宠写真应为 16 个镜头");

const reviewedAt = "2026-10-05";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
async function pushLocal(key, bytes) {
  const file = path.join(storageDir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(file + ".meta", JSON.stringify({ contentType: "image/webp" }));
}

let deploy = await readFile(deployFile, "utf8");
const current = new Set(duoShots.map((shot) => shot.id));
const retired = masterIndex.templates.filter((item) => item.templateId.startsWith("duo-") && !current.has(item.templateId)).map((item) => item.templateId);
masterIndex.templates = masterIndex.templates.filter((item) => !retired.includes(item.templateId));
previewIndex.templates = previewIndex.templates.filter((item) => !retired.includes(item.templateId));
for (const id of retired) deploy = deploy.split("\n").filter((line) => !line.includes(`samples/image-templates/${id}-`) && !line.includes(`samples/image-template-previews/${id}-`)).join("\n");
if (retired.length) console.log(`撤下 v1 镜头 ${retired.length} 个`);
const lines = [];
for (const shot of duoShots) {
  const originalFile = path.join(inputDir, shot.id + ".jpg");
  const original = await readFile(originalFile);
  const reviewFile = path.join(inputDir, shot.id + ".json");
  const review = JSON.parse(await readFile(reviewFile, "utf8"));
  if (review.sha256 !== sha256(original)) throw new Error(`${shot.id}: original changed after review`);
  const master = await sharp(original).resize(720, 1280, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
  const preview = await sharp(master).webp({ quality: 76 }).toBuffer();
  const masterHash = sha256(master);
  const previewHash = sha256(preview);
  const masterFile = path.join(mastersDir, shot.id + "_9x16_v01.webp");
  const previewFile = path.join(previewsDir, shot.id + "_9x16_v01.webp");
  const metadataFile = path.join(mastersDir, "metadata", shot.id + "_9x16_v01.json");
  const masterKey = `samples/image-templates/${shot.id}-${masterHash.slice(0, 12)}.webp`;
  const previewKey = `samples/image-template-previews/${shot.id}-${previewHash.slice(0, 12)}.webp`;
  await mkdir(path.dirname(metadataFile), { recursive: true });
  await writeFile(masterFile, master);
  await writeFile(previewFile, preview);
  await writeFile(metadataFile, JSON.stringify({ templateId: shot.id, groupId: shot.group.id, title: shot.title, size: "720x1280", source: relative(originalFile), sourceSha256: review.sha256, provider: review.provider, model: review.model, prompt: review.prompt, rights: "text-only-generated-generic-adults-and-pets-no-private-identity", visualReview: "pass", reviewedAt }, null, 2) + "\n");
  await writeFile(reviewFile, JSON.stringify({ ...review, review: "approved-local-visual", reviewedAt, master: relative(masterFile), preview: relative(previewFile) }, null, 2) + "\n");
  await pushLocal(masterKey, master);
  await pushLocal(previewKey, preview);
  const masterItem = { templateId: shot.id, title: shot.title, orientation: "portrait", size: "720x1280", path: relative(masterFile), sha256: masterHash, metadata: relative(metadataFile), approvedAt: `${reviewedAt}T00:00:00.000+08:00` };
  const previewItem = { templateId: shot.id, title: shot.title, orientation: "portrait", size: "720x1280", path: relative(previewFile), sha256: previewHash, sampleStorageKey: previewKey, sourceKind: "text-only-original-public-preview", publicVersion: "v01", masterSha256: masterHash };
  const oldMaster = masterIndex.templates.findIndex((item) => item.templateId === shot.id);
  const oldPreview = previewIndex.templates.findIndex((item) => item.templateId === shot.id);
  if (oldMaster >= 0) masterIndex.templates[oldMaster] = masterItem; else masterIndex.templates.push(masterItem);
  if (oldPreview >= 0) previewIndex.templates[oldPreview] = previewItem; else previewIndex.templates.push(previewItem);
  // deploy-assets.tsv：同一模板的旧行先移除，保证重跑后只有一份
  deploy = deploy.split("\n").filter((line) => !line.includes(`samples/image-templates/${shot.id}-`) && !line.includes(`samples/image-template-previews/${shot.id}-`)).join("\n");
  lines.push(`master\t${masterKey}\t${relative(masterFile)}\t${masterHash}`, `preview\t${previewKey}\t${relative(previewFile)}\t${previewHash}`);
  console.log(`  { entryId: "duo", templateId: "${shot.id}", title: "${shot.title}", subjectMode: "owner-pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "${masterKey}", groupId: "${shot.group.id}" },`);
  console.log(`  // preview "${shot.id}": "${previewKey}",`);
}
deploy = deploy.replace(/\n+$/, "") + "\n" + lines.join("\n") + "\n";
await writeFile(deployFile, deploy);
await writeFile(masterIndexFile, JSON.stringify(masterIndex, null, 2) + "\n");
await writeFile(previewIndexFile, JSON.stringify(previewIndex, null, 2) + "\n");
console.log(`已登记 ${duoShots.length} 个人宠写真镜头`);
