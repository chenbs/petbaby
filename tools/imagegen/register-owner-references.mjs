/** 登记用户明确授权的 4 个独立主人身份图；原图仅本地内部验证使用。 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { ownerReferences, relativeToRoot, REFERENCE_ROOT, ROOT } from "./dual-subject-prompts.mjs";

const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");
const OUTPUT = path.join(REFERENCE_ROOT, "owners", "index.json");

const records = [];
for (const owner of ownerReferences) {
  const body = await readFile(owner.path);
  const metadata = await sharp(body).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${owner.id} 无法读取尺寸`);
  records.push({
    id: owner.id,
    label: owner.label,
    independentIdentity: true,
    path: relativeToRoot(owner.path),
    width: metadata.width,
    height: metadata.height,
    mimeType: "image/png",
    sha256: createHash("sha256").update(body).digest("hex")
  });
}

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({
  status: "authorized-internal-validation-only",
  authorizationBasis: "user-provided-and-explicitly-authorized-in-conversation",
  authorizedAt: "2026-08-17T00:00:00+08:00",
  identitiesAreIndependent: true,
  allowedUses: ["internal-dual-subject-master-production", "internal-generation-stability-validation"],
  forbiddenUses: ["public-sample", "marketing", "client-bundle", "object-storage-seed", "third-party-sharing-outside-generation-request"],
  publicSample: false,
  sourceFilesGitIgnored: true,
  records
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(OUTPUT));
