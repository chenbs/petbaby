/**
 * 岛的端上服务层：接口调用与「服务端权威」边界的守门人。
 *
 * **额度与亲密度只能由服务端计算**（22 号文 5.6）。这是留存型模块与既有生成型模块
 * 最大的差异点，也最容易做错：岛的即时反馈会诱使实现方在端上先加数再同步，
 * 那样断网重连就会对不上。所以本文件里**没有任何一处**在本地累加亲密度或扣额度 ——
 * 端上只发请求、读回结果。
 *
 * 对应的允许项是**乐观动画但不乐观数据**：点草丛立刻播动画（体验需要，在 renderer 里），
 * 但掉落物由服务端返回后才进库存显示（在这里）。两件事分在两个文件，
 * 就是为了让「哪些能抢跑、哪些不能」在代码结构上就分得开。
 */

const api = require("../services/api");

/** 互动收敛到单一 actions 端点（22 号文 5.5）：三个动作共用额度校验与门禁，拆开必漏改 */
const ACTIONS_PATH = "/api/island/actions";

/**
 * 岛全量快照。场景、宠物、库存、今日额度、素材 URL（已补域名）。
 *
 * 走 `requestWithRetry`：首屏这一发失败就没有岛，而弱网下退避重试的成本远低于
 * 让用户看一个空页面再自己下拉。
 */
function loadIsland(petId) {
  const query = petId ? "?petId=" + encodeURIComponent(petId) : "";
  return api.requestWithRetry("/api/island" + query, {}, 2);
}

/** 建岛。幂等，首次进入时调 */
function createIsland() {
  return api.request("/api/island", { method: "POST" });
}

/**
 * 宠物入岛。
 *
 * **`memorial` 形态服务端会拦**（1.4 / 4.1 #11），端上列表也要过滤 —— **两处都要**：
 * 只做端上隐藏则接口仍可调，只做服务端拦截则用户会看到入口点进去报错。
 * 端上那一半在 `selectablePets()`。
 */
function joinPet(petId) {
  return api.request("/api/island/pets", { method: "POST", data: { petId: petId } });
}

/**
 * 可入岛的宠物列表。
 *
 * **过滤掉 `memorial`**：岛的核心机制是「亲密度日增、陪伴天数往上涨」，
 * 对已离开的宠物递增天数是明确的冒犯（CLAUDE.md 已钉死「陪伴天数一律封口」）。
 * 纪念形态的对应能力是纪念空间，不是岛。
 */
function selectablePets(pets) {
  return (pets || []).filter((pet) => pet && pet.lifeStage !== "memorial");
}

/**
 * 提交一次互动。`type` ∈ gather / feed / pet。
 *
 * 返回服务端结算后的结果（掉落物、亲密度、剩余额度）。**端上不预测结果**：
 * 超额时服务端返回 429，这里原样抛出，由页面给「今天的草丛都看过了」这类措辞 ——
 * 注意措辞差异决定它是不是 4.1 #4 的体力值，所以文案在页面里而不是这里拼。
 */
function submitAction(type, payload) {
  return api.request(ACTIONS_PATH, { method: "POST", data: Object.assign({ type: type }, payload || {}) });
}

/** 日记翻阅，分页 */
function loadDiary(cursor) {
  const query = cursor ? "?cursor=" + encodeURIComponent(cursor) : "";
  return api.request("/api/island/diary" + query);
}

/**
 * 已达成的里程碑，供日记页的「已经走过」区块。
 *
 * **只留 `reached`**（22 号文 4.2）：未达成的那几个读作「还差 20 天」，那是催促 ——
 * 4.1 #7 禁掉的正是这类摩擦。服务端下发全部三档带 `reached` 标记是对的（后台要看得到），
 * 筛选因此放在端上：那是展示判断，不是数据问题。
 *
 * **文案由传入的 `milestoneLabel` 给，不在这里拼字符串**：同一个第 365 天必须在首页、
 * 时间线与岛日记里都叫「一起过了一年」。调用方传 `services/companion.js` 的那个实现，
 * 它与服务端 `domain/companion.ts` 的同名函数逐字对齐、已有测试钉住。
 *
 * 依赖注入而不是在本文件 require：`service.js` 是接口层，把 companion 拖进来会让
 * 它同时依赖展示口径，而这个函数是纯筛选，测试里传个替身就能覆盖全部分支。
 */
function reachedMilestones(snapshot, milestoneLabel) {
  const list = (snapshot && snapshot.milestones) || [];
  const entries = [];
  for (const item of list) {
    if (!item || !item.reached) continue;
    const day = Number(item.day);
    const label = milestoneLabel(day);
    // 拿不到文案说明天数不在 MILESTONE_DAYS 里 —— 两端清单漂移了，宁可不显示也不猜
    if (label) entries.push({ day: day, label: label });
  }
  return entries;
}

/** 提交立绘生成，落 ai_runs，返回 runId */
function createAvatarRun(petId, photoId) {
  return api.request("/api/island/avatar", { method: "POST", data: { petId: petId, photoId: photoId } });
}

/** 轮询候选（沿用 pages/ai-run 交互） */
function loadAvatarRun(runId) {
  return api.requestWithRetry("/api/island/avatar/" + encodeURIComponent(runId), {}, 2);
}

/** 选定候选，写 island_pets.avatar_key */
function selectAvatar(runId, candidateId) {
  return api.request("/api/island/avatar/" + encodeURIComponent(runId) + "/select", { method: "POST", data: { candidateId: candidateId } });
}

/**
 * 从快照里取素材清单。
 *
 * **URL 由服务端下发、端上不硬编码**（5.3）：站内存相对路径，出口按 `PUBLIC_APP_URL`
 * 补域名。这里做两件事：
 *
 * 1. 把服务端漏补域名的（以 `/` 开头）挑出来丢掉 —— 小程序 `<image src>` 与
 *    `downloadFile` 遇到那种值会当主包内本地文件找，必然裂图且不报错
 *    （CLAUDE.md 已记录这个坑）。丢掉后走「素材未就绪」路径，比静默裂图好查得多。
 * 2. **把宠物立绘并进同一份清单**，并标 `authed`。
 *
 * 第 2 件事容易漏：立绘不在 `snapshot.assets` 里（那是场景素材，公开只读），
 * 它在 `snapshot.pet.avatarUrl` 下、是**私有对象**。不并进来的话渲染器
 * 永远拿不到 `pet-avatar`，画面上只有空院子 —— 而 `renderer.js` 会回落到
 * `pet-sample`（样板宠物摩奇），于是用户看到的是**别人家的猫**，比看不到更糟。
 */
function assetEntries(snapshot) {
  const assets = (snapshot && snapshot.assets) || {};
  const entries = [];
  for (const name of Object.keys(assets)) {
    const url = assets[name];
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
    entries.push({ key: name, url: url, authed: false });
  }
  const pet = (snapshot && snapshot.pet) || {};
  if (typeof pet.avatarUrl === "string" && /^https?:\/\//.test(pet.avatarUrl)) {
    // 键名固定 `pet-avatar`：renderer 优先取它，取不到才回落 `pet-sample`
    entries.push({ key: "pet-avatar", url: pet.avatarUrl, authed: true });
  }
  return entries;
}

/**
 * 今日额度是否还够做某个动作。
 *
 * **判据来自服务端下发的 `limits`，不在端上写死上限**：采集上限是产品参数
 * （建议 8 次，需按「够玩 2–3 分钟但不腻」实测调），写死在端上意味着服务端调了之后
 * 老版本小程序仍按旧值禁用按钮。这里只做展示层的预判，真正的拦截在服务端。
 */
function remainingOf(snapshot, type) {
  const today = (snapshot && snapshot.today) || {};
  const limits = (snapshot && snapshot.limits) || {};
  const used = Number(today[type]) || 0;
  const limit = Number(limits[type]);
  if (!isFinite(limit) || limit <= 0) return null;
  return Math.max(0, limit - used);
}

module.exports = {
  loadIsland: loadIsland,
  createIsland: createIsland,
  joinPet: joinPet,
  selectablePets: selectablePets,
  submitAction: submitAction,
  loadDiary: loadDiary,
  reachedMilestones: reachedMilestones,
  createAvatarRun: createAvatarRun,
  loadAvatarRun: loadAvatarRun,
  selectAvatar: selectAvatar,
  assetEntries: assetEntries,
  remainingOf: remainingOf
};
