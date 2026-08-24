import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { getDatabase } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { FADE_SECONDS, MAX_PHOTOS, normalizeDuration, perPhotoSeconds } from "@/domain/video-duration";
import { renderAnnualFilm } from "@/server/video/annual-film";

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`)));
  });
}

/**
 * 字幕滤镜。
 *
 * drawtext 不指定 fontfile 时用 fontconfig 的默认字体，而生产镜像（alpine + apk add
 * ffmpeg）不含任何中文字体，中文会渲染成方框或整行消失 —— 且 ffmpeg 退出码为 0，
 * 属于静默失效。所以字体路径必须显式给出，并在镜像里装好对应字体包。
 *
 * 路径里的 ":" 对 filtergraph 是分隔符，Windows 盘符（C:/…）必须转义成 "C\:/…"。
 */
function drawtextFilter(caption: string) {
  const fontFile = process.env.FFMPEG_FONT_FILE;
  const font = fontFile ? `fontfile='${fontFile.replace(/:/g, "\\:")}':` : "";
  return `drawtext=${font}text='${caption}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=h-100`;
}

/**
 * 拼出完整的 ffmpeg 参数表。
 *
 * 单独抽成纯函数是为了能单测：`vitest.config.ts` 的覆盖率白名单不含
 * `server/video/*`，Playwright 也不跑视频链路 —— 那条「`.45` 解析失败导致线上
 * 渲染 100% 失败」的缺陷就是这样活了很久没人发现的（见任务书附录 A）。
 * 参数表能断言，就不必真装 ffmpeg 才能挡住同类回归。
 *
 * @param options.photoFiles 已归一到 720×1280 的本地文件路径，顺序即成片顺序
 * @param options.totalSeconds 用户选的成片总时长，单张停留由它反推
 */
export function buildFfmpegArgs(options: {
  photoFiles: string[];
  totalSeconds: number;
  caption: string;
  bgm?: string;
  outputFile: string;
}) {
  const { photoFiles, caption, bgm, outputFile } = options;
  const totalSeconds = normalizeDuration(options.totalSeconds);
  const duration = perPhotoSeconds(totalSeconds, photoFiles.length);
  // 3 位小数即可（30/7 这类除不尽的档位），且必须带前导零 —— 见 FADE_SECONDS 的注释。
  const durationArg = duration.toFixed(3);
  const inputs: string[] = [];
  for (const photo of photoFiles) inputs.push("-loop", "1", "-t", durationArg, "-i", photo);
  // 一张照片都没有时给纯色兜底，成片仍然是所选时长而不是 0 秒。
  if (!photoFiles.length) inputs.push("-f", "lavfi", "-i", `color=c=#14251c:s=720x1280:d=${totalSeconds}:r=30`);
  const withAudio = Boolean(bgm) && bgm !== "none";
  if (withAudio) inputs.push("-f", "lavfi", "-i", `sine=frequency=${bgm === "bright" ? 523 : 261}:sample_rate=44100:duration=${totalSeconds}`);
  const videoInputCount = photoFiles.length || 1;
  // fade 的 d/st 必须写成 0.45 这样带前导零的形式：ffmpeg 6+ 拒绝把 ".45" 解析为
  // 时长（Unable to parse option value ".45" as duration），整条渲染会直接失败。
  const filters = Array.from({ length: videoInputCount }, (_, index) => `[${index}:v]scale=720:1280,setsar=1,fade=t=in:st=0:d=${FADE_SECONDS.toFixed(2)},fade=t=out:st=${Math.max(0, duration - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS.toFixed(2)}[v${index}]`).join(";");
  const concat = Array.from({ length: videoInputCount }, (_, index) => `[v${index}]`).join("");
  const filterComplex = `${filters};${concat}concat=n=${videoInputCount}:v=1:a=0,${drawtextFilter(caption)}[vout]`;
  const args = ["-y", ...inputs, "-filter_complex", filterComplex, "-map", "[vout]"];
  if (withAudio) args.push("-map", `${videoInputCount}:a`, "-shortest", "-c:a", "aac", "-b:a", "128k");
  args.push("-t", String(totalSeconds), "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputFile);
  return { args, totalSeconds, perPhotoSeconds: duration };
}

/**
 * 叙事年度视频的收尾：渲染 → 归档为作品 → 更新队列行。
 *
 * 与项目短片一样**锁定**（`locked=true`）：预览版免费看，高清解锁付费，
 * 沿用 PL-19 现有的 19.9。作品记录按 `source_kind='report'` 归类，
 * 同一年重复生成时更新同一条作品并自增版本，不堆出多条。
 */
async function processAnnualFilm(row: Record<string, unknown>, database: Awaited<ReturnType<typeof getDatabase>>) {
  const renderId = String(row.id);
  const userId = String(row.user_id);
  const config = (row.config || {}) as { year?: number; petId?: string; photoId?: string; durationSeconds?: unknown };
  const { key, aggregate } = await renderAnnualFilm({ id: renderId, user_id: userId, config: row.config });
  const previewKey = key.replace(/\.mp4$/, "-preview.mp4");
  // 预览与成片同一字节（现状如此，见附录 B 的「待优化」），但键必须不同：
  // 解锁逻辑按 locked 选 previewKey / outputKey，同键会让锁形同虚设。
  const object = await objectStorage.get(key);
  if (object) await objectStorage.put(previewKey, object.body, "video/mp4");

  const year = Number(config.year);
  const title = `${aggregate.petName || "我们"}的 ${year}`;
  const subtitle = `${aggregate.companionDays} 天 · ${aggregate.counts.photos} 张照片`;
  const sourceId = `${userId}:${year}`;
  const existing = await database.query("SELECT id,version FROM works WHERE source_kind='report' AND source_id=$1", [sourceId]);
  const workId = existing[0] ? String(existing[0].id) : crypto.randomUUID();
  const version = existing[0] ? Number(existing[0].version || 1) + 1 : 1;
  const createdAt = new Date();
  const photoId = config.photoId || aggregate.photos[0]?.photo.id;
  if (existing[0]) {
    await database.query("UPDATE works SET title=$2,subtitle=$3,output_key=$4,preview_key=$5,locked=true,public=false,share_token=NULL,version=$6,photo_id=$7,deleted_at=NULL WHERE id=$1", [workId, title, subtitle, key, previewKey, version, photoId]);
  } else {
    await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,source_id,locked,public,version,created_at) VALUES ($1,$2,'pl-19',$3,$4,$5,$6,$7,'PETBABY ANNUAL STUDIO',$8,$9,'video','report',$10,true,false,1,$11)", [workId, userId, config.petId || aggregate.petId, photoId, title, subtitle, `ANN-${renderId.slice(0, 8).toUpperCase()}`, key, previewKey, sourceId, createdAt]);
  }
  await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), workId, version, title, subtitle, key, previewKey, createdAt]);
  await database.query("UPDATE video_renders SET status='ready',progress=100,output_key=$2,preview_key=$3,work_id=$4,error_code=NULL,locked_at=NULL WHERE id=$1", [renderId, key, previewKey, workId]);
  return { id: renderId, status: "ready", progress: 100, outputKey: key, workId };
}

export async function processNextVideo() {
  const database = await getDatabase();
  const rows = await database.query("UPDATE video_renders SET status='processing',progress=15,attempt=attempt+1,locked_at=now() WHERE id=(SELECT id FROM video_renders WHERE status='queued' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *");
  if (!rows[0]) return null;
  const row = rows[0]; const directory = await mkdtemp(path.join(os.tmpdir(), "petbaby-video-")); const file = path.join(directory, `${String(row.id)}.mp4`);
  try {
    const config = (row.config || {}) as { kind?: string; projectId?: string; photos?: unknown; captions?: unknown; bgm?: string; cover?: unknown; interactiveSessionId?: string; petId?: string; photoId?: string; durationSeconds?: unknown; snapshot?: { title?: string; copy?: string } };
    /*
     * 叙事年度视频走另一条 filtergraph（四段结构，见 `video/narrative.ts`），
     * 但共用这一个队列与并发 1 —— 视频任务独占 CPU 时图文任务跟着延迟，
     * 不该为它再开一条并行通道。
     */
    if (config.kind === "annual-film") return await processAnnualFilm(row, database);
    /*
     * 封面排在最前，但**必须去重**：封面本来就是已选照片之一（`renderVideoProject` 取
     * `cover_photo_id` 或 photos[0]），直接前插会让它出现两次，帧数比用户选的多一张。
     * 时长选项上线后这一点变成硬约束 —— 张数上限是按所选时长算的（maxPhotosFor），
     * 多出来的一张会顶掉末尾那张，用户选的最后一张照片被静默丢掉。
     */
    const orderedKeys = [
      ...(typeof config.cover === "string" ? [config.cover] : []),
      ...(Array.isArray(config.photos) ? config.photos.filter((item): item is string => typeof item === "string") : []),
    ];
    const photoKeys = [...new Set(orderedKeys)].slice(0, MAX_PHOTOS);
    if (photoKeys.some((key) => !key.startsWith(`private/${String(row.user_id)}/`))) throw new Error("VIDEO_ASSET_NOT_ALLOWED");
    if (config.bgm && !["none", "calm", "bright"].includes(config.bgm)) throw new Error("VIDEO_BGM_NOT_ALLOWED");
    const caption = Array.isArray(config.captions) && config.captions.length ? String(config.captions[0]).replace(/[:\\'\"]+/g, " ").slice(0, 80) : "PETBABY";
    const normalized: string[] = [];
    for (let index = 0; index < photoKeys.length; index += 1) {
      const object = await objectStorage.get(photoKeys[index]);
      if (!object || !object.contentType.startsWith("image/")) throw new Error("VIDEO_ASSET_NOT_FOUND");
      const target = path.join(directory, `${index}.jpg`);
      await writeFile(target, await sharp(Buffer.from(object.body)).resize(720, 1280, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer());
      normalized.push(target);
    }
    /*
     * 总时长由用户选（10 / 20 / 30 秒），单张停留时长反推。
     *
     * 反推的前提是张数上限已经随时长收紧过（`maxPhotosFor`，在 service.ts 建项目时校验）：
     * 单张停留必须 > 两段 fade 之和 0.9 秒，否则画面大半在黑场 ——
     * 10 秒 ÷ 20 张 = 0.5 秒就是这种情况。这里不再兜底收紧，
     * 因为静默截断张数等于悄悄丢掉用户选的照片；不匹配应在入口就被拒。
     */
    const { args, totalSeconds } = buildFfmpegArgs({ photoFiles: normalized, totalSeconds: normalizeDuration(config.durationSeconds), caption, bgm: config.bgm, outputFile: file });
    await run(process.env.FFMPEG_PATH || "ffmpeg", args);
    const body = new Uint8Array(await readFile(file)); const key = `private/${String(row.user_id)}/videos/${String(row.id)}.mp4`;
    await objectStorage.put(key, body, "video/mp4");
    const previewKey = `private/${String(row.user_id)}/videos/${String(row.id)}-preview.mp4`;
    await objectStorage.put(previewKey, body, "video/mp4");
    let workId: string | undefined;
    if (config.interactiveSessionId && config.petId && config.photoId) {
      const existing = await database.query("SELECT id,version FROM works WHERE source_kind='interactive' AND source_id=$1", [config.interactiveSessionId]);
      workId = existing[0] ? String(existing[0].id) : crypto.randomUUID();
      const title = String(config.snapshot?.title || "星尘互动纪念片").slice(0, 80);
      const subtitle = String(config.snapshot?.copy || `${totalSeconds} 秒互动页导出`).slice(0, 160);
      if (!existing[0]) {
        const createdAt = new Date();
        await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,source_id,locked,public,version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PETBABY INTERACTIVE STUDIO',$9,$10,'video','interactive',$11,false,false,1,$12)", [workId, row.user_id, row.plugin_id, config.petId, config.photoId, title, subtitle, `H5-${String(row.id).slice(0, 8).toUpperCase()}`, key, typeof config.cover === "string" ? config.cover : null, config.interactiveSessionId, createdAt]);
        await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7)", [crypto.randomUUID(), workId, title, subtitle, key, typeof config.cover === "string" ? config.cover : null, createdAt]);
      } else {
        const version = Number(existing[0].version || 1) + 1; const createdAt = new Date();
        await database.query("UPDATE works SET output_key=$2,title=$3,subtitle=$4,locked=false,deleted_at=NULL,version=$5,photo_id=$6,preview_key=$7 WHERE id=$1", [workId, key, title, subtitle, version, config.photoId, typeof config.cover === "string" ? config.cover : null]);
        await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), workId, version, title, subtitle, key, typeof config.cover === "string" ? config.cover : null, createdAt]);
      }
      await database.query("UPDATE interactive_sessions SET state='ready',exported_key=$2,work_id=$3,updated_at=now() WHERE id=$1", [config.interactiveSessionId, key, workId]);
    }
    if (config.projectId) {
      const projects = await database.query("SELECT * FROM video_projects WHERE id=$1 AND user_id=$2", [config.projectId, row.user_id]);
      const project = projects[0];
      if (!project) throw new Error("VIDEO_PROJECT_NOT_FOUND");
      const photoIds = Array.isArray(project.photo_ids) ? project.photo_ids.map(String) : [];
      if (!photoIds[0]) throw new Error("VIDEO_PROJECT_PHOTO_MISSING");
      const existing = await database.query("SELECT id,version FROM works WHERE source_kind='video' AND source_id=$1", [config.projectId]);
      workId = existing[0] ? String(existing[0].id) : crypto.randomUUID();
      const version = existing[0] ? Number(existing[0].version || 1) + 1 : 1;
      const title = String(project.title || "宠物记忆短片").slice(0, 80); const createdAt = new Date();
      // 副标题写实际时长。时长可选之后「15 秒可编辑宠物短片」对 10/30 秒的片子是错的。
      const subtitle = `${totalSeconds} 秒可编辑宠物短片`;
      if (existing[0]) await database.query("UPDATE works SET title=$2,subtitle=$3,output_key=$4,preview_key=$5,locked=true,public=false,share_token=NULL,version=$6,photo_id=$7,deleted_at=NULL WHERE id=$1", [workId, title, subtitle, key, previewKey, version, photoIds[0]]);
      else await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,source_id,locked,public,version,created_at) VALUES ($1,$2,'pl-19',$3,$4,$5,$6,$7,'PETBABY VIDEO STUDIO',$8,$9,'video','video',$10,true,false,1,$11)", [workId, row.user_id, project.pet_id, photoIds[0], title, subtitle, `VID-${String(row.id).slice(0, 8).toUpperCase()}`, key, previewKey, config.projectId, createdAt]);
      await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), workId, version, title, subtitle, key, previewKey, createdAt]);
      await database.query("UPDATE video_projects SET status='preview_ready',work_id=$2,updated_at=now() WHERE id=$1", [config.projectId, workId]);
    }
    const status = config.projectId ? "preview_ready" : "ready";
    await database.query("UPDATE video_renders SET status=$2,progress=100,output_key=$3,preview_key=$4,work_id=$5,error_code=NULL,locked_at=NULL WHERE id=$1", [row.id, status, key, previewKey, workId || null]);
    return { id: String(row.id), status, progress: 100, outputKey: key, workId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "FFMPEG_FAILED";
    await database.query("UPDATE video_renders SET status='failed',progress=0,error_code=$2,locked_at=NULL WHERE id=$1", [row.id, message]);
    const config = (row.config || {}) as { interactiveSessionId?: string; projectId?: string };
    if (config.interactiveSessionId) await database.query("UPDATE interactive_sessions SET state='failed',updated_at=now() WHERE id=$1", [config.interactiveSessionId]);
    if (config.projectId) await database.query("UPDATE video_projects SET status='failed',updated_at=now() WHERE id=$1", [config.projectId]);
    return { id: String(row.id), status: "failed", progress: 0, errorCode: message };
  } finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
}
