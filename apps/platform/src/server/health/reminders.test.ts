import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { runHealthReminders } from "@/server/health/reminders";
import { recordCare, recordWeight } from "@/server/health-service";

/*
 * 健康主动提示（改造项 L5）。
 *
 * 20 号文 3.1：健康线是「日常打开理由」的全部依据，而它 100% 被动 ——
 * **合规不产生留存**。这一组验的是提示确实会产生，以及三条铁律：
 *
 * 1. `memorial` 宠物一律排除（红线 10）—— 已离开的宠物收到体检提醒不可接受；
 * 2. 只陈述事实不给结论（不出现「异常」「该打疫苗了」这类评价或指令）；
 * 3. 每条提示只推一次（Worker 每小时跑一轮，去重失效会变成刷屏）。
 *
 * 断言落在 `user_notifications` 的实际行上，不落在返回值 ——
 * 用户看到的是通知，返回值只是计数。
 */

const USER = "00000000-0000-4000-8000-0000000000c1";
const ACTIVE = "00000000-0000-4000-8000-0000000000c2";
const MEMORIAL = "00000000-0000-4000-8000-0000000000c3";
const SENIOR = "00000000-0000-4000-8000-0000000000c4";

const NOW = new Date(2026, 7, 4, 10, 0);

function dateString(offsetDays: number) {
  const base = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offsetDays);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

async function notifications(type?: string) {
  const database = await getDatabase();
  return type
    ? database.query("SELECT type,title,body,target_path FROM user_notifications WHERE user_id=$1 AND type=$2 ORDER BY created_at", [USER, type])
    : database.query("SELECT type,title,body,target_path FROM user_notifications WHERE user_id=$1 ORDER BY created_at", [USER]);
}

/** 评价性与指令性词汇。提示只能陈述事实，不能替兽医下判断或开处置 */
const FORBIDDEN_WORDS = ["异常", "偏胖", "偏瘦", "超重", "肥胖", "正常范围", "诊断", "确诊", "治愈", "问诊", "疾病", "病情"];

describe("健康主动提示", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','birthday','active',true,now())", [ACTIVE, USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','cat','unknown','birthday','memorial',false,now())", [MEMORIAL, USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'豆包','dog','unknown','birthday','senior',false,now())", [SENIOR, USER]);
  });

  it("没有任何记录时不推任何提示", async () => {
    // senior 宠物的季度体检是唯一无需前置记录的提示，所以这里只断言不炸且不刷屏。
    const result = await runHealthReminders(NOW);
    expect(result.care).toBe(0);
    expect(result.weight).toBe(0);
  });

  /* ---------- 疫苗 / 驱虫到期 ---------- */

  it("到期前一周内开始提示，只给日期这个事实", async () => {
    await recordCare(USER, ACTIVE, { kind: "vaccine", label: "猫三联", performedOn: dateString(-360), dueOn: dateString(5) });
    expect((await runHealthReminders(NOW)).care).toBe(1);
    const rows = await notifications("health_care_due");
    expect(rows).toHaveLength(1);
    expect(String(rows[0].title)).toContain("年糕的猫三联");
    expect(String(rows[0].body)).toContain(dateString(5));
    // 不写「请尽快接种」——打什么、打不打由兽医决定（红线 2 的延伸）
    expect(String(rows[0].body)).not.toContain("接种");
  });

  it("还早的到期日不提示", async () => {
    await recordCare(USER, ACTIVE, { kind: "vaccine", label: "狂犬", performedOn: dateString(-30), dueOn: dateString(60) });
    expect((await runHealthReminders(NOW)).care).toBe(0);
    expect(await notifications("health_care_due")).toHaveLength(0);
  });

  it("已过期的措辞不同，但同样不给处置建议", async () => {
    await recordCare(USER, ACTIVE, { kind: "deworm_internal", label: "体内驱虫", performedOn: dateString(-120), dueOn: dateString(-10) });
    await runHealthReminders(NOW);
    const rows = await notifications("health_care_due");
    expect(String(rows[0].title)).toContain("已过期");
    expect(String(rows[0].body)).toContain("和兽医确认");
  });

  /** 没有下次到期日的一次性项目不该产生提示 */
  it("dueOn 为空表示不提醒", async () => {
    await recordCare(USER, ACTIVE, { kind: "checkup", label: "基础体检", performedOn: dateString(-3) });
    expect((await runHealthReminders(NOW)).care).toBe(0);
  });

  /*
   * Worker 每小时跑一轮，去重失效就是刷屏。
   * 去重记录先插、冲突即跳过，所以第二轮不产生通知。
   */
  it("同一条到期只推一次", async () => {
    await recordCare(USER, ACTIVE, { kind: "vaccine", label: "猫三联", performedOn: dateString(-360), dueOn: dateString(3) });
    expect((await runHealthReminders(NOW)).care).toBe(1);
    expect((await runHealthReminders(NOW)).care).toBe(0);
    expect((await runHealthReminders(new Date(NOW.getTime() + 3_600_000))).care).toBe(0);
    expect(await notifications("health_care_due")).toHaveLength(1);
  });

  /**
   * 续期后应当能再提示：subject_key 带上到期日，续期换了日期就是新的提示对象。
   * 只用 record id 会让续期后永远不再提醒。
   */
  it("续期成新的到期日后可以再提示", async () => {
    await recordCare(USER, ACTIVE, { kind: "vaccine", label: "猫三联", performedOn: dateString(-360), dueOn: dateString(3) });
    await runHealthReminders(NOW);
    const database = await getDatabase();
    // 用户把到期日续到明年，然后时间推进到新到期日前
    await database.query("UPDATE pet_care_records SET due_on=$1 WHERE pet_id=$2", [dateString(370), ACTIVE]);
    const nextYear = new Date(NOW.getFullYear() + 1, NOW.getMonth(), NOW.getDate() + 5);
    expect((await runHealthReminders(nextYear)).care).toBe(1);
    expect(await notifications("health_care_due")).toHaveLength(2);
  });

  /* ---------- memorial 屏蔽（红线 10）---------- */

  /*
   * **这是本组最重要的用例。** 已离开的宠物收到体检提醒是不可接受的，
   * 而这类错误一旦上线就是对用户最深的伤害之一。
   *
   * 记录直接插库而不走 recordCare —— 那条路径已经拒绝 memorial 宠物，
   * 用它构造不出这个场景。这里要验的是**提示扫描侧**也过滤。
   */
  it("memorial 宠物一律不出现在任何提示里", async () => {
    const database = await getDatabase();
    await database.query(
      "INSERT INTO pet_care_records (id,user_id,pet_id,kind,label,performed_on,due_on,created_at) VALUES ($1,$2,$3,'vaccine','猫三联',$4,$5,now())",
      [crypto.randomUUID(), USER, MEMORIAL, dateString(-360), dateString(2)],
    );
    await database.query(
      "INSERT INTO pet_weight_records (id,user_id,pet_id,weight_grams,measured_on,created_at) VALUES ($1,$2,$3,4000,$4,now()),($5,$2,$3,4400,$6,now())",
      [crypto.randomUUID(), USER, MEMORIAL, dateString(-20), crypto.randomUUID(), dateString(-1)],
    );
    const result = await runHealthReminders(NOW);
    /*
     * 断言落在**这只宠物**上而不是总数：同一个用户还有一只 senior 宠物，
     * 它的季度体检提示会计入 total。用总数断言会把「memorial 被正确排除」
     * 与「senior 提示正常工作」两件事混在一起，任一变化都让这条用例失去指向。
     */
    expect(result.care).toBe(0);
    expect(result.weight).toBe(0);
    const reminders = await database.query("SELECT id FROM health_reminders WHERE pet_id=$1", [MEMORIAL]);
    expect(reminders).toHaveLength(0);
    // 通知里也不能出现这只宠物的名字。
    for (const row of await notifications()) {
      expect(`${row.title} ${row.body}`).not.toContain("汤圆");
    }
  });

  /** 服务端写入侧也要拦：只做扫描侧过滤，接口仍可往已封存的档案写记录 */
  it("memorial 宠物拒绝写入健康记录", async () => {
    await expect(recordCare(USER, MEMORIAL, { kind: "vaccine", label: "猫三联", performedOn: dateString(-1) }))
      .rejects.toMatchObject({ code: "HEALTH_UNAVAILABLE_MEMORIAL" });
  });

  /* ---------- 体重变化 ---------- */

  it("变化达到阈值时提示，措辞不含「异常」", async () => {
    await recordWeight(USER, ACTIVE, { weightGrams: 4000, measuredOn: dateString(-20) });
    await recordWeight(USER, ACTIVE, { weightGrams: 4400, measuredOn: dateString(-1) });
    expect((await runHealthReminders(NOW)).weight).toBe(1);
    const rows = await notifications("health_weight_change");
    expect(rows).toHaveLength(1);
    expect(String(rows[0].body)).toContain("10%");
    expect(String(rows[0].body)).toContain("和兽医提一下");
    expect(String(rows[0].body)).not.toContain("异常");
  });

  it("变化不大时不提示", async () => {
    await recordWeight(USER, ACTIVE, { weightGrams: 4000, measuredOn: dateString(-20) });
    await recordWeight(USER, ACTIVE, { weightGrams: 4020, measuredOn: dateString(-1) });
    expect((await runHealthReminders(NOW)).weight).toBe(0);
  });

  it("只有一条记录时不谈趋势", async () => {
    await recordWeight(USER, ACTIVE, { weightGrams: 4000, measuredOn: dateString(-1) });
    expect((await runHealthReminders(NOW)).weight).toBe(0);
  });

  it("同一次称重只提醒一次，再称一次才会重新判", async () => {
    await recordWeight(USER, ACTIVE, { weightGrams: 4000, measuredOn: dateString(-20) });
    await recordWeight(USER, ACTIVE, { weightGrams: 4400, measuredOn: dateString(-2) });
    expect((await runHealthReminders(NOW)).weight).toBe(1);
    expect((await runHealthReminders(NOW)).weight).toBe(0);
    // 再称一次且仍有较大变化 —— 新的最近记录，应当再提示
    await recordWeight(USER, ACTIVE, { weightGrams: 4900, measuredOn: dateString(-1) });
    expect((await runHealthReminders(NOW)).weight).toBe(1);
  });

  /* ---------- senior 季度体检 ---------- */

  /*
   * `senior` 在此之前是一个空标签：方案 3.2 指出用户手动设成晚年后什么都不会变，
   * 「这比没有这个选项更差 —— 它给了一个承诺然后什么都不做」。
   * 这条季度提示是 senior 的第一个实际行为。
   */
  it("senior 宠物收到季度体检提示，措辞克制", async () => {
    expect((await runHealthReminders(NOW)).senior).toBe(1);
    const rows = await notifications("health_senior_checkup");
    expect(rows).toHaveLength(1);
    expect(String(rows[0].title)).toContain("豆包");
    // 不列具体检查项目（那是兽医根据触诊决定的），也不带紧迫感或恐吓
    expect(String(rows[0].body)).toContain("由兽医决定");
    expect(String(rows[0].body)).not.toContain("尽快");
  });

  it("同一季度内不重复提示", async () => {
    expect((await runHealthReminders(NOW)).senior).toBe(1);
    expect((await runHealthReminders(NOW)).senior).toBe(0);
    // 同季度内隔一天也不推
    expect((await runHealthReminders(new Date(NOW.getTime() + 86_400_000))).senior).toBe(0);
  });

  /** active 宠物不该收到季度体检提示 —— 那是晚年阶段特有的 */
  it("active 宠物没有季度体检提示", async () => {
    const database = await getDatabase();
    await database.query("DELETE FROM pets WHERE id=$1", [SENIOR]);
    expect((await runHealthReminders(NOW)).senior).toBe(0);
  });

  /* ---------- 文案红线 ---------- */

  /*
   * 扫全部提示文案。健康线的用户可见文案不得出现「诊断」「确诊」「治愈」
   * 「问诊」（红线 1），也不得出现评价性判断如「异常」。
   */
  it("全部提示文案不含禁用词", async () => {
    await recordCare(USER, ACTIVE, { kind: "vaccine", label: "猫三联", performedOn: dateString(-360), dueOn: dateString(2) });
    await recordCare(USER, ACTIVE, { kind: "deworm_external", label: "体外驱虫", performedOn: dateString(-90), dueOn: dateString(-5) });
    await recordWeight(USER, ACTIVE, { weightGrams: 4000, measuredOn: dateString(-20) });
    await recordWeight(USER, ACTIVE, { weightGrams: 4500, measuredOn: dateString(-1) });
    await runHealthReminders(NOW);
    const rows = await notifications();
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      const text = `${row.title} ${row.body}`;
      for (const word of FORBIDDEN_WORDS) {
        expect(text, `「${word}」不该出现在健康提示里：${text}`).not.toContain(word);
      }
    }
  });

  /** 提示要能点进去。target_path 指健康页而不是首页 —— 用户要看的是记录本身 */
  it("提示带上健康页的跳转路径", async () => {
    await recordCare(USER, ACTIVE, { kind: "vaccine", label: "猫三联", performedOn: dateString(-360), dueOn: dateString(2) });
    await runHealthReminders(NOW);
    expect(String((await notifications("health_care_due"))[0].target_path)).toContain("/pages/health/health");
  });
});
