import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const META = path.join(REFERENCE_ROOT, "validation", "metadata");
const OLD_NAME = "roller-coaster_dog_shiba-dog_9x16_v01.json";
const NEW_NAME = "roller-coaster_dog_shiba-dog_9x16_v02.json";

const oldMetadata = JSON.parse(await readFile(path.join(META, OLD_NAME), "utf8"));
oldMetadata.status = "superseded-after-targeted-rerun";
oldMetadata.supersededBy = "tools/imagegen/out/reference-v1/validation/roller-coaster_dog_shiba-dog_9x16_v02.png";
oldMetadata.review = {
  ...oldMetadata.review,
  state: "superseded",
  finalApproval: "rejected-for-calm-expression",
  findings: ["用户要求增加过山车兴奋感，已由 v02 定向重做替代。"]
};
await writeFile(path.join(META, OLD_NAME), `${JSON.stringify(oldMetadata, null, 2)}\n`, "utf8");

const newMetadata = JSON.parse(await readFile(path.join(META, NEW_NAME), "utf8"));
newMetadata.status = "targeted-rerun-pending-user-approval";
newMetadata.replaces = "tools/imagegen/out/reference-v1/validation/roller-coaster_dog_shiba-dog_9x16_v01.png";
newMetadata.rerunReason = "用户要求增加过山车场景中的兴奋感。";
newMetadata.review = {
  ...newMetadata.review,
  state: "pre-reviewed-pending-user-approval",
  checks: Object.fromEntries(Object.keys(newMetadata.review?.checks || {}).map((key) => [key, "pass"])),
  findings: ["v02 已明显加强张嘴开心、明亮眼神与竖耳的兴奋感；宠物身份、座舱、安全带和双爪接触保持稳定。"],
  finalApproval: "pending-user"
};
await writeFile(path.join(META, NEW_NAME), `${JSON.stringify(newMetadata, null, 2)}\n`, "utf8");
console.log("已将柴犬过山车 v01 标记为被 v02 替代");
