import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4v5QBAARLAaVqE1cAAAAAAElFTkSuQmCC",
  "base64",
);

/*
 * 主链路使用电影海报（5 颗）：建档得见面礼 3 颗，再模拟充值补足后生成。
 *
 * 2026-08-03 起 `pet-id-card` 转免费（改造方案 C6：证件照的免费替代太密），
 * 免费玩法不再有「支付并保存原图」这一步 —— 用它测解锁链路会测不到付费分支。
 * 免费路径由下面那条用例覆盖。
 */
test("completes paid generation with newcomer gift and public share", async ({ page, request }) => {
  const before = (await (await request.get("/api/wallet")).json()).data;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /每张照片/ })).toBeVisible();
  await page.getByRole("link", { name: /宠物电影海报/ }).click();

  await page.getByLabel("我叫什么？").fill("年糕");
  const petSaved = page.waitForResponse((response) => response.url().endsWith("/api/pets") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存档案，选择照片" }).click();
  expect((await petSaved).status()).toBe(201);
  const gifted = (await (await request.get("/api/wallet")).json()).data;
  expect(gifted.balance).toBe(before.balance + 3);
  // 海报 5 颗，见面礼 3 颗不够：先走一次模拟充值（6 元 6 颗）
  const headers = { "x-petbaby-client": "miniprogram" };
  const topup = await request.post("/api/wallet/topups", { headers, data: { packageId: "p6" } });
  expect(topup.status()).toBe(201);
  const paid = await request.post("/api/growth-orders/" + (await topup.json()).data.id + "/pay", { headers, data: {} });
  expect(paid.status()).toBe(200);
  const funded = (await (await request.get("/api/wallet")).json()).data;
  expect(funded.balance).toBe(gifted.balance + 6);
  await page.getByLabel(/追加新照片/).setInputFiles({ name: "pet.png", mimeType: "image/png", buffer: tinyPng });
  await page.getByRole("button", { name: "5 颗 · 开始生成" }).click();

  await expect(page.getByText("正式版 · 可直接保存")).toBeVisible({ timeout: 20_000 });
  const resultImage = page.locator(".preview-photo img");
  await expect.poll(() => resultImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await resultImage.evaluate((element) => (element as HTMLImageElement).decode());
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/wallet-paid-work.png", fullPage: true });
  const charged = (await (await request.get("/api/wallet")).json()).data;
  expect(charged.balance).toBe(funded.balance - 5);
  await page.getByRole("button", { name: "生成分享页" }).click();
  await page.getByRole("link", { name: /打开分享页/ }).click();

  await expect(page.getByRole("link", { name: "给我的宠物也做一个" })).toBeVisible();
});

// 免费玩法每日十次与退款边界由服务端回归覆盖；这里复用主链路的宠物和照片。
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
  await expect(page.getByRole("button", { name: "确认年度素材与报价" })).toBeVisible();
});

/*
 * 2026-10-11 运营后台重建为桌面控制台（src/app/admin 独立根布局）。
 * 这条用例按侧栏导航逐页打开，每页都必须渲染出标题且没有错误边界；
 * 旧入口 /admin/wallet、/admin/business 必须跳到新页面，而不是 404。
 */
test("loads every administrator workspace through the console navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/admin") && response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror ${error.message}`));

  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "运营总览" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "待处理" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/admin-overview.png", fullPage: true });

  const workspaces = [
    ["用户增长", "/admin/growth", "用户增长"],
    ["功能使用", "/admin/features", "功能使用"],
    ["收入与冻干", "/admin/revenue", "收入与冻干"],
    ["用户", "/admin/users", "用户"],
    ["图片审核", "/admin/uploads", "图片审核"],
    ["订单与履约", "/admin/orders", "订单与履约"],
    ["任务监控", "/admin/tasks", "任务监控"],
    ["消息与报告", "/admin/messages", "消息与报告"],
    ["麻麻精选", "/admin/curation", "麻麻精选"],
    ["玩法配置", "/admin/plugins", "玩法配置"],
    ["玩法赛马", "/admin/experiments", "玩法赛马"],
    ["视频目录", "/admin/video", "视频目录"],
    ["纪念空间", "/admin/memorials", "纪念空间"],
    ["系统健康", "/admin/system", "系统健康"],
    ["审计日志", "/admin/audit", "审计日志"],
  ] as const;
  const nav = page.getByRole("navigation", { name: "后台导航" });
  for (const [link, path, heading] of workspaces) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main")).not.toContainText("这一页没有加载出来");
  }

  for (const [legacy, target] of [["/admin/wallet", "/admin/revenue"], ["/admin/business", "/admin/messages"]] as const) {
    await page.goto(legacy);
    await expect(page).toHaveURL(new RegExp(`${target}$`));
  }

  // 用户详情：从列表点进第一位用户，详情页必须带出账号与价值卡片。
  await page.goto("/admin/users");
  const firstUser = page.locator("table a[href^='/admin/users/']").first();
  await firstUser.click();
  await expect(page.getByRole("heading", { name: "账号", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "补偿冻干" })).toBeVisible();

  // 深色主题切换后刷新仍保持（localStorage + 首屏脚本）。
  await page.getByRole("button", { name: "切换到深色" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/admin/revenue");
  await page.screenshot({ path: "output/playwright/admin-revenue-dark.png", fullPage: true });
  await page.getByRole("button", { name: "切换到浅色" }).click();

  expect(failures).toEqual([]);
});
