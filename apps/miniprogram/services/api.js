const config = require("../config");

function sessionHeader() {
  const session = wx.getStorageSync("petbaby_session");
  return session ? { authorization: "Bearer " + session } : {};
}

function responseError(response, fallback) {
  const payload = typeof response.data === "object" ? response.data : {};
  const detail = payload && payload.error;
  const error = new Error((detail && detail.message) || fallback);
  error.code = (detail && detail.code) || "REQUEST_FAILED";
  error.statusCode = response.statusCode;
  error.details = detail && detail.details;
  const header = response.header || {};
  error.retryAfterSeconds = Number((detail && detail.retryAfterSeconds) || header["Retry-After"] || header["retry-after"]) || 0;
  return error;
}

/*
 * 账号被后台封禁（2026-10-26）：服务端对任何需要登录的接口返回 403 ACCOUNT_SUSPENDED，微信登录同样拒绝。
 * 清掉本地会话并回到登录页提示，只跳一次，避免多个并发请求各自 reLaunch。
 */
let suspendedHandled = false;
function handleSuspended(error) {
  if (error.code !== "ACCOUNT_SUSPENDED" || suspendedHandled) return;
  suspendedHandled = true;
  wx.removeStorageSync("petbaby_session");
  wx.reLaunch({ url: "/pages/login/login?suspended=1" });
}

function transportError(failure) {
  const error = new Error((failure && failure.errMsg) || "网络中断，请核对保存结果");
  error.code = "NETWORK_ERROR";
  error.statusCode = 0;
  return error;
}

/**
 * 启动静默登录（app.js 的 loginReady）落定前先等一等，避免首屏请求抢在登录前拿到 401。
 * 登录接口本身不等，否则自己等自己。最多等 10 秒：登录卡住时照常发请求，由页面显示真实错误。
 */
function loginSettled(path) {
  if (path.indexOf("/api/auth/") === 0) return Promise.resolve();
  const app = typeof getApp === "function" ? getApp() : null;
  const ready = app && app.globalData && app.globalData.loginReady;
  if (!ready) return Promise.resolve();
  return Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 10000))]);
}

function request(path, options) {
  return loginSettled(path).then(() => send(path, options));
}

function send(path, options) {
  const settings = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBaseUrl + path,
      method: settings.method || "GET",
      data: settings.data || {},
      timeout: 10000,
      header: Object.assign({ "content-type": "application/json", "x-petbaby-client": "miniprogram" }, sessionHeader(), settings.header || {}),
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data.data);
        else {
          const error = responseError(response, "请求失败");
          handleSuspended(error);
          reject(error);
        }
      },
      fail: (error) => reject(transportError(error))
    });
  });
}

function requestWithRetry(path, options, retries) {
  const remaining = typeof retries === "number" ? retries : 2;
  return request(path, options).catch((error) => {
    if (remaining <= 0 || (error.statusCode && error.statusCode < 500)) throw error;
    return new Promise((resolve) => setTimeout(resolve, (3 - remaining) * 600)).then(() => requestWithRetry(path, options, remaining - 1));
  });
}

function upload(path, filePath, formData, options) {
  const settings = options || {};
  let task;
  let aborted = false;
  const promise = loginSettled(path).then(() => new Promise((resolve, reject) => {
    if (aborted) return reject(transportError({ errMsg: "uploadFile:fail abort" }));
    task = wx.uploadFile({
      url: config.apiBaseUrl + path,
      filePath,
      name: "file",
      formData: formData || {},
      timeout: 30000,
      header: Object.assign({ "x-petbaby-client": "miniprogram" }, sessionHeader()),
      success(response) {
        let payload;
        try { payload = JSON.parse(response.data); } catch (error) { reject(transportError({ errMsg: "上传结果待核对" })); return; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(payload.data);
        else {
          const error = responseError(Object.assign({}, response, { data: payload }), "上传失败");
          handleSuspended(error);
          reject(error);
        }
      },
      fail: (error) => reject(transportError(error))
    });
    if (task.onProgressUpdate && settings.onProgress) task.onProgressUpdate(settings.onProgress);
  }));
  promise.abort = function () { aborted = true; if (task && task.abort) task.abort(); };
  return promise;
}

module.exports = { request, requestWithRetry, upload };
