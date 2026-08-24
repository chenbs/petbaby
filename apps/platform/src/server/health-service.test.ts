import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createHealthSession, getHealthSession, listHealthSessions, listWeights, recordWeight } from "@/server/health-service";

const USER = "00000000-0000-4000-8000-0000000000c1";
const PET = "00000000-0000-4000-8000-0000000000c2";
const MEMORIAL_PET = "00000000-0000-4000-8000-0000000000c3";
const OTHER_USER = "00000000-0000-4000-8000-0000000000c4";

describe("健康分诊", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [OTHER_USER]);
    await database.query(
      "INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,now())",
      [PET, USER],
    );
    await database.query(
      "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','dog','unknown','birthday','memorial',false,now())",
      [MEMORIAL_PET, USER],
    );
  });

  it("给出四档之一，带升级条件与免责声明", async () => {
    const session = await createHealthSession(USER, { petId: PET, description: "今天有点掉毛，还会挠痒痒" });
    expect(["emergency", "urgent_24h", "observe", "routine"]).toContain(session.triageLevel);
    expect(session.advisory.watchFor.length).toBeGreaterThan(0);
    expect(session.advisory.disclaimer).toMatch(/不是诊断/);
    expect(session.status).toBe("succeeded");
  });

  /*
   * A3 紧急直通：必须在调模型之前，且 triage_source 要记成 keyword。
   * 这个字段是审计要求 —— 争议追溯时要能区分「AI 判的」与「规则判的」。
   */
  it("紧急症状走关键词直通，不经过模型", async () => {
    const session = await createHealthSession(USER, { petId: PET, description: "猫突然呼吸困难，张着嘴喘" });
    expect(session.triageLevel).toBe("emergency");
    expect(session.triageSource).toBe("keyword");
  });

  it("普通症状走模型路径", async () => {
    const session = await createHealthSession(USER, { petId: PET, description: "眼角有一点眼屎，精神还不错" });
    expect(session.triageSource).toBe("model");
  });

  /*
   * 红线 10：已离开的宠物屏蔽全部健康功能。
   * **服务端拦截与端上隐藏都要做** —— 只做端上隐藏，接口仍可调。
   */
  it("memorial 宠物拒绝健康分诊", async () => {
    await expect(createHealthSession(USER, { petId: MEMORIAL_PET, description: "最近好像不太舒服" }))
      .rejects.toMatchObject({ code: "HEALTH_UNAVAILABLE_MEMORIAL" });
  });

  it("他人宠物返回 404", async () => {
    await expect(createHealthSession(OTHER_USER, { petId: PET, description: "有点咳嗽，持续两天了" }))
      .rejects.toMatchObject({ code: "PET_NOT_FOUND" });
  });

  it("描述过短被拒", async () => {
    await expect(createHealthSession(USER, { petId: PET, description: "咳" })).rejects.toThrow();
  });

  /** 免费文字额度 3 次/日，第 4 次被拒。 */
  it("超出每日文字额度被拒", async () => {
    for (let index = 0; index < 3; index += 1) {
      await createHealthSession(USER, { petId: PET, description: `第 ${index} 次咨询，有点掉毛` });
    }
    await expect(createHealthSession(USER, { petId: PET, description: "第四次咨询，还是掉毛" }))
      .rejects.toMatchObject({ code: "HEALTH_QUOTA_USED" });
  });

  /*
   * 健康额度独立于创意生成的 daily_quotas —— 健康分诊用完不该影响做图额度，
   * 那是两种资源。用完健康额度后 daily_quotas 必须仍然是空的。
   */
  it("健康额度不占用创意生成的日额度", async () => {
    await createHealthSession(USER, { petId: PET, description: "有点掉毛，会挠痒" });
    const database = await getDatabase();
    const rows = await database.query("SELECT count(*)::int total FROM daily_quotas WHERE user_id=$1", [USER]);
    expect(Number(rows[0].total)).toBe(0);
  });

  it("快照记录当时的档案信息", async () => {
    await recordWeight(USER, PET, { weightGrams: 4200, measuredOn: "2026-08-01" });
    const session = await createHealthSession(USER, { petId: PET, description: "最近有点掉毛" });
    const database = await getDatabase();
    const rows = await database.query("SELECT pet_snapshot FROM health_sessions WHERE id=$1", [session.id]);
    const snapshot = rows[0].pet_snapshot as Record<string, unknown>;
    expect(snapshot.name).toBe("年糕");
    expect(snapshot.species).toBe("cat");
    // 体重进快照：用户后续改档案不该改变历史分诊记录的输入前提。
    expect(snapshot.weightGrams).toBe(4200);
  });

  it("可按宠物查列表与详情，他人记录取不到", async () => {
    const session = await createHealthSession(USER, { petId: PET, description: "有点掉毛，会挠痒" });
    const list = await listHealthSessions(USER, PET);
    expect(list.map((item) => item.id)).toContain(session.id);
    expect(await getHealthSession(USER, session.id)).toMatchObject({ id: session.id });
    await expect(getHealthSession(OTHER_USER, session.id)).rejects.toMatchObject({ code: "HEALTH_SESSION_NOT_FOUND" });
  });

  it("输出不含药物提示", async () => {
    const session = await createHealthSession(USER, { petId: PET, description: "一直拉稀，精神也差，该怎么用药" });
    const joined = [
      session.advisory.summary,
      ...session.advisory.relatedAreas,
      ...session.advisory.watchFor,
      ...session.advisory.visitPreparation,
    ].join(" ");
    expect(joined).not.toMatch(/毫克|mg|片|粒|抗生素|消炎药|布洛芬|阿莫西林/);
  });
});

describe("体重记录", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [OTHER_USER]);
    await database.query(
      "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','birthday','active',true,now())",
      [PET, USER],
    );
  });

  it("以克存储并可查列表", async () => {
    await recordWeight(USER, PET, { weightGrams: 4200, measuredOn: "2026-08-01" });
    const list = await listWeights(USER, PET);
    expect(list).toHaveLength(1);
    expect(list[0].weightGrams).toBe(4200);
    expect(list[0].measuredOn).toBe("2026-08-01");
  });

  /*
   * 同一天覆盖而非堆叠：一天称三次没有趋势意义，
   * 堆叠会让体重曲线在同一个横坐标上出现多个点。
   */
  it("同一天重复录入是覆盖", async () => {
    await recordWeight(USER, PET, { weightGrams: 4200, measuredOn: "2026-08-01" });
    await recordWeight(USER, PET, { weightGrams: 4350, measuredOn: "2026-08-01" });
    const list = await listWeights(USER, PET);
    expect(list).toHaveLength(1);
    expect(list[0].weightGrams).toBe(4350);
  });

  it("不同日期各成一条，按日期倒序", async () => {
    await recordWeight(USER, PET, { weightGrams: 4000, measuredOn: "2026-07-01" });
    await recordWeight(USER, PET, { weightGrams: 4200, measuredOn: "2026-08-01" });
    const list = await listWeights(USER, PET);
    expect(list.map((item) => item.measuredOn)).toEqual(["2026-08-01", "2026-07-01"]);
  });

  it("他人宠物不能录入", async () => {
    await expect(recordWeight(OTHER_USER, PET, { weightGrams: 4200, measuredOn: "2026-08-01" }))
      .rejects.toMatchObject({ code: "PET_NOT_FOUND" });
  });

  it("超出合理范围的体重被拒", async () => {
    await expect(recordWeight(USER, PET, { weightGrams: 0, measuredOn: "2026-08-01" })).rejects.toThrow();
    await expect(recordWeight(USER, PET, { weightGrams: 999_999, measuredOn: "2026-08-01" })).rejects.toThrow();
  });
});
