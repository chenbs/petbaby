import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { generateGrowthCompare } from "@/server/generators/svg";
import type { GeneratorInput } from "@/server/generators/types";
import type { GenerationTask, Pet, Photo, PluginManifest } from "@/domain/models";

async function jpeg(hue: number) {
  const body = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: hue, g: 120, b: 160 } } }).jpeg().toBuffer();
  return { body: new Uint8Array(body), contentType: "image/jpeg" };
}

function photoMeta(shotAt: string): Photo {
  return {
    id: crypto.randomUUID(), userId: "u", petId: "p", filename: "a.jpg", mimeType: "image/jpeg", size: 1,
    storageKey: "k", url: "/u", createdAt: shotAt, shotAt, shotAtSource: "exif", position: 0,
  };
}

const PET: Pet = {
  id: "00000000-0000-4000-8000-00000000c001", userId: "u", name: "年糕", species: "cat", gender: "unknown",
  birthday: "2024-01-01", dateType: "birthday", lifeStage: "active", isDefault: true, createdAt: "2025-06-01T00:00:00.000Z",
};

const PLUGIN = { id: "pl-23", generator: { template: "growth-compare-v1" } } as unknown as PluginManifest;
const TASK = { id: "t", options: {} } as unknown as GenerationTask;

async function input(shotAtList: string[]): Promise<GeneratorInput> {
  const photos = await Promise.all(shotAtList.map(async (shotAt, index) => ({ metadata: photoMeta(shotAt), object: await jpeg(60 * index) })));
  return { task: TASK, pet: PET, photos, plugin: PLUGIN } as GeneratorInput;
}

describe("generateGrowthCompare", () => {
  /**
   * 必须按拍摄时间排序，不能依赖 photoIds 的顺序：
   * 用户点选的顺序与拍摄先后无关，排错了「成长」方向就是倒的。
   */
  it("按拍摄时间排序，最早的在左，即使入参是倒序", async () => {
    const output = await generateGrowthCompare(await input(["2024-12-31T10:00:00Z", "2024-01-01T10:00:00Z"]));
    const svg = Buffer.from(output.files[0].body).toString();
    const leftDay = svg.match(/x="70" y="906"[^>]*>第 (\d+) 天/);
    const rightDay = svg.match(/x="550" y="906"[^>]*>第 (\d+) 天/);
    expect(Number(leftDay?.[1])).toBeLessThan(Number(rightDay?.[1]));
    expect(Number(leftDay?.[1])).toBe(1);
  });

  /** 间隔天数必须来自这个用户的真实档案，而不是一句谁都能说的话 */
  it("标注两张之间过了多少天", async () => {
    const output = await generateGrowthCompare(await input(["2024-01-01T10:00:00Z", "2024-01-11T10:00:00Z"]));
    const svg = Buffer.from(output.files[0].body).toString();
    expect(svg).toContain("这中间过了 10 天");
    expect(output.subtitle).toBe("这中间过了 10 天");
  });

  it("同一天的两张不说「相隔 0 天」", async () => {
    // 必须构造成**同一个本地日**的两个时刻。08:00Z 与 20:00Z 在东八区跨了日界，
    // 那种输入本来就该算 1 天，不能用来测这条。
    const day = new Date(2024, 4, 5, 9, 0);
    const later = new Date(2024, 4, 5, 21, 0);
    const output = await generateGrowthCompare(await input([day.toISOString(), later.toISOString()]));
    expect(output.subtitle).toBe("同一天的两张");
  });

  it("两张照片都真嵌进 SVG，且产出可光栅化的 PNG", async () => {
    const output = await generateGrowthCompare(await input(["2024-01-01T10:00:00Z", "2024-06-01T10:00:00Z"]));
    const svg = Buffer.from(output.files[0].body).toString();
    expect(svg.match(/data:image\/jpeg;base64,/g)).toHaveLength(2);
    const png = output.files.find((file) => file.suffix === "png");
    expect(png).toBeDefined();
    expect((await sharp(Buffer.from(png!.body)).metadata()).width).toBe(1080);
  });

  it("宠物名字进标题（换掉名字句子就不成立，这是不可替代性的判定）", async () => {
    const output = await generateGrowthCompare(await input(["2024-01-01T10:00:00Z", "2024-06-01T10:00:00Z"]));
    expect(output.title).toBe("年糕的变化");
  });
});
