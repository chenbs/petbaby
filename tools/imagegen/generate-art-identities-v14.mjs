/**
 * 写真 v14（2026-10-07）新增样片宠物身份图：黑白雪纳瑞、白色雪纳瑞、白色萨摩耶、贵宾泰迪、陨石边牧。
 * 只用于离线生成公开样片，运行时不读取。已存在则跳过（断点续跑）。
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const out = path.resolve(import.meta.dirname, "out/scenes-v14");
const base = "sits on a plain light grey floor against a plain light grey wall, soft even daylight, full body visible, looking at camera with a sweet, bright expression. Natural texture, no props, no collar, no clothing, no text.";
const items = {
  "schnauzer-bw": `A real photograph of one adult black-and-white Miniature Schnauzer: glossy black coat on the head, back and ears, crisp white bushy eyebrows, white beard and moustache, white chest and legs, folded ears, bright dark eyes, neatly groomed. The dog ${base}`,
  "schnauzer-white": `A real photograph of one adult pure white Miniature Schnauzer: soft all-white coat, fluffy white eyebrows, white beard and moustache, folded ears, shiny black nose and dark eyes, neatly groomed. The dog ${base}`,
  samoyed: `A real photograph of one adult white Samoyed: thick fluffy pure white double coat, upright triangular ears, black lips curled into the classic Samoyed smile, dark almond eyes and black nose. The dog ${base}`,
  teddy: `A real photograph of one adult apricot toy poodle in a round teddy-bear cut: soft curly apricot coat, round fluffy face and ears, dark button eyes and black nose, small compact body. The dog ${base}`,
  merle: `A real photograph of one adult blue merle Border Collie: marbled silver-grey and black merle coat with white blaze, white collar ruff and white paws, tan points on the cheeks, semi-erect ears, one light blue eye and one brown eye. The dog ${base}`
};
await mkdir(out, { recursive: true });
const config = await loadEnv();
for (const [id, prompt] of Object.entries(items)) {
  const file = path.join(out, `identity-${id}-v1.jpg`);
  if (await access(file).then(() => true, () => false)) { console.log("已存在", id); continue; }
  const result = await generate(config, { prompt, size: "1024x1024", quality: "high", maxRetries: 3 });
  await writeFile(file, await fit(result.buffer, "card", { anchor: 0.5, quality: 90 }));
  console.log("已生成", id);
}
