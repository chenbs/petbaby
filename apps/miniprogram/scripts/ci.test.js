const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig } = require("./ci");

test("发布拒绝游客身份、非 HTTPS 与缺少版本的上传", () => {
  assert.throws(() => validateConfig("preview", {}, { appid: "touristappid" }), /AppID/);
  assert.throws(() => validateConfig("upload", { MINIPROGRAM_APP_ID: "wx1234567890abcdef" }, {}), /VERSION/);
  assert.throws(() => validateConfig("preview", { MINIPROGRAM_APP_ID: "wx1234567890abcdef", MINIPROGRAM_API_BASE_URL: "http://localhost:3000" }, {}), /HTTPS/);
  assert.throws(() => validateConfig("preview", { MINIPROGRAM_APP_ID: "wx1234567890abcdef", MINIPROGRAM_API_BASE_URL: "https://user:secret@app.babykitty.cn/" }, {}), /HTTPS/);
});

test("上传使用已确认的 API 域名并保留显式测试域名", () => {
  const environment = { MINIPROGRAM_APP_ID: "wx1234567890abcdef", MINIPROGRAM_VERSION: "1.0.0" };
  assert.equal(validateConfig("upload", environment, {}).apiBaseUrl, "https://app.babykitty.cn");
  assert.equal(validateConfig("preview", { ...environment, MINIPROGRAM_API_BASE_URL: "https://staging.babykitty.cn" }, {}).apiBaseUrl, "https://staging.babykitty.cn");
});
