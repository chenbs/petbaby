const api = require("./api");
const PREFIX = "petbaby_record_v1:";
const MAX_BYTES = 2500000;
let draftEpoch = 0;
const sessionVersions = {};

function requestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 3) | 8).toString(16);
  });
}
function fileInfo(path) {
  return new Promise((resolve, reject) => wx.getFileInfo({ filePath: path, success: resolve, fail: reject }));
}
function imageInfo(path) {
  return new Promise((resolve, reject) => wx.getImageInfo({ src: path, success: resolve, fail: reject }));
}
function failedFile(message) {
  const error = new Error(message);
  error.code = "FILE_UNAVAILABLE";
  error.statusCode = 422;
  return error;
}

/** 同制作页的压缩参数；压缩失败不能跳过实际字节和图片格式校验。 */
async function preparePhoto(file) {
  let path = file.tempFilePath || file.path;
  let metadata;
  try { metadata = await imageInfo(path); }
  catch { throw failedFile("临时照片已失效，请重新选择这一张"); }
  if (["jpeg", "jpg", "png", "webp"].indexOf(metadata.type) < 0) throw failedFile("仅支持 JPG、PNG 或 WebP 照片");
  path = await new Promise((resolve) => wx.compressImage({
    src: path, quality: 82, compressedWidth: 1800,
    success: (result) => resolve(result.tempFilePath), fail: () => resolve(path)
  }));
  let info;
  try { info = await fileInfo(path); metadata = await imageInfo(path); }
  catch { throw failedFile("临时照片已失效，请重新选择这一张"); }
  if (!info.size || info.size > MAX_BYTES) throw failedFile("这张照片压缩后仍超过 2.5MB，请换一张较小的照片");
  if (metadata.width * metadata.height > 40000000) throw failedFile("这张照片像素过大，请压缩后重选");
  const extension = metadata.type === "jpeg" ? "jpg" : metadata.type;
  return { path, name: "pet-" + requestId() + "." + extension };
}

function clearRecordDrafts() {
  draftEpoch++;
  const keys = (wx.getStorageInfoSync().keys || []).filter((key) => key.indexOf(PREFIX) === 0 || key.indexOf("petbaby_create_") === 0);
  keys.forEach((key) => wx.removeStorageSync(key));
}

/** 可注入网络/存储/时钟的逐张队列。100% 只更新进度，保存必须有照片 ID。 */
function createUploadSession(settings) {
  const epoch = draftEpoch;
  const deps = Object.assign({
    request: api.request, upload: api.upload, exists: fileInfo,
    wait: (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
    now: () => Date.now(),
    read: (key) => wx.getStorageSync(key), write: (key, value) => wx.setStorageSync(key, value)
  }, settings.dependencies || {});
  const key = PREFIX + settings.accountId + ":" + settings.petId;
  const version = sessionVersions[key] = (sessionVersions[key] || 0) + 1;
  const restored = deps.read(key);
  const session = {
    sessionId: restored && restored.sessionId || requestId(),
    petId: settings.petId, petName: settings.petName, accountId: settings.accountId,
    items: restored && Array.isArray(restored.items) ? restored.items : [],
    running: false, stopped: false, current: null
  };
  session.items.forEach((item) => { if (item.state === "uploading") item.state = "checking"; });

  function publish() {
    if (epoch !== draftEpoch || sessionVersions[key] !== version) {
      session.stopped = true;
      if (session.current && session.current.abort) session.current.abort();
      return;
    }
    // 只存请求/照片 ID 和临时路径，不存凭据、字节或用户故事。
    deps.write(key, { sessionId: session.sessionId, items: session.items.map((item) => Object.assign({}, item)) });
    if (settings.onChange && !session.stopped) settings.onChange(session.snapshot());
  }
  session.snapshot = function () {
    const items = session.items.map((item) => Object.assign({}, item));
    return {
      items, running: session.running, sessionId: session.sessionId,
      savedCount: items.filter((item) => item.state === "saved").length,
      pendingCount: items.filter((item) => item.state !== "saved" && item.state !== "deleted").length,
      deletedCount: items.filter((item) => item.state === "deleted").length
    };
  };
  session.add = function (files) {
    if (session.running || session.items.length + files.length > 9) throw new Error("每批最多收好 9 张照片");
    files.forEach((file) => session.items.push({ requestId: requestId(), path: file.path, name: file.name, state: "ready", progress: 0, attempted: false }));
    publish();
  };
  session.replace = function (id, file) {
    if (session.running || session.reconciling) return;
    const item = session.items.find((item) => item.requestId === id);
    if (!item || item.state === "saved" || item.state === "deleted") return;
    if (item.attempted) item.replacement = { path: file.path, name: file.name };
    else { item.path = file.path; item.name = file.name; }
    item.error = ""; item.needsReselect = false;
    item.state = item.attempted ? "checking" : "ready";
    publish();
  };
  session.remove = function (id) {
    if (session.running || session.reconciling) return;
    session.items = session.items.filter((item) => item.requestId !== id || item.attempted);
    publish();
  };
  session.reset = function () {
    if (session.running || session.reconciling) return;
    session.items = []; session.sessionId = requestId(); publish();
  };
  async function reconcile(item) {
    const result = await deps.request("/api/uploads?requestId=" + item.requestId);
    if (result.status === "saved" && result.photo && result.photo.id) {
      item.photoId = result.photo.id; item.state = "saved"; item.progress = 100;
      item.duplicatePhotoId = result.photo.duplicatePhotoId || ""; item.error = "";
      if (item.replacement) { item.error = "已找回之前上传的照片；刚重选的照片尚未上传，请在下一批添加"; delete item.replacement; }
    } else if (result.status === "deleted") {
      item.state = "deleted"; item.photoId = result.photoId; item.error = "这张照片已从照片库移除";
    } else throw new Error("保存结果仍待核对");
    publish();
  }
  session.reconcile = async function () {
    if (session.running || session.reconciling) return session.snapshot();
    session.reconciling = true;
    session.stopped = false;
    try { for (const item of session.items) {
      if (session.stopped) break;
      if (!item.attempted || item.state === "deleted") continue;
      try { await reconcile(item); }
      catch (error) {
        if (item.state === "saved") continue;
        if (error.statusCode === 404) { item.state = "failed"; item.error = "尚未确认保存，请重试这一张"; }
        else { item.state = "checking"; item.error = error.message; }
      }
    } } finally { session.reconciling = false; }
    publish();
  };
  async function runItem(item) {
    if (item.retryAt && item.retryAt > deps.now()) { item.error = "操作频繁，请稍后重试"; session.halted = true; publish(); return; }
    for (let attempt = 0; attempt <= 2 && !session.stopped; attempt++) {
      try {
        if (item.attempted) {
          item.state = "checking"; publish();
          try { await reconcile(item); return; }
          catch (error) { if (error.statusCode !== 404) throw error; }
        }
        const source = item.replacement || item;
        try { await deps.exists(source.path); }
        catch { item.needsReselect = true; throw failedFile("临时照片已失效，请重新选择这一张"); }
        if (session.stopped) return;
        item.state = "uploading"; item.attempted = true; item.error = ""; publish();
        session.current = deps.upload("/api/uploads", source.path, { petId: session.petId, filename: source.name, uploadRequestId: item.requestId, entry: settings.entry || "photos" }, {
          onProgress: (progress) => { item.progress = progress.progress; publish(); }
        });
        const photo = await session.current;
        session.current = null;
        if (photo.status === "deleted") { item.state = "deleted"; item.photoId = photo.photoId; }
        else if (photo.id) { item.state = "saved"; item.photoId = photo.id; item.progress = 100; item.duplicatePhotoId = photo.duplicatePhotoId || ""; item.path = source.path; item.name = source.name; delete item.replacement; }
        else throw new Error("上传结果待核对");
        publish(); return;
      } catch (error) {
        session.current = null;
        item.error = error.message || "上传结果待核对";
        const retryable = !error.statusCode || error.statusCode >= 500;
        item.state = retryable && item.attempted ? "checking" : "failed";
        if (error.statusCode === 429) item.retryAt = deps.now() + Math.max(1, error.retryAfterSeconds || 60) * 1000;
        if (error.statusCode === 401 || error.statusCode === 429) session.halted = true;
        if (error.statusCode === 401 && settings.onLoginRequired) settings.onLoginRequired();
        publish();
        if (session.stopped || !retryable || attempt === 2) return;
        await deps.wait(600 * Math.pow(2, attempt));
      }
    }
  }
  session.run = async function () {
    if (session.running || session.reconciling) return session.snapshot();
    session.running = true; session.stopped = false; session.halted = false; publish();
    try {
      for (const item of session.items) {
        if (session.stopped || session.halted) break;
        if (item.state === "saved" || item.state === "deleted") continue;
        await runItem(item);
      }
    } finally { session.running = false; publish(); }
    return session.snapshot();
  };
  session.stop = function () {
    session.stopped = true;
    session.items.forEach((item) => { if (item.state === "uploading") item.state = "checking"; });
    if (session.current && session.current.abort) session.current.abort();
    publish();
  };
  return session;
}

module.exports = { createUploadSession, preparePhoto, clearRecordDrafts, requestId };
