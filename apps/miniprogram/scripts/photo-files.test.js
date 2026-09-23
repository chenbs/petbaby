const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const { downloadPhoto, savePhotoToAlbum } = require("../services/photo-files");
afterEach(() => { delete global.wx; });

test("A16：下载使用会话，校验状态和文件类型；拒绝授权不报保存成功", async () => {
  let requested, saves = 0;
  global.wx = {
    getStorageSync: () => "session-token",
    downloadFile: (options) => { requested = options; options.success({ statusCode: 200, tempFilePath: "actual-file" }); },
    getImageInfo: ({ success }) => success({ type: "png" }),
    saveImageToPhotosAlbum: ({ filePath, success }) => { assert.equal(filePath, "actual-file"); saves++; success(); }
  };
  const photo = { url: "/api/media/private%2Ffixture.png" };
  await savePhotoToAlbum(photo);
  assert.equal(requested.header.authorization, "Bearer session-token"); assert.equal(saves, 1);
  for (const type of ["jpeg", "png", "webp"]) {
    global.wx.getImageInfo = ({ success }) => success({ type });
    assert.equal(await downloadPhoto(photo), "actual-file");
  }
  global.wx.saveImageToPhotosAlbum = ({ fail }) => fail({ errMsg: "auth deny" });
  await assert.rejects(savePhotoToAlbum(photo), (error) => error.albumDenied === true);
  global.wx.downloadFile = ({ success }) => success({ statusCode: 404, tempFilePath: "error" });
  await assert.rejects(savePhotoToAlbum(photo), /未能下载/);
  global.wx.downloadFile = ({ success }) => success({ statusCode: 200, tempFilePath: "not-image" });
  global.wx.getImageInfo = ({ fail }) => fail();
  await assert.rejects(savePhotoToAlbum(photo), /无法读取/);
  assert.equal(saves, 1);
});
