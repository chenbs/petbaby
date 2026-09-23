import { beforeEach, expect, it } from "vitest";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createPet } from "@/server/platform-service";
import { scheduleUpcomingReminders, subscribeReminder } from "@/server/growth-service";
import { scheduleOnThisDay } from "@/server/timeline-service";
import { processDueMessages } from "@/server/messaging/worker";

const USER = "00000000-0000-4000-8000-000000000039";
beforeEach(async () => {
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
});

it("A12：未授权/拒绝授权不排生日提醒；授权只用一次，改为纪念后不再投递", async () => {
  const pet = await createPet(USER, { name: "朋友", species: "cat", birthday: "2024-12-25" });
  const now = new Date("2026-07-20T00:00:00Z");
  expect(await scheduleUpcomingReminders(USER, now)).toEqual([]);
  await subscribeReminder(USER, { petId: pet.id, eventType: "birthday", consent: true, wechatAuthorization: "reject" });
  expect(await scheduleUpcomingReminders(USER, now)).toEqual([]);
  await subscribeReminder(USER, { petId: pet.id, eventType: "birthday", consent: true, wechatAuthorization: "accept" });
  const scheduled = await Promise.all([scheduleUpcomingReminders(USER, now), scheduleUpcomingReminders(USER, now)]);
  expect(scheduled.flat()).toHaveLength(1);
  const db = await getDatabase();
  await db.query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [pet.id]);
  await db.query("UPDATE message_subscriptions SET scheduled_at=now()-interval '1 day' WHERE status='scheduled'");
  expect(await processDueMessages()).toEqual([]);
});

it("A12：纪念宠物即使已有授权和去年今日照片，也不排提醒", async () => {
  const pet = await createPet(USER, { name: "想念", species: "cat", birthday: "2024-12-25", lifeStage: "memorial" });
  const db = await getDatabase();
  await db.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,shot_at,created_at) VALUES ($1,$2,$3,'fixture.png','image/png',1,'private/reminder-fixture.png','2025-07-20T08:00:00Z',now())", [crypto.randomUUID(), USER, pet.id]);
  for (const eventType of ["birthday", "on_this_day"]) await subscribeReminder(USER, { petId: pet.id, eventType, consent: true });
  expect(await scheduleUpcomingReminders(USER, new Date("2026-07-20T00:00:00Z"))).toEqual([]);
  expect((await scheduleOnThisDay(USER, new Date("2026-07-20T12:00:00Z"))).scheduled).toBe(0);
});
