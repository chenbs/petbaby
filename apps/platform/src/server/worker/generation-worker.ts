import "server-only";

import sharp from "sharp";
import type { Pet, Photo } from "@/domain/models";
import { getRuntimePlugin } from "@/plugins/runtime";
import { getDatabase } from "@/server/db/client";
import { mapPet, mapPhoto, mapTask } from "@/server/db/rows";
import { generatorRegistry } from "@/server/generators/svg";
import { svgToPdf } from "@/server/generators/pdf";
import { objectStorage } from "@/server/storage";
import { applyAiMetadata, needsAiLabel } from "@/server/media/ai-label";
import { MAX_TASK_ATTEMPTS, describeCost } from "@/domain/dongan-pricing";
import { refundSpend } from "@/server/wallet/service";

/** 首次 + 系统自动重试 2 次；仍失败则全额退还冻干（36 号文 D5）。 */
const MAX_ATTEMPTS = MAX_TASK_ATTEMPTS;
/** 免费预览长边。正式产物保留完整分辨率，这是去水印后付费墙唯一的依据之一。 */
const PREVIEW_LONG_EDGE = 1080;
/** 长图（画册）预览只限宽：640 宽在手机上仍清楚，但明显低于 1080 宽的原图。 */
const PREVIEW_LONG_IMAGE_WIDTH = 640;

export async function claimNextTask() {
  const database = await getDatabase();
  const rows = await database.query(
    `UPDATE generation_tasks SET status='processing', progress=35, attempt=attempt+1, locked_at=now(), updated_at=now()
     WHERE id = (SELECT id FROM generation_tasks WHERE (status='queued' OR (status='processing' AND locked_at < now() - interval '5 minutes')) AND available_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
  );
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function processTask(task: ReturnType<typeof mapTask>) {
  const database = await getDatabase();
  try {
    const plugin = task.pluginSnapshot || await getRuntimePlugin(task.pluginId);
    if (!plugin) throw new Error("PLUGIN_UNAVAILABLE");
    const [petRows, photoRows] = await Promise.all([
      database.query("SELECT * FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [task.petId, task.userId]),
      database.query("SELECT * FROM photos WHERE id = ANY($1::uuid[]) AND user_id=$2 AND deleted_at IS NULL", [task.photoIds, task.userId]),
    ]);
    if (!petRows[0] || photoRows.length !== task.photoIds.length) throw new Error("INPUT_NOT_FOUND");
    const byId = new Map(photoRows.map((row) => [String(row.id), row]));
    const snapshot = task.pluginId === "pl-23" ? task.options.recordSnapshot as { pet: Pet; photos: Photo[] } | undefined : undefined;
    const photos = [];
    for (const photoId of task.photoIds) {
      const row = byId.get(photoId);
      if (!row) throw new Error("PHOTO_NOT_FOUND");
      let object = await objectStorage.get(String(row.storage_key));
      for (let attempt = 0; !object && attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        object = await objectStorage.get(String(row.storage_key));
      }
      if (!object) throw new Error("PHOTO_OBJECT_NOT_FOUND");
      photos.push({ metadata: snapshot?.photos.find((photo) => photo.id === photoId) || mapPhoto(row), object });
    }

    const generator = generatorRegistry[plugin.generator.template as keyof typeof generatorRegistry];
    if (!generator) throw new Error("GENERATOR_NOT_FOUND");
    const output = await generator({ task, pet: snapshot?.pet || mapPet(petRows[0]), photos, plugin });
    // SVG 保留供矢量/PDF 使用，相册交付必须另有完整分辨率的 PNG。
    if (!output.files.some((file) => file.suffix === "png")) {
      const svg = output.files.find((file) => file.suffix === "svg");
      if (svg) output.files.push({ suffix: "png", body: new Uint8Array(await sharp(Buffer.from(svg.body)).png().toBuffer()), contentType: "image/png" });
    }
    const storedFiles: Record<string, string> = {};
    for (const file of output.files) {
      const key = `private/${task.userId}/works/${task.id}.${file.suffix}`;
      await objectStorage.put(key, file.body, file.contentType);
      storedFiles[file.suffix] = key;
    }
    if (plugin.output.formats.includes("pdf")) {
      const svg = output.files.find((file) => file.suffix === "svg");
      if (svg) {
        const pdfKey = `private/${task.userId}/works/${task.id}.pdf`;
        await objectStorage.put(pdfKey, await svgToPdf(svg.body), "application/pdf");
        storedFiles.pdf = pdfKey;
      }
    }

    const previewSource = output.files.find((file) => file.suffix === "png") || output.files.find((file) => file.suffix === "svg");
    if (!previewSource) throw new Error("PREVIEW_SOURCE_NOT_FOUND");
    /*
     * 预览 = 长边 1080 的 PNG，不叠任何可见标记（2026-09 起取消营销水印）。
     *
     * 去掉水印后，预览与正式产物唯一的区别是分辨率与「能否保存到相册」，
     * 所以预览必须真的缩下来；SVG 产物同样栅格化成 PNG 预览，否则预览就等于矢量原图。
     * 生成类产物（电影海报）缩图后重新写一次隐式元数据，sharp 重新编码默认会丢 EXIF。
     */
    const sourceMeta = await sharp(Buffer.from(previewSource.body)).metadata();
    // 画册这类长图（高 > 宽 2 倍）按长边缩会窄到看不清，改为只限宽。
    const longImage = (sourceMeta.height || 0) > (sourceMeta.width || 1) * 2;
    const resizedPreview = new Uint8Array(await sharp(Buffer.from(previewSource.body))
      .resize(longImage ? { width: PREVIEW_LONG_IMAGE_WIDTH, withoutEnlargement: true } : { width: PREVIEW_LONG_EDGE, height: PREVIEW_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer());
    const previewBody = needsAiLabel(plugin) ? await applyAiMetadata(resizedPreview, task.id) : resizedPreview;
    const previewKey = `private/${task.userId}/works/${task.id}-preview.png`;
    await objectStorage.put(previewKey, previewBody, "image/png");

    /*
     * 免费玩法（`unlockPrice: 0`）直接给干净的正式产物，以 `locked=false` 入库。
     * 原先这里会用带水印的预览覆盖正式产物，作为「分享钩子」；
     * 2026-09 起拉新改由分享卡 / 公开页 / 分享海报承担，作品本身不带任何标记。
     */
    const freePlugin = plugin.pricing.unlockPrice <= 0;
    /*
     * 已扣冻干的任务直接产出正式版（先扣后做，没有预览这一步）。
     * 没有扣费键又不是免费玩法的，只可能是冻干上线前入队的历史任务，沿用当时的锁定口径。
     */
    // options.dongan 只有冻干上线后入队的任务才有：颗数为 0（如纪念形态的画册）同样直接是正式版。
    const paid = Boolean(task.walletBizKey) || Boolean((task.options as { dongan?: unknown }).dongan);

    const sourceRows = task.sourceWorkId ? await database.query("SELECT * FROM works WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [task.sourceWorkId, task.userId]) : [];
    const workId = sourceRows[0] ? String(sourceRows[0].id) : crypto.randomUUID();
    const version = sourceRows[0] ? Number(sourceRows[0].version) + 1 : 1;
    /*
     * 作品长期保存，不写 expires_at（2026-09 起取消「未付费作品 90 天后清理」）。
     * 作品只在用户自己删除、删除宠物或注销账户时清理。
     */
    if (sourceRows[0]) {
      await database.query("UPDATE works SET photo_id=$2,title=$3,subtitle=$4,serial_number=$5,authority=$6,output_key=$7,preview_key=$8,version=$9,expires_at=NULL,locked=CASE WHEN $10 THEN false ELSE locked END WHERE id=$1", [workId, task.photoIds[0], output.title, output.subtitle, output.serialNumber, output.authority, storedFiles.png || storedFiles.svg, previewKey, version, paid]);
    } else {
      /*
       * `locked` 不再无条件为 true。免费玩法原先也以 locked=true 入库，用户必须走一遍
       * 0 元订单才能下载 —— 这直接违反 14 号文的「积累不能有任何摩擦」。
       */
      const locked = !freePlugin && !paid;
      await database.query(
        "INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,locked,public,version,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$14,false,$12,NULL,$13)",
        [workId, task.userId, task.pluginId, task.petId, task.photoIds[0], output.title, output.subtitle, output.serialNumber, output.authority, storedFiles.png || storedFiles.svg, previewKey, version, new Date(), locked],
      );
    }
    await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), workId, version, output.title, output.subtitle, storedFiles.png || storedFiles.svg, previewKey, new Date()]);
    await database.query("UPDATE generation_tasks SET status='succeeded',progress=100,work_id=$2,locked_at=null,updated_at=now() WHERE id=$1", [task.id, workId]);
    await database.query("INSERT INTO events (id,user_id,plugin_id,name,created_at) VALUES ($1,$2,$3,'generation_succeeded',$4)", [crypto.randomUUID(), task.userId, task.pluginId, new Date()]);
    await database.query("INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,'generation_ready',$3,$4,$5,$6)", [crypto.randomUUID(), task.userId, "作品已生成", `${plugin.name}已经准备好了`, `/works/${workId}`, new Date()]);
    const estimatedCost = Number(task.pluginId === "pet-movie-poster" ? process.env.AI_IMAGE_COST || 0.08 : process.env.LAYOUT_GENERATION_COST || 0.01);
    await database.query("INSERT INTO system_usage (usage_date,generation_count,estimated_cost,circuit_open,updated_at) VALUES ($1,1,$2,false,now()) ON CONFLICT (usage_date) DO UPDATE SET generation_count=system_usage.generation_count+1,estimated_cost=system_usage.estimated_cost+$2,updated_at=now()", [new Date().toISOString().slice(0, 10), estimatedCost]);
    return { status: "succeeded" as const, taskId: task.id, workId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 80) : "GENERATOR_FAILED";
    if (task.attempt < MAX_ATTEMPTS) {
      await database.query("UPDATE generation_tasks SET status='queued',progress=8,error_code=$2,available_at=now() + interval '2 seconds',locked_at=null,updated_at=now() WHERE id=$1", [task.id, message]);
      return { status: "retrying" as const, taskId: task.id };
    }
    await database.query("UPDATE generation_tasks SET status='failed',progress=0,error_code=$2,locked_at=null,updated_at=now() WHERE id=$1", [task.id, message]);
    await database.query("DELETE FROM daily_quotas WHERE task_id=$1", [task.id]);
    // 系统已自动重试过；终态失败按扣费流水原路全额退还冻干（只回到余额，现金不退）。
    const returned = task.walletBizKey ? await refundSpend(task.walletBizKey, { title: "制作失败 · 已退还" }) : 0;
    await database.query("INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,'generation_failed',$3,$4,$5,$6)", [crypto.randomUUID(), task.userId, "这次没有做成", returned ? `已退还 ${describeCost(returned)}冻干，可以重新试一次` : "免费次数已返还，可以重新尝试", `/create/${task.pluginId}`, new Date()]);
    return { status: "failed" as const, taskId: task.id };
  }
}

export async function runNextTask() {
  const task = await claimNextTask();
  return task ? processTask(task) : null;
}

export async function runWorkerUntilIdle(limit = 25) {
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await runNextTask();
    if (!result) break;
    results.push(result);
  }
  return results;
}
