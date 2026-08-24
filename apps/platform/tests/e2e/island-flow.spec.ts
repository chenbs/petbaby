import { expect, test } from "@playwright/test";

/*
 * 宠物小岛的端到端链路（22 号文 11.12 的 B 组「岛没有 Playwright E2E 用例」）。
 *
 * **走 API 而不是页面**：岛只有小程序端（9.4 第 10 项拍板不做 Web 端同步实现），
 * 没有可点的 Web 页面。缺的那一层是「真实 HTTP + 真实会话 + 真实路由守卫」——
 * 单测直接调服务层函数，绕过了 `assertTrustedMutation`、`requireUserId`、
 * `enforceRateLimit` 与 `routeError` 的 envelope 包装，而端上看到的正是这一层。
 *
 * `x-petbaby-client: miniprogram` 是必须的：`assertTrustedOrigin` 对小程序放行
 * （小程序无 Origin），而 Playwright 的 `request` 上下文不带 Origin 头 ——
 * 不带这个标记时非生产环境会走「无 origin 直接返回」那条分支，能通过但与
 * 小程序真实请求形态不一致。显式带上，测的就是端上那条路径。
 *
 * 用例刻意**不生成立绘**：`processNextAiRun` 在本地走 `LocalImageProvider`
 * （纯色 SVG 占位、非品红底），抠图必然落到降级分支 —— 那条路径的断言在
 * `island/avatar.test.ts` 里更严格（含产物 alpha 与 AI 标识底衬的像素级检查）。
 * 这里覆盖的是不依赖生图的那条主链路：建岛 → 入岛 → 快照 → 互动 → 日记。
 */

const MINIPROGRAM_HEADERS = { "x-petbaby-client": "miniprogram", "content-type": "application/json" };

/**
 * 拿一只可入岛的宠物：**有就复用，没有才建，建了的由调用方删掉**。
 *
 * 不能无条件新建。全站共用一个 demo 用户，而 `createPet` 只在「该用户还没有宠物」
 * 时置 `is_default`，于是本文件先跑（文件名字母序在 `main-flow` 之前）留下的宠物会
 * 顶掉主链路那只 —— Web 时间线页取 `isDefault || pets[0]`，就会显示一只没有照片的
 * 宠物，表现是「陪伴第 N 天」在，而「第 N 天」那条不见。实测已复现。
 *
 * 复用也更贴近真实：用户是先有档案才进岛的。
 */
async function pickIslandPet(request: import("@playwright/test").APIRequestContext) {
  const listed = await request.get("/api/island?candidates=1", { headers: MINIPROGRAM_HEADERS });
  expect(listed.ok()).toBeTruthy();
  const candidates = (await listed.json()).data.candidates as Array<{ id: string; name: string }>;
  if (candidates.length) return { id: candidates[0].id, created: false };

  const created = await request.post("/api/pets", {
    headers: MINIPROGRAM_HEADERS,
    data: { name: "小岛测试宠", species: "cat" },
  });
  expect(created.ok()).toBeTruthy();
  return { id: (await created.json()).data.id as string, created: true };
}

test("runs the island loop end to end over real HTTP", async ({ request }) => {
  const pet = await pickIslandPet(request);
  expect(pet.id).toBeTruthy();

  // 建岛。幂等：端上首屏「拉不到就建一次再拉」会正常触发它，重复调用不产生第二座
  const built = await request.post("/api/island", { headers: MINIPROGRAM_HEADERS, data: {} });
  expect([200, 201]).toContain(built.status());
  const again = await request.post("/api/island", { headers: MINIPROGRAM_HEADERS, data: {} });
  expect([200, 201]).toContain(again.status());
  expect((await again.json()).data.id).toBe((await built.json()).data.id);

  /*
   * 入岛。M1 只住得下一只，所以库里可能已经有一只（上一次运行留下的）——
   * 两种结果都是对的：201 是本次入的，409 `ISLAND_PET_LIMIT` 说明已经住着一只。
   * 断言的是「不会出现别的错误」，而不是写死其中一种。
   */
  const joined = await request.post("/api/island/pets", { headers: MINIPROGRAM_HEADERS, data: { petId: pet.id } });
  if (joined.status() !== 201) {
    expect(joined.status()).toBe(409);
    expect((await joined.json()).error.code).toBe("ISLAND_PET_LIMIT");
  }

  // 快照。这是端上首屏唯一的一发请求，缺任何一个键都会让画面少一块而不报错
  const snapshotResponse = await request.get("/api/island", { headers: MINIPROGRAM_HEADERS });
  expect(snapshotResponse.ok()).toBeTruthy();
  const snapshot = (await snapshotResponse.json()).data;

  /*
   * **`petId` 要被真的读到。** 端上从宠物档案的操作行进来时会带它，而服务端原先
   * 只认 `candidates` 参数、把这个值静默丢弃（表现是「点第二只看到第一只」）。
   * 服务层的多宠分支由 `island-service.test.ts` 覆盖，这里守的是**路由这一层
   * 有没有把参数接出来** —— 那正是原缺陷所在，也是单测拿不到的一层。
   */
  const targeted = await request.get(`/api/island?petId=${snapshot.pet.id}`, { headers: MINIPROGRAM_HEADERS });
  expect(targeted.ok()).toBeTruthy();
  expect((await targeted.json()).data.pet.id).toBe(snapshot.pet.id);
  // 不存在的 petId 不该 500，也不该变成「岛上没有宠物」—— 回落到岛上那只
  const bogus = await request.get("/api/island?petId=00000000-0000-4000-8000-0000000000ee", { headers: MINIPROGRAM_HEADERS });
  expect(bogus.ok()).toBeTruthy();
  expect((await bogus.json()).data.pet.id).toBe(snapshot.pet.id);

  expect(snapshot.pet?.name).toBeTruthy();
  // 起算日：端上 `services/companion.js` 靠它算陪伴天数，缺了 HUD 那一行是空的
  expect(snapshot.pet.createdAt).toBeTruthy();
  /*
   * 服务端权威日期，`YYYY-MM-DD`。**这个断言钉的是 11.10 记过的那类缺陷** ——
   * 端上按契约猜字段名，猜错时表现是「日期整列空白」，不报错。
   */
  expect(snapshot.serverDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // 上限表：端上不写死上限，`remainingOf` 读的是这三个键
  expect(snapshot.limits).toMatchObject({ gathered: expect.any(Number), fed: expect.any(Number), petted: expect.any(Number) });
  expect(snapshot.today).toMatchObject({ gathered: expect.any(Number), fed: expect.any(Number), petted: expect.any(Number) });
  // 三组锚点齐备。少一个键会让站位变 undefined，宠物直接消失（逐键合并的前提）
  expect(snapshot.anchors).toMatchObject({
    petClear: { x: expect.any(Number), y: expect.any(Number) },
    petShelter: { x: expect.any(Number), y: expect.any(Number) },
    window: { x: expect.any(Number), y: expect.any(Number) },
    horizonY: expect.any(Number),
  });
  /*
   * 素材清单：**当前为空是正式状态**（素材由用户提供后回填 `ISLAND_ASSET_PATHS`）。
   * 断言的不是「有几张」而是「凡下发的一律绝对 URL」—— 以 `/` 开头的值会被小程序
   * 当主包内本地文件找，必然裂图且不报错，而端上 `assetEntries` 会把它们丢掉。
   * 所以素材回填后这条会自动开始生效，不需要改用例。
   */
  for (const url of Object.values(snapshot.assets as Record<string, string>)) {
    expect(url).toMatch(/^https?:\/\//);
  }
  // 里程碑：服务端下发全量带 reached，端上筛 reached 显示（11.13 补的那个落点）
  expect(Array.isArray(snapshot.milestones)).toBeTruthy();
  expect(snapshot.milestones[0]).toMatchObject({ day: expect.any(Number), reached: expect.any(Boolean) });

  /*
   * 采集一次。**掉落物由服务端决定**（允许乐观动画不允许乐观数据），
   * 所以返回值里必须有 drop 与更新后的库存 —— 端上就是拿这两个渲染的。
   */
  const gathered = await request.post("/api/island/actions", { headers: MINIPROGRAM_HEADERS, data: { type: "gather", targetId: "grass" } });
  expect(gathered.ok()).toBeTruthy();
  const gatherResult = (await gathered.json()).data;
  expect(gatherResult.drop?.itemId).toBeTruthy();
  expect(gatherResult.today.gathered).toBeGreaterThan(0);
  expect(Array.isArray(gatherResult.inventory)).toBeTruthy();
  /*
   * 文案门禁的运行时那一半（门禁 11–14 扫的是模板，这里扫的是拼好的成品）。
   * 反馈里不能出现游戏化词汇 —— 措辞差异本身就是类目安全区的边界。
   */
  expect(gatherResult.message).not.toMatch(/体力|经验|等级|金币|升级|任务奖励/);

  // 摸摸。亲密度只增不减，且由服务端算
  const petted = await request.post("/api/island/actions", { headers: MINIPROGRAM_HEADERS, data: { type: "pet", targetId: "pet" } });
  expect(petted.ok()).toBeTruthy();
  const petResult = (await petted.json()).data;
  expect(petResult.intimacy).toBeGreaterThan(0);
  expect(petResult.today.petted).toBeGreaterThan(0);

  // 日记。取快照会顺带懒结算出今天那一条，所以这里必然有内容
  const diaryResponse = await request.get("/api/island/diary", { headers: MINIPROGRAM_HEADERS });
  expect(diaryResponse.ok()).toBeTruthy();
  const diary = (await diaryResponse.json()).data;
  expect(diary.entries.length).toBeGreaterThan(0);
  const entry = diary.entries[0];
  // 端上 `wx:key` 用的是 id：同一天可以有 diary 与 milestone 两条，用 date 会复用错节点
  expect(entry.id).toBeTruthy();
  expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // 库里存 template_id + payload，读取侧渲染 —— 下发的必须是成品文案且非空
  expect(entry.templateId).toBeTruthy();
  expect(entry.text.length).toBeGreaterThan(0);
  expect(entry.text).not.toMatch(/诊断|确诊|治愈|问诊|体况|偏胖|BMI/);

  /*
   * 翻页游标：**`cursor` 与 `nextCursor` 必须同值**。端上 `island/diary/diary.js`
   * 读的是 `cursor`（按它判「还有没有下一页」），REST 侧的习惯叫 `nextCursor` ——
   * 少一个的表现是「日记只有第一页」，不报错（11.10 那类缺陷）。
   *
   * 用 `limit=1` 造出「还有下一页」的情形：到底时两个键都是 `undefined`，
   * 而 `NextResponse.json` 会把 undefined 的键整个丢掉（那是对的，端上按假值判断），
   * 所以直接断言键存在会在只有一条日记时误报 —— 必须在有下一页的分支上验。
   */
  const paged = await request.get("/api/island/diary?limit=1", { headers: MINIPROGRAM_HEADERS });
  expect(paged.ok()).toBeTruthy();
  const pagedData = (await paged.json()).data;
  expect(pagedData.entries).toHaveLength(1);
  expect(pagedData.cursor).toBe(pagedData.nextCursor);
  if (pagedData.cursor) expect(pagedData.cursor).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // 本次建的才删：复用到的那只是别的用例（或上一次运行）在用的，删了会连带软删它的照片
  if (pet.created) {
    expect((await request.delete(`/api/pets/${pet.id}`, { headers: MINIPROGRAM_HEADERS })).ok()).toBeTruthy();
  }
});

/*
 * `memorial` 宠物不进岛（红线，服务端拦 + 端上过滤两处都要）。
 *
 * 这条走真实 HTTP 是有意义的：单测直接调 `joinIslandPet`，测不到
 * 「错误码经 `routeError` 包装后端上收到的是什么」——而端上 `island/service.js`
 * 的调用方是按 envelope 里的 `error.code` 分支的。
 */
test("refuses to admit a memorial pet through the real endpoint", async ({ request }) => {
  const created = await request.post("/api/pets", {
    headers: MINIPROGRAM_HEADERS,
    data: { name: "已离开的宠", species: "cat" },
  });
  expect(created.ok()).toBeTruthy();
  const pet = (await created.json()).data;

  const updated = await request.patch(`/api/pets/${pet.id}`, {
    headers: MINIPROGRAM_HEADERS,
    data: { name: "已离开的宠", species: "cat", lifeStage: "memorial" },
  });
  expect(updated.ok()).toBeTruthy();

  const joined = await request.post("/api/island/pets", { headers: MINIPROGRAM_HEADERS, data: { petId: pet.id } });
  expect(joined.status()).toBe(409);
  expect((await joined.json()).error.code).toBe("ISLAND_UNAVAILABLE_MEMORIAL");

  /*
   * 立绘同样拦（入岛的前置步骤）——不拦的话用户能生成一张却发现进不去，
   * 比一开始就说清楚更糟。这里不需要真照片：`memorial` 判定在照片校验之前。
   */
  const avatar = await request.post("/api/island/avatar", {
    headers: MINIPROGRAM_HEADERS,
    data: { petId: pet.id, photoId: "00000000-0000-4000-8000-0000000000ff" },
  });
  expect(avatar.status()).toBe(409);
  expect((await avatar.json()).error.code).toBe("ISLAND_UNAVAILABLE_MEMORIAL");

  // 可选宠物列表里也不出现它 —— 服务端的读取侧那一半
  const candidates = await request.get("/api/island?candidates=1", { headers: MINIPROGRAM_HEADERS });
  expect(candidates.ok()).toBeTruthy();
  const list = (await candidates.json()).data.candidates as Array<{ id: string; lifeStage: string }>;
  expect(list.some((item) => item.id === pet.id)).toBe(false);
  expect(list.every((item) => item.lifeStage !== "memorial")).toBe(true);

  /*
   * 删掉本次建的那只。全站共用一个 demo 用户，留下一只 `memorial` 宠物会让
   * 其他用例的宠物列表多一行 —— 而 Web 页面按 `isDefault || pets[0]` 取默认宠物，
   * 残留会改变别人看到的「哪一只」（本文件先跑，实测把主链路的时间线用例弄挂过）。
   */
  expect((await request.delete(`/api/pets/${pet.id}`, { headers: MINIPROGRAM_HEADERS })).ok()).toBeTruthy();
});

/*
 * 写接口的守卫。
 *
 * 三行开头（`assertTrustedMutation` → `requireUserId` → `enforceRateLimit`）是
 * 每个写接口的固定形态，而**只有真实 HTTP 能验它**：单测调服务层函数时这三行
 * 根本没跑。表单提交（非 JSON）必须被 415 挡掉 —— 那是 CSRF 的主要入口形态。
 */
test("rejects non-JSON writes to the island endpoints", async ({ request }) => {
  for (const path of ["/api/island", "/api/island/pets", "/api/island/actions"]) {
    const response = await request.post(path, {
      headers: { "x-petbaby-client": "miniprogram", "content-type": "application/x-www-form-urlencoded" },
      data: "type=gather",
    });
    expect(response.status(), `${path} 应拒绝表单提交`).toBe(415);
    expect((await response.json()).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  }
});
