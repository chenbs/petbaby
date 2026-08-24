import { beforeEach, describe, expect, it } from "vitest";

import { daysSince, anchorOf } from "@/domain/companion";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { configuredIslandAssetCount } from "@/server/island/assets";
import { healthSnapshot } from "@/server/maintenance";
import {
  GATHER_DAILY_LIMIT,
  MAX_ISLAND_PETS,
  PET_DAILY_LIMIT,
  ensureIsland,
  getIslandSnapshot,
  joinIslandPet,
  listIslandCandidates,
  listIslandDiary,
  settleDiary,
  submitIslandAction,
} from "@/server/island-service";

/*
 * 宠物小岛服务层（22 号文 9.3 的必测用例逐条对照）。
 *
 * 这一组守的是**服务端权威**（5.6）—— 留存型模块与既有生成型模块最大的差异点，
 * 也最容易做错：岛的即时反馈会诱使实现方在端上先加数再同步，那样断网重连就会对不上，
 * 而岛的库存是要累积的，对不上不只是显示错，是用户觉得东西丢了。
 */

const USER = "00000000-0000-4000-8000-0000000000f1";
const OTHER = "00000000-0000-4000-8000-0000000000f2";
const PET = "00000000-0000-4000-8000-0000000000f3";
const MEMORIAL_PET = "00000000-0000-4000-8000-0000000000f4";
const SECOND_PET = "00000000-0000-4000-8000-0000000000f5";

const ORIGIN = "https://petbaby.example.com";

async function seed() {
  await resetDatabaseForTest();
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  await database.query(
    "INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'摩奇','cat','unknown','2024-01-01','birthday','active',true,now())",
    [PET, USER],
  );
  await database.query(
    "INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2025-01-01','birthday','active',false,now())",
    [SECOND_PET, USER],
  );
  await database.query(
    "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','dog','unknown','birthday','memorial',false,now())",
    [MEMORIAL_PET, USER],
  );
}

/** 给岛塞满库存，让喂食测试不受采集额度牵连 */
async function stockInventory(islandId: string, itemId = "biscuit", count = 20) {
  await (await getDatabase()).query(
    "INSERT INTO island_inventory (id,island_id,item_id,count) VALUES ($1,$2,$3,$4) ON CONFLICT (island_id,item_id) DO UPDATE SET count=EXCLUDED.count",
    [crypto.randomUUID(), islandId, itemId, count],
  );
}

describe("建岛", () => {
  beforeEach(seed);

  /** **幂等**（5.5）：首次进入时端上可能并发发两次，靠唯一约束 + ON CONFLICT */
  it("重复建岛不产生第二座", async () => {
    const first = await ensureIsland(USER);
    const second = await ensureIsland(USER);
    expect(String(second.id)).toBe(String(first.id));
    const rows = await (await getDatabase()).query<{ count: number }>("SELECT count(*)::int count FROM islands WHERE user_id=$1", [USER]);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("没建岛时取快照报 404，不静默建一座", async () => {
    await expect(getIslandSnapshot(USER, ORIGIN)).rejects.toMatchObject({ code: "ISLAND_NOT_FOUND" });
  });

  it("快照给出服务端日期与上限表", async () => {
    await ensureIsland(USER);
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.limits.gathered).toBe(GATHER_DAILY_LIMIT);
    expect(snapshot.serverDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.today).toEqual({ gathered: 0, fed: 0, petted: 0 });
  });
});

describe("memorial 宠物不进岛（红线，两处都要）", () => {
  beforeEach(seed);

  /*
   * 9.3 的必测用例第一条：**服务端返回错误码，且可选宠物列表不含它 —— 两处都测。**
   *
   * 理由：岛的核心机制是「亲密度日增、陪伴天数往上涨」，对已离开的宠物递增天数
   * 是明确的冒犯（CLAUDE.md 已钉死「陪伴天数一律封口」）。
   */
  it("服务端拦下入岛请求", async () => {
    await ensureIsland(USER);
    await expect(joinIslandPet(USER, { petId: MEMORIAL_PET })).rejects.toMatchObject({ code: "ISLAND_UNAVAILABLE_MEMORIAL" });
  });

  it("可选宠物列表里没有它", async () => {
    const candidates = await listIslandCandidates(USER);
    expect(candidates.map((pet) => pet.id)).toContain(PET);
    expect(candidates.map((pet) => pet.id)).not.toContain(MEMORIAL_PET);
  });

  /*
   * **入岛之后才改成 memorial 这条路径**：表上没有 CHECK（life_stage 在 pets 表上
   * 且可被用户随时改），所以由读取侧处理 —— 不删记录（那段陪伴发生过），
   * 而是不再下发，岛回到「还没有宠物入岛」的状态。
   */
  it("入岛后改成 memorial：快照不再下发它，记录不删", async () => {
    const island = await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
    expect((await getIslandSnapshot(USER, ORIGIN)).pet?.id).toBe(PET);

    const database = await getDatabase();
    await database.query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [PET]);
    expect((await getIslandSnapshot(USER, ORIGIN)).pet).toBeUndefined();
    // 记录仍在 —— 删数据是不可逆的，而改回 active 就该恢复
    const rows = await database.query<{ count: number }>("SELECT count(*)::int count FROM island_pets WHERE island_id=$1", [island.id]);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("已离开的宠物无法互动 —— 岛上等于没有宠物", async () => {
    await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
    await (await getDatabase()).query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [PET]);
    await expect(submitIslandAction(USER, { type: "pet" })).rejects.toMatchObject({ code: "ISLAND_PET_REQUIRED" });
  });
});

describe("宠物入岛", () => {
  beforeEach(seed);

  it("入岛后快照带出宠物与起算日", async () => {
    await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.pet?.name).toBe("摩奇");
    expect(snapshot.pet?.birthday).toBe("2024-01-01");
    expect(snapshot.pet?.intimacy).toBe(0);
  });

  /** 幂等：重复点「进岛」不该看到失败 */
  it("重复入岛不报错", async () => {
    await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
    await expect(joinIslandPet(USER, { petId: PET })).resolves.toMatchObject({ joined: true });
  });

  /** M1 只支持一只（9.4 第 4 项）。措辞说「住得下一只」而不是「超出上限」 */
  it("第二只被拦下，M1 只住得下一只", async () => {
    expect(MAX_ISLAND_PETS).toBe(1);
    await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
    await expect(joinIslandPet(USER, { petId: SECOND_PET })).rejects.toMatchObject({ code: "ISLAND_PET_LIMIT" });
  });

  it("他人宠物返回 404", async () => {
    await ensureIsland(OTHER);
    await expect(joinIslandPet(OTHER, { petId: PET })).rejects.toMatchObject({ code: "PET_NOT_FOUND" });
  });

  it("入岛会顺带建岛 —— 引导流程不必先单独建一次", async () => {
    await joinIslandPet(USER, { petId: PET });
    expect((await getIslandSnapshot(USER, ORIGIN)).pet?.id).toBe(PET);
  });

  /*
   * **快照必须认端上传来的 `petId`**（CLAUDE.md：入口必须带 `petId`，
   * 不带的话点非默认宠物会看到错的那只）。
   *
   * 端上一直在传（`island/service.js` 的 `loadIsland` 拼 `?petId=`），而服务端原先
   * 只认 `candidates` 参数，这个值被静默丢弃 —— 表现是「从宠物档案点第二只，
   * 进去看到第一只的名字与天数」，不报错。
   *
   * **绕过 `MAX_ISLAND_PETS` 直接写第二行**：M1 只住得下一只，走 `joinIslandPet`
   * 拿不到「岛上有两只」的状态，而那正是能区分「读了 petId」与「没读」的唯一情形 ——
   * 只有一只时取谁都一样，测不出差别。M2 放开多只入岛后这条会自然覆盖真实路径。
   */
  it("快照按端上传来的 petId 给对应那只，不是一律给最早入岛的", async () => {
    const database = await getDatabase();
    const island = await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
    await database.query(
      "INSERT INTO island_pets (id,island_id,pet_id,intimacy,joined_at) VALUES ($1,$2,$3,0,$4)",
      [crypto.randomUUID(), island.id, SECOND_PET, new Date(Date.now() + 1000)],
    );

    // 不传：给最早入岛的那只
    expect((await getIslandSnapshot(USER, ORIGIN)).pet?.id).toBe(PET);
    // 传第二只：必须给第二只 —— 丢弃参数的实现会在这里返回 PET
    expect((await getIslandSnapshot(USER, ORIGIN, new Date(), SECOND_PET)).pet?.id).toBe(SECOND_PET);
    // 传一只没入岛的：回落到岛上那只，而不是变成「岛上没有宠物」
    expect((await getIslandSnapshot(USER, ORIGIN, new Date(), MEMORIAL_PET)).pet?.id).toBe(PET);
  });
});

describe("互动：额度与亲密度全由服务端算", () => {
  beforeEach(async () => {
    await seed();
    await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
  });

  it("没有宠物时不能互动", async () => {
    await ensureIsland(OTHER);
    await expect(submitIslandAction(OTHER, { type: "pet" })).rejects.toMatchObject({ code: "ISLAND_PET_REQUIRED" });
  });

  /** 采集掉落物**由服务端返回才进库存**（5.6：允许乐观动画，不允许乐观数据） */
  it("采集掉一件东西并进库存", async () => {
    const result = await submitIslandAction(USER, { type: "gather", targetId: "grass" });
    expect(result.drop).toBeTruthy();
    expect(result.today.gathered).toBe(1);
    const entry = result.inventory.find((item) => item.itemId === result.drop!.itemId);
    expect(entry?.count).toBe(1);
  });

  /*
   * 9.3 必测：**超额返回 429 而非静默失败；额度按服务端时间判定。**
   * 措辞是「今天的草丛都看过了」而不是「体力耗尽」—— 措辞差异决定它是不是
   * 4.1 #4 的体力值（那会把整体推过类目线）。
   */
  it("采集超过每日上限返回 429，措辞不是体力", async () => {
    for (let index = 0; index < GATHER_DAILY_LIMIT; index += 1) {
      await submitIslandAction(USER, { type: "gather" });
    }
    await expect(submitIslandAction(USER, { type: "gather" })).rejects.toMatchObject({
      code: "ISLAND_ACTION_LIMIT",
      status: 429,
    });
    try {
      await submitIslandAction(USER, { type: "gather" });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("草丛");
      for (const word of ["体力", "行动点", "耗尽", "energy"]) expect(message).not.toContain(word);
    }
  });

  it("摸摸上限独立于采集上限", async () => {
    for (let index = 0; index < GATHER_DAILY_LIMIT; index += 1) await submitIslandAction(USER, { type: "gather" });
    // 采集打满后摸摸照常 —— 三个动作各有各的计数列
    const result = await submitIslandAction(USER, { type: "pet" });
    expect(result.today.petted).toBe(1);
    expect(result.today.gathered).toBe(GATHER_DAILY_LIMIT);
    expect(PET_DAILY_LIMIT).toBeGreaterThan(GATHER_DAILY_LIMIT);
  });

  /*
   * 9.3 必测：**亲密度只增，不存在任何使其下降的路径。**
   * 表上有 `CHECK (intimacy >= 0)`，服务层也没有减的分支。
   */
  it("亲密度只增不减", async () => {
    const first = await submitIslandAction(USER, { type: "pet" });
    expect(first.intimacy).toBeGreaterThan(0);
    const second = await submitIslandAction(USER, { type: "pet" });
    expect(second.intimacy).toBeGreaterThan(first.intimacy);
    // 采集不加亲密度，但也绝不减
    const third = await submitIslandAction(USER, { type: "gather" });
    expect(third.intimacy).toBe(second.intimacy);
  });

  it("喂食消耗库存并加亲密度", async () => {
    const island = await ensureIsland(USER);
    await stockInventory(String(island.id), "biscuit", 3);
    const result = await submitIslandAction(USER, { type: "feed", itemId: "biscuit" });
    expect(result.consumed?.itemId).toBe("biscuit");
    expect(result.intimacy).toBeGreaterThan(0);
    expect(result.inventory.find((item) => item.itemId === "biscuit")?.count).toBe(2);
  });

  it("背包空着不能喂，且不吃掉额度", async () => {
    await expect(submitIslandAction(USER, { type: "feed" })).rejects.toMatchObject({ code: "ISLAND_NOTHING_TO_FEED" });
    // **额度校验在扣库存之后、但库存校验在扣额度之前**：空背包点喂食不该白白吃掉一次额度
    expect((await getIslandSnapshot(USER, ORIGIN)).today.fed).toBe(0);
  });

  it("毛线球不能吃", async () => {
    const island = await ensureIsland(USER);
    await stockInventory(String(island.id), "yarn-ball", 3);
    await expect(submitIslandAction(USER, { type: "feed", itemId: "yarn-ball" })).rejects.toMatchObject({ code: "ISLAND_ITEM_NOT_FEEDABLE" });
    await expect(submitIslandAction(USER, { type: "feed" })).rejects.toMatchObject({ code: "ISLAND_NOTHING_TO_FEED" });
  });

  it("未知物品被拒", async () => {
    await expect(submitIslandAction(USER, { type: "feed", itemId: "rocket" })).rejects.toMatchObject({ code: "ISLAND_ITEM_UNKNOWN" });
  });

  /*
   * 喂食超额时**已扣的那件要退回来**：扣了库存又没喂成是净损失，而库存是用户攒的。
   * 这条路径在正常玩法里走不到（喂食上限 = 采集上限，库存先见底），
   * 但直接塞库存就能触发 —— 而那正是会员放宽采集额度后的形态。
   */
  it("喂食超额时退还已扣的库存", async () => {
    const island = await ensureIsland(USER);
    const database = await getDatabase();
    await stockInventory(String(island.id), "biscuit", 50);
    // 把 fed 直接顶到上限，模拟「库存充足但额度用尽」
    await database.query(
      "INSERT INTO island_daily_actions (id,island_id,action_date,gathered,fed,petted) VALUES ($1,$2,CURRENT_DATE,0,999,0) ON CONFLICT (island_id,action_date) DO UPDATE SET fed=999",
      [crypto.randomUUID(), island.id],
    );
    await expect(submitIslandAction(USER, { type: "feed", itemId: "biscuit" })).rejects.toMatchObject({ code: "ISLAND_ACTION_LIMIT" });
    const rows = await database.query<{ count: number }>("SELECT count FROM island_inventory WHERE island_id=$1 AND item_id='biscuit'", [island.id]);
    expect(Number(rows[0].count)).toBe(50);
  });

  it("非法动作类型被拒", async () => {
    await expect(submitIslandAction(USER, { type: "fly" })).rejects.toThrow();
  });

  /** 反馈是**表情与动作**而不是数值弹字（4.2），且不含任何游戏化词汇 */
  it("反馈文案不出现数值与游戏化词汇", async () => {
    const island = await ensureIsland(USER);
    await stockInventory(String(island.id), "biscuit", 3);
    for (const input of [{ type: "gather" }, { type: "feed", itemId: "biscuit" }, { type: "pet" }]) {
      const result = await submitIslandAction(USER, input);
      for (const word of ["+1", "亲密度", "经验", "等级", "体力", "金币"]) {
        expect(result.message, `反馈「${result.message}」含 ${word}`).not.toContain(word);
      }
    }
  });
});

describe("岛日记", () => {
  beforeEach(async () => {
    await seed();
    await ensureIsland(USER);
    await joinIslandPet(USER, { petId: PET });
  });

  /*
   * 9.3 必测：**同日重复结算不产生第二条。**
   * 幂等靠 `UNIQUE(island_id, kind, event_date)`，与 `health_reminders` 的
   * `(pet_id, kind, subject_key)` 同一手法。
   */
  it("同日重复结算幂等", async () => {
    const island = await ensureIsland(USER);
    const first = await settleDiary(USER, String(island.id));
    expect(first.written).toBe(1);
    const second = await settleDiary(USER, String(island.id));
    expect(second.written).toBe(0);
    const rows = await (await getDatabase()).query<{ count: number }>("SELECT count(*)::int count FROM island_events WHERE island_id=$1", [island.id]);
    expect(Number(rows[0].count)).toBe(1);
  });

  /*
   * **每天只有一条，即使当天的事实中途变了。**
   *
   * 唯一约束含 `kind`，而模板选择的结果会随事实变化：先结算出 `ambient-v1`
   * （`kind=diary`），随后用户上传照片 —— 若只靠约束，下一次结算会选 `photo-today-v1`
   * ……那个恰好也是 `diary`，被约束拦住。但换成命中「去年今日」就不是了
   * （`kind=on_this_day`），约束放它过去，于是同一天两条。
   *
   * 所以「每天一条」这条产品规则必须靠「先查当日有无任何条目」保证。
   */
  it("当天事实变化后再结算也不会写出第二条", async () => {
    const island = await ensureIsland(USER);
    await settleDiary(USER, String(island.id));

    const database = await getDatabase();
    const now = new Date();
    // 造一张「去年今日」的照片：若只靠唯一约束，它会以 kind=on_this_day 写进去
    await database.query(
      "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,shot_at,created_at) VALUES ($1,$2,$3,'c.jpg','image/jpeg',100,$4,0,$5,$6)",
      [
        crypto.randomUUID(),
        USER,
        PET,
        `private/${USER}/photos/c.jpg`,
        new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 9, 0, 0),
        new Date(Date.now() - 3 * 86_400_000),
      ],
    );
    expect((await settleDiary(USER, String(island.id))).written).toBe(0);

    const rows = await database.query<{ count: number }>("SELECT count(*)::int count FROM island_events WHERE island_id=$1", [island.id]);
    expect(Number(rows[0].count), "同一天写出了第二条 —— 唯一约束含 kind，拦不住模板改选").toBe(1);
  });

  /** 取快照会顺带结算（懒结算，5.6）—— 不需要 Worker 定时跑 */
  it("取快照顺带结算出今天的日记", async () => {
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.diary?.text).toBeTruthy();
    expect(snapshot.diary?.date).toBe(snapshot.serverDate);
  });

  /*
   * **存 `template_id` + `payload`，不是成品文案**（0024 的表注释）：
   * 模板改了措辞之后历史日记应当跟着修正，而存成品会把违规文案永久固化在库里。
   */
  it("库里存模板 id 与变量，不存成品文案", async () => {
    const island = await ensureIsland(USER);
    await settleDiary(USER, String(island.id));
    const rows = await (await getDatabase()).query("SELECT template_id,payload FROM island_events WHERE island_id=$1", [island.id]);
    expect(String(rows[0].template_id)).toMatch(/-v\d+$/);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.petName).toBe("摩奇");
    // 成品文案不该出现在任何列里
    expect(JSON.stringify(rows[0])).not.toContain("自己待了一会儿");
  });

  it("日记翻阅按日期倒序并给出游标", async () => {
    const island = await ensureIsland(USER);
    const database = await getDatabase();
    // 塞三天历史。kind 相同、日期不同 —— 唯一约束是 (island, kind, date)
    for (const date of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
      await database.query(
        "INSERT INTO island_events (id,island_id,pet_id,kind,template_id,payload,event_date,created_at) VALUES ($1,$2,$3,'diary','ambient-v1','{\"phase\":\"day\",\"weather\":\"clear\",\"activity\":\"idle\"}'::jsonb,$4,now())",
        [crypto.randomUUID(), island.id, PET, date],
      );
    }
    const page = await listIslandDiary(USER, { limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0].date > page.entries[1].date).toBe(true);
    expect(page.nextCursor).toBe(page.entries[1].date);
    const next = await listIslandDiary(USER, { cursor: page.nextCursor, limit: 2 });
    expect(next.entries.every((entry) => entry.date < page.nextCursor!)).toBe(true);
  });

  /*
   * 9.3 必测：**`date` 列归一走 `asDateKey`，东八区不退回前一天。**
   * `String(value).slice(0,10)` 会得到 `"Sat Aug 01"` —— 健康线已经踩过一次。
   */
  it("date 列不会读成 Sat Aug 01，也不因 UTC 退回前一天", async () => {
    const island = await ensureIsland(USER);
    await (await getDatabase()).query(
      "INSERT INTO island_events (id,island_id,pet_id,kind,template_id,payload,event_date,created_at) VALUES ($1,$2,$3,'milestone','milestone-v1','{\"milestoneDay\":100}'::jsonb,'2026-08-01',now())",
      [crypto.randomUUID(), island.id, PET],
    );
    const page = await listIslandDiary(USER);
    const entry = page.entries.find((item) => item.templateId === "milestone-v1")!;
    expect(entry.date).toBe("2026-08-01");
    expect(entry.date).not.toContain("Aug");
  });

  /** 「今天拍了 N 张」按 `created_at` 计数 —— 那是用户的行为，不是照片里的那一天 */
  it("今天上传的照片进日记，按 created_at 计数", async () => {
    const island = await ensureIsland(USER);
    const database = await getDatabase();
    // shot_at 是三年前，created_at 是今天 —— 用 shot_at 计数会漏掉这张
    await database.query(
      "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,shot_at,created_at) VALUES ($1,$2,$3,'a.jpg','image/jpeg',100,$4,0,'2023-05-01T10:00:00Z',now())",
      [crypto.randomUUID(), USER, PET, `private/${USER}/photos/a.jpg`],
    );
    await settleDiary(USER, String(island.id));
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.diary?.templateId).toBe("photo-today-v1");
    expect(snapshot.diary?.text).toContain("1 张");
  });

  /*
   * 「去年今日」**只认 `shot_at IS NOT NULL`**（复用 `findOnThisDay`）：
   * 上传时间的月日撞上今天纯属巧合，拿它说「去年今日」是假的。
   */
  it("命中去年今日时引用去年，不认只有上传时间的照片", async () => {
    const island = await ensureIsland(USER);
    const database = await getDatabase();
    const now = new Date();
    const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 10, 0, 0);
    // 一张有 EXIF 的去年今日照片，但 created_at 在昨天（不进「今天拍了 N 张」）
    await database.query(
      "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,shot_at,created_at) VALUES ($1,$2,$3,'b.jpg','image/jpeg',100,$4,0,$5,$6)",
      [crypto.randomUUID(), USER, PET, `private/${USER}/photos/b.jpg`, lastYear, new Date(Date.now() - 2 * 86_400_000)],
    );
    await settleDiary(USER, String(island.id));
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.diary?.templateId).toBe("on-this-day-v1");
    expect(snapshot.diary?.text).toContain("去年的今天");
  });
});

describe("陪伴天数与里程碑", () => {
  beforeEach(async () => {
    await seed();
    await ensureIsland(USER);
  });

  /*
   * 9.3 必测：**岛内显示与 `domain/companion.ts` 输出逐日相等。**
   * 快照不下发天数本身，而是下发起算日 —— 端上用 `services/companion.js` 算。
   * 这一条验的是那个起算日能算出同一个数字。
   */
  it("快照下发的起算日与 companion 口径一致", async () => {
    await joinIslandPet(USER, { petId: PET });
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    const days = daysSince(anchorOf({ birthday: snapshot.pet!.birthday, createdAt: snapshot.pet!.createdAt }));
    expect(days).toBe(daysSince("2024-01-01"));
    expect(days).toBeGreaterThan(0);
  });

  /** 里程碑**只列已达成的**：「还差 20 天」是催促（4.1 #7） */
  it("里程碑标出已达成的那些", async () => {
    await joinIslandPet(USER, { petId: PET });
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.milestones.map((item) => item.day)).toEqual([100, 365, 1000]);
    // 2024-01-01 起算，到 2026 年已过 365 天
    expect(snapshot.milestones.find((item) => item.day === 100)?.reached).toBe(true);
    expect(snapshot.milestones.find((item) => item.day === 365)?.reached).toBe(true);
  });

  /** 没有宠物时不给里程碑数字 —— 都是未达成 */
  it("没有宠物时里程碑全部未达成", async () => {
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.milestones.every((item) => !item.reached)).toBe(true);
  });
});

describe("素材下发", () => {
  beforeEach(async () => {
    await seed();
    await ensureIsland(USER);
  });

  /*
   * **素材 URL 由服务端下发、端上不硬编码**（5.3）：小程序 `<image src>` 与
   * `wx.downloadFile` 遇到以 `/` 开头的值会当主包内本地文件找，必然裂图且不报错。
   * 所以出口必须给绝对地址 —— 这一条钉住「绝不下发相对路径」。
   */
  it("下发的素材地址一律是绝对 URL", async () => {
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    for (const [slot, url] of Object.entries(snapshot.assets)) {
      expect(url, `${slot} 下发了相对路径 ${url} —— 端上会当主包内本地文件找，必然裂图`).toMatch(/^https?:\/\//);
    }
  });

  /*
   * **缺素材时留空，不画占位色块**（既有约定）：`LocalImageProvider` 的纯色 SVG
   * 正是方案点名的抽象色块违例。当前素材还没上传，所以清单为空 ——
   * 那是正式状态不是待办占位，端上走「素材未就绪」路径（纯色底 + 立绘）。
   */
  it("素材未配置时给空清单而不是占位地址", async () => {
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(Object.values(snapshot.assets).every((url) => typeof url === "string" && url.length > 0)).toBe(true);
  });

  /*
   * **健康快照要报告岛素材，冒烟脚本靠它逐张校验。**
   *
   * `configuredIslandAssetCount()` 的注释一直写着「`/api/health` 与冒烟脚本用它
   * 判断有没有漏灌」，但此前**零调用方** —— 那两个消费方都不存在。
   * 漏灌时 `/api/plugins` 与 `/api/health` 均正常，只有取字节时 404，
   * 端上表现为大面积裂图且不报错（CLAUDE.md 点名的故障模式），岛素材原先没有对应校验。
   *
   * 张数与路径清单必须同源：冒烟脚本先读张数决定要不要查，再按路径逐张取字节 ——
   * 两者对不上会让校验静默跳过（说配了 N 张却给不出地址）。
   */
  it("健康快照报告岛素材张数与路径，两者同源", async () => {
    const health = await healthSnapshot();
    expect(health.islandAssets).toBe(configuredIslandAssetCount());
    expect(health.islandAssetPaths).toHaveLength(health.islandAssets);
    // 清单为空是正式状态，**不能因此把服务判成 degraded**
    expect(health.status).toBe("ok");
    // 给的是站内相对路径：冒烟脚本在容器内按 http://web:3000 自己拼域名
    for (const path of health.islandAssetPaths) expect(path.startsWith("/")).toBe(true);
  });

  /** 底图坐标随快照下发，端上逐键合并到预设上 —— 缺一组坐标会让宠物直接消失 */
  it("下发底图坐标，三组关键锚点齐备", async () => {
    const snapshot = await getIslandSnapshot(USER, ORIGIN);
    expect(snapshot.anchors.petClear).toBeTruthy();
    expect(snapshot.anchors.petShelter).toBeTruthy();
    expect(snapshot.anchors.window).toBeTruthy();
    expect(typeof snapshot.anchors.horizonY).toBe("number");
  });
});
