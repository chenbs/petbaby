import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const generateWithFailoverMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/ai/provider", () => ({ generateWithFailover: generateWithFailoverMock }));
vi.mock("@/server/image-template-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/image-template-registry")>();
  const humanTemplate = {
    entryId: "human",
    templateId: "test-pet-human",
    title: "测试宠物人化",
    subjectMode: "pet-human" as const,
    orientation: "portrait" as const,
    size: "720x1280" as const,
    version: "v01",
    status: "live" as const,
    masterStorageKey: "samples/image-templates/test-pet-human.png",
    sampleStorageKey: "samples/image-templates/test-pet-human.png",
    effectPrompt: "测试效果图专属人物与场景描述",
  };
  return {
    ...actual,
    getImageTemplate(templateId: string, options?: { includePending?: boolean }) {
      return templateId === humanTemplate.templateId ? humanTemplate : actual.getImageTemplate(templateId, options);
    },
  };
});

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createAiRun, getAiRun, processNextAiRun, rerollAiRun } from "@/server/growth-service";
import type { ImageReference } from "@/server/ai/provider";
import { objectStorage } from "@/server/storage";

const USER = "20000000-0000-4000-8000-000000000001";
const PET = "20000000-0000-4000-8000-000000000002";
const PHOTO = "20000000-0000-4000-8000-000000000003";
const MASTER_KEY = "samples/image-templates/test-pet-human.png";

async function png(color: string) {
  return new Uint8Array(await sharp({
    create: { width: 64, height: 96, channels: 3, background: color },
  }).png().toBuffer());
}

describe("pet-human effect-reference generation", () => {
  beforeEach(async () => {
    vi.stubEnv("AI_IMAGE_COST", "0.1");
    generateWithFailoverMock.mockReset();
    const finalImage = await png("#d5a743");
    generateWithFailoverMock.mockImplementation(async (_prompt, count) => ({
      provider: { name: "test-provider", modelVersion: "test-model" },
      images: Array.from({ length: count }, () => ({ body: finalImage, contentType: "image/png" })),
    }));
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query(
      "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Milo','cat','unknown','birthday','active',true,now())",
      [PET, USER],
    );
    await database.query(
      "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,'milo.png','image/png',1,$4,0,'clear',now())",
      [PHOTO, USER, PET, `private/${USER}/photos/milo.png`],
    );
    await Promise.all([
      objectStorage.put(`private/${USER}/photos/milo.png`, await png("#222222"), "image/png"),
      objectStorage.put(MASTER_KEY, await png("#eeeeee"), "image/png"),
    ]);
  });

  it("单次生成两张，严格按宠物图一和效果图二传参且只记一次账", async () => {
    const run = await createAiRun(USER, {
      pluginId: "pl-10",
      templateId: "test-pet-human",
      petId: PET,
      photoIds: [PHOTO],
      idempotencyKey: "pet-human-first-run",
    });

    expect((await processNextAiRun())?.status).toBe("succeeded");
    expect(generateWithFailoverMock).toHaveBeenCalledTimes(1);
    const references = generateWithFailoverMock.mock.calls[0][4] as ImageReference[];
    expect(generateWithFailoverMock.mock.calls[0][1]).toBe(2);
    expect(references.map((item) => item.filename)).toEqual(["pet-identity.png", "effect-reference.png"]);
    expect(String(generateWithFailoverMock.mock.calls[0][0])).toContain("测试效果图专属人物与场景描述");
    expect(String(generateWithFailoverMock.mock.calls[0][0])).toContain("最终画面只允许一个完整、自然、可信的真人");

    const ready = await getAiRun(USER, run.id);
    expect(ready.candidates).toHaveLength(2);
    expect(ready.cost).toBeCloseTo(0.2);
    expect(ready.rerollRemaining).toBe(0);
    expect(ready.roleInputs).toMatchObject({ subjectMode: "pet-human" });
    expect(ready.roleInputs.petHumanIdentityPromptVersion).toBeUndefined();
    expect(ready.roleInputs.petHumanIdentityId).toBeUndefined();
    const database = await getDatabase();
    const storedRuns = await database.query("SELECT role_inputs FROM ai_runs WHERE id=$1", [run.id]);
    expect(storedRuns[0].role_inputs).not.toHaveProperty("petHumanIdentityPromptVersion");
    expect(storedRuns[0].role_inputs).not.toHaveProperty("petHumanIdentityId");
    expect(await database.query("SELECT id FROM pet_human_identities WHERE user_id=$1", [USER])).toHaveLength(0);
    const ledger = await database.query("SELECT units,amount FROM ai_cost_ledger WHERE run_id=$1 ORDER BY units", [run.id]);
    expect(ledger.map((row) => ({ units: Number(row.units), amount: Number(row.amount) }))).toEqual([{ units: 2, amount: 0.2 }]);
  });

  it("服务端拒绝宠物人化重抽，且不会再次调用 Provider", async () => {
    const run = await createAiRun(USER, {
      pluginId: "pl-10",
      templateId: "test-pet-human",
      petId: PET,
      photoIds: [PHOTO],
      idempotencyKey: "pet-human-reroll",
    });
    await processNextAiRun();
    await expect(rerollAiRun(USER, run.id, "too-animal")).rejects.toMatchObject({ code: "AI_REROLL_NOT_SUPPORTED", status: 409 });

    expect(generateWithFailoverMock).toHaveBeenCalledTimes(1);
    const ready = await getAiRun(USER, run.id);
    expect(ready.status).toBe("succeeded");
    expect(ready.cost).toBeCloseTo(0.2);
    expect(ready.roleInputs.rerollReason).toBeUndefined();
    const ledger = await (await getDatabase()).query("SELECT units FROM ai_cost_ledger WHERE run_id=$1", [run.id]);
    expect(ledger.map((row) => Number(row.units))).toEqual([2]);
  });
});
