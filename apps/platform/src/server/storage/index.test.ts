import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfiguredCloudStorage } from "@/server/storage/cloud-storage";
import { LocalObjectStorage } from "@/server/storage/local-storage";
import { inspectImage, selectObjectStorage } from "@/server/storage";

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from("52494646", "hex"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]);

describe("object storage selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses local disk in development and in an explicit staging test machine", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "");
    expect(selectObjectStorage()).toBeInstanceOf(LocalObjectStorage);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "local");
    expect(selectObjectStorage()).toBeInstanceOf(LocalObjectStorage);
  });

  it("never falls back to local disk in real production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "local");
    expect(selectObjectStorage()).toBeInstanceOf(ConfiguredCloudStorage);
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "");
    expect(selectObjectStorage()).toBeInstanceOf(ConfiguredCloudStorage);
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "s3");
    expect(selectObjectStorage()).toBeInstanceOf(ConfiguredCloudStorage);
  });

  it("validates image magic bytes against the declared MIME type", () => {
    expect(inspectImage(PNG)).toMatchObject({ mime: "image/png", extension: "png" });
    expect(inspectImage(PNG, "image/jpeg")).toBeNull();
    expect(inspectImage(WEBP, "image/webp")).toMatchObject({ extension: "webp" });
    expect(inspectImage(Buffer.concat([Buffer.from("52494646", "hex"), Buffer.alloc(8)]), "image/webp")).toBeNull();
    expect(inspectImage(Buffer.from("not an image at all"))).toBeNull();
  });
});
