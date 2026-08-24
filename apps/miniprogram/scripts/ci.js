const fs = require("node:fs");
const path = require("node:path");
const ci = require("miniprogram-ci");

const mode = process.argv[2];
if (!new Set(["preview", "upload"]).has(mode)) throw new Error("Usage: node scripts/ci.js preview|upload");

const root = path.resolve(__dirname, "..");
const appid = process.env.MINIPROGRAM_APP_ID;
const privateKeyPath = process.env.MINIPROGRAM_PRIVATE_KEY_PATH;
const apiBaseUrl = process.env.MINIPROGRAM_API_BASE_URL;
if (!appid || !privateKeyPath || !apiBaseUrl) throw new Error("MINIPROGRAM_APP_ID, MINIPROGRAM_PRIVATE_KEY_PATH and MINIPROGRAM_API_BASE_URL are required");
if (!fs.existsSync(privateKeyPath)) throw new Error(`Private key not found: ${privateKeyPath}`);
if (mode === "upload" && !apiBaseUrl.startsWith("https://")) throw new Error("Upload requires an HTTPS MINIPROGRAM_API_BASE_URL");

fs.writeFileSync(path.join(root, "config.local.js"), `module.exports = ${JSON.stringify({ apiBaseUrl }, null, 2)};\n`, "utf8");
const project = new ci.Project({ appid, type: "miniProgram", projectPath: root, privateKeyPath, ignores: ["node_modules/**/*", "preview-qrcode.png"] });
const setting = { es6: true, es7: true, minify: true, codeProtect: false, autoPrefixWXSS: true };
const description = (process.env.MINIPROGRAM_DESCRIPTION || "Petbaby automated build").slice(0, 40);

if (mode === "preview") {
  ci.preview({ project, desc: description, setting, qrcodeFormat: "image", qrcodeOutputDest: path.join(root, "preview-qrcode.png"), onProgressUpdate: console.log }).then(() => console.log("Preview QR: preview-qrcode.png"));
} else {
  const version = process.env.MINIPROGRAM_VERSION;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("MINIPROGRAM_VERSION must use x.y.z format");
  ci.upload({ project, version, desc: description, setting, onProgressUpdate: console.log }).then(() => console.log(`Uploaded Mini Program ${version}`));
}
