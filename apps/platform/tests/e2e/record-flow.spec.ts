import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

test("记录到回看：非默认宠物、上传回执、日期短句、实际年度素材与报价", async ({ page, request }) => {
  const headers = { "x-petbaby-client": "miniprogram" };
  const create = await request.post("/api/pets", { headers, data: { name: "记录B", species: "cat", birthday: "2024-01-01" } });
  expect(create.status()).toBe(201);
  const pet = (await create.json()).data;
  const png = await sharp({ create: { width: 240, height: 320, channels: 3, background: "#427bd1" } }).png().toBuffer();
  const requestId = crypto.randomUUID();
  const multipart = { petId: pet.id, filename: "record-fixture.png", uploadRequestId: requestId, entry: "photos", file: { name: "record-fixture.png", mimeType: "image/png", buffer: png } };
  const upload = await request.post("/api/uploads", { headers, multipart });
  expect(upload.status()).toBe(201);
  const photo = (await upload.json()).data;
  const replay = await request.post("/api/uploads", { headers, multipart });
  expect((await replay.json()).data.id).toBe(photo.id);
  const receipt = await request.get(`/api/uploads?requestId=${requestId}`);
  expect((await receipt.json()).data.photo.id).toBe(photo.id);
  const year = new Date().getFullYear();
  const update = await request.patch(`/api/photos/${photo.id}`, { headers, data: { version: 1, memoryDate: `${year}-02-28`, caption: "一起看窗外的雨", tags: ["keep"] } });
  expect(update.status()).toBe(200);
  const outdated = await request.patch(`/api/photos/${photo.id}`, { headers, data: { version: 1, caption: "过期修改" } });
  expect(outdated.status()).toBe(409);
  const downloads = await request.get(photo.url);
  expect(await downloads.body()).toEqual(png);
  const list = await request.get(`/api/photos?petId=${pet.id}&pageSize=50`);
  expect((await list.json()).data.totalCount).toBe(1);

  await page.goto(`/timeline?petId=${pet.id}`);
  await expect(page.getByText("一起看窗外的雨")).toBeVisible();
  await expect(page.getByText("你设置的日期", { exact: true })).toBeVisible();
  await expect(page.getByText("照片库共 1 张")).toBeVisible();
  await expect(page.locator(".photo-thumb img")).toHaveJSProperty("naturalWidth", 240);
  await page.getByRole("button", { name: "确认年度素材与报价" }).click();
  await expect(page.getByText(new RegExp(`记录B · ${year} · 20 秒`))).toBeVisible();
  await expect(page.getByText(/解锁 ¥/)).toBeVisible();
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/record-b-timeline.png", fullPage: true });
  // 改动时长必须重新确认，不能用前一次预览的素材/时长提交。
  await page.getByLabel("时长").selectOption("10");
  await expect(page.getByRole("button", { name: "用这些照片制作" })).toHaveCount(0);
  await page.getByRole("button", { name: "确认年度素材与报价" }).click();
  const submission = page.waitForRequest((item) => item.url().endsWith("/api/annual-films") && item.method() === "POST");
  await page.getByRole("button", { name: "用这些照片制作" }).click();
  expect((await submission).postDataJSON()).toMatchObject({ petId: pet.id, year, durationSeconds: 10, photoIds: [photo.id] });
  await expect(page.getByRole("status")).toContainText("已为 记录B 开始渲染");
});

test("无权宠物链接保持错误，不回退默认宠物", async ({ page }) => {
  await page.goto(`/timeline?petId=${crypto.randomUUID()}`);
  await expect(page.getByRole("status")).toContainText("宠物档案不存在");
  await expect(page.locator(".work-list-item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认年度素材与报价" })).toHaveCount(0);
});
