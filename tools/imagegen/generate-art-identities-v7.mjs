/**
 * 写真扩到 36 套（2026-10）用的两只新样片宠物身份图：美国短毛猫、三花猫。柯基沿用 out/source/dog-corgi.jpg。
 * 只用于离线生成公开样片，运行时不读取。已存在则跳过（断点续跑）。
 */
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const out = path.resolve(import.meta.dirname, "out/scenes-v7");
const items = {
  shorthair: "A real photograph of one adult American Shorthair cat with a classic silver tabby coat: bold black swirl and bullseye markings on silver, round face, copper-green eyes, sturdy body. The cat sits on a plain light grey floor against a plain light grey wall, soft even daylight, full body visible, looking at camera. Natural fur texture, no props, no collar, no text.",
  calico: "A real photograph of one adult calico cat with distinct white, orange and black patches, white chest and paws, an orange-and-black patched face, green-amber eyes, medium build. The cat sits on a plain light grey floor against a plain light grey wall, soft even daylight, full body visible, looking at camera. Natural fur texture, no props, no collar, no text."
};
const config = await loadEnv();
for (const [id, prompt] of Object.entries(items)) {
  const file = path.join(out, `identity-${id}-v1.jpg`);
  if (await access(file).then(() => true, () => false)) { console.log("已存在", id); continue; }
  const result = await generate(config, { prompt, size: "1024x1024", quality: "high", maxRetries: 2 });
  await writeFile(file, await fit(result.buffer, "card", { anchor: 0.5, quality: 90 }));
  console.log("已生成", id);
}
