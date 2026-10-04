/**
 * 就地上传一张宠物照片（2026-09）：制作页 / 写真套餐页的照片网格首格「拍照 / 相册」。
 *
 * 原先照片区为空时只给「去上传照片」，用户要跳到照片库，上传后再自己返回找刚才的效果。
 * 这里复用照片库同一套上传会话（幂等回执、断点核对、429 退避），传完直接返回照片 ID，
 * 页面刷新照片列表并自动选中这一张，不离开当前流程。
 */
const api = require("./api");
const { createUploadSession, preparePhoto } = require("./photo-upload-session");

function pickOne() {
  return new Promise((resolve, reject) => wx.chooseMedia({
    count: 1, mediaType: ["image"], sourceType: ["album", "camera"],
    success: (result) => resolve(result.tempFiles && result.tempFiles[0]),
    fail: (error) => (/cancel/.test((error && error.errMsg) || "") ? resolve(null) : reject(new Error("未能打开相册，请重试")))
  }));
}

/**
 * @param {{ id: string, name: string }} pet
 * @param {string} entry 埋点来源（ai-create / art-photo-bundle）
 * @returns {Promise<string|null>} 新照片 ID；用户取消时为 null
 */
async function uploadOnePhoto(pet, entry) {
  const file = await pickOne();
  if (!file) return null;
  const prepared = await preparePhoto(file);
  const account = await api.request("/api/account");
  /*
   * 草稿只存在内存里：照片库的记录批次按「账号 + 宠物」存本地草稿，
   * 这里若共用同一个存储键，就会读到或清掉用户在照片库里还没收好的那一批。
   */
  let draft = null;
  const session = createUploadSession({
    // accountId 只参与会话键；加后缀让版本号与照片库的会话互不影响（同键会让对方的会话被判为过期而停下）。
    accountId: account.id + ":quick", petId: pet.id, petName: pet.name, entry,
    dependencies: { read: () => draft, write: (_, value) => { draft = value; } },
    onLoginRequired: () => wx.navigateTo({ url: "/pages/login/login" })
  });
  session.add([prepared]);
  const state = await session.run();
  const item = state.items[0];
  if (!item || item.state !== "saved" || !item.photoId) throw new Error((item && item.error) || "照片还没有保存成功，请重试");
  return item.photoId;
}

module.exports = { uploadOnePhoto };
