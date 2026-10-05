/**
 * 日常记录的端上工具（2026-10）。
 *
 * 表单字段与选项文案以服务端 `/api/record-kinds` 为准（server/daily-log-kinds.ts），
 * 这里只做三件事：拉清单并缓存一份、把字段变成表单初始值、把附图传到私有存储。
 * 不在端上维护第二份选项清单 —— 两端各写一份文案，改一处必然漏一处。
 */
const api = require("./api");

let kindsCache = null;

function loadKinds() {
  if (kindsCache) return Promise.resolve(kindsCache);
  return api.request("/api/record-kinds").then((kinds) => {
    kindsCache = kinds || [];
    return kindsCache;
  });
}

/** 测试用 */
function resetKindsCache() { kindsCache = null; }

function pad(value) { return String(value).padStart(2, "0"); }

/** 本地日历日，YYYY-MM-DD。不用 toISOString：东八区凌晨会退回前一天 */
function today(now) {
  const date = now || new Date();
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function nowTime(now) {
  const date = now || new Date();
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/** 表单初始值：计数给默认值，多选给空数组，其余留空 */
function emptyValues(spec) {
  const values = {};
  (spec.fields || []).forEach((field) => {
    if (field.type === "count") values[field.key] = field.defaultValue;
    else if (field.type === "choice" && field.multiple) values[field.key] = [];
    else if (field.type === "toggle") values[field.key] = false;
    else values[field.key] = "";
  });
  return values;
}

/**
 * 把表单值整理成接口要的 details。数字输入框给的是字符串，这里转数字；
 * 空串、空数组、false 都不发 —— 服务端也会丢，但少发一点更容易排查。
 */
function toDetails(spec, values) {
  const details = {};
  (spec.fields || []).forEach((field) => {
    const value = values[field.key];
    if (value === undefined || value === null || value === "" || value === false) return;
    if (Array.isArray(value) && !value.length) return;
    if (field.type === "number") { const number = Number(value); if (Number.isFinite(number) && number > 0) details[field.key] = number; return; }
    if (field.type === "count") { if (Number(value) !== field.defaultValue || field.key !== "courseDays") details[field.key] = Number(value); return; }
    details[field.key] = typeof value === "string" ? value.trim() : value;
  });
  return details;
}

/** 选一张附图并上传。返回 { id, url }；用户取消返回 null */
function pickAndUploadAttachment(petId) {
  return new Promise((resolve, reject) => wx.chooseMedia({
    count: 1, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"],
    success: (result) => resolve(result.tempFiles && result.tempFiles[0]),
    fail: (error) => (/cancel/.test((error && error.errMsg) || "") ? resolve(null) : reject(new Error("未能打开相册，请重试")))
  })).then((file) => {
    if (!file) return null;
    return new Promise((resolve) => wx.compressImage({
      src: file.tempFilePath, quality: 80, compressedWidth: 1600,
      success: (result) => resolve(result.tempFilePath), fail: () => resolve(file.tempFilePath)
    })).then((path) => api.upload("/api/pets/" + encodeURIComponent(petId) + "/record-attachments", path, {})
      .then((attachment) => Object.assign({}, attachment, { localPath: path })));
  });
}

module.exports = { loadKinds, resetKindsCache, today, nowTime, emptyValues, toDetails, pickAndUploadAttachment };
