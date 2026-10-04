import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { getImageTemplate } from "@/server/image-template-registry";
import { objectStorage } from "@/server/storage";

import { GET } from "./route";

const TEMPLATE_ID = "human-effect-31";

describe("GET /api/image-templates/[id]/sample", () => {
  beforeAll(async () => {
    const key = getImageTemplate(TEMPLATE_ID)?.sampleStorageKey;
    if (!key) throw new Error("模板缺少公开样片键");
    const webp = await sharp({ create: { width: 36, height: 64, channels: 3, background: "#d0b090" } }).webp().toBuffer();
    await objectStorage.put(key, new Uint8Array(webp), "image/webp");
  });

  const call = (query = "") => GET(new Request(`http://localhost/api/image-templates/${TEMPLATE_ID}/sample${query}`), { params: Promise.resolve({ id: TEMPLATE_ID }) });

  it("默认直出存储里的原文件", async () => {
    const response = await call();
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });

  it("format=jpeg 时转成小程序可解码的 JPEG", async () => {
    const response = await call("?format=jpeg");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 36, height: 64 });
  });

  it("未知模板返回 404", async () => {
    const response = await GET(new Request("http://localhost/api/image-templates/nope/sample"), { params: Promise.resolve({ id: "nope" }) });
    expect(response.status).toBe(404);
  });
});
