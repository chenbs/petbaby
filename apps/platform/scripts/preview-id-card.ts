/*
 * 本地预览宠物证件模板（id-card-v1）：node --conditions=react-server --import tsx scripts/preview-id-card.ts <照片> <输出目录>
 * 输出单证（四种）与全套证件的 PNG，便于改版式时人眼核对。不连数据库、不走 Worker。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { generateIdCard } from "../src/server/generators/svg";
import type { GeneratorInput } from "../src/server/generators/types";

async function main() {
  const [photoPath, outDir] = process.argv.slice(2);
  if (!photoPath || !outDir) throw new Error("用法：preview-id-card.ts <照片> <输出目录>");
  const body = new Uint8Array(await readFile(photoPath));
  await mkdir(outDir, { recursive: true });
  for (const documentType of ["identity", "passport", "household", "vaccine", "bundle"]) {
    const input = {
      task: { id: "preview", options: { documentType } },
      pet: { id: "a1b2c3d4-0000-4000-8000-000000000000", name: "年糕", species: "cat", gender: "female", birthday: "2024-03-08", dateType: "birthday", lifeStage: "active" },
      photos: [{ metadata: {}, object: { body, contentType: "image/jpeg" } }],
      plugin: { id: "pet-id-card" },
    } as unknown as GeneratorInput;
    const output = await generateIdCard(input);
    const png = await sharp(Buffer.from(output.files[0].body)).png().toBuffer();
    await writeFile(path.join(outDir, `id-card-${documentType}.png`), png);
  }
  process.stdout.write(`written to ${outDir}\n`);
}

main().catch((error) => { process.stderr.write(String(error?.stack || error) + "\n"); process.exit(1); });
