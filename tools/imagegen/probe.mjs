/** 接口连通性探针：最低成本验证鉴权、响应结构、图片可解码。跑通后即可删。 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnv, generate } from "./client.mjs";

const config = await loadEnv();
console.log("baseUrl:", config.baseUrl, "model:", config.model, "key:", config.apiKey.slice(0, 6) + "…");

const started = Date.now();
const result = await generate(config, {
  prompt: "A single orange tabby cat sitting on a windowsill, soft afternoon light, photographic, shallow depth of field",
  size: "1024x1024",
  quality: "low"
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const outDir = path.resolve(import.meta.dirname, "out");
await mkdir(outDir, { recursive: true });
const target = path.join(outDir, "probe.png");
await writeFile(target, result.buffer);

const head = result.buffer.subarray(0, 8);
const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
console.log(`耗时 ${elapsed}s · ${(result.buffer.length / 1024).toFixed(0)}KB · PNG 魔数 ${isPng ? "OK" : "不匹配 " + [...head].join(",")}`);
console.log("revised_prompt:", result.revisedPrompt.slice(0, 160) || "(空)");
console.log("落盘:", target);
