import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { daysSince } from "@/domain/companion";
import { cancelSubscription, subscribeReminder } from "@/server/growth-service";
import { findOnThisDay, getPetTimeline, onThisDayConsentState, pickGrowthPair, scheduleOnThisDay } from "@/server/timeline-service";

const USER = "00000000-0000-4000-8000-0000000000b1";
const PET = "00000000-0000-4000-8000-0000000000b2";
const OTHER_PET = "00000000-0000-4000-8000-0000000000b3";

/**
 * 登记一次「去年今日」的订阅授权。
 *
 * 走 `subscribeReminder` 而不是直接 INSERT：授权的形态（status='active'、
 * consent 必须为 true）由那个函数定义，测试里另写一份 INSERT 会在两者
 * 走散时仍然通过 —— 而「授权记录长什么样」正是这条改造的核心。
 */
async function grantConsent() {
  return subscribeReminder(USER, { eventType: "on_this_day", templateCode: "on-this-day-v1", consent: true, wechatAuthorization: "accept" });
}

/**
 * @param shotAt 传 null 模拟没有 EXIF 的照片（截图、历史照片）
 * @param createdAt 上传时间，`shot_at` 为 NULL 时时间线用它排序
 */
async function addPhoto(options: { shotAt: string | null; createdAt: string; petId?: string; position?: number }) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  await database.query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,shot_at,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',100,$5,$6,'clear',$7,$8)",
    [id, USER, options.petId || PET, `${id}.jpg`, `private/${USER}/photos/${id}.jpg`, options.position || 0, options.shotAt, options.createdAt],
  );
  return id;
}

describe("timeline", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("DELETE FROM memorial_spaces");
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2025-06-01T00:00:00Z")]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','dog','unknown','birthday','active',false,$3)", [OTHER_PET, USER, new Date("2025-06-01T00:00:00Z")]);
  });

  /**
   * 验收标准：时间线的「第几天」与 companion.js 算出的陪伴天数一致，不差一天。
   * 起算日是生日 2024-01-01，所以当天拍的照片是第 1 天。
   */
  it("第几天与陪伴天数同一口径，起算日当天为第 1 天", async () => {
    await addPhoto({ shotAt: "2024-01-01T10:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await addPhoto({ shotAt: "2024-01-10T10:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    const timeline = await getPetTimeline(USER, PET, { order: "asc" });
    expect(timeline.entries[0].day).toBe(daysSince("2024-01-01", "2024-01-01T10:00:00Z"));
    expect(timeline.entries[0].day).toBe(1);
    expect(timeline.entries[1].day).toBe(daysSince("2024-01-01", "2024-01-10T10:00:00Z"));
    expect(timeline.anchorType).toBe("birthday");
  });

  /** 验收标准：无 shot_at 的历史照片按上传时间排序，不报错、不排到 1970 */
  it("无 shot_at 的照片按上传时间排序，不排到 1970", async () => {
    await addPhoto({ shotAt: "2024-03-01T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await addPhoto({ shotAt: null, createdAt: "2024-06-01T00:00:00Z" });
    await addPhoto({ shotAt: "2024-09-01T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    const timeline = await getPetTimeline(USER, PET, { order: "asc" });
    expect(timeline.entries.map((entry) => entry.date)).toEqual(["2024-03-01", "2024-06-01", "2024-09-01"].map((date) => {
      // 断言用本地日历日，避免测试机时区把 UTC 零点推到前一天。
      const local = new Date(`${date}T00:00:00Z`);
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
    }));
    expect(timeline.entries.every((entry) => entry.day > 0)).toBe(true);
    // 只有上传时间的那张要标出来，端上才不会把它当拍摄事实。
    expect(timeline.entries.filter((entry) => entry.dateSource === "upload")).toHaveLength(1);
  });

  it("默认倒序，最近的在前", async () => {
    await addPhoto({ shotAt: "2024-03-01T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await addPhoto({ shotAt: "2024-09-01T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    const timeline = await getPetTimeline(USER, PET);
    expect(timeline.entries[0].day).toBeGreaterThan(timeline.entries[1].day);
  });

  it("只返回该宠物的照片，不串档", async () => {
    await addPhoto({ shotAt: "2024-03-01T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await addPhoto({ shotAt: "2024-04-01T00:00:00Z", createdAt: "2025-06-02T00:00:00Z", petId: OTHER_PET });
    expect((await getPetTimeline(USER, PET)).entries).toHaveLength(1);
    expect((await getPetTimeline(USER, OTHER_PET)).entries).toHaveLength(1);
  });

  it("没有生日时起算日退回建档日，anchorType 说明来源", async () => {
    await addPhoto({ shotAt: "2025-06-05T00:00:00Z", createdAt: "2025-06-05T00:00:00Z", petId: OTHER_PET });
    const timeline = await getPetTimeline(USER, OTHER_PET);
    expect(timeline.anchorType).toBe("created");
    expect(timeline.entries[0].day).toBeGreaterThan(0);
  });

  it("别人的宠物取不到时间线", async () => {
    await expect(getPetTimeline("00000000-0000-4000-8000-0000000000bf", PET)).rejects.toMatchObject({ code: "PET_NOT_FOUND" });
  });

  /** 里程碑只标已经过去的：已离开的宠物不该冒出一个不会发生的「第 1000 天」 */
  it("里程碑只含已达成的天数", async () => {
    await addPhoto({ shotAt: "2024-04-09T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    const timeline = await getPetTimeline(USER, PET);
    // 生日 2024-01-01 到今天已远超 365 天。
    expect(timeline.milestones.map((item) => item.day)).toContain(100);
    expect(timeline.milestones.map((item) => item.day)).toContain(365);
    for (const milestone of timeline.milestones) expect(milestone.day).toBeLessThanOrEqual(timeline.totalDays);
  });

  it("已离开的宠物总天数按纪念空间创建日封口", async () => {
    const database = await getDatabase();
    await addPhoto({ shotAt: "2024-04-09T00:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await database.query(
      "INSERT INTO memorial_spaces (id,user_id,pet_id,status,title,story,theme,photo_ids,visibility,lifecycle,created_at,updated_at) VALUES ($1,$2,$3,'private','年糕','','stardust','[]'::jsonb,'private','active',$4,$4)",
      [crypto.randomUUID(), USER, PET, new Date("2024-06-01T00:00:00Z")],
    );
    const timeline = await getPetTimeline(USER, PET);
    expect(timeline.memorialSince).toBeTruthy();
    // 2024-01-01 → 2024-06-01 = 153 天，远小于算到今天的天数。
    expect(timeline.totalDays).toBe(daysSince("2024-01-01", "2024-06-01T00:00:00Z"));
    expect(timeline.milestones.map((item) => item.day)).not.toContain(365);
  });
});

describe("on this day", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2025-06-01T00:00:00Z")]);
  });

  it("命中同月同日的更早照片", async () => {
    const now = new Date(2026, 6, 30, 12, 0);
    // 去年今日：2025-07-30
    await addPhoto({ shotAt: new Date(2025, 6, 30, 15, 0).toISOString(), createdAt: "2025-07-30T00:00:00Z" });
    // 同年不同日，不该命中
    await addPhoto({ shotAt: new Date(2025, 6, 29, 15, 0).toISOString(), createdAt: "2025-07-29T00:00:00Z" });
    const matches = await findOnThisDay(USER, now);
    expect(matches).toHaveLength(1);
    expect(matches[0].yearsAgo).toBe(1);
    expect(matches[0].petName).toBe("年糕");
  });

  /** 没命中就静默。硬凑出来的「回忆」是产品的表演，不是用户的事实 */
  it("没有命中时返回空，不硬凑", async () => {
    await addPhoto({ shotAt: new Date(2025, 0, 5, 12, 0).toISOString(), createdAt: "2025-01-05T00:00:00Z" });
    expect(await findOnThisDay(USER, new Date(2026, 6, 30, 12, 0))).toHaveLength(0);
    expect(await scheduleOnThisDay(USER, new Date(2026, 6, 30, 12, 0))).toEqual({ scheduled: 0 });
  });

  /** 只认真实拍摄时间：上传时间撞上今天纯属巧合，拿它说「去年今日」是假的 */
  it("只有上传时间的照片不算去年今日", async () => {
    await addPhoto({ shotAt: null, createdAt: new Date(2025, 6, 30, 12, 0).toISOString() });
    expect(await findOnThisDay(USER, new Date(2026, 6, 30, 12, 0))).toHaveLength(0);
  });

  it("今天拍的不算去年今日", async () => {
    const now = new Date(2026, 6, 30, 18, 0);
    await addPhoto({ shotAt: new Date(2026, 6, 30, 9, 0).toISOString(), createdAt: now.toISOString() });
    expect(await findOnThisDay(USER, now)).toHaveLength(0);
  });

  it("命中时排一条订阅消息，同一天不重复排", async () => {
    const now = new Date(2026, 6, 30, 12, 0);
    await addPhoto({ shotAt: new Date(2024, 6, 30, 15, 0).toISOString(), createdAt: "2024-07-30T00:00:00Z" });
    await grantConsent();
    const first = await scheduleOnThisDay(USER, now);
    expect(first.scheduled).toBe(1);
    expect(first.yearsAgo).toBe(2);
    // Worker 每轮都会调它，重复调用不该堆出多条。
    expect((await scheduleOnThisDay(USER, new Date(2026, 6, 30, 20, 0))).scheduled).toBe(0);
    const rows = await (await getDatabase()).query("SELECT id FROM message_subscriptions WHERE user_id=$1 AND event_type='on_this_day' AND status='scheduled'", [USER]);
    expect(rows).toHaveLength(1);
  });
});

/*
 * 授权门（改造项 E2）。
 *
 * 原实现直接 INSERT 一条 `status='scheduled'` 的记录当授权，而
 * `processDueMessages` 取 `status IN ('active','scheduled')` 会把它投出去 ——
 * 微信订阅消息是「一次授权一次下发」，无授权下发会被平台拦截并影响小程序信誉。
 *
 * 这一组测的是**不写投递记录**，而不是「不抛错」：抛不抛错不影响合规，
 * 有没有那行 INSERT 才影响。
 */
describe("去年今日的订阅授权门", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2025-06-01T00:00:00Z")]);
  });

  const NOW = new Date(2026, 6, 30, 12, 0);
  async function seedMatch() {
    await addPhoto({ shotAt: new Date(2024, 6, 30, 15, 0).toISOString(), createdAt: "2024-07-30T00:00:00Z" });
  }
  async function deliveryRows() {
    return (await getDatabase()).query("SELECT id,status FROM message_subscriptions WHERE user_id=$1 AND event_type='on_this_day' AND scheduled_at IS NOT NULL", [USER]);
  }

  it("无授权时命中也不写投递记录", async () => {
    await seedMatch();
    expect(await scheduleOnThisDay(USER, NOW)).toEqual({ scheduled: 0, reason: "no_consent" });
    expect(await deliveryRows()).toHaveLength(0);
  });

  /** 端上仍要能看到回忆 —— 那是用户自己的照片，授权只决定推不推送。 */
  it("无授权不影响回忆本身的可见性", async () => {
    await seedMatch();
    expect(await findOnThisDay(USER, NOW)).toHaveLength(1);
    expect(await onThisDayConsentState(USER)).toEqual({ consented: false });
  });

  it("被拒绝的授权不算授权", async () => {
    await seedMatch();
    await subscribeReminder(USER, { eventType: "on_this_day", consent: true, wechatAuthorization: "reject" });
    expect((await scheduleOnThisDay(USER, NOW)).scheduled).toBe(0);
    expect(await deliveryRows()).toHaveLength(0);
  });

  it("已撤销的授权不算授权", async () => {
    await seedMatch();
    const subscription = await subscribeReminder(USER, { eventType: "on_this_day", consent: true, wechatAuthorization: "accept" });
    await cancelSubscription(USER, subscription.id);
    expect((await scheduleOnThisDay(USER, NOW)).scheduled).toBe(0);
    expect(await deliveryRows()).toHaveLength(0);
  });

  it("有授权时才写投递记录", async () => {
    await seedMatch();
    await grantConsent();
    expect(await onThisDayConsentState(USER)).toEqual({ consented: true });
    expect((await scheduleOnThisDay(USER, NOW)).scheduled).toBe(1);
    expect(await deliveryRows()).toHaveLength(1);
  });

  /*
   * **一次授权一次下发。** 只补授权门却不消耗授权，等于把「从不授权」
   * 换成「授权一次、之后无限推」—— 合规状态没有改善。
   */
  it("一条授权只换一次推送，用完要重新授权", async () => {
    await seedMatch();
    await grantConsent();
    expect((await scheduleOnThisDay(USER, NOW)).scheduled).toBe(1);
    // 次年同一天再命中：授权已被消耗，不该再推。
    await addPhoto({ shotAt: new Date(2025, 6, 30, 15, 0).toISOString(), createdAt: "2025-07-30T00:00:00Z" });
    expect(await scheduleOnThisDay(USER, new Date(2027, 6, 30, 12, 0))).toEqual({ scheduled: 0, reason: "no_consent" });
    expect(await deliveryRows()).toHaveLength(1);
    // 重新授权后可以再推一次。
    await grantConsent();
    expect((await scheduleOnThisDay(USER, new Date(2027, 6, 30, 12, 0))).scheduled).toBe(1);
    expect(await deliveryRows()).toHaveLength(2);
  });
});

describe("growth pair", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2025-06-01T00:00:00Z")]);
  });

  /** 验收标准：对比图的两张照片确实来自不同时间，间隔天数正确 */
  it("挑出相隔最远的两张，间隔天数正确", async () => {
    await addPhoto({ shotAt: "2024-01-01T10:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await addPhoto({ shotAt: "2024-06-15T10:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    await addPhoto({ shotAt: "2024-12-31T10:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    const pair = await pickGrowthPair(USER, PET);
    expect(pair).toBeDefined();
    expect(pair!.earliest.date < pair!.latest.date).toBe(true);
    expect(pair!.gapDays).toBe(pair!.latest.day - pair!.earliest.day);
    expect(pair!.gapDays).toBeGreaterThan(300);
  });

  /** 一张照片比不出变化，返回 undefined 让调用方降级，不拿同一张比自己 */
  it("只有一张照片时返回 undefined", async () => {
    await addPhoto({ shotAt: "2024-01-01T10:00:00Z", createdAt: "2025-06-02T00:00:00Z" });
    expect(await pickGrowthPair(USER, PET)).toBeUndefined();
  });
});
