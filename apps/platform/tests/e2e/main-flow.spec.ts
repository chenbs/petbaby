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
    ["/admin/video", "视频模板与渲染任务"],
    ["/admin/memorials", "纪念产品管理"],
    ["/admin/business", "订阅、履约与权益"],
    ["/admin/wallet", "冻干钱包管理"],
    ["/admin/users", "用户与审计"],
    ["/admin/audit", "统一管理审计"],
  ] as const;
  for (const [path, heading] of workspaces) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("服务暂时不可用", { timeout: 15_000 });
    await page.waitForTimeout(250);
    if (path === "/admin/wallet") {
      await page.screenshot({ path: "output/playwright/wallet-admin.png", fullPage: true });
    }
  }
  expect(failedAdminRequests).toEqual([]);
});
