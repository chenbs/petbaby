import { beforeEach, describe, expect, it } from "vitest";

import { resolveManifestTone } from "@/plugins/runtime";
import { getPlugin } from "@/plugins/registry";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import {
  createGeneration,
  createPet,
  getGeneration,
  getWork,
  savePhoto,
} from "@/server/platform-service";
import { objectStorage } from "@/server/storage";
import { runWorkerUntilIdle } from "@/server/worker/generation-worker";
import { getWallet } from "@/server/wallet/service";
import { fundWallet } from "@/server/wallet/test-helpers";

const USER = "00000000-0000-4000-8000-0000000000e1";
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4v5QBAARLAaVqE1cAAAAAAElFTkSuQmCC", "base64"),
);

async function seed() {
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()) ON CONFLICT DO NOTHING", [USER]);
}

async function addPhoto(petId: string, shotAt: string) {
  const key = `private/${USER}/${crypto.randomUUID()}.png`;
  await objectStorage.put(key, PNG, "image/png");
  const photo = await savePhoto(USER, { petId, filename: "p.png", mimeType: "image/png", size: PNG.byteLength, storageKey: key });
  const database = await getDatabase();
  await database.query("UPDATE photos SET shot_at=$2 WHERE id=$1", [photo.id, new Date(shotAt)]);
  return photo;
}

/*
 * 玩法合并后的调性切换（C4）与定价分档（C5）的端到端验证。
 *
 * 单独成文件是因为这两件事必须一起验：纪念形态的定价来自 toneVariants，
 * 而分档逻辑要在纪念形态下被跳过 —— 分开测会漏掉「纪念册被算成基础档」。
 */
describe("生命阶段调性切换", () => {
  it("active 用本体文案，memorial 用纪念文案与纪念价", () => {
    const album = getPlugin("pet-time-album")!;
    expect(resolveManifestTone(album, "active").name).toBe("宠物时光画册");
    const memorial = resolveManifestTone(album, "memorial");
    expect(memorial.name).toBe("纪念册");
    expect(memorial.pricing.unlockPrice).toBe(49);
  });

  /** 不传生命阶段时给 active 文案 —— 首页在用户还没选宠物时就要渲染卡片。 */
  it("未指定生命阶段回落本体文案", () => {
    const album = getPlugin("pet-time-album")!;
    expect(resolveManifestTone(album, undefined).name).toBe("宠物时光画册");
  });

  /*
   * `senior` 的调性：**克制但不纪念**（改造项 L4）。
   *
   * 改造前 senior 是一个空标签 —— 用户手动设成晚年后什么都不会变，
   * 而 20 号文 3.2 判断「这比没有这个选项更差：它给了一个承诺然后什么都不做」。
   *
   * 分界线是三件事：名字不变（还是同一个玩法，不是纪念形态）、
   * 价格不变（涨价是趁人之危，降价暗示这个阶段的东西不值钱）、
   * 措辞不提离别（那是替用户宣告一件还没发生的事）。
   */
  it("senior 换调性但不换名字、不换价格", () => {
    const album = getPlugin("pet-time-album")!;
    const senior = resolveManifestTone(album, "senior");
    expect(senior.name).toBe("宠物时光画册");
    expect(senior.pricing.unlockPrice).toBe(album.pricing.unlockPrice);
    expect(senior.tagline).not.toBe(album.tagline);
  });

  /** 晚年调性不得出现预告离别的措辞 —— 那比沿用轻快调更冒犯 */
  it("senior 文案不提离别", () => {
    for (const id of ["pet-time-album", "pl-19", "pl-15"]) {
      const senior = resolveManifestTone(getPlugin(id)!, "senior");
      const text = `${senior.name} ${senior.tagline} ${senior.description}`;
      for (const word of ["离别", "最后", "剩下的时间", "告别", "不多了", "余生", "临终", "走了"]) {
        expect(text, `「${word}」不该出现在 ${id} 的晚年文案里`).not.toContain(word);
      }
    }
  });

  /** 三个玩法都要有 senior 调性 —— 漏一个就是那个玩法在晚年阶段仍然轻快 */
  it("画册、短片、星尘页都有 senior 调性", () => {
    for (const id of ["pet-time-album", "pl-19", "pl-15"]) {
      expect(getPlugin(id)!.toneVariants?.senior, `${id} 缺 senior 调性`).toBeDefined();
    }
  });

  it("短片与互动页同样带 memorial 调性", () => {
    expect(resolveManifestTone(getPlugin("pl-19")!, "memorial").name).toBe("纪念短片");
    expect(resolveManifestTone(getPlugin("pl-15")!, "memorial").name).toBe("星尘纪念页");
  });
});

describe("冻干分档端到端", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seed();
    await fundWallet(USER, 100);
  });

  /** 生成一本画册，返回作品与这一次扣掉的颗数（新人礼 3 颗 + 测试充值 100 颗）。 */
  async function makeAlbum(lifeStage: "active" | "memorial", photoCount: number, spanDays: number) {
    const pet = await createPet(USER, { name: "年糕", species: "cat", gender: "unknown", birthday: "", lifeStage });
    const photos = [];
    for (let index = 0; index < photoCount; index += 1) {
      // 把照片摊在 spanDays 的跨度里，首尾正好相差 spanDays。
      const offset = photoCount > 1 ? Math.round((spanDays * index) / (photoCount - 1)) : 0;
      photos.push(await addPhoto(pet.id, new Date(Date.UTC(2025, 0, 1 + offset, 8)).toISOString()));
    }
    const before = (await getWallet(USER)).balance;
    const task = await createGeneration(USER, {
      pluginId: "pet-time-album",
      petId: pet.id,
      photoIds: photos.slice(0, 6).map((photo) => photo.id),
      idempotencyKey: `album-${lifeStage}-${photoCount}-${spanDays}`,
    });
    const charged = before - (await getWallet(USER)).balance;
    await runWorkerUntilIdle();
    return { work: (await getGeneration(USER, task.id)).work!, charged, taskId: task.id };
  }

  it("20 张 / 短跨度是基础档 18 颗", async () => {
    const { charged, work } = await makeAlbum("active", 20, 30);
    expect(charged).toBe(18);
    expect(work.locked).toBe(false);
  }, 60_000);

  it("21 张是进阶档 28 颗（边界值）", async () => {
    expect((await makeAlbum("active", 21, 30)).charged).toBe(28);
  }, 60_000);

  it("跨度满年是年度档 38 颗，且照片不必多", async () => {
    expect((await makeAlbum("active", 8, 400)).charged).toBe(38);
  }, 60_000);

  /*
   * 纪念形态**不分档**：纪念场景比价是冒犯。纪念空间与纪念阶段的画册维持免费（36 号文 D2）。
   */
  it("纪念阶段的画册免费，且直接是正式版", async () => {
    const { charged, work } = await makeAlbum("memorial", 6, 10);
    expect(charged).toBe(0);
    expect(work.locked).toBe(false);
  }, 60_000);

  it("任务快照记录颗数、档位与积累量", async () => {
    const { taskId } = await makeAlbum("active", 21, 30);
    const database = await getDatabase();
    const rows = await database.query("SELECT options FROM generation_tasks WHERE id=$1", [taskId]);
    const dongan = (rows[0].options as { dongan: { cost: number; tier: string; accumulation: { photoCount: number } } }).dongan;
    expect(dongan).toMatchObject({ cost: 28, tier: "advanced" });
    expect(dongan.accumulation.photoCount).toBe(21);
  }, 60_000);
});

/*
 * V2-2-5：**合并 manifest 后历史作品必须仍能打开。**
 *
 * 这是合并动作唯一的真实风险，必须真的造一条 plugin_id 指向老 manifest
 * 的作品再走读取路径 —— 不能靠读代码判断。
 *
 * 验收时发现产品改造方案 4.1 判断错了一处：那里写「历史作品靠
 * plugin_snapshot 打开」，但 **`works` 表没有这一列**（只有
 * `generation_tasks` 和 `orders` 有），`hydrateWork` 一律
 * `getRuntimePlugin(work.pluginId)` 现查。所以老 manifest 只能
 * 保留为 `archived`，不能删条目 —— 否则这些作品打不开也删不掉。
 */
describe("历史作品在玩法合并后仍可打开", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seed();
  });

  it.each([
    ["pl-20", "纪念册"],
    ["pl-21", "纪念视频"],
    ["pl-22", "星尘纪念页"],
  ])("plugin_id='%s' 的老作品正常读出", async (pluginId, expectedName) => {
    const database = await getDatabase();
    const pet = await createPet(USER, { name: "年糕", species: "cat", gender: "unknown", birthday: "" });
    const photo = await addPhoto(pet.id, "2025-03-01T08:00:00Z");
    const workId = crypto.randomUUID();
    await database.query(
      "INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,locked,public,version,created_at) VALUES ($1,$2,$3,$4,$5,'年糕 · 老作品','来自纪念空间的克制产物',$6,'PETBABY MEMORIAL',$7,$7,'pdf','memorial',false,false,1,now())",
      [workId, USER, pluginId, pet.id, photo.id, `MEM-${pluginId.toUpperCase()}`, `private/${USER}/memorials/legacy-${pluginId}.pdf`],
    );

    const work = await getWork(USER, workId);
    expect(work.plugin.name).toBe(expectedName);
    expect(work.title).toBe("年糕 · 老作品");
  });

  /** archived 的老玩法不能出现在可选清单里（`/api/plugins` 只输出 live）。 */
  it("老玩法不出现在 live 清单中", async () => {
    const { listRuntimePlugins } = await import("@/plugins/runtime");
    const live = (await listRuntimePlugins()).filter((plugin) => plugin.status === "live").map((plugin) => plugin.id);
    // PL-15 互动星尘页 2026-09 下线（archived），live 从 7 个变为 6 个。
    expect(live).toHaveLength(6);
    for (const archived of ["pl-15", "pl-20", "pl-21", "pl-22"]) {
      expect(live).not.toContain(archived);
    }
  });

  /** 老玩法不能被用来建新任务 —— archived 不是 live。 */
  it("不能用老玩法建新任务", async () => {
    const pet = await createPet(USER, { name: "年糕", species: "cat", gender: "unknown", birthday: "" });
    const photo = await addPhoto(pet.id, "2025-03-01T08:00:00Z");
    await expect(
      createGeneration(USER, { pluginId: "pl-20", petId: pet.id, photoIds: [photo.id], idempotencyKey: "archived-0001" }),
    ).rejects.toMatchObject({ code: "PLUGIN_UNAVAILABLE" });
  });
});
