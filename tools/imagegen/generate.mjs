/**
 * 素材生成编排器。
 *
 * 单张耗时约 45 秒，批量必须能断点续跑：已存在的产物直接跳过，所以中断后重跑无成本。
 * 所有请求最终都进入 client.mjs 的共享队列；默认串行，硬上限为 20。
 *
 * 用法：
 *   node tools/imagegen/generate.mjs source    生成宠物源照片（12 张）
 *   node tools/imagegen/generate.mjs model     生成历史对比样板猫的 8 个场景（兼容旧批次）
 *   node tools/imagegen/generate.mjs styles    生成 4 风格 + 3 玩法对比图（同一主体）
 *   node tools/imagegen/generate.mjs plugins   生成 9 个玩法入口样例图（16:10）
 *   node tools/imagegen/generate.mjs website   生成官网多品种素材（20 张，混比例）
 *   node tools/imagegen/generate.mjs all
 * 加 --force 覆盖已有产物，加 --concurrency=N 调整任务池（最大 20）。
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { loadEnv, generate, edit } from "./client.mjs";
import { fit } from "./crop.mjs";
import { MODEL_PET, MODEL_PET_SHOTS, SOURCE_PETS, AI_STYLES, AI_PLAYS, PLUGIN_HEROES, WEBSITE_SHOTS, sourcePrompt, stylePrompt, heroPrompt, websitePrompt } from "./prompts.mjs";

const OUT = path.resolve(import.meta.dirname, "out");
const args = process.argv.slice(2);
const target = args.find((item) => !item.startsWith("--")) || "all";
const force = args.includes("--force");
const concurrency = Math.max(1, Math.min(20, Number((args.find((item) => item.startsWith("--concurrency=")) || "").split("=")[1]) || 1));

/**
 * 各比例对应的请求 size。
 *
 * 接口对 size 的态度是**只认方形**：实测请求 1024x1024 得到 1024x1024，
 * 但请求 1600x1000 得到 2048x1376 —— 比例接近而尺寸不符。所以仍按目标比例传一份
 * （构图更接近、裁切损失更小），但**比例必须由 crop.mjs 本地强制**，不能省。
 * 取值须满足文档白名单：宽高均为 16 的倍数、长边 ≤3840、比例 ≤3:1。
 */
const SIZES = { cover: "1600x1200", card: "1200x1600", square: "1200x1200", hero: "1600x1000", source: "1200x1600" };

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

/** 固定并发的任务池。单任务失败不拖垮整批，失败清单最后汇总。 */
/**
 * 带原图缓存的 edits 调用。
 *
 * 生图一次约 45 秒且计费，而裁切参数是要反复调的（16:10 的锚点就调错过一次）。
 * 把接口返回的原始 PNG 落盘，重裁时直接读缓存，不再打接口 ——
 * 否则每次微调构图都要重跑整批。删掉 raw/ 目录即可强制重新生成。
 */
async function cachedEdit(config, rawPath, options) {
  if (await exists(rawPath)) return readFile(rawPath);
  const result = await edit(config, options);
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, result.buffer);
  return result.buffer;
}

async function runPool(jobs, worker) {
  const failures = [];
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      try {
        await worker(job);
        done += 1;
        console.log(`  [${done}/${jobs.length}] ${job.label}`);
      } catch (error) {
        failures.push({ label: job.label, message: error.message });
        console.error(`  [失败] ${job.label}: ${error.message}`);
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

/** 源照片：文生图 → 裁成 3:4 竖版（手机随拍的常见比例）。 */
function sourceJobs() {
  const dir = path.join(OUT, "source");
  const jobs = SOURCE_PETS.map((pet) => ({
    label: `source/${pet.key}`,
    file: path.join(dir, `${pet.key}.jpg`),
    run: async (config) => {
      const result = await generate(config, { prompt: sourcePrompt(pet.identity, pet.scene), quality: "high" });
      return fit(result.buffer, "source", { anchor: 0.32 });
    }
  }));
  return { dir, jobs };
}

function modelJobs() {
  const dir = path.join(OUT, "model");
  const jobs = MODEL_PET_SHOTS.map((shot) => ({
    label: `model/${shot.key}`,
    file: path.join(dir, `${shot.key}.jpg`),
    run: async (config) => {
      const result = await generate(config, { prompt: sourcePrompt(MODEL_PET.identity, shot.scene), quality: "high" });
      return fit(result.buffer, "source", { anchor: shot.anchor });
    }
  }));
  return { dir, jobs };
}

/**
 * 风格与玩法对比图：走 edits 端点，输入固定为历史对比样板猫的正脸照。
 * 这是方案 3.3 硬规则的落地 —— 同一主体，风格是唯一变量。
 */
function styleJobs() {
  const dir = path.join(OUT, "styles");
  const base = path.join(OUT, "model", "front.jpg");
  const build = (group, item) => ({
    label: `styles/${group}-${item.id}`,
    file: path.join(dir, `${group}-${item.id}.jpg`),
    needs: base,
    run: async (config) => {
      const result = await edit(config, { imagePath: base, prompt: stylePrompt(item.direction), quality: "high" });
      return fit(result.buffer, "card", { anchor: 0.28 });
    }
  });
  return { dir, jobs: [...AI_STYLES.map((item) => build("style", item)), ...AI_PLAYS.map((item) => build("play", item))] };
}

/**
 * 玩法入口样例图：16:10，同样走 edits 端点锁定同一只主体。
 * 产出交给 upload-samples.mjs 推进对象存储，再写入 PluginManifest.samples.heroUrl。
 */
function pluginJobs() {
  const dir = path.join(OUT, "plugins");
  const base = path.join(OUT, "model", "front.jpg");
  return {
    dir,
    jobs: PLUGIN_HEROES.map((item) => ({
      label: `plugins/${item.id}`,
      file: path.join(dir, `${item.id}.jpg`),
      needs: base,
      run: async (config) => {
        const raw = path.join(dir, "raw", `${item.id}.png`);
        const buffer = await cachedEdit(config, raw, { imagePath: base, prompt: heroPrompt(item.direction), quality: "high" });
        // 锚点按条目给定：平铺类居中、宽景类主体在下半幅，统一取值会把主体裁没
        return fit(buffer, "hero", { anchor: item.anchor });
      }
    }))
  };
}

/**
 * 官网素材：文生图直出，混比例（规格第 10.3 节）。
 *
 * 与其他分组的两处不同：
 *   ① 不依赖 model/front.jpg —— 11 个新品种都没有底图，先生成底图再 edits 会让张数翻倍，
 *      而官网展示位不需要「同一只主体」（并列比较的风格对比带仍复用历史对比样板猫的现成 7 张）。
 *   ② 比例逐条给定而非整组统一 —— 瀑布流要高度参差，等高图会让 CSS columns 退化成规整网格。
 * raw 缓存同 pluginJobs：单张约 45 秒且计费，调锚点不该重新打接口。
 */
function websiteJobs() {
  const dir = path.join(OUT, "website");
  return {
    dir,
    jobs: WEBSITE_SHOTS.map((shot) => ({
      label: `website/${shot.key}`,
      file: path.join(dir, `${shot.key}.jpg`),
      run: async (config) => {
        const raw = path.join(dir, "raw", `${shot.key}.png`);
        let buffer;
        if (await exists(raw)) {
          buffer = await readFile(raw);
        } else {
          const result = await generate(config, { prompt: websitePrompt(shot), size: SIZES[shot.ratio], quality: "high" });
          await mkdir(path.dirname(raw), { recursive: true });
          await writeFile(raw, result.buffer);
          buffer = result.buffer;
        }
        return fit(buffer, shot.ratio, { anchor: shot.anchor });
      }
    }))
  };
}

const GROUPS = { source: sourceJobs, model: modelJobs, styles: styleJobs, plugins: pluginJobs, website: websiteJobs };
// website 不进 all：都是专用批次且有计费，要显式点名才跑。
const order = target === "all" ? ["source", "model", "styles", "plugins"] : [target];
if (order.some((name) => !GROUPS[name])) throw new Error(`未知分组 ${target}，可选：source / model / styles / plugins / website / all`);

const config = await loadEnv();
const allFailures = [];

for (const name of order) {
  const { dir, jobs } = GROUPS[name]();
  await mkdir(dir, { recursive: true });
  const pending = [];
  for (const job of jobs) {
    if (!force && await exists(job.file)) continue;
    if (job.needs && !await exists(job.needs)) throw new Error(`${job.label} 依赖 ${path.relative(OUT, job.needs)}，请先跑 model 分组`);
    pending.push(job);
  }
  console.log(`\n${name}: ${pending.length} 张待生成（共 ${jobs.length}，已有 ${jobs.length - pending.length}）`);
  if (!pending.length) continue;
  const failures = await runPool(pending, async (job) => {
    const buffer = await job.run(config);
    await writeFile(job.file, buffer);
  });
  allFailures.push(...failures);
}

if (allFailures.length) {
  console.error(`\n${allFailures.length} 张失败，重跑本命令即可续传：`);
  for (const item of allFailures) console.error(`  ${item.label}: ${item.message}`);
  process.exit(1);
}
console.log("\n全部完成。");
