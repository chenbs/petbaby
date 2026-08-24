import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createAiRun, getAiRun, processNextAiRun, selectAiCandidate, unlockAiCandidate, createInteractiveSession, appendInteractiveEvent, listInteractiveEvents, scheduleUpcomingReminders, createPhysicalOrder, createAnnualReport, payPhysicalOrder, createExperiment, updateExperiment, rollbackExperiment, updatePhysicalOrderStatus } from "@/server/growth-service";
import { decryptAddress } from "@/server/commerce/address";
import { objectStorage } from "@/server/storage";
import { payOrder } from "@/server/platform-service";
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
    await objectStorage.put(`private/${USER}/photos/milo.png`, new TextEncoder().encode("photo"), "image/png");
    await objectStorage.put(MASTER_KEY, new TextEncoder().encode("owned-master"), "image/webp");
  });

  it("queues AI runs and persists four candidates with selectable unlock", async () => {
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], prompt: "a cat", idempotencyKey: "ai-test-run-1" });
    expect(run.status).toBe("queued");
    expect(run.roleInputs).toMatchObject({ subjectMode: "pet", templateId: "pet-expression-grid", petPhotoIds: [PHOTO] });
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const ready = await getAiRun(USER, run.id);
    expect(ready.candidates).toHaveLength(4);
    await selectAiCandidate(USER, run.id, ready.candidates[0].id);
    const pending = await unlockAiCandidate(USER, run.id);
    expect(pending.order?.status).toBe("pending");
    await payOrder(USER, String(pending.order?.id));
    expect((await getAiRun(USER, run.id)).selectedUnlocked).toBe(true);
  });

  it("必需母版缺失时明确失败，不回退文生图", async () => {
    await objectStorage.delete(MASTER_KEY);
    const run = await createAiRun(USER, { pluginId: "pl-10", petId: PET, photoIds: [PHOTO], idempotencyKey: "ai-test-missing-master" });
    expect((await processNextAiRun())?.status).toBe("failed");
    expect((await getAiRun(USER, run.id)).errorCode).toBe("必需参考图不存在，请重新选择或联系运营补齐母版");
  });

  it("records interactive events and schedules a reminder seven days ahead", async () => {
    const session = await createInteractiveSession(USER, { pluginId: "pl-15", petId: PET, photoIds: [PHOTO], snapshot: { title: "Milo 的星尘", copy: "一起生活的闪光时刻", theme: "stardust" } });
    await appendInteractiveEvent(USER, session.id, { name: "stardust_collected", payload: { count: 1 } });
    expect(await listInteractiveEvents(USER, session.id)).toHaveLength(1);
    const database = await getDatabase();
    await database.query("UPDATE pets SET birthday='2026-12-25' WHERE id=$1", [PET]);
    const scheduled = await scheduleUpcomingReminders(USER, new Date("2026-07-20T00:00:00Z"));
    expect(scheduled[0].scheduledAt).toContain("2026-12-18");
  });

  it("protects physical addresses and creates a watermarked annual preview", async () => {
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
