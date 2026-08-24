import { expect, test } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=",
  "base64",
);

/*
 * 付费主链路用**电影海报**（12.9）而不是身份证。
 *
 * 2026-08-03 起 `pet-id-card` 转免费（改造方案 C6：证件照的免费替代太密），
 * 免费玩法不再有「支付并去水印」这一步 —— 用它测解锁链路会测不到付费分支。
 * 免费路径由下面那条用例覆盖。
 */
test("completes generation, unlock, and public share flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /每张照片/ })).toBeVisible();
  await page.getByRole("link", { name: /宠物电影海报/ }).click();

  await page.getByLabel("它叫什么？").fill("年糕");
  await page.getByRole("button", { name: "保存档案，选择照片" }).click();
  await page.getByLabel(/追加新照片/).setInputFiles({ name: "pet.png", mimeType: "image/png", buffer: tinyPng });
  await page.getByRole("button", { name: "免费生成预览" }).click();

  await page.getByRole("button", { name: "支付并去水印" }).click({ timeout: 20_000 });
  await expect(page.getByText("已解锁高清版本")).toBeVisible();
  await page.getByRole("button", { name: "生成分享页" }).click();
  await page.getByRole("link", { name: /打开分享页/ }).click();

  await expect(page.getByRole("link", { name: "给我的宠物也做一个" })).toBeVisible();
});

/*
 * 免费玩法零摩擦（改造方案 C2）**不放在 E2E 里**。
 *
 * 免费额度是每天 1 次且全站共用一个 demo 用户，第二个「要生成一次」的
 * E2E 用例必然撞上 DAILY_QUOTA_USED —— 而且 memory:// 的库随 dev server
 * 复用而保留，改成先跑免费再跑付费也只是换一个失败的那条。
 *
 * 该行为由 `platform-service.test.ts` 的「免费玩法」一组覆盖：
 * locked=false 入库、createOrder 拒绝、产物仍带水印。
 */

/*
 * 会员购买与权益兑付（改造项 M5）。
 *
 * 20 号文附录局限 1 点明这是原 E2E 的缺口：两个用例覆盖生成→解锁→分享与
 * 8 个后台，**不覆盖会员购买与权益兑付** —— 而那正是收入支点所在。
 *
 * 这条用例刻意**不做生成**：免费额度每天 1 次且全站共用一个 demo 用户，
 * 再加一个要生成的用例必然撞上 DAILY_QUOTA_USED（见上面那段说明）。
 * 会员与年报都不消耗生成额度，所以这条能与主链路共存。
 *
 * 断言落在**界面上的价格与权益文案**：M3 要修的就是「端上写死的价格与
 * 迁移走散」，而那种缺陷只有在真的渲染一遍页面时才看得见 ——
 * 服务端单测拿不到「按钮上印的是 ¥199」这件事。
 */
test("sells only redeemable membership entitlements at the migrated price", async ({ page }) => {
  const failedRequests: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/member") && response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/commerce");

  /*
   * 价格与权益必须与最新的在售版本一致（当前是迁移 0023 的 v4 ¥128）。
   * 写死 ¥199/¥25 的旧实现会在这里失败 —— 那是「界面承诺一个价、实收另一个」
   * 的价格欺诈风险，也是 M3 要修的东西。
   *
   * 权益断言限定在套餐卡的 `<li>` 上：已开通会员的用户在同一页还有一张
   * 会员卡（权益渲染成 `<small>`），不限定会命中 strict mode 的双元素。
   */
  await expect(page.getByRole("heading", { name: "¥128 / 年" })).toBeVisible({ timeout: 15_000 });
  const planBenefits = page.locator("li");
  await expect(planBenefits.filter({ hasText: "画册与短片按最高规格制作，价格按最低档收" })).toHaveCount(1);
  await expect(planBenefits.filter({ hasText: "年度报告高清版 1 次免费解锁" })).toHaveCount(1);
  await expect(planBenefits.filter({ hasText: "实体纪念品 9 折" })).toHaveCount(1);
  // 健康两项已随第三批实施并由 P5 加回 —— 在售即必须可兑付。
  await expect(planBenefits.filter({ hasText: "健康档案 PDF 无限导出" })).toHaveCount(1);
  await expect(planBenefits.filter({ hasText: "年度健康记录 1 次" })).toHaveCount(1);
  // 省额为负时不宣称省钱，改给回本件数（¥128 − 一次性 89.7 = 38.3，每件省 29.1 ⇒ 2 件）。
  await expect(page.getByText("做 2 件画册或短片即回本")).toBeVisible();

  /*
   * 健康权益的卖点文案同样受红线约束：这份文件是就医准备材料，
   * 不得被描述成体检报告或诊断结论。
   */
  await expect(page.locator("main")).not.toContainText("体检报告");
  await expect(page.locator("main")).not.toContainText("诊断");
  // D6 判定的负向卖点，迁移已从权益 JSON 移除，端上文案也不该残留。
  await expect(page.locator("main")).not.toContainText("额度加量");
  await expect(page.locator("main")).not.toContainText("额度按月自动重置");
  // 月会员已下架：留着它点下去只会命中 MEMBERSHIP_PLAN_UNAVAILABLE。
  await expect(page.locator("main")).not.toContainText("月会员");

  expect(failedRequests).toEqual([]);
});

/*
 * **会员开通与年报权益核销不放进 E2E**，理由与上面的免费玩法同源：
 * 全站共用一个 demo 用户，而 memory:// 的库随 dev server 复用而保留 ——
 * 会员记录会跨用例累积，「年报余量剩 1 次」在第二次运行时就是错的期望。
 *
 * 这条链路由 `server/entitlement-redemption.test.ts` 覆盖，且那里走的是
 * **完整购买链路**（createMembership → payGrowthOrder）并断言账本行与
 * locked 状态，比点一遍界面严格。E2E 这条留下的是单测拿不到的那部分：
 * **界面上印的价格与权益文案是否与迁移走散**。
 */

/*
 * Web 成长时间线（改造项 E6）。
 *
 * 20 号文 2.2 把「积累层的底座只有单端」列为情绪价值的分发缺口：
 * `getPetTimeline` 与 `/api/pets/[id]/timeline` 早已建成，而此前只有小程序有页面。
 *
 * 这条用例同时守住 E6 的入口可达性 —— 一个建好但没人能进的页面
 * 与 E5 修掉的「零端上调用方」是同一种浪费。
 */
test("reaches the growth timeline from the account entry", async ({ page }) => {
  await page.goto("/me");
  await page.getByRole("link", { name: /成长时间线/ }).click();
  await expect(page).toHaveURL(/\/timeline/);
  await expect(page.getByRole("heading", { name: "成长时间线", level: 1 })).toBeVisible();

  /*
   * 主链路那条用例已经建过档案并上传过照片，所以这里能看到「第 N 天」。
   * 断言用正则而不是具体天数：起算日是建档当天，天数随跑测日期变。
   */
  await expect(page.getByRole("heading", { name: /陪伴第 \d+ 天/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /^第 \d+ 天$/ }).first()).toBeVisible();

  // 叙事年度视频入口（E5）：有照片才出现，否则服务端会以 ANNUAL_PHOTOS_REQUIRED 拒掉。
  await expect(page.getByRole("button", { name: "生成年度短片" })).toBeVisible();
});

test("loads every administrator workspace through the formal navigation", async ({ page }) => {
  const failedAdminRequests: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/") && response.status() >= 400) failedAdminRequests.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "运营诊断台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天该处理什么" })).toBeVisible({ timeout: 15_000 });

  const workspaces = [
    ["/admin/experiments", "玩法赛马"],
    ["/admin/plugins", "玩法配置与回滚"],
    ["/admin/interactive", "互动会话与服务端导出"],
    ["/admin/video", "视频模板与渲染任务"],
    ["/admin/memorials", "纪念产品管理"],
    ["/admin/business", "订阅、履约与权益"],
    ["/admin/users", "用户与审计"],
    ["/admin/audit", "统一管理审计"],
  ] as const;
  for (const [path, heading] of workspaces) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("服务暂时不可用", { timeout: 15_000 });
    await page.waitForTimeout(250);
  }
  expect(failedAdminRequests).toEqual([]);
});
