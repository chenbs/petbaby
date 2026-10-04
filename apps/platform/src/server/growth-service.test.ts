import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createAiRun, getAiRun, rerollAiRun, listAiRuns, processNextAiRun, selectAiCandidate, unlockAiCandidate, scheduleUpcomingReminders, createPhysicalOrder, createAnnualReport, payPhysicalOrder, createExperiment, updateExperiment, rollbackExperiment, updatePhysicalOrderStatus, expirePastDueMemberships } from "@/server/growth-service";
import { decryptAddress } from "@/server/commerce/address";
import { objectStorage } from "@/server/storage";
import { payOrder, deletePhoto, getDownload, getWork } from "@/server/platform-service";
import { acknowledgeAiDisclosure } from "@/server/ai-disclosure-service";
import { listRuntimePlugins } from "@/plugins/runtime";

const USER = "00000000-0000-4000-8000-00000000000c";
const PET = "00000000-0000-4000-8000-00000000000d";
const PHOTO = "00000000-0000-4000-8000-00000000000e";
const MASTER_KEY = "samples/image-templates/pet-expression-grid-30c2d3341262.webp";

describe("stage two growth services", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Milo','cat','unknown','birthday','active',true,now())", [PET, USER]);
    await database.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,'milo.png','image/png',1,$4,0,'clear',now())", [PHOTO, USER, PET, `private/${USER}/photos/milo.png`]);
    await objectStorage.put(`private/${USER}/photos/milo.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"), "image/png");
    await objectStorage.put(MASTER_KEY, new TextEncoder().encode("owned-master"), "image/webp");
  });

  it("expires memberships only after three full days past due", async () => {
    const database = await getDatabase();
    const now = new Date("2026-09-27T12:00:00Z");
    const cases = [
      { id: crypto.randomUUID(), status: "past_due", updatedAt: "2026-09-24T11:59:59Z" },
      { id: crypto.randomUUID(), status: "past_due", updatedAt: "2026-09-24T12:00:00Z" },
      { id: crypto.randomUUID(), status: "active", updatedAt: "2026-09-23T12:00:00Z" },
    ];
    for (const item of cases) {
      await database.query(
        "INSERT INTO memberships (id,user_id,plan,status,quota,used,expires_at,created_at,status_updated_at) VALUES ($1,$2,'yearly',$3,5,1,$4,$4,$5)",
        [item.id, USER, item.status, now, new Date(item.updatedAt)],
      );
    }

    expect(await expirePastDueMemberships(now)).toBe(1);
    const rows = await database.query<{ id: string; status: string; quota: number; used: number }>(
      "SELECT id,status,quota,used FROM memberships WHERE user_id=$1", [USER],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(cases[0].id)).toMatchObject({ status: "expired", quota: 0, used: 0 });
    expect(byId.get(cases[1].id)).toMatchObject({ status: "past_due", quota: 5, used: 1 });
    expect(byId.get(cases[2].id)).toMatchObject({ status: "active", quota: 5, used: 1 });
  });

  it("queues AI runs, generates one image and archives it as a work automatically", async () => {
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], prompt: "a cat", idempotencyKey: "ai-test-run-1" });
    expect(run.status).toBe("queued");
    expect(run.roleInputs).toMatchObject({ subjectMode: "pet", templateId: "pet-expression-grid", petPhotoIds: [PHOTO] });
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const ready = await getAiRun(USER, run.id);
    expect(ready.candidates).toHaveLength(1);
    // 单张出图即自动选中并归档；再次选择（旧客户端）是幂等的
    expect(ready.selectedId).toBe(ready.candidates[0].id);
    expect(ready.workId).toBeTruthy();
    const selected = await Promise.all([selectAiCandidate(USER, run.id, ready.candidates[0].id), selectAiCandidate(USER, run.id, ready.candidates[0].id)]);
    expect(selected[0].workId).toBe(ready.workId);
    expect(selected[1].workId).toBe(ready.workId);
    expect(await (await getDatabase()).query("SELECT id FROM works WHERE source_id=$1", [run.id])).toHaveLength(1);
    const pending = await unlockAiCandidate(USER, run.id);
    expect(pending.order?.status).toBe("pending");
    await payOrder(USER, String(pending.order?.id));
    expect((await getAiRun(USER, run.id)).selectedUnlocked).toBe(true);

    /*
     * 2026-09 口径：图上不画可见标识，只写元数据；界面蒙层文案由服务端下发；
     * 第一次交付原图前必须确认标识义务，确认后每次交付都留日志。
     */
    const unlocked = await getAiRun(USER, run.id);
    expect(unlocked.aiNotice).toBe("该内容由AI生成");
    const work = await getWork(USER, String(unlocked.workId));
    expect(work.aiGenerated).toBe(true);
    expect(work.title).not.toMatch(/AI/);
    expect(work.authority).not.toMatch(/AI/);
    expect(work.expiresAt).toBeUndefined();
    const outputMeta = await sharp(Buffer.from((await objectStorage.get(String(work.outputKey)))!.body)).metadata();
    expect(Buffer.from(outputMeta.exif as Buffer).toString("latin1")).toContain("AI-generated");
    const previewMeta = await sharp(Buffer.from((await objectStorage.get(String(work.previewKey)))!.body)).metadata();
    expect(previewMeta.exif, "预览缩图也必须保留隐式标识").toBeTruthy();
    await expect(getDownload(USER, work.id, "image")).rejects.toMatchObject({ code: "AI_DISCLOSURE_REQUIRED", status: 428 });
    await acknowledgeAiDisclosure(USER, "miniprogram");
    await expect(getDownload(USER, work.id, "image")).resolves.toMatchObject({ key: work.outputKey });
    expect(await (await getDatabase()).query("SELECT id FROM ai_original_deliveries WHERE user_id=$1 AND resource_id=$2", [USER, work.id])).toHaveLength(1);
    expect((await listAiRuns(USER)).map((item) => item.id)).not.toContain(run.id);
  });

  it("进行中列表包含未选中的独立任务，不包含写真套餐逐张任务", async () => {
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], idempotencyKey: "ai-test-in-progress" });
    const listed = await listAiRuns(USER);
    expect(listed.map((item) => item.id)).toContain(run.id);
    expect(listed.find((item) => item.id === run.id)).toMatchObject({ status: "queued", aiNotice: "该内容由AI生成" });
    expect(listed.find((item) => item.id === run.id)?.title).not.toMatch(/AI/);
  });

  it("必需母版缺失时明确失败，不回退文生图", async () => {
    await objectStorage.delete(MASTER_KEY);
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], idempotencyKey: "ai-test-missing-master" });
    expect((await processNextAiRun())?.status).toBe("failed");
    expect((await getAiRun(USER, run.id)).errorCode).toBe("必需参考图不存在，请重新选择或联系运营补齐母版");
  });

  it("艺术写真只用宠物身份照，并保留旧风格入参映射的场景", async () => {
    await objectStorage.delete(MASTER_KEY);
    const run = await createAiRun(USER, {
      pluginId: "pl-10", templateId: "pet-art-photo", petId: PET, photoIds: [PHOTO],
      options: { style: "paper-cut" }, idempotencyKey: "ai-test-art-photo",
    });
    expect(run.options.scene).toBe("garden-curious");
    expect(run.prompt).toContain("green dinosaur hoodie and leans against the plush toy");
    expect(run.prompt).toContain("Image 1 as the sole pet identity reference");
    expect((await processNextAiRun())?.status).toBe("succeeded");
    expect((await getAiRun(USER, run.id)).candidates).toHaveLength(1);
  });

  it("历史多候选任务未选中时删除原照，不能再创建引用该照片的新作品", async () => {
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], idempotencyKey: "deleted-ai-source" });
    await processNextAiRun();
    // 还原成 2026-10 之前「出图后等用户挑」的状态：撤下自动归档的作品、清空选择
    const database = await getDatabase();
    await database.query("DELETE FROM work_versions WHERE work_id IN (SELECT id FROM works WHERE source_id=$1)", [run.id]);
    await database.query("UPDATE ai_runs SET selected_id=NULL,work_id=NULL WHERE id=$1", [run.id]);
    await database.query("DELETE FROM works WHERE source_id=$1", [run.id]);
    const ready = await getAiRun(USER, run.id);
    await deletePhoto(USER, PHOTO);
    await expect(selectAiCandidate(USER, run.id, ready.candidates[0].id)).rejects.toMatchObject({ code: "PHOTO_PET_MISMATCH" });
    expect(await database.query("SELECT id FROM works WHERE source_id=$1", [run.id])).toHaveLength(0);
  });

  it("单张出图后未下单仍可重拍，重拍时撤下自动归档的未付费作品", async () => {
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], idempotencyKey: "ai-reroll-after-archive" });
    await processNextAiRun();
    const ready = await getAiRun(USER, run.id);
    expect(ready.workId).toBeTruthy();
    const rerolled = await rerollAiRun(USER, run.id, "composition");
    expect(rerolled).toMatchObject({ status: "queued", workId: undefined, selectedId: undefined });
    expect((await (await getDatabase()).query("SELECT deleted_at FROM works WHERE id=$1", [ready.workId]))[0]?.deleted_at).toBeTruthy();
  });

  it("schedules a birthday reminder seven days ahead", async () => {
    const database = await getDatabase();
    await database.query("UPDATE pets SET birthday='2026-12-25' WHERE id=$1", [PET]);
    await database.query("INSERT INTO message_subscriptions (id,user_id,pet_id,event_type,status,consented_at,created_at) VALUES ($1,$2,$3,'birthday','active',now(),now())", [crypto.randomUUID(), USER, PET]);
    const scheduled = await scheduleUpcomingReminders(USER, new Date("2026-07-20T00:00:00Z"));
    expect(scheduled[0].scheduledAt).toContain("2026-12-18");
  });

  it("protects physical addresses and creates a downscaled annual preview", async () => {
    const database = await getDatabase(); const workId=crypto.randomUUID();const outputKey=`private/${USER}/works/print.svg`;await objectStorage.put(outputKey,new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect width="1080" height="1440" fill="white"/></svg>'),"image/svg+xml");await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,locked,public,version,created_at) VALUES ($1,$2,'pet-id-card',$3,$4,'x','x','x','x',$5,false,false,1,now())",[workId,USER,PET,PHOTO,outputKey]);
    const order = await createPhysicalOrder(USER, { workId, sku: "art-print-a4", address: { name: "张三", phone: "13800000000", province: "上海", city: "上海", detail: "测试路 1 号" } });
    const rows = await database.query("SELECT address_ciphertext FROM physical_orders WHERE id=$1", [order.id]);
    expect(decryptAddress(String(rows[0].address_ciphertext)).phone).toBe("13800000000");
    expect((await payPhysicalOrder(USER, order.id)).status).toBe("paid");
    expect((await updatePhysicalOrderStatus(order.id, "producing", USER, "开始生产")).status).toBe("producing");
    await expect(updatePhysicalOrderStatus(order.id, "shipped", USER, "确认发货")).rejects.toMatchObject({ code: "SHIPPING_REQUIRED" });
    expect((await updatePhysicalOrderStatus(order.id, "shipped", USER, "确认发货", { carrier: "顺丰", trackingNo: "SF123" })).status).toBe("shipped");
    expect((await updatePhysicalOrderStatus(order.id, "completed", USER, "用户签收")).status).toBe("completed");
    const report = await createAnnualReport(USER, 2026); const reportRows = await database.query("SELECT locked,preview_key,data FROM annual_reports WHERE id=$1", [report.id]);
    expect(reportRows[0].locked).toBe(true); expect(reportRows[0].preview_key).toBeTruthy();
  });

  /**
   * 验收标准：报告包含用户当年的真实照片，且预览版水印逻辑保留。
   *
   * 原实现是纯计数 SVG（几个数字 + 一句谁都能说的话），一张照片都没有。
   * 这里断言的是「嵌了照片的 PNG 不可能只有几 KB」以及预览版与正式版体积不同
   * （水印确实叠上去了）。
   */
  it("年度报告含真实照片，预览版带水印", async () => {
    const database = await getDatabase();
    // PHOTO 的 created_at 是 now()，把它归到当年
    const year = new Date().getFullYear();
    await database.query("UPDATE photos SET shot_at=now() WHERE id=$1", [PHOTO]);
    // seed 的照片字节是文本占位，报告要能取到真图才嵌得进去
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 100, g: 150, b: 120 } } }).png().toBuffer();
    await objectStorage.put(`private/${USER}/photos/milo.png`, new Uint8Array(png), "image/png");

    const report = await createAnnualReport(USER, year);
    const rows = await database.query<{ output_key: string; preview_key: string; data: unknown }>("SELECT output_key,preview_key,data FROM annual_reports WHERE id=$1", [report.id]);
    expect(rows[0].output_key).toMatch(/\.png$/);

    const full = await objectStorage.get(String(rows[0].output_key));
    const preview = await objectStorage.get(String(rows[0].preview_key));
    expect(full?.contentType).toBe("image/png");
    // 嵌了真照片的长图不可能只有几 KB。
    expect(full!.body.byteLength).toBeGreaterThan(20_000);
    // 水印叠上去了，字节与正式版不同。
    expect(preview!.body.byteLength).not.toBe(full!.body.byteLength);

    const data = (typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data) as Record<string, unknown>;
    expect(Number(data.photoCount)).toBeGreaterThan(0);
    expect(data.petName).toBe("Milo");
  }, 60_000);

  it("keeps the current plugin live while testing and restores the previous live variant", async () => {
    expect((await listRuntimePlugins()).some((plugin) => plugin.id === "pl-19")).toBe(true);
    const baseline = await createExperiment({ pluginId: "pl-19", variantCode: "baseline", status: "testing", config: {}, reason: "建立基准" }, USER);
    await updateExperiment(String(baseline.id), { status: "live", config: {}, reason: "发布基准" }, USER);
    const candidate = await createExperiment({ pluginId: "pl-19", variantCode: "candidate", status: "idea", config: {}, reason: "创建候选" }, USER);
    expect((await listRuntimePlugins()).some((plugin) => plugin.id === "pl-19")).toBe(true);
    await updateExperiment(String(candidate.id), { status: "testing", config: {}, reason: "进入测试" }, USER);
    const promoted = await updateExperiment(String(candidate.id), { status: "live", config: {}, reason: "发布候选" }, USER);
    expect(String(promoted.superseded_live_id)).toBe(String(baseline.id));
    const restored = await rollbackExperiment(String(candidate.id), "指标回退", USER);
    expect(String(restored.id)).toBe(String(baseline.id));
    expect(restored.status).toBe("live");
  });
});
