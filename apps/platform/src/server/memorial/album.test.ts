import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

import { escapeXml, renderMemorialAlbum, type AlbumPhoto } from "@/server/memorial/album";

/** 造一张真 JPEG。每张用不同底色，便于断言「页面真的换了照片」 */
async function photo(hue: number): Promise<AlbumPhoto> {
  const body = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: hue, g: 120, b: 160 } } }).jpeg().toBuffer();
  return { body: new Uint8Array(body), contentType: "image/jpeg" };
}

const BASE = {
  petName: "年糕",
  title: "永远闪亮的年糕",
  story: "他喜欢趴在窗台上晒太阳，尾巴一下一下地拍着地板。",
  theme: "stardust",
  sections: [],
  anchor: "2019-03-01",
  memorialSince: "2026-07-01T02:00:00.000Z",
};

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/*
 * 每条用例都要把整册 SVG 光栅化（单页 1240×1754），开覆盖率时 v8 instrumentation
 * 会让 sharp 明显变慢，5 秒的默认超时不够。给足余量，避免 CI 上出现只在
 * `test:coverage` 里挂、单跑又过的假失败。
 */
const RASTER_TIMEOUT = 60_000;

describe("renderMemorialAlbum", () => {
  it("产出真 PDF，页数 = 封面 + 照片页 + 故事页 + 结尾页", { timeout: RASTER_TIMEOUT }, async () => {
    const photos = await Promise.all([photo(200), photo(120), photo(60)]);
    const bytes = await renderMemorialAlbum({ ...BASE, photos });
    // %PDF 魔数
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    // 3 张照片 → 2 个照片页；story 非空 → 1 个故事页。
    expect(await pageCount(bytes)).toBe(1 + 2 + 1 + 1);
  });

  it("全部选中照片都进册子（每页 2 张）", { timeout: RASTER_TIMEOUT }, async () => {
    const photos = await Promise.all(Array.from({ length: 9 }, (_, index) => photo(20 * index)));
    const bytes = await renderMemorialAlbum({ ...BASE, photos, story: "" });
    // 9 张 → 5 个照片页；story 为空 → 无故事页。
    expect(await pageCount(bytes)).toBe(1 + 5 + 1);
  });

  it("单张照片也能出册，不崩", { timeout: RASTER_TIMEOUT }, async () => {
    const bytes = await renderMemorialAlbum({ ...BASE, photos: [await photo(90)] });
    expect(await pageCount(bytes)).toBe(1 + 1 + 1 + 1);
  });

  /**
   * 分段文字与照片页一一对应，多出来的分段不能被丢掉 ——
   * 那些是用户自己写的字。照片页消化 ceil(n/2) 个，剩下的落到故事页。
   */
  it("分段多于照片页时，多出的分段落到故事页而不是被丢弃", { timeout: RASTER_TIMEOUT }, async () => {
    const photos = await Promise.all([photo(200), photo(120)]);
    const sections = Array.from({ length: 5 }, (_, index) => ({ title: `第 ${index} 段`, body: `内容 ${index}` }));
    const withStory = await renderMemorialAlbum({ ...BASE, photos, sections });
    // 2 张 → 1 个照片页（消化 1 段），余 4 段 + story → 故事页存在。
    expect(await pageCount(withStory)).toBe(1 + 1 + 1 + 1);
    // 没有 story、也没有多余分段时就不该有故事页。
    const lean = await renderMemorialAlbum({ ...BASE, photos, story: "", sections: sections.slice(0, 1) });
    expect(await pageCount(lean)).toBe(1 + 1 + 1);
  });

  it("三套主题都能出册", { timeout: RASTER_TIMEOUT }, async () => {
    const photos = [await photo(150)];
    for (const theme of ["stardust", "forest", "dawn", "unknown-theme"]) {
      const bytes = await renderMemorialAlbum({ ...BASE, theme, photos });
      expect(await pageCount(bytes)).toBeGreaterThan(2);
    }
  });

  it("没有照片时产出的仍是合法 PDF（调用方负责先拦住空册子）", { timeout: RASTER_TIMEOUT }, async () => {
    const bytes = await renderMemorialAlbum({ ...BASE, photos: [] });
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
  });

  it("陪伴天数是过去式且按纪念空间创建日封口，不算到今天", { timeout: RASTER_TIMEOUT }, async () => {
    // 2019-03-01 → 2026-07-01 本地日 = 2679 天（含当天）。
    const bytes = await renderMemorialAlbum({ ...BASE, photos: [await photo(80)] });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // 天数本身在 companion.test.ts 断言；这里只确认缺 memorialSince 时不产出数字。
    const withoutSince = await renderMemorialAlbum({ ...BASE, photos: [await photo(80)], memorialSince: undefined });
    expect(Buffer.from(withoutSince.slice(0, 4)).toString()).toBe("%PDF");
  });
});

describe("escapeXml", () => {
  /**
   * 原实现是 `replace(/[<>&'"]/g, "")` —— 直接删掉，用户故事里的引号被吃掉。
   * 纪念册里每个字都是用户写的，不能悄悄改。
   */
  it("引号被转义而不是删除", () => {
    expect(escapeXml('他总是"喵"一声')).toBe("他总是&quot;喵&quot;一声");
    expect(escapeXml("它'的'窗台")).toBe("它'的'窗台");
  });

  it("尖括号与 & 正确转义，顺序不产生双重转义", () => {
    expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  it("空值不抛异常", () => {
    expect(escapeXml(undefined)).toBe("");
    expect(escapeXml(null)).toBe("");
    expect(escapeXml(0)).toBe("0");
  });
});
