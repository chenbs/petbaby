/**
 * 页面 query 参数校验（2026-10）。
 *
 * 起因：作品详情 / 生成结果 / 短片三个页面原先只判断「参数在不在」，
 * 没判断「格式对不对」。?id=abc 会一路打到服务端，由 zod 抛错，
 * routeError 把英文原文原样放进 error.message，端上又直接 setData 显示，
 * 用户就看到「Invalid UUID」「Too small: expected string to have >=16 characters」。
 *
 * 服务端不泄漏细节的原则（见 errors.ts）要求这里同步兜住：
 * 格式不对就按「链接无效」处理，不发出请求、不显示服务端原文。
 */

/** 服务端的 id 一律是 UUID（见各 route 的 z.string().uuid()）。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * 分享 token 是随机串，服务端只约束长度（memorial-share 是 min(16)）。
 * 取不到真实长度下限时宁可让服务端判定，这里只挡明显不合法的短串。
 */
function isShareToken(value, minLength) {
  return typeof value === "string" && value.length >= (minLength || 16);
}

module.exports = { UUID_PATTERN, isUuid, isShareToken };
