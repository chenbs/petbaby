import { afterEach, describe, expect, it, vi } from "vitest";
import { batchPhotoMetadataSchema, effectivePhotoDate, photoLocalDate, photoMetadataSchema, storedMemoryDate } from "./photo-memory";

afterEach(() => vi.unstubAllEnvs());

describe("照片日期事实（A04）", () => {
  it("手工纯日期在服务端时区切换后不漂移，ISO 时刻沿用本地日语义", () => {
    for (const timezone of ["Asia/Shanghai", "America/Los_Angeles", "UTC"]) {
      vi.stubEnv("TZ", timezone);
      expect(photoLocalDate("2024-02-29")).toBe("2024-02-29");
      expect(storedMemoryDate("2024-02-29")).toBe("2024-02-29");
      expect(storedMemoryDate(new Date(2024, 1, 29))).toBe("2024-02-29");
      const photo = { memoryDate: "2024-02-29", shotAt: "2025-12-31T23:30:00Z", shotAtSource: "exif" as const };
      expect(effectivePhotoDate(photo)).toEqual({ date: "2024-02-29", source: "manual" });
      expect(effectivePhotoDate({ ...photo, memoryDate: null })).toEqual({ date: timezone === "Asia/Shanghai" ? "2026-01-01" : "2025-12-31", source: "exif" });
    }
    expect(effectivePhotoDate({ shotAt: "2024-01-02T12:00:00Z", shotAtSource: "upload" }).source).toBe("upload");
    expect(storedMemoryDate(null)).toBeNull();
    expect(photoLocalDate("invalid")).toBe("");
  });

  it("校验真实年月日、未来日、版本、标签上限、清空和批次边界", () => {
    expect(photoMetadataSchema.parse({ version: 1, memoryDate: "2024-02-29", caption: "", tags: [] })).toMatchObject({ memoryDate: "2024-02-29" });
    expect(photoMetadataSchema.parse({ version: 1, memoryDate: null }).memoryDate).toBeNull();
    for (const input of [{ version: 1 }, { version: 0, caption: "a" }, { version: 1, memoryDate: "2023-02-29" }, { version: 1, memoryDate: "2999-01-01" }, { version: 1, tags: ["today", "first", "walk", "keep"] }]) expect(photoMetadataSchema.safeParse(input).success).toBe(false);
    const item = { photoId: crypto.randomUUID(), version: 1 };
    expect(batchPhotoMetadataSchema.safeParse({ photos: [item], caption: "" }).success).toBe(true);
    expect(batchPhotoMetadataSchema.safeParse({ photos: [item] }).success).toBe(false);
    expect(batchPhotoMetadataSchema.safeParse({ photos: [item, item], tags: [] }).success).toBe(false);
    expect(batchPhotoMetadataSchema.safeParse({ photos: [item], memoryDate: "2024-01-01" }).success).toBe(false);
  });
});
