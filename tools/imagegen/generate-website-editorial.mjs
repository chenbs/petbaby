import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { edit, generate, loadEnv } from "./client.mjs";
import { websiteEditorialAssets, websiteEditorialPrompt } from "./website-editorial-prompts.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(root, "apps/website/package.json"));
const sharp = require("sharp");
const output = path.join(root, "tools/imagegen/out/website/editorial-v2");
const publicAssets = path.join(root, "apps/website/public/assets");
const selected = process.argv.find((argument) => argument.startsWith("--only="))?.slice(7);
const config = await loadEnv();
await mkdir(output, { recursive: true });
const exists = (filename) => access(filename).then(() => true, () => false);

for (const asset of websiteEditorialAssets.filter((item) => !selected || item.name === selected)) {
  const rawPath = path.join(output, `${asset.name}.png`);
  const metadataPath = path.join(output, `${asset.name}.json`);
  const prompt = websiteEditorialPrompt(asset);
  if (!await exists(rawPath)) {
    console.log(`开始生成 ${asset.name}`);
    const options = { prompt, size: asset.width === asset.height ? "1024x1024" : asset.width > asset.height ? "1536x1024" : "1024x1536", quality: "high", maxRetries: 1 };
    let result;
    if (asset.reference) {
      const referencePath = path.join(output, `${asset.reference}-reference.jpg`);
      await sharp(path.join(output, `${asset.reference}.png`)).resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(referencePath);
      if ((await readFile(referencePath)).length > 1_000_000) throw new Error("参考图超过 1MB");
      result = await edit(config, { ...options, imagePath: referencePath });
    } else {
      result = await generate(config, options);
    }
    await sharp(result.buffer).metadata();
    await writeFile(rawPath, result.buffer);
    await writeFile(metadataPath, JSON.stringify({ provider: "lingsuan", model: config.model, generatedAt: new Date().toISOString(), prompt, reference: asset.reference || null, sha256: createHash("sha256").update(result.buffer).digest("hex") }, null, 2) + "\n");
  }
  const destination = path.join(publicAssets, `${asset.name}.jpg`);
  await sharp(rawPath).resize(asset.width, asset.height, { fit: "cover", position: "attention" }).jpeg({ quality: 90, mozjpeg: true }).toFile(destination);
  for (const width of [160, 320, 640, 960, 1440]) {
    if (width > asset.width) continue;
    await sharp(destination).resize({ width }).webp({ quality: 84 }).toFile(path.join(publicAssets, `${asset.name}-${width}.webp`));
  }
  await copyFile(destination, path.join(output, `${asset.name}.jpg`));
  console.log(`已写入 ${asset.name} (${asset.width}×${asset.height})`);
}
