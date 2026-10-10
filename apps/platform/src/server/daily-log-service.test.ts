import { beforeEach, describe, expect, it } from "vitest";
import { fundWallet } from "@/server/wallet/test-helpers";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { describeRecord, RECORD_KINDS } from "@/server/daily-log-kinds";
import { recentContextLines } from "@/server/daily-log-context";
import {
  cleanupOrphanAttachments,
  createRecord,
  deleteRecord,
  getRecordAttachmentObject,
  getRecordOverview,
  getVisitSummary,
  listRecords,
  saveRecordAttachment,
} from "@/server/daily-log-service";
import { createHealthSession, createHealthDocument } from "@/server/health-service";
import { buildHealthDocumentSvg } from "@/server/health/document";
import { objectStorage } from "@/server/storage";

const USER = "00000000-0000-4000-8000-0000000000d1";
const PET = "00000000-0000-4000-8000-0000000000d2";
const MEMORIAL_PET = "00000000-0000-4000-8000-0000000000d3";
const OTHER_USER = "00000000-0000-4000-8000-0000000000d4";

function day(offset: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("日常记录", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER_USER]);
    await database.query(
      "INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,now())",
      [PET, USER],
    );
    await database.query(
      "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','dog','unknown','birthday','memorial',false,now())",
      [MEMORIAL_PET, USER],
    );
  });

  it("三类来源合并成一条时间流，按日期与时间倒序", async () => {
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-1), occurredTime: "08:30", details: { count: 2, content: "foam" } });
    await createRecord(USER, PET, { kind: "weight", occurredOn: day(0), details: { weightKg: 4.2 } });
    await createRecord(USER, PET, { kind: "care", occurredOn: day(-2), details: { careKind: "vaccine", label: "猫三联", dueOn: day(300) } });
    await createRecord(USER, PET, { kind: "meal", occurredOn: day(-1), occurredTime: "19:00", details: { appetite: "little" } });
    const { items, nextCursor } = await listRecords(USER, PET);
    expect(items.map((item) => item.kind)).toEqual(["weight", "meal", "vomit", "vaccine"]);
    expect(items[0]).toMatchObject({ source: "weight", title: "体重", summary: "4.2 公斤" });
    expect(items[2].summary).toBe("2 次 · 白色泡沫");
    expect(items[3]).toMatchObject({ source: "care", title: "疫苗" });
    expect(nextCursor).toBeNull();
  });

  it("按分组筛选与分页", async () => {
    for (let index = 0; index < 5; index += 1) await createRecord(USER, PET, { kind: "stool", occurredOn: day(-index), details: { form: "formed" } });
    await createRecord(USER, PET, { kind: "weight", occurredOn: day(0), details: { weightKg: 4 } });
    const first = await listRecords(USER, PET, { group: "body", pageSize: "3" });
    expect(first.items).toHaveLength(3);
    expect(first.items.every((item) => item.kind === "stool")).toBe(true);
    const second = await listRecords(USER, PET, { group: "body", pageSize: "3", cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("按清单校验：未登记的键被剥掉，选项值必须合法，必填项缺失报错", async () => {
    await createRecord(USER, PET, { kind: "stool", occurredOn: day(0), details: { form: "soft", diagnosis: "肠炎" } });
    const [item] = (await listRecords(USER, PET)).items;
    expect(item.details).toEqual({ form: "soft" });
    await expect(createRecord(USER, PET, { kind: "stool", occurredOn: day(0), details: { form: "腹泻" } })).rejects.toMatchObject({ code: "RECORD_FIELD_INVALID" });
    await expect(createRecord(USER, PET, { kind: "medication", occurredOn: day(0), details: { dose: "半片" } })).rejects.toMatchObject({ code: "RECORD_FIELD_REQUIRED" });
    await expect(createRecord(USER, PET, { kind: "other", occurredOn: day(0) })).rejects.toMatchObject({ code: "RECORD_EMPTY" });
    await expect(createRecord(USER, PET, { kind: "other", occurredOn: day(5), note: "未来" })).rejects.toMatchObject({ code: "RECORD_DATE_IN_FUTURE" });
  });

  /** 与健康线红线 10 同口径：已离开的宠物不再接受新记录 */
  it("memorial 宠物拒绝新记录，他人宠物 404", async () => {
    await expect(createRecord(USER, MEMORIAL_PET, { kind: "other", occurredOn: day(0), note: "想你" })).rejects.toMatchObject({ code: "RECORDS_SEALED_MEMORIAL" });
    await expect(createRecord(OTHER_USER, PET, { kind: "other", occurredOn: day(0), note: "x" })).rejects.toMatchObject({ code: "PET_NOT_FOUND" });
    await expect(listRecords(OTHER_USER, PET)).rejects.toMatchObject({ code: "PET_NOT_FOUND" });
  });

  /** 备注里写下紧急表现时，用分诊同一份关键词提示立即就医 */
  it("备注命中紧急关键词时返回 urgentAreas", async () => {
    const result = await createRecord(USER, PET, { kind: "symptom", occurredOn: day(0), details: { signs: ["lethargic"] }, note: "一直蹲猫砂，尿不出来" });
    expect(result.urgentAreas).toContain("泌尿");
    const calm = await createRecord(USER, PET, { kind: "symptom", occurredOn: day(0), details: { signs: ["sneeze"] } });
    expect(calm.urgentAreas).toEqual([]);
  });

  it("概览：连续天数、上次间隔、近 7 天计数、到期与疗程", async () => {
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-3), details: { count: 2 } });
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-1), details: { count: 1 } });
    await createRecord(USER, PET, { kind: "stool", occurredOn: day(-1), details: { form: "watery", count: 3 } });
    await createRecord(USER, PET, { kind: "meal", occurredOn: day(-2), details: { appetite: "all" } });
    await createRecord(USER, PET, { kind: "medication", occurredOn: day(-1), details: { name: "医院开的药", dose: "半片", courseDays: 5 } });
    await createRecord(USER, PET, { kind: "medication", occurredOn: day(0), details: { name: "医院开的药" } });
    await createRecord(USER, PET, { kind: "care", occurredOn: day(-360), details: { careKind: "vaccine", label: "猫三联", dueOn: day(5) } });
    await createRecord(USER, PET, { kind: "care", occurredOn: day(-200), details: { careKind: "deworm_internal", label: "体内驱虫", dueOn: day(-10) } });
    // 同一项目续打后，旧那条的到期日不该再出现
    await createRecord(USER, PET, { kind: "care", occurredOn: day(-5), details: { careKind: "deworm_internal", label: "体内驱虫", dueOn: day(85) } });
    await createRecord(USER, PET, { kind: "visit", occurredOn: day(-1), details: { type: "visit", followUpOn: day(6) } });

    const overview = await getRecordOverview(USER, PET);
    expect(overview.streakDays).toBe(4);
    expect(overview.todayCount).toBe(1);
    expect(overview.intervals.find((item) => item.key === "vomit")).toMatchObject({ daysAgo: 1, text: "上次呕吐：1 天前" });
    expect(overview.intervals.find((item) => item.key === "deworm_internal")?.daysAgo).toBe(5);
    expect(overview.recentFacts).toEqual(["近 7 天记了 3 次呕吐", "近 7 天便便偏软或更稀 3 次"]);
    expect(overview.upcoming.map((item) => item.title)).toEqual(["疫苗 · 猫三联", "复诊"]);
    expect(overview.courses).toEqual([expect.objectContaining({ name: "医院开的药", dayIndex: 2, courseDays: 5, dosesToday: 1 })]);
  });

  /** 概览文字只陈述事实：与体重趋势同一份评价词守卫 */
  it("概览与摘要不含评价性措辞", async () => {
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(0), details: { count: 3, blood: true } });
    await createRecord(USER, PET, { kind: "stool", occurredOn: day(0), details: { form: "watery" } });
    const overview = await getRecordOverview(USER, PET);
    const summary = await getVisitSummary(USER, PET);
    const text = JSON.stringify(overview) + summary.text + RECORD_KINDS.flatMap((spec) => spec.fields.map((field) => field.label + ("options" in field ? field.options.map((option) => option.label).join("") : ""))).join("");
    for (const word of ["异常", "正常", "严重", "诊断", "确诊", "腹泻", "肠炎", "偏胖", "健康状况"]) {
      expect(text, `「${word}」不该出现`).not.toContain(word);
    }
  });

  it("就医摘要罗列近 N 天身体状况与用药、计数并附疫苗驱虫", async () => {
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-2), occurredTime: "07:10", details: { count: 2, content: "food" }, note: "吃完粮就吐" });
    await createRecord(USER, PET, { kind: "meal", occurredOn: day(-1), details: { appetite: "all" } });
    await createRecord(USER, PET, { kind: "weight", occurredOn: day(-1), details: { weightKg: 4.1 } });
    await createRecord(USER, PET, { kind: "care", occurredOn: day(-30), details: { careKind: "vaccine", label: "猫三联" } });
    const summary = await getVisitSummary(USER, PET, { days: "7" });
    expect(summary.header[1]).toContain("4.1 公斤");
    expect(summary.counts).toEqual(["呕吐 2 次"]);
    // 「吃完了」是没有信息量的日常，不进就医摘要
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]).toContain("07:10 呕吐 · 2 次 · 没消化的粮（吃完粮就吐）");
    expect(summary.care[0]).toContain("疫苗 猫三联");
    expect(summary.text).toContain("仅供参考");
  });

  it("附图：私有存储、只有本人可读、随记录删除清理、孤儿附图一天后清理", async () => {
    const key = `private/${USER}/records/${crypto.randomUUID()}.png`;
    await objectStorage.put(key, new Uint8Array([1, 2, 3]), "image/png");
    const attachment = await saveRecordAttachment(USER, PET, { storageKey: key, mimeType: "image/png" });
    const { record } = await createRecord(USER, PET, { kind: "vomit", occurredOn: day(0), details: { count: 1 }, attachmentIds: [attachment.id] });
    expect((await listRecords(USER, PET)).items[0].attachments).toEqual([{ id: attachment.id, url: `/api/record-attachments/${attachment.id}/media` }]);
    expect((await getRecordAttachmentObject(USER, attachment.id)).body).toBeTruthy();
    await expect(getRecordAttachmentObject(OTHER_USER, attachment.id)).rejects.toMatchObject({ code: "RECORD_ATTACHMENT_NOT_FOUND" });
    // 已挂到别的记录上的附图不能再挂一次
    await expect(createRecord(USER, PET, { kind: "other", occurredOn: day(0), note: "x", attachmentIds: [attachment.id] })).rejects.toMatchObject({ code: "RECORD_ATTACHMENT_INVALID" });

    await deleteRecord(USER, PET, record.id, "log");
    expect(await objectStorage.get(key)).toBeNull();
    expect((await listRecords(USER, PET)).items).toHaveLength(0);

    const orphanKey = `private/${USER}/records/${crypto.randomUUID()}.png`;
    await objectStorage.put(orphanKey, new Uint8Array([1]), "image/png");
    const orphan = await saveRecordAttachment(USER, PET, { storageKey: orphanKey, mimeType: "image/png" });
    expect(await cleanupOrphanAttachments()).toBe(0);
    await (await getDatabase()).query("UPDATE pet_record_attachments SET created_at=now()-interval '2 days' WHERE id=$1", [orphan.id]);
    expect(await cleanupOrphanAttachments()).toBe(1);
    expect(await objectStorage.get(orphanKey)).toBeNull();
  });

  it("删除体重与疫苗记录走各自的表，他人无法删除", async () => {
    const weight = await createRecord(USER, PET, { kind: "weight", occurredOn: day(0), details: { weightKg: 4 } });
    const care = await createRecord(USER, PET, { kind: "care", occurredOn: day(0), details: { careKind: "checkup", label: "年度体检" } });
    await expect(deleteRecord(OTHER_USER, PET, weight.record.id, "weight")).rejects.toMatchObject({ code: "WEIGHT_RECORD_NOT_FOUND" });
    await deleteRecord(USER, PET, weight.record.id, "weight");
    await deleteRecord(USER, PET, care.record.id, "care");
    expect((await listRecords(USER, PET)).items).toHaveLength(0);
  });

  it("健康助手带上近 7 天记录作为上下文，并快照进会话", async () => {
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-2), details: { count: 1 } });
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-1), details: { count: 2 } });
    await createRecord(USER, PET, { kind: "meal", occurredOn: day(-1), details: { appetite: "all" } });
    await createRecord(USER, PET, { kind: "vomit", occurredOn: day(-20), details: { count: 1 } });
    const lines = await recentContextLines(USER, PET);
    expect(lines).toHaveLength(2);
    const session = await createHealthSession(USER, { petId: PET, description: "今天又有点没精神" });
    expect(session.contextRecords).toEqual(lines);
    // 本地规则实现：近 7 天两天都记了呕吐 → 24 小时内就医，并点出记录
    expect(session.triageLevel).toBe("urgent_24h");
    expect(session.advisory.summary).toContain("近 7 天有 2 天");
    const without = await createHealthSession(USER, { petId: PET, description: "今天又有点没精神", includeRecords: false });
    expect(without.contextRecords).toEqual([]);
  });

  it("健康档案 PDF 收录近期日常记录", async () => {
    const svg = buildHealthDocumentSvg({
      petName: "年糕", species: "cat", lifeStage: "active", generatedOn: day(0), weights: [], care: [], sessions: [],
      records: [`${day(0)}　呕吐 · 2 次`],
    });
    expect(svg).toContain("近期日常记录");
    expect(svg).toContain("呕吐 · 2 次");
    // 健康档案每份 6 颗冻干（2026-10-08 起，会员下线）。
    await fundWallet(USER, 6);
    await createRecord(USER, PET, { kind: "stool", occurredOn: day(0), details: { form: "soft" } });
    const document = await createHealthDocument(USER, PET);
    expect(document.records).toBe(1);
  });

  it("describeRecord 处理多选、开关与日期字段", () => {
    expect(describeRecord("symptom", { signs: ["cough", "sneeze"] }).summary).toBe("咳嗽、打喷嚏");
    expect(describeRecord("stool", { form: "soft", blood: true, count: 1 }).summary).toBe("偏软 · 看到血丝");
    expect(describeRecord("visit", { type: "recheck", vetSaid: "再观察三天", followUpOn: "2026-10-12" }).summary).toBe("复查 · 医生说：再观察三天 · 复诊日期 2026-10-12");
    expect(describeRecord("medication", { name: "药", courseDays: 7 }).summary).toBe("药 · 疗程 7 天");
    expect(describeRecord("unknown", {}).title).toBe("记录");
  });
});
