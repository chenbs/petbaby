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

  it("只迁移旧默认样片地址，不覆盖后台人工选择", async () => {
    const custom = "/api/plugin-samples/samples/admin-choice-000000000000.jpg";
    for (const plugin of plugins) rows.set(plugin.id, { manifest: { ...plugin } });
    rows.set("pet-id-card", { manifest: { ...plugins.find((plugin) => plugin.id === "pet-id-card"), samples: { heroUrl: "/api/plugin-samples/samples/pet-id-card-cee27b346c67.jpg" } } });
    rows.set("pet-movie-poster", { manifest: { ...plugins.find((plugin) => plugin.id === "pet-movie-poster"), samples: { heroUrl: custom } } });
    const result = await listRuntimePlugins();
    expect(result.find((plugin) => plugin.id === "pet-id-card")?.samples?.heroUrl).toBe(plugins.find((plugin) => plugin.id === "pet-id-card")?.samples?.heroUrl);
    expect(result.find((plugin) => plugin.id === "pet-movie-poster")?.samples?.heroUrl).toBe(custom);
  });

  it("写真场景图逐项迁移，保留单项人工覆盖", async () => {
    const custom = "/api/plugin-samples/samples/admin-choice-000000000000.jpg";
    const portrait = plugins.find((plugin) => plugin.id === "pl-10");
    if (!portrait) throw new Error("PL-10 missing");
    rows.set("pl-10", { manifest: { ...portrait, samples: {
      heroUrl: "/api/plugin-samples/samples/pl-10-df4b766033ec.jpg",
      sceneUrls: { "window-morning": "/api/plugin-samples/samples/scene-window-morning-v1-9770823ac40a.jpg", "studio-confident": custom }
    } } });
    const result = await listRuntimePlugins();
    const samples = result.find((plugin) => plugin.id === "pl-10")?.samples;
    expect(samples?.heroUrl).toBe(portrait.samples?.heroUrl);
    expect(samples?.sceneUrls?.["window-morning"]).toBe(portrait.samples?.sceneUrls?.["window-morning"]);
    expect(samples?.sceneUrls?.["studio-confident"]).toBe(custom);
    expect(samples?.sceneUrls?.["night-playful"]).toBe(portrait.samples?.sceneUrls?.["night-playful"]);
  });

  it("V1 四场景默认文案升级为十二场景，人工文案不覆盖", async () => {
    const portrait = plugins.find((plugin) => plugin.id === "pl-10");
    if (!portrait) throw new Error("PL-10 missing");
    const v1 = [
      { id: "window-morning", title: "窗边晨光", description: "坐姿望窗 · 平静神态" },
      { id: "garden-curious", title: "花园探索", description: "抬爪嗅花 · 好奇神态" },
      { id: "studio-confident", title: "影棚主角", description: "正面坐姿 · 自信凝视" },
      { id: "night-playful", title: "夜色追光", description: "回头跃起 · 惊喜活泼" },
    ];
    rows.set("pl-10", { manifest: { ...portrait, samples: { ...portrait.samples, sceneOptions: v1.map((item) => ({ description: item.description, title: item.title, id: item.id })) } } });
    const upgraded = await listRuntimePlugins();
    expect(upgraded.find((plugin) => plugin.id === "pl-10")?.samples?.sceneOptions).toEqual(portrait.samples?.sceneOptions);
    rows.set("pl-10", { manifest: { ...portrait, samples: { ...portrait.samples, sceneOptions: [{ id: "custom", title: "运营选场", description: "保留" }] } } });
    const customized = await listRuntimePlugins();
    expect(customized.find((plugin) => plugin.id === "pl-10")?.samples?.sceneOptions?.[0]?.id).toBe("custom");
  });

  it("V2 默认写真图和文案升级到新版，保留人工设置", async () => {
    const portrait = plugins.find((plugin) => plugin.id === "pl-10");
    if (!portrait) throw new Error("PL-10 missing");
    const v2 = [
      ["window-morning", "窗边观鸟", "伏窗望鸟 · 安静专注"],
      ["garden-curious", "花园探花", "抬爪嗅花 · 好奇"],
      ["studio-confident", "复古影棚", "登上木台 · 自信回望"],
      ["night-playful", "夜庭追光", "跃步追光 · 惊喜活泼"],
      ["seaside-breeze", "海边栈道", "迎风站立 · 警觉舒展"],
      ["library-whisper", "书店探险", "转角探身 · 机灵好奇"],
      ["autumn-leaves", "枫叶小径", "轻跑落叶 · 兴奋"],
      ["snow-cabin", "雪窗木屋", "蜷卧毛毯 · 困倦满足"],
      ["cafe-afternoon", "街角咖啡馆", "坐椅转头 · 悠闲观察"],
      ["lakeside-sunset", "湖畔木桥", "伸懒腰 · 眯眼迎光"],
      ["city-rain", "雨后骑楼", "跨过水洼 · 惊讶"],
      ["spring-picnic", "春日野餐", "伸爪拨带 · 轻快愉悦"],
    ].map(([id, title, description]) => ({ id, title, description }));
    const custom = "/api/plugin-samples/samples/admin-choice-000000000000.jpg";
    rows.set("pl-10", { manifest: { ...portrait, samples: {
      heroUrl: "/api/plugin-samples/samples/mp26-pl-10-8bfc17d3b3b5.jpg",
      sceneOptions: v2,
      sceneUrls: {
        "window-morning": "/api/plugin-samples/samples/scene-window-morning-v2-76d6e35bcd80.jpg",
        "garden-curious": custom,
      },
    } } });
    const result = await listRuntimePlugins();
    const samples = result.find((plugin) => plugin.id === "pl-10")?.samples;
    expect(samples?.heroUrl).toBe(portrait.samples?.heroUrl);
    expect(samples?.sceneOptions).toEqual(portrait.samples?.sceneOptions);
    expect(samples?.sceneUrls?.["window-morning"]).toBe(portrait.samples?.sceneUrls?.["window-morning"]);
    expect(samples?.sceneUrls?.["garden-curious"]).toBe(custom);
  });

  it("旧十二套默认写真自动扩到二十四套，人工编辑过的十二套仍保留", async () => {
    const portrait = plugins.find((plugin) => plugin.id === "pl-10");
    if (!portrait?.samples?.sceneOptions) throw new Error("PL-10 scenes missing");
    const twelve = portrait.samples.sceneOptions.slice(0, 12);
    rows.set("pl-10", { manifest: { ...portrait, samples: { ...portrait.samples, sceneOptions: twelve } } });
    const upgraded = await listRuntimePlugins();
    expect(upgraded.find((plugin) => plugin.id === "pl-10")?.samples?.sceneOptions).toHaveLength(24);
    const custom = twelve.map((scene, index) => index === 0 ? { ...scene, title: "运营自定标题" } : scene);
    rows.set("pl-10", { manifest: { ...portrait, samples: { ...portrait.samples, sceneOptions: custom } } });
    const preserved = await listRuntimePlugins();
    expect(preserved.find((plugin) => plugin.id === "pl-10")?.samples?.sceneOptions).toEqual(custom);
  });

  /*
   * 第三个方向：库里已有 samples 但缺新加的子键。
   * 上一次部署给 PL-10 补了 heroUrl，这次 registry 里新增 sceneUrls ——
   * 若按「有 samples 就跳过」处理，新键永远进不去已有行，
   * 端上取不到风格对比图，只能退回纯文字选项。
   */
  it("库里已有 samples 时仍补齐新增的子键", async () => {
    const withScenes = plugins.find((plugin) => plugin.samples?.sceneUrls);
    if (!withScenes) throw new Error("registry 里没有带 sceneUrls 的玩法，本测试失去意义");
    const publishedHero = "/api/plugin-samples/samples/admin-choice-000000000000.jpg";
    for (const plugin of plugins) {
      // 只有 heroUrl，没有 styleUrls —— 正是上一次部署留下的状态
      rows.set(plugin.id, { manifest: { ...plugin, samples: { heroUrl: publishedHero } } });
    }
    const result = await listRuntimePlugins();
    const target = result.find((plugin) => plugin.id === withScenes.id);
    expect(target?.samples?.sceneUrls).toEqual(withScenes.samples?.sceneUrls);
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
