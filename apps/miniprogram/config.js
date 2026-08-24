let local = {};
try { local = require("./config.local"); } catch (error) { local = {}; }

module.exports = {
  // config.local.js is generated or copied locally and is intentionally not committed.
  apiBaseUrl: local.apiBaseUrl || "http://127.0.0.1:3000",
  /*
   * 订阅消息模板 ID，按 eventType 索引。
   *
   * 空表示未配置：此时 `wx.requestSubscribeMessage` 无从调起，
   * 端上按 accept 落库以便本地联调。生产的模板 ID 缺失由
   * deploy/scripts/preflight.sh 与 /api/health 兜住，不靠这里报错。
   *
   * 模板 ID 属外部凭据（见 docs/operations/04-external-prerequisites.md），
   * 不进版本控制 —— 走 config.local.js 注入。
   */
  subscribeTemplateIds: local.subscribeTemplateIds || {}
};
