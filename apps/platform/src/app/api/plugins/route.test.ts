import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * /api/plugins 出口必须给样例图绝对地址。
 *
 * 小程序 `<image src>` 遇到以 / 开头的值会当成主包内的本地文件路径去找，必然裂图，
 * 而 registry 里存的正是站内相对路径。首屏 A 方向的大图入口全压在这个字段上，
 * 少了绝对化就是一片空白 —— 比不做大图更差，所以钉死在测试里。
 */
const listRuntimePlugins = vi.fn();
// resolveManifestTone 用真实实现（纯函数、无 IO）：mock 掉它就等于不测
// 生命阶段调性解析，而那正是玩法合并后 /api/plugins 的新职责。
vi.mock("@/plugins/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/plugins/runtime")>()),
  listRuntimePlugins: () => listRuntimePlugins(),
}));

const basePlugin = {
  id: "pet-id-card",
  code: "PL-01",
  name: "宠物身份证",
  category: "layout",
  status: "live",
};

async function callGet(url: string) {
  const { GET } = await import("./route");
  const response = await GET(new Request(url));
  return (await response.json()) as { data: Array<Record<string, unknown>> };
}

afterEach(() => {
  vi.resetModules();
  delete process.env.PUBLIC_APP_URL;
  listRuntimePlugins.mockReset();
});

describe("GET /api/plugins", () => {
  it("把站内相对路径的样例图补成绝对地址", async () => {
    process.env.PUBLIC_APP_URL = "https://petbaby.example.com";
    listRuntimePlugins.mockResolvedValue([
      { ...basePlugin, samples: { heroUrl: "/api/plugin-samples/samples/a.jpg", thumbUrls: ["/api/plugin-samples/samples/b.jpg"] } },
    ]);

    const body = await callGet("http://localhost:3000/api/plugins");
    const samples = body.data[0].samples as { heroUrl: string; thumbUrls: string[] };
    expect(samples.heroUrl).toBe("https://petbaby.example.com/api/plugin-samples/samples/a.jpg");
    expect(samples.thumbUrls).toEqual(["https://petbaby.example.com/api/plugin-samples/samples/b.jpg"]);
  });

  it("PUBLIC_APP_URL 末尾多余的斜杠不会拼出双斜杠", async () => {
    process.env.PUBLIC_APP_URL = "https://petbaby.example.com///";
    listRuntimePlugins.mockResolvedValue([{ ...basePlugin, samples: { heroUrl: "/api/plugin-samples/samples/a.jpg" } }]);

    const body = await callGet("http://localhost:3000/api/plugins");
    expect((body.data[0].samples as { heroUrl: string }).heroUrl).toBe("https://petbaby.example.com/api/plugin-samples/samples/a.jpg");
  });

  it("未配置 PUBLIC_APP_URL 时按请求来源推导（本地联调）", async () => {
    listRuntimePlugins.mockResolvedValue([{ ...basePlugin, samples: { heroUrl: "/api/plugin-samples/samples/a.jpg" } }]);

    const body = await callGet("http://192.168.1.9:3000/api/plugins");
    expect((body.data[0].samples as { heroUrl: string }).heroUrl).toBe("http://192.168.1.9:3000/api/plugin-samples/samples/a.jpg");
  });

  it("风格对比图逐条绝对化，且保留 style 键", async () => {
    process.env.PUBLIC_APP_URL = "https://petbaby.example.com";
    listRuntimePlugins.mockResolvedValue([
      {
        ...basePlugin,
        samples: {
          styleUrls: {
            "warm-film": "/api/plugin-samples/samples/style-warm-film.jpg",
            fantasy: "/api/plugin-samples/samples/style-fantasy.jpg",
          },
        },
      },
    ]);

    const body = await callGet("http://localhost:3000/api/plugins");
    expect((body.data[0].samples as { styleUrls: Record<string, string> }).styleUrls).toEqual({
      "warm-film": "https://petbaby.example.com/api/plugin-samples/samples/style-warm-film.jpg",
      fantasy: "https://petbaby.example.com/api/plugin-samples/samples/style-fantasy.jpg",
    });
  });

  it("已是绝对地址的样例图原样透传（CDN 场景）", async () => {
    process.env.PUBLIC_APP_URL = "https://petbaby.example.com";
    listRuntimePlugins.mockResolvedValue([{ ...basePlugin, samples: { heroUrl: "https://cdn.example.com/a.jpg" } }]);

    const body = await callGet("http://localhost:3000/api/plugins");
    expect((body.data[0].samples as { heroUrl: string }).heroUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("没有 samples 的玩法不会被塞进空对象，首屏据此退回文字卡", async () => {
    listRuntimePlugins.mockResolvedValue([{ ...basePlugin }]);

    const body = await callGet("http://localhost:3000/api/plugins");
    expect(body.data[0].samples).toBeUndefined();
  });

  it("只输出 live 状态的玩法", async () => {
    listRuntimePlugins.mockResolvedValue([
      { ...basePlugin, id: "live-one", status: "live" },
      { ...basePlugin, id: "testing-one", status: "testing" },
      { ...basePlugin, id: "archived-one", status: "archived" },
    ]);

    const body = await callGet("http://localhost:3000/api/plugins");
    expect(body.data.map((item) => item.id)).toEqual(["live-one"]);
  });
});
