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
import { fit, pad, hasAlpha } from "./crop.mjs";
import { MODEL_PET, MODEL_PET_SHOTS, SOURCE_PETS, AI_STYLES, AI_PLAYS, PLUGIN_HEROES, WEBSITE_SHOTS, ISLAND_ASSETS, sourcePrompt, stylePrompt, heroPrompt, websitePrompt, islandPrompt } from "./prompts.mjs";

const OUT = path.resolve(import.meta.dirname, "out");
const args = process.argv.slice(2);
const target = args.find((item) => !item.startsWith("--")) || "all";
const force = args.includes("--force");
const concurrency = Math.max(1, Math.min(20, Number((args.find((item) => item.startsWith("--concurrency=")) || "").split("=")[1]) || 1));
/** 每个槽位生几张候选。只 island 分组用（24 号文要求 3–4 张挑一张）。 */
const variants = Number((args.find((item) => item.startsWith("--variants=")) || "").split("=")[1]) || 3;

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

/** 历史对比样板猫的多场景：仅供旧版风格对比兼容，不代表小岛卡通摩奇。 */
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

/**
 * 宠物小岛素材（`24-宠物小岛素材清单.md`）。
 *
 * 与其他分组的三处不同：
 *   ① **一次生 N 张候选而不是 1 张**（`--variants=N`，默认 3）。24 号文第 0 章硬要求 3：
 *      「这套画风的一致性靠挑选保证，不靠反复微调提示词」。产物落 `<key>-1.png` …，
 *      挑中的那张由人**手工改名**成裸名字 —— 不自动选，因为挑哪张是审美判断。
 *   ② **透明底优先直出**（`background: "transparent"`），拿不到 alpha 时回落品红。
 *      判据是**回读产物的 alpha 通道**而不是捕获 4xx —— lingsuan 对该参数
 *      「不报错也不生效」（实测 200 + `alpha=false`），只看异常永远不会回落，
 *      于是立绘拿到不透明底、抠图无从下手，最终变成一张贴纸。
 *      回落发生时打印告警，因为那意味着后续要多一道色键抠图。
 *   ③ 透明素材走 `pad()` 而非 `fit()`：立绘要求全身不裁切（24 号文 2.4 验收标准）。
 *
 * raw 缓存同 plugins/website：单张约 45 秒且计费。但**候选图不进 raw**——
 * 每张候选本就是独立的一次生成，缓存它等于把「多生几张挑」变成「永远是这几张」。
 */
function islandJobs() {
  const dir = path.join(OUT, "island");
  const jobs = [];
  for (const asset of ISLAND_ASSETS) {
    for (let index = 1; index <= variants; index += 1) {
      jobs.push({
        label: `island/${asset.key}-${index}`,
        file: path.join(dir, `${asset.key}-${index}.${asset.transparent ? "png" : "jpg"}`),
        run: async (config) => {
          const size = SIZES[asset.ratio];
          /*
           * **从已定稿的底图派生（图生图）**，不走文生图。
           *
           * 判据是画风一致性：入口卡与进岛后的画面紧挨着看（点卡片即进岛），
           * 而同一句风格提示词两次调用的笔触、描边粗细、色相都会漂移 ——
           * 这批素材的验收判据是人眼比对，靠文字复述风格拿不到「同一个地方」。
           * 从底图派生等于把风格交给参考图而不是提示词。
           *
           * 底图缺失时**直接失败而不是回落文生图**：静默回落会产出一张风格接近但
           * 不同源的卡图，而那种偏差只有把两张并排看才发现 —— 宁可报错。
           */
          if (asset.fromScene) {
            const scene = path.join(dir, "scene-yard.png");
            if (!await exists(scene)) {
              throw new Error(`${asset.key} 需要图生图，但缺少参考底图 ${scene} —— 底图定稿后再跑这一张`);
            }
            /*
             * `inputFidelity: "high"` 要求保住参考图的主体特征。lingsuan 的
             * `gpt-image-2` 接受该参数（`client.mjs` 已记录 packy 会以 400 拒绝），
             * 而这里正是它该用的场合：我们要的就是「同一个院子」。
             */
            const result = await edit(config, {
              imagePath: scene,
              prompt: islandPrompt(asset),
              size,
              quality: "high",
              outputFormat: "png",
              inputFidelity: "high"
            });
            return fit(result.buffer, asset.ratio, { anchor: asset.anchor ?? 0.5 });
          }
          if (asset.transparent) {
            /*
             * 两种失败方式都要接住：
             *   ① 模型以 4xx 拒绝 `background=transparent`（packy 的表现）
             *   ② 返 200 却不给 alpha（lingsuan 的表现，实测 `alpha=false`）
             * ② 才是危险的那个 —— 只 try/catch 的话它静默通过，抠图阶段面对一张
             * 不透明的图无从下手，端上表现是立绘带一块底色方块。
             */
            let transparentBuffer = null;
            try {
              const result = await generate(config, { prompt: islandPrompt(asset), size, quality: "high", outputFormat: "png", background: "transparent" });
              if (await hasAlpha(result.buffer)) transparentBuffer = result.buffer;
              else console.warn(`  [提示] ${asset.key}-${index} 接口接受 background=transparent 但产物无 alpha，回落品红底`);
            } catch (error) {
              if (!error.fatal) throw error;
              console.warn(`  [提示] ${asset.key}-${index} 模型拒绝 background=transparent（${error.message.slice(0, 80)}），回落品红底`);
            }
            if (transparentBuffer) return pad(transparentBuffer, asset.ratio);
            // 回落时才把品红写进提示词：与 transparent 那句互斥，见 islandPrompt
            const result = await generate(config, { prompt: islandPrompt(asset, { magenta: true }), size, quality: "high", outputFormat: "png" });
            /*
             * 品红图**不能走 pad()**：那个函数按 `fit: "contain"` 补透明边，
             * 而这张图的背景是品红实色 —— 补出来的透明边会在后续色键抠图时
             * 与品红区域分属两种「背景」，边缘留下一圈半透明品红。
             * 保持原始画幅交给 upload-island.mjs 抠完再定比例。
             */
            return result.buffer;
          }
          const result = await generate(config, { prompt: islandPrompt(asset), size, quality: "high" });
          return fit(result.buffer, asset.ratio, { anchor: asset.anchor ?? 0.5 });
        }
      });
    }
  }
  return { dir, jobs };
}

const GROUPS = { source: sourceJobs, model: modelJobs, styles: styleJobs, plugins: pluginJobs, website: websiteJobs, island: islandJobs };
// website / island 不进 all：都是专用批次且有计费，要显式点名才跑。
const order = target === "all" ? ["source", "model", "styles", "plugins"] : [target];
if (order.some((name) => !GROUPS[name])) throw new Error(`未知分组 ${target}，可选：source / model / styles / plugins / website / island / all`);

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
