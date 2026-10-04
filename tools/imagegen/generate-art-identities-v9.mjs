/**
 * 时尚杂志风 5 套（2026-10，v9）用的样片宠物身份图：无毛猫、阿富汗猎犬、意大利灵缇、金吉拉波斯猫、暹罗猫。
 * 只用于离线生成公开样片，运行时不读取。已存在则跳过（断点续跑）。
 */
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const out = path.resolve(import.meta.dirname, "out/scenes-v9");
const base = "sits on a plain light grey floor against a plain light grey wall, soft even daylight, full body visible, looking at camera. Natural texture, no props, no collar, no text.";
const items = {
  sphynx: `A real photograph of one adult Sphynx cat: hairless warm pinkish-beige skin with soft natural wrinkles, large ears, lemon-green eyes, elegant lean body. The cat ${base}`,
  afghan: `A real photograph of one adult Afghan Hound with a long, silky, well-groomed cream-and-golden coat, a darker muzzle, long narrow head and dark eyes. The dog ${base}`,
  greyhound: `A real photograph of one adult Italian Greyhound with a short sleek blue-grey coat, a small white chest patch, slender long legs, folded rose ears and dark eyes. The dog ${base}`,
  persian: `A real photograph of one adult Chinchilla Persian cat with long silver-tipped white fur, a flat sweet face, green eyes rimmed in black and a full plumed tail. The cat ${base}`,
  siamese: `A real photograph of one adult seal-point Siamese cat with a cream body, dark seal-brown face mask, ears, paws and tail, vivid sapphire-blue almond eyes and a slender elegant body. The cat ${base}`
};
const config = await loadEnv();
for (const [id, prompt] of Object.entries(items)) {
  const file = path.join(out, `identity-${id}-v1.jpg`);
  if (await access(file).then(() => true, () => false)) { console.log("已存在", id); continue; }
  const result = await generate(config, { prompt, size: "1024x1024", quality: "high", maxRetries: 3 });
  await writeFile(file, await fit(result.buffer, "card", { anchor: 0.5, quality: 90 }));
  console.log("已生成", id);
}
