/**
 * 把 out/island 里的宠物小岛素材推进对象存储，并打印可粘进 island/assets.ts 的 manifest 片段。
 *
 * 用法：
 *   node tools/imagegen/upload-island.mjs                      推本地存储（.data/objects）
 *   node tools/imagegen/upload-island.mjs --dry-run            只抠图与校验，不落盘（第 0b 步用）
 *   node tools/imagegen/upload-island.mjs --keep               同时把抠好的 PNG 写回 out/island/keyed/
 *   node tools/imagegen/upload-island.mjs --stage <目录>       额外输出对象键布局的副本，供部署机灌卷
 *   LOCAL_STORAGE_DIR=/srv/objects node ... upload-island.mjs  指定存储目录
 *
 * 与 upload-samples.mjs 的三处不同（其余一致：站内相对路径、内容哈希键名、只打印不改代码）：
 *
 * 1. **要抠图**。素材由用户用 AI 生成后提供（22 号文 2.7），而生图不产出 alpha ——
 *    需要透明底的槽位约定用纯品红 `#FF00FF` 打底（24 号文第 0 章），这里做色键抠除。
 *    品红是因为猫狗毛色里不存在这个色相：用白底会把白猫和奶白器物一起抠掉。
 *    **这是这条素材路线唯一的新增工程量，也是 M1 前要先验证的风险点**（第 0b 步）。
 * 2. **按槽位校验尺寸并裁切**。每张图的目标尺寸在 24 号文 7.4 有表，生图工具给的
 *    实际尺寸常与之不符（接口忽略 size 参数是既有踩坑），所以裁切在本地强制。
 * 3. **底图不许有动物这类内容约束验不了**，只能人眼看 —— 脚本会打印提醒，不假装检查过。
 *
 * 键名带内容哈希，换图必须换键：/api/plugin-samples 对这批对象下发 immutable 长缓存。
 * 落在 `samples/island/` 前缀下 —— 那条公开只读路由把前缀锁死在 `samples/`，
 * 另起一个顶层前缀就得再开一条路由，而这批素材的公开性质与玩法样例图完全相同。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hasAlpha } from "./crop.mjs";

// sharp 是 apps/platform 的运行时依赖，本工具复用同一份（同 crop.mjs 的做法）
const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const OUT = path.resolve(import.meta.dirname, "out", "island");
const KEYED_OUT = path.join(OUT, "keyed");
const STORAGE_DIR = process.env.LOCAL_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_STORAGE_DIR)
  : path.resolve(import.meta.dirname, "../../apps/platform/.data/objects");

const DRY_RUN = process.argv.includes("--dry-run");
const KEEP_KEYED = process.argv.includes("--keep");
/**
 * `--stage <目录>`：额外输出一份按对象键布局的副本，供部署机灌卷。见 `push()` 的说明。
 * 与 `--dry-run` 可以并用（只摆文件、不动本机 `.data/objects`）。
 */
const STAGE_DIR = (() => {
  const at = process.argv.indexOf("--stage");
  return at > 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : "";
})();

/**
 * M1 素材清单（24 号文 7.4）。**这张表是尺寸与透明度的单一事实来源**：
 * 文件名写死不带哈希、不带日期（哈希由本脚本追加到对象键上），与 out/plugins、
 * out/styles 的裸名字做法一致。
 *
 * `alpha: true` 的槽位要么已是透明 PNG，要么是品红底待抠。
 * `optional: true` 的缺失只提示不报错 —— 前景虚化层是加分项，工具输不出带 alpha
 * 的图时应当跳过而不是勉强（品红抠图会在羽化边缘留色）。
 */
const ASSETS = [
  /*
   * **底图 2496×3744 而不是 24 号文原写的 1200×1800**（2026-08-06 上调，判据见
   * `docs/product/25-宠物小岛待完成清单.md` A3）。
   *
   * 1200 宽在最苛刻机型上偏软：Pro Max 是 430 CSS 宽 × dpr3 = **1290 物理像素**，
   * 底图按屏宽铺满时密度只有 0.93 < 1，铺满即已轻微模糊。2496 给到 1.93，
   * 且为 M2 的平移缩放留出「放大 1.55× 仍锐利」的余量。
   *
   * 上限来自端上 `assets.js` 的 `MAX_ENTRY_BYTES = 2MB`：**超了不报错**，
   * 只是每次进岛重下，弱网首屏垮掉。2496 实测 q86 约 1.5MB，3200 就贴到 1.86MB。
   * 解码常驻（`drawImage` 的源纹理，与文件大小无关）2496 是 36MB，3200 是 59MB ——
   * 低端安卓的帧预算吃在这里。
   *
   * **必须维持 2:3**：`layout.js` 的 `SCENE_WIDTH/HEIGHT` 只参与比例运算，
   * 绝对值不进结果，所以同比例换尺寸端上一行都不用改；换了比例则要重量三组锚点。
   */
  { name: "scene-yard", ext: "jpg", width: 2496, height: 3744, alpha: false, role: "场景底图" },
  /*
   * 三张物件 1024 而不是 512：`propRect()` 按 `sizeRatio * 底图宽` 定尺寸，
   * 底图上调到 2496 后物件的实际绘制尺寸跟着翻倍，512 会被放大到糊。
   * 物件必须是**正方形**（`propRect` 用同一个 size 作宽高），三张原图正好都是 1:1。
   */
  { name: "prop-grass", ext: "png", width: 1024, height: 1024, alpha: true, role: "可点的草丛（采集）" },
  { name: "prop-bowl", ext: "png", width: 1024, height: 1024, alpha: true, role: "食盆（喂食落点）" },
  { name: "prop-bed", ext: "png", width: 1024, height: 1024, alpha: true, role: "宠物窝" },
  /*
   * **2046×880 而不是 1536×512。** 宽度必须能被 3 整除（端上按 1/3 切开取
   * `spriteIndex` 对应那格），2048 不行：`2048/3 = 682.67`，切片边界落在半像素上，
   * 表现是每格边缘糊一条、或串进隔壁道具一像素。裁掉 2 像素到 2046 即可整除。
   *
   * 高度保留 880 而不是压成正方：原图每格比例 0.776（道具偏高），
   * 按 1536×512（格比 1.0）裁会**切掉道具上下各约 11%** —— 而三个道具都是居中构图、
   * 上下留白本就不多。宁可格子偏高，端上按 `contain` 摆放不会变形。
   */
  { name: "item-set", ext: "png", width: 2046, height: 880, alpha: true, role: "三道具并排，端上按 1/3 切开" },
  { name: "pet-sample", ext: "png", width: 1200, height: 1600, alpha: true, role: "样板宠物摩奇（风格靶子 + 引导示意）" },
  { name: "hero-island", ext: "jpg", width: 1600, height: 1000, alpha: false, role: "岛的入口卡图" },
  { name: "scene-yard-front", ext: "png", width: 2496, height: 3744, alpha: true, optional: true, role: "近景虚化前景层（可选）" },
];

/**
 * 「品红度」= `min(R,B) - G`。取值域 -255…255，纯品红 `#FF00FF` 得 255。
 *
 * **不按 `#FF00FF` 逐像素等值比对，也不用 RGB 欧氏距离**（24 号文 6.1 的实测约束 1）：
 * 实测背景带轻微噪声与渐变，**没有任何一个像素恰好是 `255,0,255`**（实测均值
 * `rgb(252,3,245)`），等值比对会漏掉整片背景。
 *
 * 选这个量而不是距离，是因为它同时是**溢色的度量**：品红的绿通道为 0，所以边缘上
 * 混入品红的像素必然红蓝同高、绿偏低，`min(R,B) - G` 正好量出混了多少。
 * 一个量既做抠除判据又做去溢色强度，两者不会打架。
 */
function magentaness(r, g, b) {
  return Math.min(r, b) - g;
}

/**
 * 抠图的两档阈值，取自 24 号文 6.1 的实测：
 * `>110` 判全透明、`30–110` 给羽化 alpha、`<30` 判前景。
 *
 * 羽化带实测只有约 2200 px（占全图 0.12%）—— **这套画风有细描边**（24 号文第 1 章
 * 已修正风格锚点），闭合轮廓线就是最好的抠图边界，所以带宽窄是预期而非缺陷。
 * 原以为「无描边柔和边缘」是本路线唯一的技术风险，实测反而比有描边更难抠的假设不成立。
 */
const KEY_OPAQUE_BELOW = 30;
const KEY_CLEAR_ABOVE = 110;

/** 去溢色系数，实测 0.8（24 号文 6.1 的实测约束 2） */
const DESPILL_FACTOR = 0.8;

/** 前景内残留品红的占比上限。超了说明抠不干净，叠在绿草地上会看到色环 */
const RESIDUE_LIMIT_PERCENT = 0.1;

/**
 * 算「残留」时的可见性下限。**不能取 `level > 0`。**
 *
 * 品红度是 `min(R,B) - G`，任何略偏冷的中性像素（R≈B≈G+1）都会得到正值，
 * 而那不是品红残留、肉眼也看不出来。取 10 是对齐 24 号文 6.1 的实测口径：
 * 该文报告 505–626 px（占前景 0.07–0.08%），本脚本在 `>10` 时得 590 px / 0.075%，
 * 逐个吻合；取 `>0` 则得 995 px / 0.126%，会把一张已验收通过的图判成超标。
 * 判据的阈值也是口径的一部分，不能各取一套。
 */
const RESIDUE_VISIBLE_LEVEL = 10;

/**
 * 判断是否品红底：按「品红度 > 清除阈值」的像素占比。
 *
 * **不做四角采样**。24 号文 6.1 已把那条判据废止：实测四角必然不一致
 * （`241,14,235` / `242,29,234`，是编码环节在极端像素上的振铃），
 * **按四角严格判定会把可用的图全部退掉**。
 *
 * 阈值取 25%：实测主体占画面 32–43%（6.3），背景因此有 57–68%，
 * 25% 留了足够余量，同时高到不会把「主体自带大片粉色」误判成品红底。
 */
const MAGENTA_COVERAGE_MIN = 0.25;

async function detectMagenta(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let clear = 0;
  let total = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    if (magentaness(data[offset], data[offset + 1], data[offset + 2]) > KEY_CLEAR_ABOVE) clear += 1;
    total += 1;
  }
  const coverage = total ? clear / total : 0;
  return { magenta: coverage >= MAGENTA_COVERAGE_MIN, coverage };
}

/**
 * 品红色键抠除，输出带 alpha 的 raw 像素。
 *
 * 两步：① 按品红度给 alpha（含羽化带）；② 羽化带内**去溢色**（despill）。
 *
 * 第二步不能省（24 号文 6.1 的实测约束 2）：不做的话过渡带残留品红，
 * **叠在绿色草地上是最刺眼的组合** —— 品红与草绿接近互补色，一圈粉边在绿底上
 * 比在任何其他底色上都明显，而岛的画面 60% 以上是绿。
 *
 * 去溢色按 G 通道把溢出的 R/B 拉回，系数 0.8。只减不加，避免改掉主体颜色；
 * 且**只在羽化带内做** —— 全图做会把主体本身的暖色（橘猫的毛是红高蓝低）也削掉。
 *
 * @returns {{ data, info, edgePixels, keyedPixels, residuePercent }}
 */
async function chromaKey(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const width = info.width;
  const height = info.height;
  let keyedPixels = 0;
  let edgePixels = 0;
  /** 透明掩膜，供残留统计排除轮廓线那一圈用。见下方 residuePercent 的说明 */
  const cleared = new Uint8Array(width * height);
  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const level = magentaness(r, g, b);
    if (level > KEY_CLEAR_ABOVE) {
      data[offset + channels - 1] = 0;
      cleared[offset / channels] = 1;
      keyedPixels += 1;
      continue;
    }
    if (level >= KEY_OPAQUE_BELOW) {
      // 羽化带：alpha 随品红度线性下降（越像品红越透）
      const ratio = (level - KEY_OPAQUE_BELOW) / (KEY_CLEAR_ABOVE - KEY_OPAQUE_BELOW);
      data[offset + channels - 1] = Math.round(255 * (1 - ratio));
      edgePixels += 1;
      const spill = Math.round(level * DESPILL_FACTOR);
      data[offset] = Math.max(0, r - spill);
      data[offset + 2] = Math.max(0, b - spill);
      continue;
    }
  }

  /*
   * 残留统计**排除紧贴透明区的一圈**（2026-08-06 修正口径）。
   *
   * 原先算「全部前景里品红度 >10 的占比」，而这套画风有**闭合描边**，
   * 描边与背景之间必然有一圈抗锯齿过渡像素 —— 它们的品红度落在 10–29，
   * 既不够进羽化带（≥30）也高于可见下限（>10），于是全部被记成「残留」。
   *
   * 实测 `pet-sample.png`：858 个残留里 **856 个（99.8%）贴在边缘 3px 内**，
   * 内部只有 2 个、且是 `rgb(205,186,201)` 这类中性灰粉（肉眼不可见）。
   * 排除 1px 一圈后占比从 **0.319% 降到 0.034%**，而产物叠在真实草地色
   * `rgb(176,185,143)` 上目视**无任何粉边**，白胸兜与耳内绒毛完整。
   *
   * **不改 `KEY_OPAQUE_BELOW` 去凑这个数**：那是 24 号文 6.1 实测定的抠除阈值，
   * 降低它会把更多主体像素拉进羽化带并去溢色（实测降到 10 能让残留归零，
   * 但那是把描边像素改成半透明换来的，等于为了指标好看而削主体）。
   * **判据错了就修判据，不要改一个已被实测钉住的阈值。**
   *
   * 半径取 1 而不是 2/3：1px 已足够排除抗锯齿一圈（0.034%），
   * 再放大会开始掩盖真正的边缘溢色 —— 而那正是这条判据要抓的东西。
   */
  const RESIDUE_EDGE_SKIP = 1;
  let foreground = 0;
  let residue = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const level = magentaness(data[offset], data[offset + 1], data[offset + 2]);
    if (level > KEY_CLEAR_ABOVE || level >= KEY_OPAQUE_BELOW) continue;
    const x = index % width;
    const y = (index - x) / width;
    let nearEdge = false;
    for (let dy = -RESIDUE_EDGE_SKIP; dy <= RESIDUE_EDGE_SKIP && !nearEdge; dy += 1) {
      for (let dx = -RESIDUE_EDGE_SKIP; dx <= RESIDUE_EDGE_SKIP; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (cleared[ny * width + nx]) { nearEdge = true; break; }
      }
    }
    if (nearEdge) continue;
    foreground += 1;
    if (level > RESIDUE_VISIBLE_LEVEL) residue += 1;
  }

  return {
    data,
    info,
    edgePixels,
    keyedPixels,
    residuePercent: foreground ? (residue / foreground) * 100 : 0,
  };
}

/*
 * 「图里是否已有有效 alpha」从 `crop.mjs` 导入，不在这里再写一份。
 *
 * 两处判据必须一字不差：这边用它决定「已透明的图不再抠」，`generate.mjs` 用它决定
 * 「接口没给透明底，回落品红」。阈值取 250 而不是 255（PNG 编码在极端像素上有振铃，
 * 与品红四角实测同一现象）—— 两边各写一套的话，会出现「生成侧认为透明所以不画品红、
 * 抠图侧认为不透明所以要抠」这类首尾不接的组合，而两处都不报错。
 * 与 `server/island/cutout.ts` 的 `hasUsableAlpha` 同口径（那份跨 tsconfig 根，只能另写）。
 */

/**
 * 按目标尺寸居中裁切后缩放。
 *
 * 不复用 `crop.mjs` 的 `fit()`：那边的 RATIOS 是 UI 方案 2.5 的四个比例（卡片、
 * hero、封面、方图），岛需要 2:3 与 3:1 —— 往那张表里塞岛专用比例会让「方案 2.5 的
 * 四个比例」这件事不再成立。裁切算法本身照抄它，两处保持一致。
 *
 * **锚点取正中（0.5）而不是 crop.mjs 的上三分之一**：那个偏上锚点是为宠物照片
 * 定的（头部通常在上部），而岛的素材是构图完整的成品图，偏移会切掉底边的地面
 * 或右侧的屋墙。
 *
 * @param {Buffer|{data: Buffer, info: object}} input 原图字节，或 chromaKey 的 raw 结果
 */
async function fitTo(input, spec) {
  const image = input.data && input.info
    ? sharp(input.data, { raw: { width: input.info.width, height: input.info.height, channels: input.info.channels } })
    : sharp(input, { failOn: "error" });
  const meta = await image.metadata();
  const sourceWidth = input.info ? input.info.width : meta.width;
  const sourceHeight = input.info ? input.info.height : meta.height;
  if (!sourceWidth || !sourceHeight) throw new Error("读不到原图尺寸");

  const target = spec.width / spec.height;
  const source = sourceWidth / sourceHeight;
  const cropWidth = source > target ? Math.round(sourceHeight * target) : sourceWidth;
  const cropHeight = source > target ? sourceHeight : Math.round(sourceWidth / target);
  const left = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
  const top = Math.max(0, Math.round((sourceHeight - cropHeight) / 2));

  let pipeline = image
    .extract({ left, top, width: Math.min(cropWidth, sourceWidth - left), height: Math.min(cropHeight, sourceHeight - top) })
    .resize(spec.width, spec.height, { fit: "cover" });
  // 需要 alpha 的一律 PNG：JPEG 没有 alpha 通道，压成 JPEG 等于把抠好的图又填上底色
  pipeline = spec.alpha
    ? pipeline.png({ compressionLevel: 9 })
    : pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 86, mozjpeg: true });
  return pipeline.toBuffer();
}

/**
 * 落盘一张图并返回站内相对路径。键名带内容哈希，换图即换键。
 *
 * `--stage <目录>` 时**同时**往那个目录写一份**按对象键布局**的副本，供部署机灌卷用
 * （`deploy/scripts/seed-samples.sh` 直接整目录 `docker cp`）。
 *
 * 为什么要这一档：岛素材的字节**不在镜像里**（构建上下文是 `apps/platform`，
 * 素材在仓库根的 `tools/imagegen/`），而抠图与裁切只有本工具会做 ——
 * `out/island/` 里躺的是人工投放的原图（品红底、尺寸未裁），直接灌进卷等于
 * 给端上一张带品红背景、比例不对的图；而 `--keep` 写的 `keyed/` 只有需要 alpha
 * 的那几张、且被 `.gitignore` 排除，到不了部署机。
 * 漏灌的表现与玩法样例图一致：接口全部正常，只有取字节时 404，端上大面积裂图且不报错。
 */
async function push(body, name, ext) {
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const key = `samples/island/${name}-${digest}.${ext}`;
  const meta = JSON.stringify({ contentType: ext === "png" ? "image/png" : "image/jpeg" });
  if (STAGE_DIR) {
    const staged = path.join(STAGE_DIR, key);
    await mkdir(path.dirname(staged), { recursive: true });
    await writeFile(staged, body);
    await writeFile(`${staged}.meta`, meta, "utf8");
  }
  if (DRY_RUN) return `/api/plugin-samples/${key}`;
  const target = path.join(STORAGE_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  // .meta 旁文件是 LocalObjectStorage 的约定，缺了它 get() 会连正文一起判为不存在
  await writeFile(target, body);
  await writeFile(`${target}.meta`, meta, "utf8");
  return `/api/plugin-samples/${key}`;
}

/* ---------- 主流程 ---------- */

const present = new Set((await readdir(OUT).catch(() => [])).map(String));
if (!present.size) {
  throw new Error(`${OUT} 下没有文件。素材由人工生成后放入该目录，清单见 docs/product/24-宠物小岛素材清单.md`);
}

const results = [];
const warnings = [];
const missing = [];

for (const spec of ASSETS) {
  // 允许扩展名与清单不符：抠图后一律出 PNG，输入是 jpg 还是 png 不重要
  const file = [`${spec.name}.png`, `${spec.name}.jpg`, `${spec.name}.jpeg`, `${spec.name}.webp`].find((name) => present.has(name));
  if (!file) {
    if (spec.optional) console.log(`跳过 ${spec.name}（${spec.role}，可选，未提供）`);
    else missing.push(`${spec.name}（${spec.role}）`);
    continue;
  }
  const input = await readFile(path.join(OUT, file));
  const meta = await sharp(input).metadata();
  const label = `${spec.name} ← ${file}`;

  // 尺寸只提示不阻断：裁切在本地强制，实际尺寸不符是常态（生图接口忽略 size 参数）
  if (meta.width !== spec.width || meta.height !== spec.height) {
    warnings.push(`${spec.name} 实际 ${meta.width}×${meta.height}，清单要 ${spec.width}×${spec.height} —— 已按目标比例居中裁切`);
  }
  const sourceRatio = meta.width / meta.height;
  const targetRatio = spec.width / spec.height;
  // 比例差超过 12% 时裁切会明显切掉内容，值得单独警告一次
  if (Math.abs(sourceRatio - targetRatio) / targetRatio > 0.12) {
    warnings.push(`${spec.name} 比例 ${sourceRatio.toFixed(2)} 与目标 ${targetRatio.toFixed(2)} 相差较大，裁切会切掉可见内容，建议重生`);
  }

  let payload = input;
  let keyedNote = "不需抠图";
  if (spec.alpha) {
    if (await hasAlpha(input)) {
      keyedNote = "已带 alpha，跳过抠图";
      // 已透明的图仍要走 PNG 分支，不能被 flatten 掉
    } else {
      const detected = await detectMagenta(input);
      if (!detected.magenta) {
        warnings.push(
          `${spec.name} 需要透明底，但既无 alpha、品红覆盖也只有 ${(detected.coverage * 100).toFixed(1)}%`
          + `（需 ≥${MAGENTA_COVERAGE_MIN * 100}%）—— 确认这张是不是按品红底生成的`,
        );
        keyedNote = "未抠图（非品红底）";
      } else {
        const keyed = await chromaKey(input);
        payload = keyed;
        const total = keyed.info.width * keyed.info.height;
        keyedNote = `已抠图，透明 ${(keyed.keyedPixels / total * 100).toFixed(1)}%、羽化边 ${keyed.edgePixels}px、前景残留品红 ${keyed.residuePercent.toFixed(3)}%`;
        /*
         * 这条是 24 号文 6.1 定的正式判据（替代已废止的四角纯度检查）：
         * 前景内残留品红占比 <0.1%。超了就是抠不干净，叠在绿草地上会看到色环 ——
         * 而「叠底色目视无色环」那半条判据只有人眼能给，所以脚本只管这半条。
         */
        if (keyed.residuePercent > RESIDUE_LIMIT_PERCENT) {
          warnings.push(
            `${spec.name} 前景残留品红 ${keyed.residuePercent.toFixed(3)}% 超过 ${RESIDUE_LIMIT_PERCENT}% ——`
            + " 叠在绿草地上大概率能看到色环（品红与草绿接近互补），建议重生这张",
          );
        }
      }
    }
  }

  const body = await fitTo(payload, spec);
  if (KEEP_KEYED && spec.alpha) {
    await mkdir(KEYED_OUT, { recursive: true });
    await writeFile(path.join(KEYED_OUT, `${spec.name}.png`), body);
  }
  const url = await push(body, spec.name, spec.alpha ? "png" : spec.ext);
  results.push({ name: spec.name, url, bytes: body.length, note: keyedNote, label });
  console.log(`${DRY_RUN ? "已处理" : "已推送"} ${label}（${(body.length / 1024).toFixed(0)}KB，${keyedNote}）`);
}

/* ---------- 报告 ---------- */

const totalBytes = results.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(`\n共 ${results.length} 张，合计 ${(totalBytes / 1024 / 1024).toFixed(2)}MB${DRY_RUN ? "（dry-run，未落盘）" : `，落盘于 ${STORAGE_DIR}`}`);

/*
 * 体积判据的**真源是端上 `island/scene/assets.js` 的两个常量**，不是文档里的估值：
 *   `MAX_ENTRY_BYTES = 2MB`  单条上限。超了**不报错**，只是不进缓存、每次进岛重下 —— 弱网首屏垮掉
 *   `BUDGET_BYTES    = 8MB`  LRU 总预算。超了会开始互相淘汰，表现是「素材反复重新加载」
 *
 * 原先只有一条「合计 >5MB」的告警（那是 22 号文 5.3 的文档期估值，比代码严）。
 * 底图上调到 2496 后合计 5.88MB —— 按旧判据报警，但**对照代码其实是安全的**。
 * 两个判据分开报：单条超限是硬故障，总量偏高只是余量薄。
 *
 * **不要用 `palette: true` 或 `effort: 10` 去压 PNG。** 两者都会做调色板量化：
 * 实测立绘的 alpha 层级从 81 级掉到 23/10/8 级（`effort:10` 最大色差 113），
 * 而那正好毁掉抠图羽化的过渡带 —— 边缘会变硬，出现「贴纸感」。
 * 抠图这条链路存在的全部意义就是那圈羽化，不能为了体积把它压掉。
 */
const ENTRY_LIMIT_BYTES = 2 * 1024 * 1024;
const CACHE_BUDGET_BYTES = 8 * 1024 * 1024;
for (const entry of results) {
  if (entry.bytes > ENTRY_LIMIT_BYTES) {
    warnings.push(
      `${entry.name} 单张 ${(entry.bytes / 1024 / 1024).toFixed(2)}MB 超过端上单条缓存上限 2MB`
      + " —— 那张图不会进本地缓存，每次进岛都要重下（不报错，弱网下表现为首屏很久出不来）",
    );
  }
}
if (totalBytes > CACHE_BUDGET_BYTES) {
  warnings.push(`素材合计 ${(totalBytes / 1024 / 1024).toFixed(2)}MB 超过端上 LRU 总预算 8MB —— 会开始互相淘汰，表现是素材反复重新加载`);
} else if (totalBytes > CACHE_BUDGET_BYTES * 0.85) {
  warnings.push(`素材合计 ${(totalBytes / 1024 / 1024).toFixed(2)}MB，已用掉 LRU 预算（8MB）的 ${(100 * totalBytes / CACHE_BUDGET_BYTES).toFixed(0)}% —— 还能跑，但再加素材前要先量`);
}

if (missing.length) {
  console.log(`\n缺少 ${missing.length} 张必需素材：`);
  for (const item of missing) console.log(`  - ${item}`);
  // **缺素材时留空，不画占位色块**（既有约定）：LocalImageProvider 的纯色 SVG
  // 正是方案点名的抽象色块违例，挂上去比留空更糟。所以这里只报告，不生成兜底图。
  console.log("  缺的槽位在 assets.ts 里留空，端上按「无素材」分支走纯色底 —— 不要用占位色块顶替。");
}

if (warnings.length) {
  console.log(`\n${warnings.length} 条提示：`);
  for (const item of warnings) console.log(`  ! ${item}`);
}

if (results.length) {
  /*
   * 粘贴目标是 `server/island/assets.ts` 的 `ISLAND_ASSET_PATHS`（`Partial<Record<…>>`），
   * **不是** `plugins/island/assets.ts` 的 `ISLAND_ASSETS` —— 后者不存在。
   * 照错的路径与变量名做会新建一个没有任何读取方的文件：`islandAssetUrls()` 仍从
   * 原处读空清单，端上继续走「素材未就绪」路径，而人以为素材已经接上了。
   */
  console.log("\n把下面这段替换掉 apps/platform/src/server/island/assets.ts 里的 ISLAND_ASSET_PATHS");
  console.log("（键名带内容哈希，换图必须换键；老库回填时逐键合并，只补缺的键）：\n");
  console.log("const ISLAND_ASSET_PATHS: Partial<Record<IslandAssetSlot, string>> = {");
  for (const entry of results) console.log(`  "${entry.name}": "${entry.url}",`);
  console.log("};\n");
}

console.log("出口按 PUBLIC_APP_URL 补域名再下发 —— 小程序 <image src> 遇到以 / 开头的值会当主包内");
console.log("本地文件找，必然裂图。素材 URL 一律由服务端下发，端上不硬编码。");
console.log("\n还需人眼确认的（脚本验不了，24 号文第 6 章）：");
console.log("  - scene-yard 里没有任何动物、没有食盆/窝/玩具，中左侧有干净空草地");
console.log("  - scene-yard 屋墙下有屋檐或门廊（雨档宠物躲雨的落点，缺了站位无处可去）");
console.log("  - pet-sample 的白胸兜与耳朵绒毛抠完无残留色环 —— 这是本路线唯一的技术风险点");
console.log("  - 立绘叠在四档光照 × 四档天气下都不脏（尤其夜档：蓝紫压上去后橘猫会偏灰）");
if (!DRY_RUN) console.log("\n部署到测试机/生产时素材不在镜像里，需由部署脚本灌进 object-data 卷（同 seed-samples.sh）。");
