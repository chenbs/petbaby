const config = require("../config");

function sessionHeader() {
  const session = wx.getStorageSync("petbaby_session");
  return session ? { authorization: "Bearer " + session } : {};
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
        else reject(new Error((response.data && response.data.error && response.data.error.message) || "请求失败"));
      },
      fail: reject
    });
  });
}

function requestWithRetry(path, options, retries) {
  const remaining = typeof retries === "number" ? retries : 2;
  return request(path, options).catch((error) => {
    if (remaining <= 0) throw error;
    return new Promise((resolve) => setTimeout(resolve, (3 - remaining) * 600)).then(() => requestWithRetry(path, options, remaining - 1));
  });
}

function upload(path, filePath, formData) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: config.apiBaseUrl + path,
      filePath,
      name: "file",
      formData: formData || {},
      timeout: 30000,
      header: Object.assign({ "x-petbaby-client": "miniprogram" }, sessionHeader()),
      success(response) {
        let payload;
        try { payload = JSON.parse(response.data); } catch (error) { reject(new Error("上传响应无效")); return; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(payload.data);
        else reject(new Error((payload.error && payload.error.message) || "上传失败"));
      },
      fail: reject
    });
  });
}

module.exports = { request, requestWithRetry, upload };
