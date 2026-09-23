const config = require("../config");

/** 原照通过带会话的下载取得临时文件，不把私有 URL 交给访客或相册。 */
function downloadPhoto(photo) {
  if (!photo || !photo.url || photo.url.indexOf("/api/media/") !== 0) return Promise.reject(new Error("照片地址无效，请重新加载"));
  return new Promise((resolve, reject) => wx.downloadFile({
    url: config.apiBaseUrl + photo.url,
    header: { authorization: "Bearer " + wx.getStorageSync("petbaby_session"), "x-petbaby-client": "miniprogram" },
    success(result) {
      if (result.statusCode !== 200) return reject(new Error("照片未能下载，请重新加载或稍后重试"));
      wx.getImageInfo({
        src: result.tempFilePath,
        success(info) {
          if (["jpeg", "jpg", "png", "webp"].indexOf(info.type) < 0) return reject(new Error("下载内容不是支持的照片"));
          resolve(result.tempFilePath);
        }, fail: () => reject(new Error("无法读取下载的照片"))
      });
    }, fail: () => reject(new Error("照片下载失败，请检查网络"))
  }));
}

async function displayPhotos(photos) {
  const result = photos.map((photo) => Object.assign({}, photo, { mediaUrl: photo.url, url: "" }));
  let next = 0;
  async function worker() {
    while (next < result.length) {
      const index = next++;
      try { result[index].url = await downloadPhoto(photos[index]); }
      catch (error) { result[index].imageError = error.message; }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return result;
}

async function savePhotoToAlbum(photo) {
  const filePath = await downloadPhoto(photo);
  return new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({
    filePath, success: resolve,
    fail(failure) {
      const denied = /auth|deny|denied/.test(failure.errMsg || "");
      const error = new Error(denied ? "尚未获得相册权限，可在设置中允许后再保存" : "照片未保存到手机，请重试");
      error.albumDenied = denied; reject(error);
    }
  }));
}

/** 页面展示资源按会话下载；不跨请求缓存，撤销后重新进页必须再鉴权。 */
async function displayMediaTree(value) {
  const session = wx.getStorageSync("petbaby_session");
  const jobs = [];
  function copy(item) {
    if (!item || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map(copy);
    const result = {};
    Object.keys(item).forEach((key) => {
      const field = item[key];
      if (["url", "outputUrl", "avatarUrl"].indexOf(key) >= 0 && typeof field === "string" && (field.indexOf("/api/media/") === 0 || /^\/api\/owner-photos\/[^/]+\/media$/.test(field))) {
        result[key] = "";
        jobs.push(async () => {
          try {
            result[key] = await new Promise((resolve, reject) => wx.downloadFile({
              url: config.apiBaseUrl + field,
              header: { authorization: "Bearer " + session, "x-petbaby-client": "miniprogram" },
              success(response) { if (response.statusCode === 200) resolve(response.tempFilePath); else reject(new Error("图片或作品文件暂时无法读取")); },
              fail: () => reject(new Error("图片或作品文件下载失败，请重试"))
            }));
          } catch (error) { result.imageError = error.message; }
        });
      } else result[key] = copy(field);
    });
    return result;
  }
  const output = copy(value);
  let next = 0;
  async function worker() { while (next < jobs.length) await jobs[next++](); }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (wx.getStorageSync("petbaby_session") !== session) throw new Error("账号已切换，请重新加载");
  return output;
}

module.exports = { downloadPhoto, displayPhotos, savePhotoToAlbum, displayMediaTree };
