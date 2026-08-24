import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";
import { getRuntimePlugin } from "@/plugins/runtime";
import { collectAnnualData } from "@/server/annual/aggregate";
import { buildNarrativeArgs } from "@/server/video/narrative";
import { normalizeDuration } from "@/domain/video-duration";

/**
 * 叙事型年度视频（PL-19 的升级形态）。
 *
 * 与普通短片的区别不在滤镜，而在**它承载的是这个用户的真实档案数据**：
 * 陪伴天数、每张照片的拍摄日期与「第 N 天」、年初到年末的跨度、当年计数。
 * 作为「一键成片」它可替代；作为「承载真实档案数据的叙事载体」它不可替代。
 *
 * 渲染走队列（`video_renders`），与其他视频任务共用 `processNextVideo` 的并发 1，
 * 所以这里只负责入队；实际渲染在 `renderAnnualFilm` 里被 Worker 调用。
 */

/** 叙事视频最多用多少张照片。四段结构还要为开场/对比/数据卡留时间 */
const MAX_NARRATIVE_SHOTS = 12;

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
 * 入队一条叙事年度视频。
 *
 * @param durationSeconds 用户选的总时长（10 / 20 / 30），受任务 2 的档位约束
 */
export async function createAnnualFilm(userId: string, input: { year: number; durationSeconds?: number }) {
  const plugin = await getRuntimePlugin("pl-19");
  if (!plugin || plugin.status !== "live") throw new AppError("VIDEO_PRODUCT_UNAVAILABLE", "视频产品暂未开放", 404);
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError("ANNUAL_YEAR_INVALID", "年份不正确", 422);
  const durationSeconds = normalizeDuration(input.durationSeconds);

  const aggregate = await collectAnnualData(userId, year, MAX_NARRATIVE_SHOTS);
  /*
   * 一张照片都没有时明确报错，不产出一条只有开场和数据卡的空片子 ——
   * 那种片子里唯一属于用户的东西就是几个数字，正是要避免的「产品的表演」。
   */
  if (!aggregate.photos.length) throw new AppError("ANNUAL_PHOTOS_REQUIRED", `${year} 年还没有照片，先上传几张再来`, 422);

  const database = await getDatabase();
  const renderId = crypto.randomUUID();
  const config = {
    kind: "annual-film" as const,
    year,
    durationSeconds,
    petId: aggregate.petId,
    photoId: aggregate.photos[0]?.photo.id,
  };
  await database.query(
    "INSERT INTO video_renders (id,user_id,plugin_id,status,progress,config,available_at,created_at) VALUES ($1,$2,'pl-19','queued',5,$3::jsonb,now(),$4)",
    [renderId, userId, JSON.stringify(config), new Date()],
  );
  return { id: renderId, status: "queued", year, durationSeconds, petName: aggregate.petName, shots: aggregate.photos.length };
}

/**
 * 实际渲染。由 `processNextVideo` 在认出 `config.kind === "annual-film"` 时调用。
 *
 * 照片在这里重新取一次而不是把字节塞进 config：`video_renders.config` 是 jsonb，
 * 十几张照片的 base64 会把行撑到几 MB，而队列表是频繁扫描的。
 */
export async function renderAnnualFilm(row: { id: string; user_id: string; config: unknown }) {
  const config = (row.config || {}) as { year?: number; durationSeconds?: unknown };
  const userId = String(row.user_id);
  const year = Number(config.year);
  const totalSeconds = normalizeDuration(config.durationSeconds);
  const aggregate = await collectAnnualData(userId, year, MAX_NARRATIVE_SHOTS);
  if (!aggregate.photos.length) throw new Error("ANNUAL_PHOTOS_REQUIRED");

  const directory = await mkdtemp(path.join(os.tmpdir(), "petbaby-annual-"));
  const file = path.join(directory, `${String(row.id)}.mp4`);
  try {
    /** 归一到 720×1280 并落盘，返回本地路径 */
    const normalize = async (storageKey: string, name: string, height = 1280) => {
      const object = await objectStorage.get(storageKey);
      if (!object || !object.contentType.startsWith("image/")) throw new Error("VIDEO_ASSET_NOT_FOUND");
      const target = path.join(directory, name);
      await writeFile(target, await sharp(Buffer.from(object.body)).resize(720, height, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer());
      return target;
    };

    const shots = [];
    for (const [index, item] of aggregate.photos.entries()) {
      // 越权兜底：所有 key 必须落在这个用户的私有前缀下。
      if (!item.photo.storageKey.startsWith(`private/${userId}/`)) throw new Error("VIDEO_ASSET_NOT_ALLOWED");
      shots.push({ file: await normalize(item.photo.storageKey, `${index}.jpg`), day: item.day, date: item.date });
    }

    let compare;
    if (aggregate.pair) {
      const { earliest, latest } = aggregate.pair;
      // 对比段是上下半屏，各 640 高 —— 按 1280 归一再塞进半屏会被二次压缩。
      compare = {
        earliestFile: await normalize(earliest.photo.storageKey, "cmp-a.jpg", 640),
        latestFile: await normalize(latest.photo.storageKey, "cmp-b.jpg", 640),
        earliestDay: earliest.day,
        latestDay: latest.day,
        gapDays: aggregate.pair.gapDays,
      };
    }

    const { args, plan } = buildNarrativeArgs({
      petName: aggregate.petName || "我们",
      companionDays: aggregate.companionDays,
      shots,
      compare,
      counts: aggregate.counts,
      year,
      totalSeconds,
      outputFile: file,
      memorial: Boolean(aggregate.memorialSince),
    });
    await run(process.env.FFMPEG_PATH || "ffmpeg", args);

    const body = new Uint8Array(await readFile(file));
    const key = `private/${userId}/videos/${String(row.id)}-annual.mp4`;
    await objectStorage.put(key, body, "video/mp4");
    return { key, plan, aggregate };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
