import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { DEFAULT_HOME_CURATION, getHomeCuration, updateHomeCuration } from "@/server/home-curation-service";

const ADMIN = "00000000-0000-4000-8000-0000000000ad";

describe("麻麻精选配置", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await (await getDatabase()).query("INSERT INTO users (id,created_at) VALUES ($1,now())", [ADMIN]);
  });

  it("表为空时返回与小程序内置一致的默认值", async () => {
    const curation = await getHomeCuration();
    expect(curation.lead.templateId).toBe(DEFAULT_HOME_CURATION.lead.templateId);
    expect(curation.templateIds).toEqual(DEFAULT_HOME_CURATION.templateIds);
    expect(curation.version).toBe(0);
  });

  it("后台更新后版本自增并写审计；未上架模板被拒绝", async () => {
    const next = { ...DEFAULT_HOME_CURATION, templateIds: ["fish-chase", "pet-wanted-poster"], note: "本周新上" };
    const saved = await updateHomeCuration(ADMIN, next, "换一批精选");
    expect(saved.version).toBe(1);
    expect((await getHomeCuration()).templateIds).toEqual(["fish-chase", "pet-wanted-poster"]);
    await updateHomeCuration(ADMIN, { ...next, note: "再换一次" }, "再换一次");
    expect((await getHomeCuration()).version).toBe(2);
    const audits = await (await getDatabase()).query("SELECT id FROM audit_logs WHERE target_type='home_curation'");
    expect(audits.length).toBeGreaterThanOrEqual(2);
    await expect(updateHomeCuration(ADMIN, { ...next, templateIds: ["no-such-template"] }, "错误配置")).rejects.toMatchObject({ code: "HOME_CURATION_TEMPLATE_UNAVAILABLE" });
  });
});
