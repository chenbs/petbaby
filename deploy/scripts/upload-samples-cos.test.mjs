import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPlan, sign, verify } from "./upload-samples-cos.mjs";

const credentials = {
  host: "babykitty-user-one-1252454114.cos.ap-guangzhou.myqcloud.com",
  accessKey: "test-secret-id",
  secret: "test-secret-key",
};

test("部署清单中的所有母版和预览均可按原始哈希找到", async () => {
  const plan = await buildPlan();
  assert.deepEqual(plan.counts, { master: 76, preview: 76 });
  assert.equal(plan.plugins, 9);
  assert.equal(plan.styles, 4);
  assert.equal(plan.assets.size, 165);

  const root = path.resolve(import.meta.dirname, "../..");
  const sources = ["apps/platform/src/plugins/registry.ts", "apps/platform/src/server/image-template-registry.ts"];
  let references = 0;
  for (const source of sources) {
    const text = await readFile(path.join(root, source), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (source.includes("image-template-registry") && !line.includes('status: "live"')) continue;
      for (const match of line.matchAll(/"(?:\/api\/plugin-samples\/)?(samples\/[a-zA-Z0-9/_-]+\.(?:jpg|webp))"/g)) {
        assert.ok(plan.assets.has(match[1]), `${source} 引用了未上传的 ${match[1]}`);
        references++;
      }
    }
  }
  assert.ok(references >= 80);
});

test("COS 签名与应用存储适配器的已知向量一致", () => {
  const actual = sign("GET", "photos/猫 portrait.jpg", { host: credentials.host }, credentials, 1700000000000);
  assert.equal(actual, "q-sign-algorithm=sha1&q-ak=test-secret-id&q-sign-time=1700000000;1700000600&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=&q-signature=867f560ab144011f711b85dafd49108b64912ba8");
});

test("同名 COS 对象字节不匹配时拒绝复用", async () => {
  const originalFetch = globalThis.fetch;
  const body = Buffer.from("correct");
  const asset = { size: body.length, hash: createHash("sha256").update(body).digest("hex") };
  globalThis.fetch = async () => new Response("changed", { status: 200, headers: { "content-type": "image/jpeg" } });
  try {
    await assert.rejects(verify("samples/example.jpg", { ...asset, contentType: "image/jpeg" }, credentials), /内容或类型与本地不一致/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
