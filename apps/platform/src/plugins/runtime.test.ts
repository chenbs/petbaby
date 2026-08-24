import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * samples 回填的两个方向都要成立：
 *   1. 老库缺 samples 时补上（否则新入口图永远到不了线上）
 *   2. 后台已发布过 samples 时不许覆盖（否则每次部署都重置运营决策）
 *
 * 用假 database 而非真 PGlite：PGlite 文件模式是单连接的，测试与 dev server
 * 抢同一目录会互相踩，之前用外部脚本验证就因此得出过假结论。
 */
const rows = new Map<string, { manifest: unknown }>();
const queries: string[] = [];

const fakeDatabase = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push(sql);
    if (sql.startsWith("INSERT INTO plugin_configs")) {
      const [id, manifest] = params as [string, string];
      if (!rows.has(id)) rows.set(id, { manifest: JSON.parse(manifest) });
      return [{ version: 1 }];
    }
    if (sql.startsWith("SELECT manifest FROM plugin_configs WHERE id=")) {
      const row = rows.get(String(params[0]));
      return row ? [row] : [];
    }
    if (sql.startsWith("UPDATE plugin_configs SET manifest=")) {
      rows.set(String(params[0]), { manifest: JSON.parse(String(params[1])) });
      return [];
    }
    if (sql.startsWith("SELECT manifest FROM plugin_configs WHERE active=true")) {
      return [...rows.values()];
    }
    return [];
  }),
  exec: vi.fn(),
  close: vi.fn(),
};

vi.mock("@/server/db/client", () => ({ getDatabase: async () => fakeDatabase }));
vi.mock("@/server/admin/audit", () => ({ recordAdminAudit: vi.fn() }));

const { plugins } = await import("@/plugins/registry");
const { listRuntimePlugins } = await import("@/plugins/runtime");

const seeded = plugins.find((plugin) => plugin.samples?.heroUrl);
if (!seeded) throw new Error("registry 里没有任何带 samples 的玩法，本测试失去意义");

describe("玩法样例图回填", () => {
  beforeEach(() => {
    rows.clear();
    queries.length = 0;
  });

  it("老库缺 samples 时按 registry 补齐", async () => {
    for (const plugin of plugins) {
      const legacy = { ...plugin };
      delete legacy.samples;
      rows.set(plugin.id, { manifest: legacy });
    }
    const result = await listRuntimePlugins();
    const target = result.find((plugin) => plugin.id === seeded.id);
    expect(target?.samples?.heroUrl).toBe(seeded.samples?.heroUrl);
  });

  it("后台已发布的 samples 不被部署覆盖", async () => {
    const published = "/api/plugin-samples/samples/admin-choice-000000000000.jpg";
    for (const plugin of plugins) {
      rows.set(plugin.id, { manifest: { ...plugin, samples: { heroUrl: published } } });
    }
    const result = await listRuntimePlugins();
    const target = result.find((plugin) => plugin.id === seeded.id);
    expect(target?.samples?.heroUrl).toBe(published);
  });

  /*
   * 第三个方向：库里已有 samples 但缺新加的子键。
   * 上一次部署给 PL-10 补了 heroUrl，这次 registry 里新增 styleUrls ——
   * 若按「有 samples 就跳过」处理，新键永远进不去已有行，
   * 端上取不到风格对比图，只能退回纯文字选项。
   */
  it("库里已有 samples 时仍补齐新增的子键", async () => {
    const withStyles = plugins.find((plugin) => plugin.samples?.styleUrls);
    if (!withStyles) throw new Error("registry 里没有带 styleUrls 的玩法，本测试失去意义");
    const publishedHero = "/api/plugin-samples/samples/admin-choice-000000000000.jpg";
    for (const plugin of plugins) {
      // 只有 heroUrl，没有 styleUrls —— 正是上一次部署留下的状态
      rows.set(plugin.id, { manifest: { ...plugin, samples: { heroUrl: publishedHero } } });
    }
    const result = await listRuntimePlugins();
    const target = result.find((plugin) => plugin.id === withStyles.id);
    expect(target?.samples?.styleUrls).toEqual(withStyles.samples?.styleUrls);
    // 已有的 heroUrl 仍是后台那份，没被 registry 的值盖掉
    expect(target?.samples?.heroUrl).toBe(publishedHero);
  });

  it("manifest 存成 JSON 字符串时回填不误判", async () => {
    for (const plugin of plugins) {
      const legacy = { ...plugin };
      delete legacy.samples;
      // 双层编码：decodeJsonValue 要循环解两次就是为了这种历史行
      rows.set(plugin.id, { manifest: JSON.stringify(legacy) });
    }
    const result = await listRuntimePlugins();
    const target = result.find((plugin) => plugin.id === seeded.id);
    expect(target?.samples?.heroUrl).toBe(seeded.samples?.heroUrl);
  });
});
