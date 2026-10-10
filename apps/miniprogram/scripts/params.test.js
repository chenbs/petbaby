const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isUuid, isShareToken } = require("../services/params");

/*
 * 这一组守卫管的是「原始异常泄漏到界面」：
 * 作品详情 / 生成结果 / 短片原先只判断参数在不在，?id=abc 会打到服务端，
 * 由 zod 抛错，routeError 把英文原文放进 error.message，端上直接 setData 显示，
 * 用户就看到「Invalid UUID」「Too small: expected string to have >=16 characters」。
 * 详情见 docs/README.md 与 services/params.js 顶部注释。
 */
test("参数校验：只接受服务端实际使用的 UUID 形态", () => {
  assert.equal(isUuid("196b801a-1215-47af-9c60-f4d47f69bbfd"), true);
  assert.equal(isUuid("196B801A-1215-47AF-9C60-F4D47F69BBFD"), true);
  for (const bad of ["", "abc", "123", "not-a-uuid", "196b801a-1215-47af-9c60", "196b801a121547af9c60f4d47f69bbfd", null, undefined, 42, {}, []]) {
    assert.equal(isUuid(bad), false, "应拒绝: " + JSON.stringify(bad));
  }
});

test("参数校验：拒绝会把服务端英文原文带出来的超短分享串", () => {
  assert.equal(isShareToken("2dekaA0w6Jw-L8VoIJSJd5yC68NgUbhU"), true);
  assert.equal(isShareToken("a".repeat(16)), true);
  for (const bad of ["", "abc", "short", "a".repeat(15), null, undefined, 123]) {
    assert.equal(isShareToken(bad), false, "应拒绝: " + JSON.stringify(bad));
  }
  // 自定义下限时按传入值判定
  assert.equal(isShareToken("a".repeat(8), 8), true);
  assert.equal(isShareToken("a".repeat(7), 8), false);
});
