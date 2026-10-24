/*
 * 渠道归因与邀请码（2026-10-12，服务端迁移 0044）。
 *
 * 冷启动时记下「从哪来」：场景值（App.onLaunch 的 options.scene）、投放标记 src、邀请码 inv。
 * 三者来自启动路径的 query（分享卡、公众号文章卡片、视频号链接：/pages/index/index?src=xhs-1012-human），
 * 或小程序码的 scene 参数（getwxacodeunlimit 只给一个 scene 串，这里约定写成 "s=xxx&i=XXXXXXXX"）。
 *
 * 只有新建账号那次登录会被服务端采用；这里只保留第一次记到的值，避免后面一次「最近使用」把来源覆盖掉。
 * 字段格式由服务端清洗，端上只做长度截断。
 */
const STORAGE_KEY = "petbaby_acquisition";
const INVITE_KEY = "petbaby_invite_code";

function parseScene(raw) {
  const result = {};
  let text = "";
  try { text = decodeURIComponent(String(raw || "")); } catch (error) { text = String(raw || ""); }
  // 不含 "=" 的 scene 是分享 token（作品 / 趣测海报），与归因无关
  if (text.indexOf("=") < 0) return result;
  text.split("&").forEach((pair) => {
    const index = pair.indexOf("=");
    if (index <= 0) return;
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (key === "s" || key === "src") result.src = value;
    if (key === "i" || key === "inv") result.inviteCode = value;
  });
  return result;
}

/** 从启动参数里取归因字段。 */
function fromLaunch(options) {
  const query = (options && options.query) || {};
  const scene = Number(options && options.scene) || undefined;
  const fromScene = parseScene(query.scene);
  const src = String(query.src || fromScene.src || "").slice(0, 64);
  const inviteCode = String(query.inv || fromScene.inviteCode || "").slice(0, 16);
  const result = {};
  if (scene) result.scene = scene;
  if (src) result.src = src;
  if (inviteCode) result.inviteCode = inviteCode;
  return result;
}

/** 记下首次启动的来源；已有记录时只补缺失的邀请码 / 投放标记，不改场景值。 */
function capture(options) {
  const current = fromLaunch(options);
  const stored = wx.getStorageSync(STORAGE_KEY) || null;
  const merged = stored ? Object.assign({}, current, stored, {
    src: stored.src || current.src,
    inviteCode: stored.inviteCode || current.inviteCode
  }) : current;
  Object.keys(merged).forEach((key) => { if (merged[key] === undefined) delete merged[key]; });
  wx.setStorageSync(STORAGE_KEY, merged);
  return merged;
}

/** 登录请求体：微信 code + 归因字段。 */
function loginPayload(code) {
  return Object.assign({}, wx.getStorageSync(STORAGE_KEY) || {}, { code });
}

/** 自己的邀请码（服务端生成，缓存在本机）。分享路径同步拼接时用。 */
function cachedInviteCode() { return wx.getStorageSync(INVITE_KEY) || ""; }
function rememberInviteCode(code) { if (code) wx.setStorageSync(INVITE_KEY, code); }
function clearInviteCode() { wx.removeStorageSync(INVITE_KEY); }

/** 给分享路径带上自己的邀请码：好友从这张卡片进来并新建账号，就记为你邀请的。 */
function withInvite(path) {
  const code = cachedInviteCode();
  if (!code || !path) return path;
  return path + (path.indexOf("?") >= 0 ? "&" : "?") + "inv=" + encodeURIComponent(code);
}

/** 朋友圈分享用的是 query 串而不是路径。 */
function withInviteQuery(query) {
  const code = cachedInviteCode();
  if (!code) return query || "";
  return (query ? query + "&" : "") + "inv=" + encodeURIComponent(code);
}

module.exports = { capture, fromLaunch, parseScene, loginPayload, cachedInviteCode, rememberInviteCode, clearInviteCode, withInvite, withInviteQuery };
