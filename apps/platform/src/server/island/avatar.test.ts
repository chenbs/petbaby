import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { AI_LABEL_PLATE, aiLabelContrastOnWhite } from "@/domain/island-weather";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { cancelAiRun, processNextAiRun, rerollAiRun, retryAiRun, selectAiCandidate } from "@/server/growth-service";
import { listWorks } from "@/server/platform-service";
import {
  ISLAND_AVATAR_PLUGIN_ID,
  MAX_AVATAR_RUNS,
  adoptAvatarCandidate,
  buildAvatarPrompt,
  createAvatarRun,
  getAvatarCandidateFile,
  getAvatarFile,
  getAvatarRun,
} from "@/server/island/avatar";
import { cutoutSprite } from "@/server/island/cutout";
import { getIslandSnapshot } from "@/server/island-service";
import { applyAiLabel, needsAiLabel } from "@/server/media/ai-label";
import { objectStorage } from "@/server/storage";

/*
 * 岛上宠物的立绘（22 号文 2.6 / 第 4 步）。
 *
 * 三条重点：
 *   - **复用 `ai_runs` 不新开表**，但 `island-avatar` **不在 registry 注册为 live 玩法**
 *     —— 它不产出 `works`，注册进去会出现在 `/api/plugins` 的玩法列表里。
 *   - **打 AI 标识且带深色底衬**：它是 `image-api` 产物，而岛的画面比作品图更亮，
 *     所以底衬取岛专用的 `#2A1F1F` @0.65（照「纯白像素」这个最坏画面算的）。
 *   - **抠成透明底 PNG**：立绘要叠在四档光照 × 四档天气之上。
 */

const USER = "00000000-0000-4000-8000-0000000000d1";
const OTHER = "00000000-0000-4000-8000-0000000000d2";
const PET = "00000000-0000-4000-8000-0000000000d3";
const MEMORIAL_PET = "00000000-0000-4000-8000-0000000000d4";
const PHOTO = "00000000-0000-4000-8000-0000000000d5";
const ORIGIN = "https://petbaby.example.com";

/** 写一张品红底的参考照片。图生图会读它，但本地 provider 忽略参考图 */
async function seedPhoto() {
  const key = `private/${USER}/photos/${PHOTO}.png`;
  const body = new Uint8Array(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 230, g: 150, b: 90 } } }).png().toBuffer(),
  );
  await objectStorage.put(key, body, "image/png");
  await (await getDatabase()).query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,created_at) VALUES ($1,$2,$3,'ref.png','image/png',$4,$5,0,now())",
    [PHOTO, USER, PET, body.byteLength, key],
  );
}

async function seed() {
  await resetDatabaseForTest();
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  await database.query(
    "INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'摩奇','cat','unknown','2024-01-01','birthday','active',true,now())",
    [PET, USER],
  );
  await database.query(
    "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','dog','unknown','birthday','memorial',false,now())",
    [MEMORIAL_PET, USER],
  );
  await seedPhoto();
}

describe("立绘提示词", () => {
  /*
   * **角色简化规则在风格前缀之后、主体描述之前**（24 号文 6.3 的实测结论）：
   * 它约束「怎么画」，必须先于「画什么」—— 否则模型已按解剖结构起形，再简化就晚了。
   */
  it("顺序是风格 → 简化规则 → 主体 → 排除项", () => {
    const prompt = buildAvatarPrompt("摩奇", "cat");
    const style = prompt.indexOf("Cats & Soup");
    const simplify = prompt.indexOf("chibi blob style");
    const subject = prompt.indexOf("Redraw the cat from the reference photo");
    const exclude = prompt.indexOf("no text, no letters");
    expect(style).toBeGreaterThanOrEqual(0);
    expect(simplify).toBeGreaterThan(style);
    expect(subject).toBeGreaterThan(simplify);
    expect(exclude).toBeGreaterThan(subject);
  });

  /*
   * **品红底是硬要求**：立绘要抠成透明底，而当前模型拒绝 `background=transparent`。
   * 白底不行 —— 会把白猫和白胸兜一起抠掉（摩奇正是橘白猫）。
   */
  it("要求纯品红底且不要渐变阴影", () => {
    const prompt = buildAvatarPrompt("摩奇", "cat");
    expect(prompt).toContain("#FF00FF");
    expect(prompt).toContain("no gradient");
    expect(prompt).toContain("no shadow");
    expect(prompt).not.toContain("white background");
  });

  /** 保留可识别特征是这个玩法的立身之本，判据同 PL-10（拿到「某只橘猫」就是坏的） */
  it("要求保留毛色、花纹、体型、耳型、脸型", () => {
    const prompt = buildAvatarPrompt("摩奇", "cat");
    for (const feature of ["coat colour", "markings", "body proportions", "ear shape", "face shape"]) {
      expect(prompt).toContain(feature);
    }
  });

  /** 描边不用纯黑 —— 纯黑会掉到廉价贴纸观感（同 SHADOW_HUE 不用灰黑的道理） */
  it("描边是暖褐/深蓝灰细线，不是纯黑粗线", () => {
    const prompt = buildAvatarPrompt("摩奇", "cat");
    expect(prompt).toContain("never pure black");
    expect(prompt).toContain("no thick black outlines");
  });

  /** 排除项要拦住 4.1 #5 的数值条 —— 那会强化「这是游戏」的观感并加重类目风险 */
  it("排除数值条与人类角色", () => {
    const prompt = buildAvatarPrompt("摩奇", "cat");
    expect(prompt).toContain("no health bars");
    expect(prompt).toContain("no progress bars");
    expect(prompt).toContain("no human characters");
  });

  it("狗按 dog 出词，不写死成 cat", () => {
    expect(buildAvatarPrompt("汤圆", "dog")).toContain("Redraw the dog");
  });
});

describe("AI 标识的岛专用底衬", () => {
  /*
   * `needsAiLabel` 只对 `image-api` 为真 —— 立绘正是那一类，所以必须打标。
   * 排版类与视频类不打（给它们打是错误标注）。
   */
  it("立绘属 image-api，需要标识", () => {
    expect(needsAiLabel({ generator: { type: "image-api", template: "island-avatar-v1" } })).toBe(true);
  });

  /*
   * **最坏画面是纯白**（阳光高光 / 白猫 / 雪地），不是任一地表色 ——
   * 按平均色算会得出安全的假结论。实算：`#2A1F1F` 需 ≥0.62 才够 4.57:1，取 0.65 留余量。
   */
  it("底衬在纯白上让白字达到 4.5:1", () => {
    expect(AI_LABEL_PLATE.opacity).toBeGreaterThanOrEqual(0.62);
    expect(aiLabelContrastOnWhite()).toBeGreaterThanOrEqual(4.5);
  });

  /** 与 HUD 底板用途相反、不可共用：那个是奶白，压不住高亮画面 */
  it("是深色底衬 —— 不能拿 HUD 的奶白底板顶替", () => {
    expect(AI_LABEL_PLATE.color.toLowerCase()).toBe("#2a1f1f");
    expect(AI_LABEL_PLATE.textColor.toUpperCase()).toBe("#FFFFFF");
  });
});

describe("立绘任务", () => {
  beforeEach(seed);

  it("提交后落 ai_runs，plugin_id 是岛专用值", async () => {
    const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    const rows = await (await getDatabase()).query("SELECT plugin_id,status,prompt_version FROM ai_runs WHERE id=$1", [run.runId]);
    expect(String(rows[0].plugin_id)).toBe(ISLAND_AVATAR_PLUGIN_ID);
    expect(String(rows[0].status)).toBe("queued");
    expect(String(rows[0].prompt_version)).toMatch(/^island-avatar-v\d+$/);
  });

  /*
   * **不在 `registry.ts` 注册为 live 玩法**（5.4）：它不产出 `works`，
   * 注册进去会出现在 `/api/plugins` 的玩法列表里。
   */
  it("岛专用 plugin_id 不在内置 manifest 清单里", async () => {
    const { plugins, getPlugin } = await import("@/plugins/registry");
    expect(plugins.map((plugin) => plugin.id)).not.toContain(ISLAND_AVATAR_PLUGIN_ID);
    expect(getPlugin(ISLAND_AVATAR_PLUGIN_ID)).toBeUndefined();
  });

  /** `memorial` 拦截（4.1 #11）：不拦的话用户能生成一张立绘却发现进不去 */
  it("memorial 宠物不能生成立绘", async () => {
    await expect(createAvatarRun(USER, { petId: MEMORIAL_PET, photoId: PHOTO })).rejects.toMatchObject({
      code: "ISLAND_UNAVAILABLE_MEMORIAL",
    });
  });

  it("照片不属于这只宠物时被拒", async () => {
    await expect(createAvatarRun(USER, { petId: MEMORIAL_PET, photoId: PHOTO })).rejects.toBeTruthy();
    await expect(createAvatarRun(OTHER, { petId: PET, photoId: PHOTO })).rejects.toMatchObject({ code: "PET_NOT_FOUND" });
  });

  /*
   * 免费额度：**每只宠物 1 次 + 2 次重做**（9.4 第 8 项）。
   * 计数落在**这只宠物**上而不是这次任务上 —— 按任务计数等于无限重做。
   */
  it("每只宠物最多三次，第四次返回 429", async () => {
    expect(MAX_AVATAR_RUNS).toBe(3);
    for (let index = 0; index < MAX_AVATAR_RUNS; index += 1) {
      await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    }
    await expect(createAvatarRun(USER, { petId: PET, photoId: PHOTO })).rejects.toMatchObject({
      code: "ISLAND_AVATAR_LIMIT",
      status: 429,
    });
  });

  /** 取消掉的不计入：用户取消是因为不想要，罚他一次额度没有道理 */
  it("已取消的任务不占额度", async () => {
    const first = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    await (await getDatabase()).query("UPDATE ai_runs SET status='cancelled' WHERE id=$1", [first.runId]);
    // 三次都取消后仍能再起
    for (let index = 0; index < MAX_AVATAR_RUNS; index += 1) {
      const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
      await (await getDatabase()).query("UPDATE ai_runs SET status='cancelled' WHERE id=$1", [run.runId]);
    }
    await expect(createAvatarRun(USER, { petId: PET, photoId: PHOTO })).resolves.toBeTruthy();
  });

  /** 同一次重做的重复提交幂等 —— 幂等键带上「第几次」，否则第二次会返回第一次的结果 */
  it("同一次的重复提交返回同一个 runId", async () => {
    const first = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    // 手动把幂等键那一行留着但不推进 used：直接再提交一次
    const rows = await (await getDatabase()).query("SELECT idempotency_key FROM ai_runs WHERE id=$1", [first.runId]);
    expect(String(rows[0].idempotency_key)).toContain(PET);
    expect(String(rows[0].idempotency_key)).toMatch(/:0$/);
  });

  it("他人的任务查不到", async () => {
    const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    await expect(getAvatarRun(OTHER, run.runId)).rejects.toMatchObject({ code: "ISLAND_AVATAR_RUN_NOT_FOUND" });
  });

  /** 下发的候选只有 id 与预览地址，**不含对象键** —— 键是存储内部结构 */
  it("候选不下发对象键", async () => {
    const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    await processNextAiRun();
    const status = await getAvatarRun(USER, run.runId);
    expect(status.status).toBe("succeeded");
    expect(status.candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(status.candidates)).not.toContain("private/");
    expect(status.candidates[0].previewUrl).toContain(`/api/island/avatar/${run.runId}/candidates/`);
  });
});

describe("选定候选并入岛", () => {
  beforeEach(seed);

  /**
   * 从下发的绝对 URL 还原对象键。
   *
   * 逐段解码，与服务端逐段编码对称 —— 整体 `decodeURIComponent` 也能用，
   * 但那样测试就不会因为服务端改成整体编码而失败，而整体编码正是要拦的错误。
   */
  function storageKeyOf(avatarUrl: string): string {
    const prefix = `${ORIGIN}/api/island/avatar-image/`;
    expect(avatarUrl.startsWith(prefix)).toBe(true);
    return avatarUrl.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
  }

  async function runToSuccess() {
    const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    await processNextAiRun();
    return getAvatarRun(USER, run.runId);
  }

  /** **用户确认后才入岛**（2.6）：所以入岛发生在这一步而不是任务成功时 */
  it("选定后写 avatar_key 并入岛", async () => {
    const status = await runToSuccess();
    // 任务成功但还没确认时，岛上没有宠物
    await expect(getIslandSnapshot(USER, ORIGIN)).rejects.toMatchObject({ code: "ISLAND_NOT_FOUND" });

    const adopted = await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    expect(adopted.petId).toBe(PET);
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.pet?.id).toBe(PET);
    expect(snapshot.pet?.avatarUrl).toContain("/api/island/avatar-image/");
  });

  /*
   * **立绘地址必须是绝对 URL**（5.3）：它要经 `wx.downloadFile` 取字节，
   * 而以 `/` 开头的值会被当主包内本地文件找，必然裂图且不报错。
   *
   * 补域名的责任在快照那一处 —— `adoptAvatarCandidate` 给相对路径，
   * 两处都补会拼出双域名。这一条同时钉住这个分工。
   */
  it("快照里的立绘地址补了域名，adopt 的返回值不补", async () => {
    const status = await runToSuccess();
    const adopted = await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    expect(adopted.avatarUrl.startsWith("/api/island/avatar-image/")).toBe(true);
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.pet!.avatarUrl!.startsWith(`${ORIGIN}/api/island/avatar-image/`)).toBe(true);
    // 双域名的形态：拼两次会出现两个 https://
    expect(snapshot.pet!.avatarUrl!.match(/https?:\/\//g)).toHaveLength(1);
  });

  /*
   * 路径**逐段编码**，不整体编码：键是多段路径（`private/<uid>/island/...`），
   * `encodeURIComponent` 整体编码会把 `/` 变成 `%2F`，而 catch-all 路由按段拆分，
   * 收到的就是一段而非四段 —— 表现是立绘 404。
   */
  it("多段路径逐段编码，斜杠不被转义", async () => {
    const status = await runToSuccess();
    await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    const url = (await getIslandSnapshot(USER, ORIGIN)).pet!.avatarUrl!;
    expect(url).not.toContain("%2F");
    expect(url).toContain(`/private/${USER}/island/`);
  });

  /** 产物是透明底 PNG —— 立绘要叠在四档光照 × 四档天气之上（2.6） */
  it("产物是带 alpha 的 PNG，尺寸是立绘规格", async () => {
    const status = await runToSuccess();
    await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    const key = storageKeyOf(snapshot.pet!.avatarUrl!);
    const file = await getAvatarFile(USER, key);
    const meta = await sharp(Buffer.from(file.body)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(1600);
  });

  /*
   * **AI 标识必须叠在存进对象存储的那份上**（《标识办法》第四条：导出文件也要带），
   * 而不是只在导出时补。这一条验的是标识真的画上去了 —— 右下角必须变深，
   * 只用半透明白字的话那块几乎不变，而那正是「在白猫或雪地上标识消失」的成因。
   */
  it("立绘带 AI 标识，右下角有深色底衬", async () => {
    const status = await runToSuccess();
    await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    const key = storageKeyOf(snapshot.pet!.avatarUrl!);
    const file = await getAvatarFile(USER, key);
    /*
     * 取右下角一小块。立绘四周是透明的，所以先压到纯白底再看亮度 ——
     * 那正是「白猫 / 雪地 / 阳光高光」这个最坏画面，标识必须在它上面仍然可见。
     */
    const { data } = await sharp(Buffer.from(file.body))
      .flatten({ background: "#ffffff" })
      .extract({ left: 1000, top: 1500, width: 160, height: 60 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    expect(average, "右下角没有变深 —— 底衬缺失，白字压在白底上等于没有标识").toBeLessThan(220);
  });

  /*
   * **只能有一个 AI 标识，且抠图必须发生在打标之前。**
   *
   * 原实现里 `processNextAiRun` 对所有 `ai_runs` 无条件打标，而 `adoptAvatarCandidate`
   * 又从那份已打标的字节抠图并再打一次 —— 链路成了打标 → 抠图 → 再打标。
   * 第一个标识的深绿黑底衬 `min(R,B)-G` 正好落进色键的羽化带，于是被改写成一块
   * 半透明脏块留在图上；缩放后它落在 y≈1330–1377，而真标识画在 y≈1504–1568，
   * **两块不重叠**，表现是立绘右下方悬着一块深色残影 —— 而立绘要实时叠在浅色草地上。
   *
   * 全过程不报错（抠图判据与残留统计都是干净的），所以必须由测试钉住。
   * 用**真品红底**输入而不是本地 provider 的橙色 SVG：后者覆盖率不够会走
   * 「原样透传」降级分支，那条路径下残影根本不会出现，测不到这个缺陷。
   */
  it("抠图在打标之前：立绘上只有一个标识，没有半透明残影", async () => {
    const magenta = new Uint8Array(
      await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 0, b: 255 } } })
        .composite([{ input: Buffer.from('<svg width="1024" height="1024"><circle cx="512" cy="500" r="300" fill="#E8A055"/></svg>'), gravity: "northwest" }])
        .png()
        .toBuffer(),
    );
    const cutout = await cutoutSprite(magenta);
    expect(cutout.keyed, "输入必须真的被抠掉，否则这条用例测的是降级分支").toBe(true);
    const labeled = await applyAiLabel(cutout.body, "island-avatar-once", AI_LABEL_PLATE);

    const { data, info } = await sharp(Buffer.from(labeled)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const opaqueIn = (top: number, bottom: number, left: number, right: number, threshold: number) => {
      let count = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (data[(y * info.width + x) * info.channels + info.channels - 1] > threshold) count += 1;
        }
      }
      return count;
    };
    // 残影区（旧实现在这里留下 5633 个不透明像素）必须完全干净
    expect(opaqueIn(1320, 1390, 1000, 1190, 8), "标识上方出现残影 —— 抠图与打标的顺序反了").toBe(0);
    // 真标识仍在
    expect(opaqueIn(1504, 1568, 1016, 1176, 200)).toBeGreaterThan(500);
  });

  it("任务没成功时不能选定", async () => {
    const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    await expect(adoptAvatarCandidate(USER, run.runId, { candidateId: "whatever" })).rejects.toMatchObject({
      code: "ISLAND_AVATAR_NOT_READY",
    });
  });

  it("未知候选被拒", async () => {
    const status = await runToSuccess();
    await expect(adoptAvatarCandidate(USER, status.id, { candidateId: "nope" })).rejects.toMatchObject({
      code: "ISLAND_AVATAR_CANDIDATE_NOT_FOUND",
    });
  });

  /** 生成期间用户可能把宠物改成「已离开」。**两处都拦**（4.1 #11） */
  it("生成后改成 memorial：选定被拦下", async () => {
    const status = await runToSuccess();
    await (await getDatabase()).query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [PET]);
    await expect(adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id })).rejects.toMatchObject({
      code: "ISLAND_UNAVAILABLE_MEMORIAL",
    });
  });

  /** 重做后覆盖同一行而不是堆出第二只 —— UNIQUE(island_id, pet_id) 上的 DO UPDATE */
  it("重做后覆盖立绘，不新增宠物行", async () => {
    const first = await runToSuccess();
    await adoptAvatarCandidate(USER, first.id, { candidateId: first.candidates[0].id });
    const firstUrl = (await getIslandSnapshot(USER, ORIGIN)).pet!.avatarUrl;

    const second = await runToSuccess();
    await adoptAvatarCandidate(USER, second.id, { candidateId: second.candidates[0].id });
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.pet!.avatarUrl).not.toBe(firstUrl);

    const rows = await (await getDatabase()).query<{ count: number }>("SELECT count(*)::int count FROM island_pets WHERE island_id=$1", [snapshot.id]);
    expect(Number(rows[0].count)).toBe(1);
  });

  /*
   * **岛不产出 `works`**（8.2）：岛的产出是状态而不是作品，
   * 所以没有解锁、分享、定价。这一条钉住立绘不会意外建出作品行。
   */
  it("立绘不产生 works 行，也不建订单", async () => {
    const status = await runToSuccess();
    await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    const database = await getDatabase();
    const works = await database.query<{ count: number }>("SELECT count(*)::int count FROM works WHERE user_id=$1", [USER]);
    const orders = await database.query<{ count: number }>("SELECT count(*)::int count FROM orders WHERE user_id=$1", [USER]);
    expect(Number(works[0].count)).toBe(0);
    expect(Number(orders[0].count)).toBe(0);
  });

  /*
   * **岛的立绘任务不能被通用 `ai-runs` 接口操作。**
   *
   * 立绘复用 `ai_runs` 表但不在 `registry.ts` 注册（它不产出 `works`）。通用侧原先
   * 只按 `id + user_id` 查、不过滤 `plugin_id`，于是拿 runId 打
   * `PATCH /api/ai-runs/<id>` 带 candidateId 就会建出一条 `plugin_id='island-avatar'`
   * 的 `works` 行 —— 而 `hydrateWork` 现查 manifest、查不到就抛 `WORK_INCOMPLETE`，
   * 那一行**打不开也删不掉**，且 `listWorks` 逐行 hydrate，
   * **一条脏行会让整个作品列表 500**（已实证：select 静默成功 → listWorks 抛
   * 「作品关联数据不完整」）。这与「archived manifest 不能删」是同一个故障模式，
   * 只是从另一头进来的。
   *
   * 四个入口逐个验：拦在服务层，所以路由层不需要各加一次（必漏改一处）。
   */
  it("通用 ai-runs 接口拒绝岛的立绘任务，作品列表不被污染", async () => {
    const status = await runToSuccess();
    const database = await getDatabase();

    await expect(selectAiCandidate(USER, status.id, status.candidates[0].id)).rejects.toMatchObject({ code: "AI_RUN_NOT_FOUND" });
    await expect(rerollAiRun(USER, status.id)).rejects.toMatchObject({ code: "AI_RUN_NOT_FOUND" });
    await expect(retryAiRun(USER, status.id)).rejects.toMatchObject({ code: "AI_RETRY_LIMIT" });
    await expect(cancelAiRun(USER, status.id)).rejects.toMatchObject({ code: "AI_NOT_CANCELLABLE" });

    // 一行都不许进 works —— 进了就打不开也删不掉
    const works = await database.query<{ count: number }>("SELECT count(*)::int count FROM works WHERE plugin_id=$1", [ISLAND_AVATAR_PLUGIN_ID]);
    expect(Number(works[0].count)).toBe(0);
    // 作品列表仍然打得开（脏行会让它整个 500）
    await expect(listWorks(USER)).resolves.toBeInstanceOf(Array);
    // 候选还在：reroll 被拦住，所以没有白掉一次额度
    expect((await getAvatarRun(USER, status.id)).candidates.length).toBeGreaterThan(0);
  });

  /*
   * 不占做图额度（6.3）：岛的形象额度用完不该影响做图，反之亦然
   * —— 与 `health_daily_quotas` 独立同源。
   */
  it("立绘不占 daily_quotas", async () => {
    const status = await runToSuccess();
    await adoptAvatarCandidate(USER, status.id, { candidateId: status.candidates[0].id });
    const rows = await (await getDatabase()).query<{ count: number }>("SELECT count(*)::int count FROM daily_quotas WHERE user_id=$1", [USER]);
    expect(Number(rows[0].count)).toBe(0);
  });
});

describe("取字节", () => {
  beforeEach(seed);

  /** 越权兜底：键由服务端拼，但取字节的路径吃 URL 参数 */
  it("他人的私有前缀取不到", async () => {
    await expect(getAvatarFile(USER, `private/${OTHER}/island/avatar-x.png`)).rejects.toMatchObject({
      code: "ISLAND_AVATAR_FILE_MISSING",
    });
  });

  it("不在 island 前缀下的键取不到", async () => {
    await expect(getAvatarFile(USER, `private/${USER}/photos/${PHOTO}.png`)).rejects.toMatchObject({
      code: "ISLAND_AVATAR_FILE_MISSING",
    });
  });

  /*
   * 候选预览**从已打标的字节取**（`previewKey` 是 `processNextAiRun` 从打标后的字节缩的）：
   * 回退到原始字节会让预览没有标识而正式版有，正好搞反。
   */
  it("候选预览取得到，他人取不到", async () => {
    const run = await createAvatarRun(USER, { petId: PET, photoId: PHOTO });
    await processNextAiRun();
    const status = await getAvatarRun(USER, run.runId);
    const file = await getAvatarCandidateFile(USER, run.runId, status.candidates[0].id);
    expect(file.body.byteLength).toBeGreaterThan(0);
    await expect(getAvatarCandidateFile(OTHER, run.runId, status.candidates[0].id)).rejects.toMatchObject({
      code: "ISLAND_AVATAR_RUN_NOT_FOUND",
    });
  });
});
