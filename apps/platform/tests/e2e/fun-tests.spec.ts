import { expect, test } from "@playwright/test";

const titles = ["它的隐藏性格", "它带来的小小好运", "你们的陪伴关系", "它的情绪充电方式"];

test("four pet fun tests complete and produce shareable, revocable results", async ({ page }) => {
  for (const title of titles) {
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
      await page.locator(".ft-choices button").nth(index % 3).click();
    }

    const resultName = await page.locator(".ft-result-sheet h1").innerText();
    await expect(page.locator(".ft-result-sheet")).toContainText("年糕");
    await expect(page.locator(".ft-result-sheet")).toContainText("日常名场面");
    await expect(page.locator(".ft-result-sheet")).toContainText("你们之间");

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
