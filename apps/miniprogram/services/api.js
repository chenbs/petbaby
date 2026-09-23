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
  const header = response.header || {};
  error.retryAfterSeconds = Number((detail && detail.retryAfterSeconds) || header["Retry-After"] || header["retry-after"]) || 0;
  return error;
}

function transportError(failure) {
  const error = new Error((failure && failure.errMsg) || "网络中断，请核对保存结果");
  error.code = "NETWORK_ERROR";
  error.statusCode = 0;
  return error;
}

function request(path, options) {
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
          reject(responseError(response, "请求失败"));
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
  const promise = new Promise((resolve, reject) => {
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
        else reject(responseError(Object.assign({}, response, { data: payload }), "上传失败"));
      },
      fail: (error) => reject(transportError(error))
    });
    if (task.onProgressUpdate && settings.onProgress) task.onProgressUpdate(settings.onProgress);
  });
  promise.abort = function () { if (task && task.abort) task.abort(); };
  return promise;
}

module.exports = { request, requestWithRetry, upload };
