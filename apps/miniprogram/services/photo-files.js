const config = require("../config");

/**
 * 展示用地址：/api/media/* 带 display=1，服务端回一张长边不超过 1440 的 JPEG（2026-10-27）。
 * 原图动辄 1–2MB，列表逐张下载要好几秒；保存到相册仍走原图（savePhotoToAlbum / 各作品的下载出口）。
 * 视频、PDF 这类服务端不缩，会原样返回。
 */
function displayUrl(path) {
  if (path.indexOf("/api/media/") !== 0) return path;
  return path + (path.indexOf("?") >= 0 ? "&" : "?") + "display=1";
}

function isPrivateMedia(path) {
  return typeof path === "string" && (path.indexOf("/api/media/") === 0
    || /^\/api\/(owner-photos|record-attachments)\/[^/]+\/media$/.test(path)
    || /^\/api\/ai-runs\/[^/]+\/candidates\/[^/?]+$/.test(path));
}

function sessionHeader(session) {
  return { authorization: "Bearer " + session, "x-petbaby-client": "miniprogram" };
}

/*
 * 直连 COS（2026-10-27）：先把整页要显示的路径一次交给 /api/media-links，服务端按原接口同一份归属校验
 * 换成预签名地址，字节直接从 COS 下载，不再经过服务器带宽。每次进页都重新换一次地址（即重新鉴权）。
 * 换不到（本地磁盘存储、SVG、接口失败）的那几张回落到原接口，页面行为不变。
 */
function requestLinks(paths, display, session) {
  if (!paths.length || typeof wx.request !== "function") return Promise.resolve(paths.map(() => null));
  return new Promise((resolve) => wx.request({
    url: config.apiBaseUrl + "/api/media-links",
    method: "POST",
    data: { paths, display },
    timeout: 10000,
    header: Object.assign({ "content-type": "application/json" }, sessionHeader(session)),
    success(response) {
      const links = response.statusCode === 200 && response.data && response.data.data && response.data.data.links;
      resolve(Array.isArray(links) && links.length === paths.length ? links.map((link) => (link && link.url) || null) : paths.map(() => null));
    },
    fail: () => resolve(paths.map(() => null))
  }));
}

async function resolveLinks(paths, display, session) {
  const result = [];
  for (let start = 0; start < paths.length; start += 100) {
    result.push.apply(result, await requestLinks(paths.slice(start, start + 100), display, session));
  }
  return result;
}

/*
 * 同一张图在 30 分钟窗口内签出的地址不变（服务端按窗口对齐签名），按地址记住已下载的临时文件，
 * 来回切页不用重复下载。地址本身每次进页都重新鉴权换取，撤销后拿不到同一个地址。
 */
const downloaded = Object.create(null);
const downloadedOrder = [];
function rememberDownload(url, filePath) {
  if (downloaded[url]) return;
  downloaded[url] = filePath;
  downloadedOrder.push(url);
  if (downloadedOrder.length > 300) delete downloaded[downloadedOrder.shift()];
}

function downloadDirect(url) {
  if (downloaded[url]) return Promise.resolve(downloaded[url]);
  // COS 预签名地址：签名在查询串里，不能再带 Authorization 头
  return new Promise((resolve, reject) => wx.downloadFile({
    url,
    success(result) {
      if (result.statusCode !== 200 || !result.tempFilePath) return reject(new Error("direct download failed"));
      rememberDownload(url, result.tempFilePath);
      resolve(result.tempFilePath);
    },
    fail: () => reject(new Error("direct download failed"))
  }));
}

function downloadViaServer(path, session) {
  return new Promise((resolve, reject) => wx.downloadFile({
    url: config.apiBaseUrl + path,
    header: sessionHeader(session),
    success(result) {
      if (result.statusCode !== 200) return reject(new Error("照片未能下载，请重新加载或稍后重试"));
      resolve(result.tempFilePath);
    }, fail: () => reject(new Error("照片下载失败，请检查网络"))
  }));
}

/** 有直连地址先走直连，失败（地址过期、域名未配置等）再回落原接口。 */
function fetchMedia(path, link, session) {
  if (!link) return downloadViaServer(path, session);
  return downloadDirect(link).catch(() => downloadViaServer(path, session));
}

function checkImage(filePath) {
  return new Promise((resolve, reject) => wx.getImageInfo({
    src: filePath,
    success(info) {
      if (["jpeg", "jpg", "png", "webp"].indexOf(info.type) < 0) return reject(new Error("下载内容不是支持的照片"));
      resolve(filePath);
    }, fail: () => reject(new Error("无法读取下载的照片"))
  }));
}

/** 原照通过带会话的下载取得临时文件，不把私有 URL 交给访客或相册。 */
async function downloadPhoto(photo, options) {
  if (!photo || !photo.url || photo.url.indexOf("/api/media/") !== 0) throw new Error("照片地址无效，请重新加载");
  const original = Boolean(options && options.original);
  const session = wx.getStorageSync("petbaby_session");
  const link = options && options.link !== undefined ? options.link : (await resolveLinks([photo.url], !original, session))[0];
  return checkImage(await fetchMedia(original ? photo.url : displayUrl(photo.url), link, session));
}

async function displayPhotos(photos) {
  const result = photos.map((photo) => Object.assign({}, photo, { mediaUrl: photo.url, url: "" }));
  const session = wx.getStorageSync("petbaby_session");
  const valid = photos.map((photo) => Boolean(photo && photo.url && photo.url.indexOf("/api/media/") === 0));
  const links = await resolveLinks(photos.filter((photo, index) => valid[index]).map((photo) => photo.url), true, session);
  const linkOf = [];
  let cursor = 0;
  valid.forEach((ok, index) => { linkOf[index] = ok ? links[cursor++] : null; });
  let next = 0;
  async function worker() {
    while (next < result.length) {
      const index = next++;
      try { result[index].url = await downloadPhoto(photos[index], { link: linkOf[index] }); }
      catch (error) { result[index].imageError = error.message; }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  return result;
}

async function savePhotoToAlbum(photo) {
  const filePath = await downloadPhoto(photo, { original: true });
  return new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({
    filePath, success: resolve,
    fail(failure) {
      const denied = /auth|deny|denied/.test(failure.errMsg || "");
      const error = new Error(denied ? "尚未获得相册权限，可在设置中允许后再保存" : "照片未保存到手机，请重试");
      error.albumDenied = denied; reject(error);
    }
  }));
}

/** 页面展示资源：每次进页都重新鉴权换取直连地址，撤销后重新进页拿不到。 */
async function displayMediaTree(value) {
  const session = wx.getStorageSync("petbaby_session");
  const fields = [];
  function copy(item) {
    if (!item || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map(copy);
    const result = {};
    Object.keys(item).forEach((key) => {
      const field = item[key];
      if (["url", "outputUrl", "avatarUrl"].indexOf(key) >= 0 && isPrivateMedia(field)) {
        result[key] = "";
        fields.push({ target: result, key, path: field });
      } else result[key] = copy(field);
    });
    return result;
  }
  const output = copy(value);
  const unique = fields.map((field) => field.path).filter((path, index, all) => all.indexOf(path) === index);
  const links = await resolveLinks(unique, true, session);
  let next = 0;
  async function worker() {
    while (next < fields.length) {
      const field = fields[next++];
      try {
        field.target[field.key] = await fetchMedia(displayUrl(field.path), links[unique.indexOf(field.path)], session)
          .catch(() => { throw new Error("图片或作品文件下载失败，请重试"); });
      } catch (error) { field.target.imageError = error.message; }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  if (wx.getStorageSync("petbaby_session") !== session) throw new Error("账号已切换，请重新加载");
  return output;
}

module.exports = { downloadPhoto, displayPhotos, savePhotoToAlbum, displayMediaTree, displayUrl, resolveLinks };
