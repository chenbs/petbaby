/**
 * 日常记录 ↔ 健康助手互相跳转（2026-10）。
 *
 * 两页互有入口，一直 navigateTo 会把页面栈越叠越深（小程序上限 10 层，到顶后再跳没有反应）。
 * 上一页正好是目标页且是同一只宠物时，改为把参数交给它再返回；否则正常打开新页。
 * 目标页在 onShow 里读 `_petId` / `_query`，与 onLoad 的带参口径一致。
 */
function openPetPage(route, petId, query) {
  const params = Object.assign({}, query || {});
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const previous = pages.length > 1 ? pages[pages.length - 2] : null;
  if (previous && previous.route === route.replace(/^\//, "") && (!previous._petId || previous._petId === petId)) {
    previous._petId = petId;
    previous._query = params;
    return wx.navigateBack({ delta: 1 });
  }
  const search = ["petId=" + encodeURIComponent(petId)].concat(Object.keys(params).filter((key) => params[key] !== undefined && params[key] !== "").map((key) => key + "=" + encodeURIComponent(params[key])));
  wx.navigateTo({ url: route + "?" + search.join("&") });
}

module.exports = { openPetPage };
