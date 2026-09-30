import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const sharp = createRequire(path.join(root, "apps/platform/package.json"))("sharp");
const inputDir = path.join(root, "tools/imagegen/out/together-v1");
const mastersDir = path.join(root, "tools/imagegen/out/reference-v1/masters");
const previewsDir = path.join(root, "tools/imagegen/out/reference-v1/public-previews");
const storageDir = path.join(root, "apps/platform/.data/objects");
const masterIndexFile = path.join(mastersDir, "index.json");
const previewIndexFile = path.join(previewsDir, "index.json");
const masterIndex = JSON.parse(await readFile(masterIndexFile, "utf8"));
const previewIndex = JSON.parse(await readFile(previewIndexFile, "utf8"));
if (masterIndex.status !== "approved-frozen-master-set" || previewIndex.status !== "approved-public-preview-set") throw new Error("Sample indices are not ready");

const jobs = [
  { id: "together-selfie-photobomb", title: "抢镜自拍" },
  { id: "together-sofa-yawn", title: "同步打哈欠" },
  { id: "together-rainy-umbrella", title: "雨天一把伞" },
  { id: "together-window-nap", title: "午后靠着你" }
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
async function pushLocal(key, bytes) {
  const file = path.join(storageDir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(file + ".meta", JSON.stringify({ contentType: "image/webp" }));
}

for (const job of jobs) {
  const originalFile = path.join(inputDir, job.id + ".jpg");
  const original = await readFile(originalFile);
  const reviewFile = path.join(inputDir, job.id + ".json");
  const review = JSON.parse(await readFile(reviewFile, "utf8"));
  if (review.sha256 !== sha256(original)) throw new Error(`${job.id}: original changed after review`);
  const master = await sharp(original).resize(720, 1280, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
  const preview = await sharp(master).webp({ quality: 76 }).toBuffer();
  const masterHash = sha256(master);
  const previewHash = sha256(preview);
  const masterFile = path.join(mastersDir, job.id + "_9x16_v01.webp");
  const previewFile = path.join(previewsDir, job.id + "_9x16_v01.webp");
  const metadataFile = path.join(mastersDir, "metadata", job.id + "_9x16_v01.json");
  const masterKey = `samples/image-templates/${job.id}-${masterHash.slice(0, 12)}.webp`;
  const previewKey = `samples/image-template-previews/${job.id}-${previewHash.slice(0, 12)}.webp`;
  await writeFile(masterFile, master);
  await writeFile(previewFile, preview);
  await writeFile(metadataFile, JSON.stringify({ templateId: job.id, title: job.title, size: "720x1280", source: relative(originalFile), sourceSha256: review.sha256, provider: review.provider, model: review.model, prompt: review.prompt, rights: "text-only-generated-generic-adults-and-pets-no-private-identity", visualReview: "pass", reviewedAt: "2026-09-29" }, null, 2) + "\n");
  await writeFile(reviewFile, JSON.stringify({ ...review, review: "approved-local-visual", reviewedAt: "2026-09-29", master: relative(masterFile), preview: relative(previewFile) }, null, 2) + "\n");
  await pushLocal(masterKey, master);
  await pushLocal(previewKey, preview);
  const masterItem = { templateId: job.id, title: job.title, orientation: "portrait", size: "720x1280", path: relative(masterFile), sha256: masterHash, metadata: relative(metadataFile), approvedAt: "2026-09-29T00:00:00.000+08:00" };
  const previewItem = { templateId: job.id, title: job.title, orientation: "portrait", size: "720x1280", path: relative(previewFile), sha256: previewHash, sampleStorageKey: previewKey, sourceKind: "text-only-original-public-preview", publicVersion: "v01", masterSha256: masterHash };
  const oldMaster = masterIndex.templates.find((item) => item.templateId === job.id);
  const oldPreview = previewIndex.templates.find((item) => item.templateId === job.id);
  if (oldMaster && oldMaster.sha256 !== masterHash) throw new Error(`${job.id}: frozen master changed`);
  if (oldPreview && oldPreview.sha256 !== previewHash && oldPreview.sourceKind !== "text-only-original-public-preview") throw new Error(`${job.id}: unrelated public preview changed`);
  if (!oldMaster) masterIndex.templates.push(masterItem);
  if (oldPreview) previewIndex.templates[previewIndex.templates.indexOf(oldPreview)] = previewItem;
  else previewIndex.templates.push(previewItem);
  console.log(`${job.id}\t${masterKey}\t${previewKey}`);
}

await writeFile(masterIndexFile, JSON.stringify(masterIndex, null, 2) + "\n");
await writeFile(previewIndexFile, JSON.stringify(previewIndex, null, 2) + "\n");
