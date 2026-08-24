import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { createVideoProject, renderVideoProject, updateVideoProject } from "@/server/video/service";
import { objectStorage } from "@/server/storage";

const USER = "00000000-0000-4000-8000-0000000000f1";
const PET = "00000000-0000-4000-8000-0000000000f2";

/** 建 n 张真照片（含存储对象），返回 id 列表 */
async function seedPhotos(count: number) {
  const database = await getDatabase();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    const key = `private/${USER}/photos/${id}.png`;
    await database.query(
      "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,$4,'image/png',1,$5,$6,'clear',now())",
      [id, USER, PET, `${index}.png`, key, index],
    );
    await objectStorage.put(key, new TextEncoder().encode("photo"), "image/png");
    ids.push(id);
  }
  return ids;
}

describe("video project duration", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Milo','cat','unknown','birthday','active',true,now())", [PET, USER]);
  });

  it("三档时长都能建项目，落库值与所选一致", async () => {
    const photos = await seedPhotos(4);
    for (const durationSeconds of [10, 20, 30] as const) {
      const project = await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds });
      expect(Number(project.duration_seconds)).toBe(durationSeconds);
    }
  });

  it("不传时长时落到缺省 20 秒", async () => {
    const photos = await seedPhotos(3);
    const project = await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos });
    expect(Number(project.duration_seconds)).toBe(20);
  });

  /** 验收标准：10 秒档选 11 张被拒，且提示要说清上限和当前张数 */
  it("10 秒档选 11 张被拒，错误码与提示明确", async () => {
    const photos = await seedPhotos(11);
    await expect(createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 10 }))
      .rejects.toMatchObject({ code: "VIDEO_DURATION_MISMATCH", status: 422 });
    await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 20 })
      .then((project) => expect(Number(project.duration_seconds)).toBe(20));
    try {
      await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 10 });
      throw new Error("应该抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain("最多放 10 张");
      expect((error as AppError).message).toContain("11 张");
    }
  });

  it("非三档的时长被 schema 拒绝，不静默归一", async () => {
    const photos = await seedPhotos(2);
    await expect(createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 15 })).rejects.toThrow();
  });

  /**
   * 只改时长同样要重新校验组合：20 秒 20 张的项目改成 10 秒后，
   * 张数没动但已经超了新档的上限。漏了这条校验，渲染时才会黑闪。
   */
  it("只把时长改短、张数不变时也会被拒", async () => {
    const photos = await seedPhotos(11);
    const project = await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 20 });
    await expect(updateVideoProject(USER, String(project.id), { durationSeconds: 10 }))
      .rejects.toMatchObject({ code: "VIDEO_DURATION_MISMATCH" });
    // 同时减张数则通过。
    const updated = await updateVideoProject(USER, String(project.id), { durationSeconds: 10, photoIds: photos.slice(0, 10) });
    expect(Number(updated.duration_seconds)).toBe(10);
  });

  it("渲染任务的 config 带上时长，供 ffmpeg 反推单张停留", async () => {
    const photos = await seedPhotos(5);
    const project = await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 30 });
    const render = await renderVideoProject(USER, String(project.id));
    const database = await getDatabase();
    const rows = await database.query<{ config: unknown }>("SELECT config FROM video_renders WHERE id=$1", [String(render.id)]);
    const config = typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config as Record<string, unknown>;
    expect(config.durationSeconds).toBe(30);
  });

  /**
   * 历史项目（时长选项上线前建的）走 DEFAULT 20 秒。
   * 若这类项目的张数超过 20 秒档上限，渲染入口必须拦住而不是交给 ffmpeg 黑闪。
   */
  it("历史项目的时长按迁移默认值 20 秒处理", async () => {
    const photos = await seedPhotos(6);
    const project = await createVideoProject(USER, { petId: PET, title: "日常", photoIds: photos, durationSeconds: 10 });
    const database = await getDatabase();
    await database.query("UPDATE video_projects SET duration_seconds=DEFAULT WHERE id=$1", [String(project.id)]);
    const render = await renderVideoProject(USER, String(project.id));
    const rows = await database.query<{ config: unknown }>("SELECT config FROM video_renders WHERE id=$1", [String(render.id)]);
    const config = typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config as Record<string, unknown>;
    expect(config.durationSeconds).toBe(20);
  });
});
