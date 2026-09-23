import { z } from "zod";
import { startOfLocalDay } from "@/domain/companion";

export const PHOTO_TAGS = [
  { code: "today", label: "今天的样子" },
  { code: "first", label: "第一次" },
  { code: "walk", label: "散步" },
  { code: "birthday", label: "生日" },
  { code: "learned", label: "学会了" },
  { code: "keep", label: "只是想留着" },
] as const;
export type PhotoTag = (typeof PHOTO_TAGS)[number]["code"];
export type MemoryDateSource = "manual" | "exif" | "upload";

/** 纯日期保持日历日；ISO 时刻沿用 companion 的服务端本地日口径。 */
export function photoLocalDate(value: unknown): string {
  const day = startOfLocalDay(value);
  if (!day) return "";
  return `${String(day.getFullYear()).padStart(4, "0")}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** PostgreSQL/PGlite DATE 可能返回 Date，不能先转 ISO 再截日期。 */
export function storedMemoryDate(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? photoLocalDate(value) : String(value).slice(0, 10);
}

export function effectivePhotoDate(photo: { memoryDate?: string | null; shotAt: string; shotAtSource: "exif" | "upload" }) {
  return {
    date: photo.memoryDate || photoLocalDate(photo.shotAt),
    source: (photo.memoryDate ? "manual" : photo.shotAtSource) as MemoryDateSource,
  };
}

const tagSchema = z.enum(["today", "first", "walk", "birthday", "learned", "keep"]);
export const photoTextSchema = z.object({
  caption: z.string().max(120).optional(),
  tags: z.array(tagSchema).max(3).refine((tags) => new Set(tags).size === tags.length, "标签不能重复").optional(),
});
export const photoMetadataSchema = photoTextSchema.extend({
  version: z.number().int().positive(),
  memoryDate: z.string().date().refine((date) => date <= photoLocalDate(new Date()), "记录日期不能晚于今天").nullable().optional(),
}).strict().refine((input) => input.memoryDate !== undefined || input.caption !== undefined || input.tags !== undefined, "请选择要修改的内容");
export const batchPhotoMetadataSchema = photoTextSchema.extend({
  photos: z.array(z.object({ photoId: z.string().uuid(), version: z.number().int().positive() }).strict()).min(1).max(9)
    .refine((photos) => new Set(photos.map((photo) => photo.photoId)).size === photos.length, "照片不能重复"),
}).strict().refine((input) => input.caption !== undefined || input.tags !== undefined, "请选择要修改的内容");

export const photoPageSchema = z.object({
  petId: z.string().uuid(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  order: z.enum(["library", "uploaded", "recorded"]).default("library"),
  direction: z.enum(["asc", "desc"]).optional(),
  cursor: z.string().min(1).max(2048).optional(),
}).strict();
