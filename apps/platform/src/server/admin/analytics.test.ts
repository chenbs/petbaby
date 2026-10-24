import { beforeEach, describe, expect, it } from "vitest";

import { resolveAdminRange } from "@/lib/admin-range";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { getFeatures, getGrowth, getOverview, getRevenue } from "./analytics";
import { globalSearch, listPayments, listTasks, listUsers } from "./console";

/*
 * 口径测试：北京时间切日、现金收入不含冻干消耗、活跃取多张业务表的并集、留存只算已过观察期的注册日。
 * 时间都放在固定的北京日期上；区间用 custom，与真实「今天」无关。
 */

const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000a002";
const C = "00000000-0000-4000-8000-00000000a003";
const PET = "00000000-0000-4000-8000-00000000b001";

// 区间：北京 2026-10-05 至 2026-10-11；上一周期 09-28 至 10-04
const RANGE = resolveAdminRange({ range: "custom", from: "2026-10-05", to: "2026-10-11" }, new Date("2026-10-11T08:00:00Z"));

/** 北京时间 → Date */
const bj = (value: string) => new Date(`${value}+08:00`);

async function seed() {
  const db = await getDatabase();
  await db.query("INSERT INTO users (id,display_name,created_at) VALUES ($1,'阿橘',$4),($2,'年糕',$5),($3,'老用户',$6)", [A, B, C, bj("2026-10-05T10:00:00"), bj("2026-10-11T00:30:00"), bj("2026-09-01T10:00:00")]);
  await db.query("INSERT INTO pets (id,user_id,name,species,gender,created_at) VALUES ($1,$2,'橘子','cat','male',$3)", [PET, A, bj("2026-10-05T10:05:00")]);
  // A：注册当天创作，次日回访（创意照片），用掉冻干后充值
  await db.query("INSERT INTO ai_runs (id,user_id,plugin_id,status,options,created_at) VALUES ($1,$2,'pl-10','succeeded',$3::jsonb,$4),($5,$2,'pl-10','failed',$3::jsonb,$6)", [crypto.randomUUID(), A, JSON.stringify({ templateId: "fish-chase" }), bj("2026-10-05T11:00:00"), crypto.randomUUID(), bj("2026-10-06T09:00:00")]);
  // 写真套餐里的单张不算进「创意照片」
  await db.query("INSERT INTO ai_runs (id,user_id,plugin_id,status,options,created_at) VALUES ($1,$2,'pl-10','succeeded',$3::jsonb,$4)", [crypto.randomUUID(), A, JSON.stringify({ templateId: "pet-art-photo", artPhotoBatchId: crypto.randomUUID() }), bj("2026-10-06T09:05:00")]);
  // 北京 10-11 00:30 注册的 B：UTC 还是 10-10，必须落在 10-11
  await db.query("INSERT INTO events (id,user_id,name,created_at) VALUES ($1,$2,'visited',$3)", [crypto.randomUUID(), B, bj("2026-10-11T00:40:00")]);
  // C 只在上一周期活跃
  await db.query("INSERT INTO events (id,user_id,name,created_at) VALUES ($1,$2,'visited',$3)", [crypto.randomUUID(), C, bj("2026-10-02T12:00:00")]);
  // 收入：A 充值 38 元（区间内），C 上一周期充值 6 元；冻干消耗不计收入
  await db.query(
    `INSERT INTO growth_orders (id,user_id,kind,sku,amount,status,entitlement_snapshot,paid_at,created_at,updated_at) VALUES
      ($1,$2,'wallet_topup','fd-topup-38',38,'paid','{"units":50}',$3,$3,$3),
      ($4,$5,'wallet_topup','fd-topup-6',6,'paid','{"units":6}',$6,$6,$6),
      ($7,$2,'wallet_topup','fd-topup-18',18,'pending','{"units":22}',NULL,$3,$3)`,
    [crypto.randomUUID(), A, bj("2026-10-06T10:00:00"), crypto.randomUUID(), C, bj("2026-09-30T10:00:00"), crypto.randomUUID()],
  );
  await db.query(
    `INSERT INTO wallet_ledger (id,user_id,delta,balance_after,reason,biz_key,ref_type,title,created_at) VALUES
      ($1,$2,50,50,'topup','t1',NULL,'充值',$3),
      ($4,$2,-6,44,'spend','s1','ai_run','创意照片',$5),
      ($6,$2,2,46,'spend_return','r1','ai_run','退还',$5)`,
    [crypto.randomUUID(), A, bj("2026-10-06T10:00:00"), crypto.randomUUID(), bj("2026-10-06T11:00:00"), crypto.randomUUID()],
  );
  await db.query("INSERT INTO wallet_accounts (user_id,balance,first_topup_at,updated_at) VALUES ($1,46,$2,$2)", [A, bj("2026-10-06T10:00:00")]);
}

describe("运营分析口径", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seed();
  });

  it("总览：新增与活跃按北京时间计，收入只算实际收款", async () => {
    const overview = await getOverview(RANGE);
    expect(overview.now).toMatchObject({ newUsers: 2, activeUsers: 2, revenue: 38, payingUsers: 1, paidOrders: 1, spentUnits: 4 });
    expect(overview.before).toMatchObject({ newUsers: 0, activeUsers: 1, revenue: 6, payingUsers: 1 });
    const byDay = new Map(overview.daily.map((row) => [row.day, row]));
    expect(overview.daily).toHaveLength(7);
    expect(byDay.get("2026-10-11")).toMatchObject({ newUsers: 1, activeUsers: 1, returningUsers: 0 });
    expect(byDay.get("2026-10-10")).toMatchObject({ newUsers: 0, activeUsers: 0 });
    expect(byDay.get("2026-10-06")).toMatchObject({ activeUsers: 1, returningUsers: 1, revenue: 38 });
    // 3 个创意照片任务：1 成功 1 失败 + 1 写真单张成功
    expect(overview.now).toMatchObject({ creations: 3, succeeded: 2, failed: 1 });
  });

  it("增长：漏斗逐步收窄，次日留存只统计已满一天的注册", async () => {
    const growth = await getGrowth(RANGE);
    expect(growth.funnel.map((step) => [step.key, step.value])).toEqual([["registered", 2], ["has_pet", 1], ["uploaded", 0], ["created", 1], ["spent", 1], ["paid", 1]]);
    // B 在区间最后一天注册，不进次日留存的分母；A 次日（10-06）回访
    expect(growth.retention).toMatchObject({ d1Base: 1, d1: 1 });
    expect(growth.base).toMatchObject({ users: 3, withPet: 1 });
    expect(growth.cohorts.find((cohort) => cohort.cohort === "2026-10-05")).toMatchObject({ size: 2 });
  });

  it("增长：新用户按首次渠道与投放标记分组，实收统计到今天；邀请奖励单列", async () => {
    const db = await getDatabase();
    await db.query("UPDATE users SET acquisition_channel='search', acquisition_src='xhs-1005' WHERE id=$1", [A]);
    await db.query("UPDATE users SET acquisition_channel='invite', invited_by=$2 WHERE id=$1", [B, A]);
    await db.query("INSERT INTO invite_rewards (id,inviter_id,invitee_id,invitee_key,reward_date,units,status,created_at) VALUES ($1,$2,$3,'k-b','2026-10-11',1,'granted',$4)", [crypto.randomUUID(), A, B, bj("2026-10-11T09:00:00")]);
    const growth = await getGrowth(RANGE);
    expect(growth.channels).toEqual(expect.arrayContaining([
      { key: "search", registered: 1, hasPet: 1, spent: 1, paid: 1, revenue: 38 },
      { key: "invite", registered: 1, hasPet: 0, spent: 0, paid: 0, revenue: 0 },
    ]));
    expect(growth.sources).toEqual([{ key: "xhs-1005", registered: 1, hasPet: 1, spent: 1, paid: 1, revenue: 38 }]);
    expect(growth.invites).toEqual({ granted: 1, capped: 0, units: 1, inviters: 1 });
  });

  it("功能：写真套餐单张不算进创意照片，模板排行带入口名", async () => {
    const features = await getFeatures(RANGE);
    const image = features.summary.find((item) => item.key === "image");
    expect(image).toMatchObject({ uses: 2, users: 1, succeeded: 1, failed: 1, successRate: 0.5 });
    expect(features.templates[0]).toMatchObject({ templateId: "fish-chase", uses: 2 });
    expect(features.spend).toEqual([expect.objectContaining({ refType: "ai_run", units: 6 })]);
  });

  it("收入：来源分组、充值档、冻干收支与负债", async () => {
    const revenue = await getRevenue(RANGE);
    expect(revenue.sources.find((item) => item.source === "topup")).toMatchObject({ orders: 1, amount: 38 });
    expect(revenue.packages).toEqual([expect.objectContaining({ sku: "fd-topup-38", orders: 1, units: 50 })]);
    expect(revenue.economyTotals).toMatchObject({ topup: 50, spent: 6, returned: 2 });
    expect(revenue.arppu).toBe(38);
    expect(revenue.firstTopups).toBe(1);
    expect(revenue.payers[0]).toMatchObject({ userId: A, amount: 38 });
  });

  it("列表：用户分群与搜索、任务按失败优先", async () => {
    // 「付费用户」分群看历史累计：C 只在上一周期付过费，也算；按注册时间倒序
    expect((await listUsers({ segment: "paying" })).items.map((user) => user.id)).toEqual([A, C]);
    expect((await listUsers({ segment: "holders" })).items.map((user) => user.id)).toEqual([A]);
    expect((await listUsers({ q: "年糕" })).items.map((user) => user.id)).toEqual([B]);
    expect((await listUsers({ q: "100%" })).total).toBe(0);
    const tasks = await listTasks({ kind: "image" });
    expect(tasks.total).toBe(3);
    expect(tasks.items[0].status).toBe("failed");
    expect((await listPayments({})).total).toBe(0);
    expect((await globalSearch("阿橘")).users).toHaveLength(1);
    expect((await globalSearch("a")).users).toHaveLength(0);
  });
});
