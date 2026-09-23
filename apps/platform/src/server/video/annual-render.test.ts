import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { createAnnualFilm } from "@/server/video/annual-film";
import { createVideoProject, renderVideoProject } from "@/server/video/service";
import { annualFilmSourceId, processNextVideo } from "@/server/video/ffmpeg";
import { deletePhoto, updatePhotoMetadata } from "@/server/photo-library-service";

const USER = "00000000-0000-4000-8000-0000000000e1";
const PET = "00000000-0000-4000-8000-0000000000e2";

/** 本机可能没有 ffmpeg。有则跑真渲染，没有则只断言队列与失败落库 */
const HAS_FFMPEG = Boolean(process.env.FFMPEG_PATH);

async function addPhoto(shotAt: string, petId = PET, color = { r: 120, g: 140, b: 160 }) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const key = `private/${USER}/photos/${id}.jpg`;
  const body = await sharp({ create: { width: 400, height: 600, channels: 3, background: color } }).jpeg().toBuffer();
  await database.query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,shot_at,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',$5,$6,0,'clear',$7,$7)",
    [id, USER, petId, `${id}.jpg`, body.byteLength, key, shotAt],
  );
  await objectStorage.put(key, new Uint8Array(body), "image/jpeg");
  return id;
}

describe("annual film render pipeline", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("DELETE FROM video_renders");
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2024-01-01T00:00:00Z")]);
  });

  /**
   * 关键接线：`processNextVideo` 必须认出 `config.kind === "annual-film"`
   * 并走叙事分支，而不是当普通短片处理（那会因为 config 里没有 photos 而产出纯色片）。
   *
   * 没有 ffmpeg 时渲染会失败，但失败也必须落到 `status='failed'` 并带上 error_code ——
   * 静默停在 processing 会让任务永远卡在队列里。
   */
  it("processNextVideo 认出 annual-film 并走叙事分支", async () => {
    await addPhoto("2025-03-01T10:00:00Z");
    await addPhoto("2025-11-01T10:00:00Z");
    const film = await createAnnualFilm(USER, { year: 2025, durationSeconds: 10 });

    const result = await processNextVideo();
    expect(result?.id).toBe(film.id);

    const database = await getDatabase();
    const rows = await database.query<{ status: string; error_code: string | null; output_key: string | null; work_id: string | null }>(
      "SELECT status,error_code,output_key,work_id FROM video_renders WHERE id=$1", [film.id],
    );
    const row = rows[0];
    if (HAS_FFMPEG) {
      expect(row.status, JSON.stringify(row)).toBe("ready");
      expect(row.output_key).toMatch(/-annual\.mp4$/);
      expect(row.work_id).toBeTruthy();
      const works = await database.query<{ source_kind: string; source_id: string; locked: boolean; asset_kind: string }>(
        "SELECT source_kind,source_id,locked,asset_kind FROM works WHERE id=$1", [String(row.work_id)],
      );
      expect(works[0].source_kind).toBe("report");
      expect(works[0].source_id).toBe(annualFilmSourceId(USER, PET, 2025));
      // 高清解锁付费，预览免费 —— 与 PL-19 现有口径一致。
      expect(works[0].locked).toBe(true);
      expect(works[0].asset_kind).toBe("video");
    } else {
      // 没有 ffmpeg：必须是明确失败，不能静默停在 processing。
      expect(row.status).toBe("failed");
      expect(row.error_code).toBeTruthy();
    }
  }, 120_000);

  it.runIf(HAS_FFMPEG)("A14：非默认 B 的日期与素材快照实际渲染、抽帧，排队后 A 增图和 B 改日期不改变成片", async () => {
    const database = await getDatabase();
    const b = crypto.randomUUID();
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,is_default,created_at) VALUES ($1,$2,'蓝蓝B','cat','unknown','2024-01-01',false,now())", [b, USER]);
    const first = await addPhoto("2025-03-01T10:00:00Z", b, { r: 20, g: 50, b: 210 });
    const last = await addPhoto("2025-11-01T10:00:00Z", b, { r: 20, g: 150, b: 210 });
    const film = await createAnnualFilm(USER, { year: 2025, durationSeconds: 10, petId: b, photoIds: [first, last] });
    const [before] = await database.query("SELECT config FROM video_renders WHERE id=$1", [film.id]);
    for (let i = 0; i < 15; i++) await addPhoto("2025-12-01T10:00:00Z", PET, { r: 220, g: 30, b: 20 });
    await updatePhotoMetadata(USER, first, { version: 1, memoryDate: "2023-01-01" });
    await expect(deletePhoto(USER, first)).rejects.toMatchObject({ code: "PHOTO_IN_USE" });
    const result = await processNextVideo();
    expect(result?.status, JSON.stringify(result)).toBe("ready");
    const [render] = await database.query("SELECT config,output_key,work_id FROM video_renders WHERE id=$1", [film.id]);
    expect(render.config).toEqual(before.config);
    const [work] = await database.query("SELECT title,pet_id,source_id FROM works WHERE id=$1", [render.work_id]);
    expect(work).toMatchObject({ title: "蓝蓝B的 2025", pet_id: b, source_id: annualFilmSourceId(USER, b, 2025) });
    const evidence = path.resolve(".data/record-evidence"); await mkdir(evidence, { recursive: true });
    const movie = path.join(evidence, "annual-b.mp4"), frame = path.join(evidence, "annual-b-frame.png");
    await writeFile(movie, (await objectStorage.get(String(render.output_key)))!.body);
    await promisify(execFile)(process.env.FFMPEG_PATH!, ["-y", "-ss", "2.8", "-i", movie, "-frames:v", "1", frame], { windowsHide: true });
    const pixels = await sharp(frame).extract({ left: 360, top: 450, width: 1, height: 1 }).raw().toBuffer();
    expect(pixels[2]).toBeGreaterThan(170); expect(pixels[0]).toBeLessThan(50);
    await writeFile(path.join(evidence, "annual-b-snapshot.json"), JSON.stringify({ renderId: film.id, snapshot: before.config, work, sampleTimeSeconds: 2.8, rgb: [...pixels] }, null, 2));
  }, 120_000);

  it.runIf(HAS_FFMPEG)("普通视频使用入队时的照片快照，排队后编辑项目不会换封面", async () => {
    const first = await addPhoto("2025-03-01T10:00:00Z", PET, { r: 20, g: 50, b: 210 });
    const second = await addPhoto("2025-11-01T10:00:00Z", PET, { r: 210, g: 50, b: 20 });
    const project = await createVideoProject(USER, { petId: PET, title: "排队时的项目", photoIds: [first], durationSeconds: 10 });
    const render = await renderVideoProject(USER, String(project.id));
    const database = await getDatabase();
    await database.query("UPDATE video_projects SET photo_ids=$2::jsonb,cover_photo_id=$3,title='后来编辑的项目' WHERE id=$1", [String(project.id), JSON.stringify([second]), second]);
    const result = await processNextVideo();
    expect(result?.status).toBe("preview_ready");
    const [work] = await database.query("SELECT photo_id,title FROM works WHERE id=$1", [String(result?.workId)]);
    expect(work).toMatchObject({ photo_id: first, title: "后来编辑的项目" });
    const [row] = await database.query<{ config: unknown }>("SELECT config FROM video_renders WHERE id=$1", [String(render.id)]);
    const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config as { photoIds?: string[] };
    expect(config.photoIds).toEqual([first]);
  }, 120_000);

  it("队列为空时返回 null", async () => {
    expect(await processNextVideo()).toBeNull();
  });
});
