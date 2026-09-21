import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CosObjectStorage, signCosRequest } from "@/server/storage/cos-storage";

const host = "babykitty-user-one-1252454114.cos.ap-guangzhou.myqcloud.com";
const storage = new CosObjectStorage();

describe("private Tencent COS", () => {
  beforeEach(() => {
    vi.stubEnv("OSS_BUCKET", "babykitty-user-one-1252454114");
    vi.stubEnv("STORAGE_REGION", "ap-guangzhou");
    vi.stubEnv("OSS_ACCESS_KEY_ID", "test-secret-id");
    vi.stubEnv("OSS_ACCESS_KEY_SECRET", "test-secret-key");
    vi.stubEnv("OSS_ENDPOINT", "");
    vi.stubEnv("OSS_SESSION_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("matches the Tencent SDK signature vector including an unescaped Unicode key", () => {
    expect(signCosRequest("GET", "/photos/猫 portrait.jpg", { host }, "test-secret-id", "test-secret-key", 1700000000000)).toBe("q-sign-algorithm=sha1&q-ak=test-secret-id&q-sign-time=1700000000;1700000600&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=&q-signature=867f560ab144011f711b85dafd49108b64912ba8");
  });

  it("signs PUT integrity headers and keeps every uploaded object private", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await storage.put("photos/猫 portrait.jpg", Buffer.from("hello"), "image/jpeg");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://${host}/photos/%E7%8C%AB%20portrait.jpg`);
    expect(options.headers).toMatchObject({ "x-cos-acl": "private", "content-md5": "XUFAKrxLKna5cZ2REBfFkg==", "content-type": "image/jpeg" });
    expect(options.headers.Authorization).toContain("q-header-list=content-md5;content-type;host;x-cos-acl");
    expect(options.redirect).toBe("error");
    expect(await options.body.text()).toBe("hello");
  });

  it("reads privately, accepts missing objects, but never treats a failed upload as success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("image", { headers: { "content-type": "image/png" } })).mockImplementation(() => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await storage.get("photos/example.png")).toEqual({ body: new Uint8Array(Buffer.from("image")), contentType: "image/png" });
    expect(await storage.get("missing.png")).toBeNull();
    await expect(storage.delete("missing.png")).resolves.toBeUndefined();
    await expect(storage.put("missing.png", Buffer.from("image"), "image/png")).rejects.toMatchObject({ code: "STORAGE_REQUEST_FAILED" });
  });

  it("fails closed on absent region, alternate endpoint, or traversal", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(storage.get("photos/../secret")).rejects.toMatchObject({ code: "INVALID_OBJECT_KEY" });
    vi.stubEnv("OSS_ENDPOINT", "https://another-bucket.example.com");
    await expect(storage.get("photo.jpg")).rejects.toMatchObject({ code: "STORAGE_CONFIG_INVALID" });
    vi.stubEnv("STORAGE_REGION", "");
    await expect(storage.get("photo.jpg")).rejects.toMatchObject({ code: "STORAGE_CONFIG_PENDING" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
