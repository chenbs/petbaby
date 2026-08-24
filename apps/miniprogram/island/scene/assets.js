/**
 * 岛屿素材的远程加载与本地缓存（22 号文 5.3）。
 *
 * 链路：
 *
 *   服务端下发绝对 URL ──wx.downloadFile──> 临时路径 ──saveFile──> 本地缓存
 *                                                        ↓
 *                                        canvas.createImage() 读本地路径绘制
 *
 * **从 M1 起就全部远程，不留「先放包里以后再挪」的中间态**：M1 单场景已约 1.6MB，
 * M2 加装饰后过 5MB，而主包上限 2MB、余量不足 700KB。中间态会带来一次全量返工。
 *
 * 四条硬约束，每条都对应一个已知的坑：
 *
 * 1. **LRU 必须真删，不能只写不删。** 小程序本地缓存有配额（10MB 量级），
 *    只记不删的话超配额后 `saveFile` 直接失败，表现是「素材突然不再更新」——
 *    而那时缓存索引里明明有记录。所以淘汰走 `removeSavedFile` 真删文件。
 * 2. **URL 不能以 `/` 开头。** 服务端按 `PUBLIC_APP_URL` 补域名后才下发；万一漏补，
 *    小程序会把 `/samples/...` 当主包内本地文件找，必然裂图（CLAUDE.md 已记录）。
 *    这里显式挡掉并当作缺素材处理 —— 静默裂图比报错难查得多。
 * 3. **键名带内容哈希，换图必须换键。** 因此缓存永不失效，命中即用，不做 If-None-Match。
 * 4. **缺素材时留空，不画占位色块**（既有约定：`LocalImageProvider` 的纯色 SVG
 *    正是方案点名的违例）。取不到就返回 null，由 renderer 走「素材未就绪」路径。
 */

/** 缓存索引存在 storage 里的键 */
const INDEX_KEY = "island_asset_cache_v1";

/**
 * 本地缓存预算。
 *
 * 小程序单个用户的本地缓存上限在 10MB 量级（需真机实测，22 号文 5.3 已列为验收项），
 * 取 8MB 留出余量给其他模块 —— 岛不该把整个配额吃光，`saveFile` 是全小程序共享的。
 */
const BUDGET_BYTES = 8 * 1024 * 1024;

/** 单个素材的体积上限。超过的直接不缓存（底图约 600KB，2MB 已是异常） */
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

/** 下载超时。弱网下宁可失败走纯色底，也不要卡住首屏 */
const DOWNLOAD_TIMEOUT_MS = 15000;

function fileSystem() {
  try { return wx.getFileSystemManager(); } catch (error) { return null; }
}

function readIndex() {
  try {
    const raw = wx.getStorageSync(INDEX_KEY);
    return raw && typeof raw === "object" ? raw : {};
  } catch (error) {
    return {};
  }
}

function writeIndex(index) {
  try { wx.setStorageSync(INDEX_KEY, index); } catch (error) { /* 存储满时忽略，下次重下 */ }
}

/**
 * 文件是否仍在。
 *
 * `saveFile` 的产物可能被系统在空间紧张时清掉，而我们的索引不会同步收到通知。
 * 不校验就会把一个已不存在的路径交给 `createImage`，表现是「缓存过的图反而裂了」。
 */
function stillExists(filePath) {
  const fs = fileSystem();
  if (!fs || !filePath) return false;
  try { fs.accessSync(filePath); return true; } catch (error) { return false; }
}

/**
 * 真删一个缓存条目。**只从索引里抹掉是不够的** —— 文件仍占着配额，
 * 那正是「LRU 只写不删」这个坑的形态。
 */
function removeEntry(index, key) {
  const entry = index[key];
  delete index[key];
  if (!entry || !entry.path) return;
  const fs = fileSystem();
  if (!fs) return;
  try { fs.removeSavedFile({ filePath: entry.path, fail: () => undefined }); } catch (error) { /* 已不存在 */ }
}

/** 当前缓存总字节 */
function totalBytes(index) {
  return Object.keys(index).reduce((sum, key) => sum + (Number(index[key].size) || 0), 0);
}

/**
 * 腾出 `needed` 字节：按 `usedAt` 升序（最久未用的先走）逐个真删，直到预算够用。
 * `keepKey` 是本次刚要写入的键，不能把它自己淘汰掉。
 */
function evictFor(index, needed, keepKey) {
  const ordered = Object.keys(index)
    .filter((key) => key !== keepKey)
    .map((key) => ({ key: key, usedAt: Number(index[key].usedAt) || 0 }))
    .sort((left, right) => left.usedAt - right.usedAt);
  let used = totalBytes(index);
  for (const entry of ordered) {
    if (used + needed <= BUDGET_BYTES) break;
    used -= Number(index[entry.key].size) || 0;
    removeEntry(index, entry.key);
  }
}

/** 正在进行中的下载，按 key 去重 —— 同一张图被两处同时请求时不重复下载 */
const inflight = {};

/** 已解码的 Canvas Image 对象，按 key 缓存在内存里，避免每帧重新 createImage */
const decoded = {};

function isRemoteUrl(url) {
  const text = String(url || "");
  // 以 `/` 开头说明服务端漏补域名（约束 2），当作无效值 —— 不静默裂图
  return /^https?:\/\//.test(text);
}

/**
 * 私有素材的鉴权头。
 *
 * 场景与物件是公开只读的（走 `/api/plugin-samples`），但**宠物立绘是私有的** ——
 * 它挂在 `/api/island/avatar-image/` 下、按 `private/<userId>/island/` 前缀校验归属。
 * `wx.downloadFile` **不会自动带上 cookie 或 header**，不显式给的话那一张必然 401，
 * 而表现是「场景都出来了、只有宠物不见」—— 看起来像立绘没生成，其实是取不到字节。
 */
function authHeader() {
  try {
    const session = wx.getStorageSync("petbaby_session");
    return session ? { authorization: "Bearer " + session } : {};
  } catch (error) {
    return {};
  }
}

/**
 * 取一个素材的本地可用路径。命中缓存直接返回，否则下载并入缓存。
 * 取不到（弱网、404、URL 非法）时 reject —— 调用方按「素材未就绪」处理。
 *
 * @param {boolean} authed 是否要带鉴权头。私有素材（立绘）必须为 true
 */
function fetchToLocal(key, url, authed) {
  if (!isRemoteUrl(url)) return Promise.reject(new Error("素材地址非法：" + url));
  const index = readIndex();
  const hit = index[key];
  /*
   * 命中要**同时比对 url**，不能只看键名。
   *
   * 场景素材的键名带内容哈希（换图必换键），所以只看键是安全的；但立绘的键是端上
   * 写死的 `pet-avatar`，而它的地址每次重画都变（键里带 `runId`）——
   * 只看键名的话用户重画形象后画面永远是旧的那只，杀掉小程序重进也一样
   * （`saveFile` 是持久缓存），只有系统清缓存或被 LRU 淘汰才会解开。
   *
   * 存 url 而不是把 url 并进键名：并进键名会让 `renderer` 取不到固定的 `pet-avatar`，
   * 而渲染器正是按逻辑键找图的。老缓存条目没有 `url` 字段，按「对不上」处理重下一次。
   */
  if (hit && hit.url === url && stillExists(hit.path)) {
    hit.usedAt = Date.now();
    writeIndex(index);
    return Promise.resolve(hit.path);
  }
  if (hit) removeEntry(index, key);
  if (inflight[key]) return inflight[key];

  const task = new Promise((resolve, reject) => {
    wx.downloadFile({
      url: url,
      header: authed ? authHeader() : {},
      timeout: DOWNLOAD_TIMEOUT_MS,
      success: (result) => {
        if (result.statusCode !== 200 || !result.tempFilePath) return reject(new Error("素材下载失败：" + result.statusCode));
        const fs = fileSystem();
        if (!fs) return resolve(result.tempFilePath);
        // 体积超限的不进缓存，但临时路径本次仍可用 —— 不缓存不等于不能画
        const size = Number(result.totalBytesWritten) || 0;
        if (size > MAX_ENTRY_BYTES) return resolve(result.tempFilePath);
        const current = readIndex();
        evictFor(current, size, key);
        fs.saveFile({
          tempFilePath: result.tempFilePath,
          success: (saved) => {
            // 记下 url：命中判定要比对它，见 fetchToLocal 开头那段说明
            current[key] = { path: saved.savedFilePath, size: size, usedAt: Date.now(), url: url };
            writeIndex(current);
            resolve(saved.savedFilePath);
          },
          // saveFile 失败（配额满、系统限制）时退回临时路径：本次能画，只是下次要重下
          fail: () => resolve(result.tempFilePath)
        });
      },
      fail: (error) => reject(new Error((error && error.errMsg) || "素材下载失败"))
    });
  });

  inflight[key] = task;
  const clear = () => { delete inflight[key]; };
  task.then(clear, clear);
  return task;
}

/**
 * 取一个可直接 `drawImage` 的图片对象。
 *
 * `canvas.createImage()` 必须由调用方传进来 —— Canvas 2D 的 Image 构造挂在画布实例上，
 * 不是全局的（这与 Web 不同，是小程序 `type="2d"` 的约定）。
 */
function loadImage(canvas, key, url, authed) {
  /*
   * 内存层的命中同样要比对 url（与 `fetchToLocal` 同一理由）：立绘的键是固定的
   * `pet-avatar`，只看键名会让重画形象后的当次会话里画面仍是旧那只 ——
   * 而这一层比磁盘缓存更靠前，漏了它下面那道也不会被问到。
   */
  const cached = decoded[key];
  if (cached && cached.__url === url) return Promise.resolve(cached);
  if (!canvas || typeof canvas.createImage !== "function") return Promise.reject(new Error("画布未就绪"));
  return fetchToLocal(key, url, authed).then((filePath) => new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => {
      // 记在图片对象上而不是另开一张表：两者生命周期相同，分开存必然有一处忘了清
      image.__url = url;
      decoded[key] = image;
      resolve(image);
    };
    image.onerror = () => {
      /*
       * 解码失败说明字节坏了（下载被截断、或缓存文件损坏）。
       * 必须连带把缓存条目删掉，否则每次都从同一份坏字节解码，永远修不好。
       */
      const index = readIndex();
      removeEntry(index, key);
      writeIndex(index);
      reject(new Error("素材解码失败：" + key));
    };
    image.src = filePath;
  }));
}

/**
 * 批量预载。**逐张独立成败**：底图失败不该拖垮立绘 —— 立绘是情感主体，
 * 哪怕只有它能画出来，「素材未就绪」路径也比白屏好得多（22 号文 5.3）。
 *
 * @param {object} canvas Canvas 2D 实例
 * @param {Array<{key:string,url:string}>} entries 素材清单，由服务端下发
 * @returns {Promise<object>} key → Image 的映射，只含成功的那些
 */
function preload(canvas, entries) {
  const list = (entries || []).filter((entry) => entry && entry.key && entry.url);
  return Promise.all(list.map((entry) => loadImage(canvas, entry.key, entry.url, entry.authed)
    .then((image) => ({ key: entry.key, image: image }))
    .catch(() => null)))
    .then((results) => {
      const map = {};
      for (const result of results) if (result) map[result.key] = result.image;
      return map;
    });
}

/** 缓存概况，给「真机验收：LRU 淘汰生效」这一项自查用 */
function inspect() {
  const index = readIndex();
  return {
    count: Object.keys(index).length,
    bytes: totalBytes(index),
    budget: BUDGET_BYTES,
    keys: Object.keys(index)
  };
}

/** 清空缓存（真删文件）。设置页或排查问题时用 */
function clear() {
  const index = readIndex();
  for (const key of Object.keys(index)) removeEntry(index, key);
  writeIndex(index);
  for (const key of Object.keys(decoded)) delete decoded[key];
}

module.exports = {
  BUDGET_BYTES: BUDGET_BYTES,
  MAX_ENTRY_BYTES: MAX_ENTRY_BYTES,
  isRemoteUrl: isRemoteUrl,
  fetchToLocal: fetchToLocal,
  loadImage: loadImage,
  preload: preload,
  inspect: inspect,
  clear: clear
};
