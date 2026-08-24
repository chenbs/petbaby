import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { createAnnualFilm } from "@/server/video/annual-film";
import { processNextVideo } from "@/server/video/ffmpeg";

const USER = "00000000-0000-4000-8000-0000000000e1";
const PET = "00000000-0000-4000-8000-0000000000e2";

/** 本机可能没有 ffmpeg。有则跑真渲染，没有则只断言队列与失败落库 */
const HAS_FFMPEG = Boolean(process.env.FFMPEG_PATH);

async function addPhoto(shotAt: string) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const key = `private/${USER}/photos/${id}.jpg`;
  const body = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg().toBuffer();
  await database.query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,shot_at,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',$5,$6,0,'clear',$7,$7)",
    [id, USER, PET, `${id}.jpg`, body.byteLength, key, shotAt],
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
      expect(row.status).toBe("ready");
      expect(row.output_key).toMatch(/-annual\.mp4$/);
      expect(row.work_id).toBeTruthy();
      const works = await database.query<{ source_kind: string; source_id: string; locked: boolean; asset_kind: string }>(
        "SELECT source_kind,source_id,locked,asset_kind FROM works WHERE id=$1", [String(row.work_id)],
      );
      expect(works[0].source_kind).toBe("report");
      expect(works[0].source_id).toBe(`${USER}:2025`);
      // 高清解锁付费，预览免费 —— 与 PL-19 现有口径一致。
      expect(works[0].locked).toBe(true);
      expect(works[0].asset_kind).toBe("video");
    } else {
      // 没有 ffmpeg：必须是明确失败，不能静默停在 processing。
      expect(row.status).toBe("failed");
      expect(row.error_code).toBeTruthy();
    }
  }, 120_000);

  it("队列为空时返回 null", async () => {
    expect(await processNextVideo()).toBeNull();
  });
});
