const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const mini = path.join(root, "apps/miniprogram");
const platform = path.join(root, "apps/platform");
const stage = path.join(platform, ".data/miniprogram-effects");
const planBody = fs.readFileSync(path.join(stage, "plan.json"));
const plan = JSON.parse(planBody);
const verification = JSON.parse(fs.readFileSync(path.join(stage, "verification.json"), "utf8"));
const digest = createHash("sha256").update(planBody).digest("hex");
if (verification.planSha256 !== digest || verification.count !== plan.remote.length) throw new Error("COS 校验与本地效果图清单不一致");

const manifestPath = path.join(mini, "assets/samples/manifest.js");
const projectPath = path.join(mini, "project.config.json");
const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
const ignore = project.packOptions.ignore || [];
for (const group of ["plugins", "scenes", "templates", "movie", "album", "interactive"]) {
  const value = "assets/samples/" + group;
  if (!ignore.some((item) => item.type === "folder" && item.value === value)) ignore.push({ type: "folder", value });
}
for (const id of ["recharge", "bond", "luck"]) {
  const value = `assets/fun-tests/${id}.jpg`;
  if (!ignore.some((item) => item.type === "file" && item.value === value)) ignore.push({ type: "file", value });
}

for (const item of plan.remote) {
  const source = path.join(root, item.file);
  const target = path.join(platform, ".data/objects", item.key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  fs.writeFileSync(target + ".meta", JSON.stringify({ contentType: "image/jpeg" }));
}
fs.writeFileSync(manifestPath, "module.exports = " + JSON.stringify(plan.manifest, null, 2) + ";\n");
project.packOptions.ignore = ignore;
fs.writeFileSync(projectPath, JSON.stringify(project, null, 2) + "\n");
console.log(`已切换 ${plan.home.length} 张首页本地图和 ${plan.remote.length} 张 COS 远程图`);
