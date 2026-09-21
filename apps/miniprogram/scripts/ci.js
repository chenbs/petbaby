const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

function validateConfig(mode, environment, currentConfig) {
  if (!["preview", "upload"].includes(mode)) throw new Error("用法：node scripts/ci.js preview|upload");
  const appid = environment.MINIPROGRAM_APP_ID || currentConfig.appid;
  if (!/^wx[0-9a-f]{16}$/i.test(appid || "")) throw new Error("MINIPROGRAM_APP_ID 必须是已认证小程序的真实 AppID");
  const apiBaseUrl = environment.MINIPROGRAM_API_BASE_URL || "https://app.babykitty.cn";
  const url = new URL(apiBaseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("预览与上传需要无路径的 HTTPS API 域名");
  const version = environment.MINIPROGRAM_VERSION;
  if (mode === "upload" && !/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error("MINIPROGRAM_VERSION 必须使用 x.y.z 格式");
  return { appid, apiBaseUrl: url.origin, version, description: (environment.MINIPROGRAM_DESCRIPTION || "麻麻抱我版本更新").slice(0, 40) };
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error("微信开发者工具退出码：" + code)));
  });
}

async function main() {
  const mode = process.argv[2];
  const root = path.resolve(__dirname, "..");
  const currentConfig = JSON.parse(await fs.readFile(path.join(root, "project.config.json"), "utf8"));
  const config = validateConfig(mode, process.env, currentConfig);
  await run(process.execPath, [path.join(root, "scripts/validate.js")], { cwd: root });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "petbaby-miniprogram-"));
  const project = path.join(directory, "project");
  try {
    const excluded = new Set(["node_modules", ".git", "scripts", "preview-qrcode.png", "project.private.config.json", "config.local.js"]);
    await fs.cp(root, project, { recursive: true, filter: (source) => !excluded.has(path.basename(source)) && !path.basename(source).endsWith(".key") });
    await fs.writeFile(path.join(project, "project.config.json"), JSON.stringify({ ...currentConfig, appid: config.appid }, null, 2));
    let local = {};
    try { local = require(path.join(root, "config.local.js")); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
    await fs.writeFile(path.join(project, "config.local.js"), "module.exports = " + JSON.stringify({ ...local, apiBaseUrl: config.apiBaseUrl }, null, 2) + ";\n");
    const args = ["-c", "Codex", mode === "preview" ? "create_preview_qrcode" : "upload", "--project", project];
    if (mode === "preview") args.push("--qr-format", "image", "--qr-output", path.join(root, "preview-qrcode.png"));
    else args.push("--upload-version", config.version, "--desc", config.description);
    if (process.platform === "win32") {
      const installation = process.env.WECHATIDE_HOME;
      if (!installation) throw new Error("Windows 请设置 WECHATIDE_HOME 为微信开发者工具 Nightly 安装目录");
      const executable = path.join(installation, "微信开发者工具.exe");
      const entry = path.join(installation, "resources/app.asar.unpacked/js/common/cli/skill-index.js");
      await fs.access(executable);
      await fs.access(entry);
      await run(executable, [entry, "--electron", ...args], { cwd: installation, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", cwd: root } });
    } else {
      await run(process.env.WECHATIDE_EXECUTABLE || "wechatide", args, { cwd: root });
    }
    console.log(mode === "preview" ? "预览二维码：preview-qrcode.png" : "已上传体验版 " + config.version + "，尚未提交审核或发布。");
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("petbaby-miniprogram-")) throw new Error("拒绝清理不属于本次构建的目录");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

module.exports = { validateConfig };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
