/**
 * 保存高清原图到相册（作品 / 挑选页 / 写真成片共用）。
 *
 * 生成类原图上没有可见的 AI 标识（2026-09 口径），所以服务端在第一次交付前
 * 会返回 428 AI_DISCLOSURE_REQUIRED：这里弹一次确认，用户同意后记录确认并重试同一请求。
 * 确认文案取服务端返回的 message，端上不写死（两端各写一份迟早漏改一处）。
 */
const config = require("../config");
const api = require("./api");

function authHeader() {
  const session = wx.getStorageSync("petbaby_session");
  return session ? { authorization: "Bearer " + session } : {};
}

function download(path) {
  return new Promise((resolve, reject) => wx.downloadFile({
    url: config.apiBaseUrl + path,
    header: authHeader(),
    timeout: 15000,
    success: (result) => {
      if (result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath) return resolve(result.tempFilePath);
      const error = new Error(result.statusCode === 428 ? "需要先确认标识说明" : "文件暂时无法下载，请稍后重试");
      error.statusCode = result.statusCode;
      error.code = result.statusCode === 428 ? "AI_DISCLOSURE_REQUIRED" : "DOWNLOAD_FAILED";
      reject(error);
    },
    fail: (failure) => reject(Object.assign(new Error((failure && failure.errMsg) || "网络中断，请重试"), { code: "NETWORK_ERROR" }))
  }));
}

function confirmDisclosure() {
  return api.request("/api/account/ai-disclosure").then((status) => {
    if (status && status.acknowledged) return true;
    return new Promise((resolve) => wx.showModal({
      title: "保存前请知悉",
      content: (status && status.text) || "保存下来的图片上不带可见的 AI 标识。你自己发布或转发时，请按平台要求标注为 AI 生成内容。",
      confirmText: "我知道了",
      cancelText: "先不保存",
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    })).then((ok) => ok ? api.request("/api/account/ai-disclosure", { method: "POST", data: { channel: "miniprogram" } }).then(() => true) : false);
  });
}

/** 下载原图；遇到 428 先确认标识说明再重试一次。用户放弃时返回 null。 */
function downloadOriginal(path) {
  return download(path).catch((error) => {
    if (error.code !== "AI_DISCLOSURE_REQUIRED") throw error;
    return confirmDisclosure().then((ok) => ok ? download(path) : null);
  });
}

function saveToAlbum(filePath, kind) {
  return new Promise((resolve, reject) => {
    const options = { filePath, success: resolve, fail: reject };
    if (kind === "video") wx.saveVideoToPhotosAlbum(options);
    else wx.saveImageToPhotosAlbum(options);
  });
}

/**
 * 下载并保存。返回 "saved" | "cancelled"；相册权限被拒时抛出 code=ALBUM_DENIED 的错误。
 * @param {string} path 以 / 开头的接口路径
 * @param {"image"|"video"} [kind]
 */
function saveOriginal(path, kind) {
  return downloadOriginal(path).then((filePath) => {
    if (!filePath) return "cancelled";
    return saveToAlbum(filePath, kind).then(() => "saved").catch((error) => {
      const denied = /auth|deny|denied/i.test((error && error.errMsg) || "");
      throw Object.assign(new Error(denied ? "尚未获得相册权限，请在设置中允许后重试" : "保存失败，请重试"), { code: denied ? "ALBUM_DENIED" : "SAVE_FAILED" });
    });
  });
}

module.exports = { saveOriginal, downloadOriginal };
