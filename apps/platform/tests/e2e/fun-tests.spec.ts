import { expect, test } from "@playwright/test";

const titles = ["我的隐藏性格", "我带来的小小好运", "我们的陪伴关系", "我的情绪充电方式"];

test("four pet fun tests complete and produce shareable, revocable results", async ({ page }) => {
  test.setTimeout(90_000);
  for (const title of titles) {
    let revealStarted = 0;
    await page.goto("/fun-tests");
    await expect(page.locator(".ft-catalog-item")).toHaveCount(4);
    await page.locator(".ft-catalog-item").filter({ hasText: title }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByLabel("宠物名字").fill("年糕");
    await page.getByRole("button", { name: /开始测试/ }).click();

    for (let index = 0; index < 10; index++) {
      await expect(page.locator(".ft-quiz-top")).toContainText(`${index + 1} / 10`);
      if (index === 1) {
        await page.getByRole("button", { name: /上一题/ }).click();
        await expect(page.locator(".ft-quiz-top")).toContainText("1 / 10");
        await page.locator(".ft-choices button").nth(2).click();
      }
      if (index === 9) revealStarted = Date.now();
      await page.locator(".ft-choices button").nth(index % 3).click();
      if (index === 9) {
        await expect(page.locator(".ft-thinking")).toBeVisible();
        await expect(page.locator(".ft-thinking")).toContainText("正在拼出 年糕 的小答案");
        if (title === titles[0]) {
          await page.waitForTimeout(1700);
          await page.screenshot({ path: "output/playwright/fun-tests-thinking-mobile.png", fullPage: true });
        }
      }
    }

    const resultName = await page.locator(".ft-result-sheet h1").innerText();
    if (title === titles[0]) expect(Date.now() - revealStarted).toBeGreaterThanOrEqual(2500);
    await expect(page.locator(".ft-result-sheet")).toContainText("年糕");
    await expect(page.locator(".ft-result-sheet")).toContainText("日常名场面");
    await expect(page.locator(".ft-result-sheet")).toContainText("我们之间");

    if (title !== titles[0]) continue;

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存海报" }).click();
    expect((await downloadPromise).suggestedFilename()).toContain(resultName);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "复制链接" }).click();
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(shareUrl).toMatch(/\/fun-tests\/share\/[A-Za-z0-9_-]{32}$/);
    const sharedPage = await page.context().newPage();
    await sharedPage.goto(shareUrl);
    await expect(sharedPage.locator(".ft-result-sheet h1")).toHaveText(resultName);
    await sharedPage.close();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除这份结果" }).click();
    await expect(page.locator(".ft-catalog-item")).toHaveCount(4);
    await page.goto(shareUrl);
    await expect(page.getByRole("heading", { name: "这份结果已失效" })).toBeVisible();
  }
});

test("failed result submission returns to the final question", async ({ page }) => {
  await page.route("**/api/fun-tests/hidden-personality", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "结果生成失败，请重试" } }) })
    : route.continue());
  await page.goto("/fun-tests");
  await page.locator(".ft-catalog-item").filter({ hasText: titles[0] }).click();
  await page.getByLabel("宠物名字").fill("年糕");
  await page.getByRole("button", { name: /开始测试/ }).click();
  for (let index = 0; index < 10; index++) await page.locator(".ft-choices button").first().click();
  await expect(page.locator(".ft-quiz-top")).toContainText("10 / 10");
  await expect(page.locator(".ft-error")).toBeVisible();
  await expect(page.locator(".ft-thinking")).toHaveCount(0);
});
