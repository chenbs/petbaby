import "server-only";

import { z } from "zod";

import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

/*
 * 岛上宠物的 2D 立绘（22 号文 2.6 / 5.4 / 第 4 步）。
 *
 * **复用 `ai_runs` 不新开表**：它已有 `candidates` + `selected_id` + `cost` + `provider`，
 * 正是四选一所需，且后台成本账本（`/admin/operations`）已在读那张表。
 * `plugin_id` 填 `island-avatar`，但**不在 `registry.ts` 注册为 live 玩法** ——
 * 它不产出 `works`，注册进去会出现在 `/api/plugins` 的玩法列表里。
 *
 * 与 PL-10（AI 肖像）三处关键差异：
 *
 * 1. **不产出作品。** 选定候选后写 `island_pets.avatar_key`，不建 `works` 行、
 *    不建订单。岛的产出是状态而不是作品（8.2），所以也没有解锁、分享、定价。
 * 2. **必须抠成透明底 PNG。** 立绘要叠在四档光照 × 四档天气之上（2.6），
 *    带背景就是一张贴纸。生图不产出 alpha，所以让模型画品红底再色键抠除
 *    （`island/cutout.ts`）。
 * 3. **独立日额度**，不占 `daily_quotas`（6.3）。理由与 `health_daily_quotas` 同源：
 *    岛的额度用完不该影响做图，反之亦然。
 *
 * **必须图生图**（`/v1/images/edits`）：判据与 PL-10 完全一致 —— 纯文生图只能得到
 * 「某只橘猫」，而用户要的是「我家那只」。参考图由 `processNextAiRun` 从
 * `photo_ids[0]` 取（`loadAiReference`），这条链路已经跑通，本文件只负责建任务与收结果。
 *
 * **岛内实时渲染不叠 AI 标识，只在导出/分享时叠** —— 但存进对象存储的那份**必须带**，
 * 与既有「预览从已打标字节缩」同一口径（导出物一定带标）。所以打标发生在
 * `adoptAvatarCandidate`，不是在导出时才补。
 */

/** 岛专属的 plugin_id。**不在 registry 注册**，见文件头说明 */
export const ISLAND_AVATAR_PLUGIN_ID = "island-avatar";

/** 提示词版本。改提示词必须升版本 —— 成本账本要能区分是哪一版生成的 */
export const ISLAND_AVATAR_PROMPT_VERSION = "island-avatar-v1";

/**
 * 免费额度：**每只宠物 1 次生成 + 2 次重做**（9.4 第 8 项拍板）。
 *
 * 与 PL-10 的 `reroll_count < 2` 同一手法，但计数落在**这只宠物**上而不是这次任务上：
 * 用户可能把第一次的任务丢掉重新提交，按任务计数等于无限重做。
 */
export const FREE_AVATAR_RUNS = 1;
export const FREE_AVATAR_REROLLS = 2;
/** 每只宠物最多能起多少次立绘任务 */
export const MAX_AVATAR_RUNS = FREE_AVATAR_RUNS + FREE_AVATAR_REROLLS;

const createSchema = z.object({
  petId: z.string().uuid(),
  /** 参考照片。**一张就够** —— 图生图只吃第一张，收多张只会让用户以为都用上了 */
  photoId: z.string().uuid(),
});

/**
 * 立绘提示词。
 *
 * 三段结构与 `tools/imagegen/prompts.mjs` 的 `islandPrompt` 同源（风格前缀 →
 * 角色简化规则 → 主体 → 排除项），但**不 import 它**：那是仓库根下的 `.mjs` 工具链，
 * 在 `apps/platform` 的 tsconfig 根之外。两份的风格锚点必须一致 ——
 * 样板宠物摩奇（`pet-sample.png`）是这套提示词的风格靶子，用户的宠物要长成同一画风，
 * 否则引导页示意与实际产物不是一套东西。
 *
 * **角色简化规则在风格前缀之后、主体描述之前**（24 号文 6.3 的实测结论）：
 * 它约束「怎么画」，必须先于「画什么」—— 否则模型已按解剖结构起形，再简化就晚了。
 * 那一轮实测的根因是**造型语言**不是配色：参考图的角色是一整块连续 blob，
 * 而第一轮画出了「一只写实小猫的可爱画法」。
 *
 * **品红底是硬要求**：立绘要抠成透明底（2.6），而当前模型拒绝
 * `background=transparent`。白底不行 —— 会把白猫和白胸兜一起抠掉。
 */
export function buildAvatarPrompt(petName: string, species: string): string {
  const creature = species === "dog" ? "dog" : "cat";
  return [
    // 风格锚点：《猫咪和汤》。描边用暖褐/深蓝灰细线，不是纯黑 —— 纯黑会掉到廉价贴纸观感
    'Official promotional illustration art style of the mobile game "Cats & Soup" (NEOWIZ):',
    "clean thin uniform hand-drawn outlines in dark warm brown or deep slate blue (never pure black),",
    "completely flat cel colouring, rounded chunky simplified shapes,",
    "soft muted pastel palette, storybook sticker illustration feel, cosy calm healing atmosphere.",
    // 角色简化规则。每一句都在修一处实测偏差（24 号文 6.3）
    "The character is drawn in an extremely simplified chibi blob style, exactly like a kawaii sticker mascot:",
    "the head and the body merge into ONE single continuous rounded egg-shaped silhouette,",
    "with no visible neck, no defined shoulders, no haunches and no realistic animal anatomy at all.",
    "The head is very large relative to the body and sits directly on it.",
    "All facial features are tiny and clustered low on the face, leaving a lot of empty flat space:",
    "two small solid dark dot eyes with no highlights and no visible iris or pupil,",
    "a minimal tiny dot nose, one very small simple closed smiling mouth,",
    "and a small soft round blush patch on each cheek.",
    "Limbs are reduced to tiny stubby rounded paws that only just peek out from the bottom edge of the body.",
    "Coat markings are simplified into a few large soft flat patches plus at most a few broad simple stripes.",
    "Colouring is entirely flat.",
    // 主体。保留参考照片里的可识别特征 —— 这是整个玩法的立身之本（判据同 PL-10）
    `Redraw the ${creature} from the reference photo in this style, keeping its recognisable features:`,
    "coat colour, the placement of its markings, body proportions, ear shape and face shape.",
    "Sitting facing the viewer with the body seen straight from the front as one symmetrical rounded blob,",
    "with the face turned only very slightly to the left. Calm, content and cute.",
    "The whole animal is visible from the ear tips down to the paws, with clear empty margin on all four sides.",
    "The face must be clearly visible and readable.",
    // 品红底。透明底拿不到，见函数注释
    "Centred on a completely flat solid pure magenta background (#FF00FF), one single uniform colour",
    "with absolutely no gradient, no vignette, no shadow, no ground plane, no reflection.",
    // 排除项。参考图自带但我们不要的东西
    "no text, no letters, no numbers, no title, no logo, no watermark, no signature,",
    "no thick black outlines, no pixel art, no photorealism, no 3D render,",
    "no drop shadow, no lens flare, no vignette, no film grain,",
    "no UI elements, no health bars, no progress bars, no icons, no speech bubbles,",
    "no human characters, no people, no hands,",
    "no realistic animal anatomy, no visible neck, no defined shoulders or haunches,",
    "no fine detailed fur striping, no gradient shading, no large anime eyes, no eye highlights,",
    "no long whiskers, no sharp claws, no separated paw toes.",
  ].join(" ");
}

/**
 * 提交一次立绘生成。
 *
 * 落 `ai_runs` 后由既有 `processNextAiRun` 处理（Worker 或本地内联），返回 runId
 * 供端上轮询 —— 沿用 `pages/ai-run` 的四选一交互，那套已经跑通。
 *
 * **不占做图额度**（6.3），但**必须进 `assertGenerationCircuit()`** ——
 * 它是 `image-api` 调用，与其他 AI 图共享成本池。熔断在路由层调，
 * 与既有写接口的三行开头保持同一形态。
 */
export async function createAvatarRun(userId: string, input: unknown) {
  const data = createSchema.parse(input);
  const database = await getDatabase();

  const petRows = await database.query(
    "SELECT id,name,species,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [data.petId, userId],
  );
  const pet = petRows[0];
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  /*
   * `memorial` 拦截（4.1 #11）。立绘是入岛的前置步骤，而已离开的宠物不进岛 ——
   * 这里不拦的话用户能生成一张立绘却发现进不去，比一开始就说清楚更糟。
   */
  if (String(pet.life_stage) === "memorial") {
    throw new AppError("ISLAND_UNAVAILABLE_MEMORIAL", "已经离开的宠物有纪念空间陪着，不进小岛", 409);
  }

  const photoRows = await database.query(
    "SELECT id FROM photos WHERE id=$1 AND pet_id=$2 AND user_id=$3 AND deleted_at IS NULL",
    [data.photoId, data.petId, userId],
  );
  if (!photoRows[0]) throw new AppError("ISLAND_PHOTO_MISMATCH", "照片不存在或不属于这只宠物", 422);

  /*
   * 额度按**这只宠物已起过的任务数**算，不按 `reroll_count`（见 FREE_AVATAR_RUNS 说明）。
   * 取消掉的任务不计入：用户取消是因为不想要，罚他一次额度没有道理。
   */
  const usedRows = await database.query<{ count: number }>(
    "SELECT count(*)::int count FROM ai_runs WHERE user_id=$1 AND pet_id=$2 AND plugin_id=$3 AND status <> 'cancelled'",
    [userId, data.petId, ISLAND_AVATAR_PLUGIN_ID],
  );
  const used = Number(usedRows[0]?.count) || 0;
  if (used >= MAX_AVATAR_RUNS) {
    throw new AppError("ISLAND_AVATAR_LIMIT", `${String(pet.name)}的形象已经画过 ${used} 次了，先用现在这版吧`, 429);
  }

  const id = crypto.randomUUID();
  const prompt = buildAvatarPrompt(String(pet.name), String(pet.species));
  /*
   * 幂等键带上「第几次」：同一只宠物的重做是新任务，键不能只由 petId 决定，
   * 否则第二次提交会直接返回第一次的结果。
   */
  const idempotencyKey = `island-avatar:${data.petId}:${used}`;
  const existing = await database.query("SELECT id FROM ai_runs WHERE user_id=$1 AND idempotency_key=$2", [userId, idempotencyKey]);
  if (existing[0]) return { runId: String(existing[0].id), petId: data.petId, attempt: used };

  await database.query(
    "INSERT INTO ai_runs (id,user_id,plugin_id,pet_id,photo_ids,status,prompt,prompt_version,model_version,provider,options,idempotency_key,candidates,cost,available_at,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,'queued',$6,$7,$8,'pending',$9::jsonb,$10,'[]'::jsonb,0,now(),$11)",
    [
      id,
      userId,
      ISLAND_AVATAR_PLUGIN_ID,
      data.petId,
      JSON.stringify([data.photoId]),
      prompt,
      ISLAND_AVATAR_PROMPT_VERSION,
      process.env.LINGSUAN_IMAGE_MODEL || "provider-v1",
      JSON.stringify({ kind: "island-avatar", attempt: used }),
      idempotencyKey,
      new Date(),
    ],
  );
  return { runId: id, petId: data.petId, attempt: used, remaining: MAX_AVATAR_RUNS - used - 1 };
}

/** 立绘任务状态。字段是 `pages/ai-run` 那套交互的最小子集 —— 岛不需要解锁与订单 */
export async function getAvatarRun(userId: string, runId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT id,pet_id,status,candidates,selected_id,error_code,created_at FROM ai_runs WHERE id=$1 AND user_id=$2 AND plugin_id=$3",
    [runId, userId, ISLAND_AVATAR_PLUGIN_ID],
  );
  const row = rows[0];
  if (!row) throw new AppError("ISLAND_AVATAR_RUN_NOT_FOUND", "形象任务不存在", 404);
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  return {
    id: String(row.id),
    petId: String(row.pet_id),
    status: String(row.status),
    /*
     * 只下发 id 与预览地址，**不下发对象键**：键是存储内部结构，
     * 端上拿到也只能通过取字节的路由用，暴露它没有收益。
     */
    candidates: candidates.map((candidate: { id?: string }) => ({
      id: String(candidate.id),
      previewUrl: `/api/island/avatar/${encodeURIComponent(String(row.id))}/candidates/${encodeURIComponent(String(candidate.id))}`,
    })),
    selectedId: row.selected_id ? String(row.selected_id) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

const selectSchema = z.object({ candidateId: z.string().trim().min(1).max(120) });

/**
 * 选定一个候选并入岛。
 *
 * 这里做两件事：
 *
 * 1. 把候选字节另存到岛的键下。**抠图与打标都已在生成时做完**
 *    （`processNextAiRun`：先 `cutoutSprite` 再 `applyAiLabel`，用岛专用的深色底衬），
 *    所以这里不再处理像素 —— 顺序反过来会在图上留一块半透明残影，
 *    见 `growth-service.ts` 那一段注释与 `avatar.test.ts` 的「抠图在打标之前」用例。
 * 2. 写 `island_pets.avatar_key`。宠物还没入岛时**顺带入岛** ——
 *    引导流程是「选宠物 → 生成形象 → 进岛」，到这一步用户已经确认过了。
 *
 * **用户确认后才入岛**（2.6）：所以入岛发生在这里而不是任务成功时。
 */
export async function adoptAvatarCandidate(userId: string, runId: string, input: unknown) {
  const data = selectSchema.parse(input);
  const database = await getDatabase();

  const rows = await database.query(
    "SELECT id,pet_id,status,candidates FROM ai_runs WHERE id=$1 AND user_id=$2 AND plugin_id=$3",
    [runId, userId, ISLAND_AVATAR_PLUGIN_ID],
  );
  const row = rows[0];
  if (!row) throw new AppError("ISLAND_AVATAR_RUN_NOT_FOUND", "形象任务不存在", 404);
  if (String(row.status) !== "succeeded") throw new AppError("ISLAND_AVATAR_NOT_READY", "形象还没画好", 409);

  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const candidate = candidates.find((item: { id?: string }) => String(item.id) === data.candidateId) as
    | { id: string; outputKey?: string; keyed?: boolean; residuePercent?: number }
    | undefined;
  if (!candidate?.outputKey) throw new AppError("ISLAND_AVATAR_CANDIDATE_NOT_FOUND", "这一版形象不存在", 404);

  const source = await objectStorage.get(candidate.outputKey);
  if (!source) throw new AppError("ISLAND_AVATAR_FILE_MISSING", "形象文件不存在，重新画一次试试", 404);

  const petId = String(row.pet_id);
  const petRows = await database.query("SELECT life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [petId, userId]);
  if (!petRows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  // 生成期间用户可能把宠物改成了「已离开」。两处都拦（4.1 #11）
  if (String(petRows[0].life_stage) === "memorial") {
    throw new AppError("ISLAND_UNAVAILABLE_MEMORIAL", "已经离开的宠物有纪念空间陪着，不进小岛", 409);
  }

  /*
   * **候选字节已经是抠好并打过标的**（`processNextAiRun` 在生成时就做完了两步），
   * 所以这里只是另存一份到岛的键下，不再抠也不再打标。
   *
   * 原实现在这里抠图 + 打标，而候选字节那时已被打过一次标 —— 于是链路成了
   * 打标 → 抠图 → 再打标，第一个标识的底衬被色键当前景处理成半透明脏块留在图上
   * （实测残影落在 y≈1330–1377、真标识在 y≈1504–1568，两块不重叠）。
   * 全过程不报错：抠图判据与残留统计都是干净的。修正见 `growth-service.ts` 那一段注释。
   *
   * 另存而不是直接复用 `candidate.outputKey`：`rerollAiRun` 会删掉候选对象，
   * 而 `island_pets.avatar_key` 必须在重做后仍指向一份有效字节。
   */
  const key = `private/${userId}/island/avatar-${petId}-${runId}.png`;
  await objectStorage.put(key, source.body, source.contentType || "image/png");

  // 建岛（幂等）→ 入岛 → 写立绘键。三步都用 ON CONFLICT，重复调用不会出错
  const now = new Date();
  await database.query(
    "INSERT INTO islands (id,user_id,scene_id,version,last_tick_at,created_at) VALUES ($1,$2,'yard-v1',1,$3,$3) ON CONFLICT (user_id) DO NOTHING",
    [crypto.randomUUID(), userId, now],
  );
  const islandRows = await database.query("SELECT id FROM islands WHERE user_id=$1", [userId]);
  const islandId = String(islandRows[0].id);
  await database.query(
    "INSERT INTO island_pets (id,island_id,pet_id,avatar_key,avatar_run_id,intimacy,joined_at) VALUES ($1,$2,$3,$4,$5,0,$6) ON CONFLICT (island_id,pet_id) DO UPDATE SET avatar_key=EXCLUDED.avatar_key,avatar_run_id=EXCLUDED.avatar_run_id",
    [crypto.randomUUID(), islandId, petId, key, runId, now],
  );
  await database.query("UPDATE ai_runs SET selected_id=$3 WHERE id=$1 AND user_id=$2", [runId, userId, data.candidateId]);

  return {
    petId,
    /**
     * 抠图是否成功。false 说明模型没画品红底，端上可提示重画 —— 但不阻断。
     *
     * 取自生成时存进候选里的那两个数（抠图在 `processNextAiRun` 做），
     * 不在这里重算：为拿一个数字把图再抠一遍是白花的 CPU，而且两次结果必须相同，
     * 算两遍反而多一处会漂移的地方。老数据没有这两个键时按 false / 0 给。
     */
    keyed: Boolean(candidate.keyed),
    residuePercent: Number(candidate.residuePercent) || 0,
    /*
     * 站内相对路径。补域名的责任在 `getIslandSnapshot` —— 端上拿到这个返回值只是
     * 「已入岛」的确认，随后会重拉快照，而立绘要经 `downloadFile` 取字节、
     * 必须是绝对地址。两处都补会拼出双域名，所以只在快照那一处补。
     *
     * 逐段编码不整体编码：键是多段路径，整体编码会把 `/` 变成 `%2F`，
     * 而 catch-all 路由按段拆分。
     */
    avatarUrl: `/api/island/avatar-image/${key.split("/").map(encodeURIComponent).join("/")}`,
  };
}

/**
 * 取立绘字节。
 *
 * 不复用 `/api/media`：那条路由的放行条件是「归属当前用户或所属作品已公开」，
 * 而立绘不挂在任何 photo / pet / work 上（岛不产出 `works`），走那里必然 404。
 * 前缀校验是越权兜底 —— 键由服务端拼，但取字节的路径吃 URL 参数。
 */
export async function getAvatarFile(userId: string, key: string) {
  if (!key.startsWith(`private/${userId}/island/`)) throw new AppError("ISLAND_AVATAR_FILE_MISSING", "形象文件不存在", 404);
  const object = await objectStorage.get(key);
  if (!object) throw new AppError("ISLAND_AVATAR_FILE_MISSING", "形象文件不存在", 404);
  return { body: object.body, contentType: object.contentType || "image/png" };
}

/**
 * 取候选预览字节。
 *
 * **从已打标的字节取**：`processNextAiRun` 写的 `previewKey` 是从打标后的字节缩的
 * （既有实现已如此），所以这里直接给它 —— 不要回退到 `outputKey` 的原始字节，
 * 那会让预览没有标识而正式版有，正好搞反。
 */
export async function getAvatarCandidateFile(userId: string, runId: string, candidateId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT candidates FROM ai_runs WHERE id=$1 AND user_id=$2 AND plugin_id=$3",
    [runId, userId, ISLAND_AVATAR_PLUGIN_ID],
  );
  if (!rows[0]) throw new AppError("ISLAND_AVATAR_RUN_NOT_FOUND", "形象任务不存在", 404);
  const candidates = Array.isArray(rows[0].candidates) ? rows[0].candidates : [];
  const candidate = candidates.find((item: { id?: string }) => String(item.id) === candidateId) as
    | { previewKey?: string; outputKey?: string }
    | undefined;
  const key = candidate?.previewKey || candidate?.outputKey;
  if (!key) throw new AppError("ISLAND_AVATAR_CANDIDATE_NOT_FOUND", "这一版形象不存在", 404);
  const object = await objectStorage.get(key);
  if (!object) throw new AppError("ISLAND_AVATAR_FILE_MISSING", "形象文件不存在", 404);
  return { body: object.body, contentType: object.contentType || "image/png" };
}
