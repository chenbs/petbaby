import "server-only";

import sharp from "sharp";
import { getRuntimePlugin } from "@/plugins/runtime";
import { getDatabase } from "@/server/db/client";
import { mapPet, mapPhoto, mapTask } from "@/server/db/rows";
import { generatorRegistry } from "@/server/generators/svg";
import { svgToPdf } from "@/server/generators/pdf";
import { objectStorage } from "@/server/storage";

const MAX_ATTEMPTS = 2;

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
      database.query("SELECT * FROM pets WHERE id=$1 AND user_id=$2", [task.petId, task.userId]),
      database.query("SELECT * FROM photos WHERE id = ANY($1::uuid[]) AND user_id=$2", [task.photoIds, task.userId]),
    ]);
    if (!petRows[0] || photoRows.length !== task.photoIds.length) throw new Error("INPUT_NOT_FOUND");
    const byId = new Map(photoRows.map((row) => [String(row.id), row]));
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
      photos.push({ metadata: mapPhoto(row), object });
    }

    const generator = generatorRegistry[plugin.generator.template as keyof typeof generatorRegistry];
    if (!generator) throw new Error("GENERATOR_NOT_FOUND");
    const output = await generator({ task, pet: mapPet(petRows[0]), photos, plugin });
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
    let previewBody: Uint8Array;
    if (previewSource.contentType === "image/svg+xml") {
      previewBody = new TextEncoder().encode(new TextDecoder().decode(previewSource.body).replace("</svg>", '<g opacity=".62"><rect x="40" y="205" width="520" height="64" rx="12" fill="#14251c"/><text x="60" y="248" fill="#ffffff" font-size="30">PETBABY 免费预览 · 小程序码</text></g></svg>'));
    } else {
      const metadata = await sharp(Buffer.from(previewSource.body)).metadata();
      const width = metadata.width || 1080;
      const height = metadata.height || 1440;
      const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g opacity=".62" transform="translate(40 80)"><rect width="${Math.min(700, width - 80)}" height="76" rx="14" fill="#14251c"/><text x="24" y="49" fill="#fff" font-family="sans-serif" font-size="30">PETBABY 免费预览 · 小程序码</text><rect x="${Math.min(610, width - 170)}" y="10" width="56" height="56" fill="#fff"/><path d="M${Math.min(618, width - 162)} 18h16v16h-16zm24 0h16v16h-16zm-24 24h16v16h-16zm24 0h8v8h-8z" fill="#14251c"/></g></svg>`;
      previewBody = new Uint8Array(await sharp(Buffer.from(previewSource.body)).composite([{ input: Buffer.from(mark), gravity: "northwest" }]).png().toBuffer());
    }
    const previewKey = `private/${task.userId}/works/${task.id}-preview.${previewSource.suffix}`;
    await objectStorage.put(previewKey, previewBody, previewSource.contentType);

    /*
     * 免费玩法的**正式产物也要带水印**。
     *
     * 免费作品以 `locked=false` 入库（见下），而 getVisibleWork 与 getDownload
     * 对未锁作品给的是 `outputKey` —— 如果这里不覆写，免费玩法反而拿到
     * 一张干净无水印的图，比付费的还好。
     *
     * 水印在免费玩法里不是付费墙，是传播载体（PL-23 的定位是「分享钩子」，
     * 靠图上的小程序码带新）。所以这里用预览字节覆盖正式产物。
     */
    const freePlugin = plugin.pricing.unlockPrice <= 0;
    if (freePlugin) {
      const targetSuffix = previewSource.suffix;
      const targetKey = storedFiles[targetSuffix];
      if (targetKey) await objectStorage.put(targetKey, previewBody, previewSource.contentType);
    }

    const sourceRows = task.sourceWorkId ? await database.query("SELECT * FROM works WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [task.sourceWorkId, task.userId]) : [];
    const workId = sourceRows[0] ? String(sourceRows[0].id) : crypto.randomUUID();
    const version = sourceRows[0] ? Number(sourceRows[0].version) + 1 : 1;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    if (sourceRows[0]) {
      await database.query("UPDATE works SET photo_id=$2,title=$3,subtitle=$4,serial_number=$5,authority=$6,output_key=$7,preview_key=$8,version=$9,expires_at=CASE WHEN locked THEN $10::timestamptz ELSE NULL END WHERE id=$1", [workId, task.photoIds[0], output.title, output.subtitle, output.serialNumber, output.authority, storedFiles.png || storedFiles.svg, previewKey, version, expiresAt]);
    } else {
      /*
       * `locked` 不再无条件为 true。免费玩法（`unlockPrice: 0`，当前是 PL-15/22/23）
       * 原先也以 locked=true 入库，用户必须走一遍 0 元订单才能下载 ——
       * 而 PL-23 的定位是「分享钩子」，钩子前面加一道支付流程，钩子就不成立了。
       *
       * 这直接违反 14 号文的「积累不能有任何摩擦」。
       *
       * 注意**免费不等于无水印**：营销水印与小程序码照旧叠（见上面的 previewBody），
       * 免费玩法的产物就是靠带码传播的，水印不是付费墙。
       */
      const locked = !freePlugin;
      await database.query(
        "INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,locked,public,version,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$15,false,$12,$13,$14)",
        // expires_at 只对锁定作品有意义（maintenance 的清理只扫 locked=true），
        // 免费作品给 NULL，与下面 UPDATE 分支的 CASE WHEN locked 同口径。
        [workId, task.userId, task.pluginId, task.petId, task.photoIds[0], output.title, output.subtitle, output.serialNumber, output.authority, storedFiles.png || storedFiles.svg, previewKey, version, locked ? expiresAt : null, new Date(), locked],
      );
    }
    await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), workId, version, output.title, output.subtitle, storedFiles.png || storedFiles.svg, previewKey, new Date()]);
    await database.query("UPDATE generation_tasks SET status='succeeded',progress=100,work_id=$2,locked_at=null,updated_at=now() WHERE id=$1", [task.id, workId]);
    await database.query("INSERT INTO events (id,user_id,plugin_id,name,created_at) VALUES ($1,$2,$3,'generation_succeeded',$4)", [crypto.randomUUID(), task.userId, task.pluginId, new Date()]);
    await database.query("INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,'generation_ready',$3,$4,$5,$6)", [crypto.randomUUID(), task.userId, "作品已生成", `${plugin.name}已经准备好了`, `/works/${workId}`, new Date()]);
    const estimatedCost = Number(process.env.LAYOUT_GENERATION_COST || 0.01);
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
    await database.query("INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,'generation_failed',$3,$4,$5,$6)", [crypto.randomUUID(), task.userId, "生成失败", "免费次数已返还，可以重新尝试", `/create/${task.pluginId}`, new Date()]);
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
