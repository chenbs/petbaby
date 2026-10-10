/*
 * 制作页里「还没有宠物档案」的统一出口（2026-10-09）。
 *
 * 直接打开档案页的新建抽屉（mode=create&onboard=1：建完 → 见面礼 → 可跳过的头像一步 → 自动返回），
 * 建成后把 petId 回调给制作页，由制作页刷新宠物列表并选中新宠物，用户回来就能接着选照片。
 * 以前这里要么按钮置灰、点了没反应，要么跳到档案列表还得再点一次「新建」。
 */
function openPetCreator(onCreated) {
  wx.navigateTo({
    url: "/pages/pets/pets?mode=create&onboard=1",
    events: { petCreated: (result) => { if (result && result.petId && onCreated) onCreated(result.petId); } }
  });
}

/** 制作页底部的主按钮离顶部的错误条很远，缺什么用轻提示说清楚，不能只置灰。 */
function remind(title) {
  wx.showToast({ title, icon: "none" });
}

module.exports = { openPetCreator, remind };
