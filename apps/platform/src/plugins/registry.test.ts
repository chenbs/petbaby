import { describe, expect, it } from "vitest";

import { plugins } from "@/plugins/registry";
import { AI_STYLE_IDS } from "@/server/growth-service";
import { generatorRegistry } from "@/server/generators/svg";

/**
 * 样例图的键与枚举必须对齐。这类错配不会抛异常：
 * 端上按 id 取图，取不到就退回纯文字选项 —— 线上表现是「缩略图不见了」，
 * 没有任何日志或报错指向原因，所以钉在测试里。
 */
describe("玩法样例图与枚举对齐", () => {
  const aiPortrait = plugins.find((plugin) => plugin.code === "PL-10");

  it("PL-10 的 styleUrls 恰好覆盖 style 枚举，不多不少", () => {
    const styleUrls = aiPortrait?.samples?.styleUrls;
    expect(styleUrls, "PL-10 应配齐风格对比图").toBeDefined();
    expect(Object.keys(styleUrls ?? {}).sort()).toEqual([...AI_STYLE_IDS].sort());
  });

  /**
   * 每个 manifest 的 `generator.template` 都必须在 generatorRegistry 里有实现，
   * 否则任务入队后在 Worker 里才失败 —— 用户先看到「生成中」再看到失败，
   * 而失败原因（拼错的模板名）只在服务端日志里。
   *
   * 只管 html-template：ffmpeg / h5-theme / image-api / report 走各自的链路，
   * 不经过 generatorRegistry。
   */
  it("html-template 类玩法的 template 都在 generatorRegistry 里", () => {
    const templates = Object.keys(generatorRegistry);
    for (const plugin of plugins) {
      if (plugin.generator.type !== "html-template") continue;
      /*
       * archived 的老玩法不查：它们只用于解析历史作品的展示信息，
       * 不会再入队（createGeneration 要求 status==='live'）。
       * PL-20 的 memorial-album-v1 走 memorial-service 的专用出册路径，
       * 本来就不经过 generatorRegistry。
       */
      if (plugin.status === "archived") continue;
      expect(templates, `${plugin.code} 的 template 未注册：${plugin.generator.template}`).toContain(plugin.generator.template);
    }
  });

  /*
   * 玩法合并后的结构断言（改造方案 C4 / D3–D5）。
   *
   * 三组「同一能力两次换皮」已合并成 toneVariants：
   * 画册（PL-03 + 原 PL-20）、短片（PL-19 + 原 PL-21）、互动页（PL-15 + 原 PL-22）。
   */
  /*
   * 老的纪念类 manifest 保留为 archived 而**不是删除**。
   *
   * `works` 表没有 `plugin_snapshot` 列（只有 generation_tasks 与 orders 有），
   * `hydrateWork` 一律 `getRuntimePlugin(work.pluginId)` 现查 —— 删条目会让
   * 历史纪念册/纪念视频/纪念页作品抛 WORK_INCOMPLETE，打不开也删不掉。
   *
   * archived 同时满足：新用户看不到（/api/plugins 只输出 live）、老作品读得出。
   */
  it("老纪念类玩法保留为 archived 供历史作品读取", () => {
    for (const legacy of ["pl-20", "pl-21", "pl-22"]) {
      const plugin = plugins.find((item) => item.id === legacy);
      expect(plugin, `${legacy} 不能删除，历史作品要靠它解析`).toBeTruthy();
      expect(plugin?.status, `${legacy} 应为 archived`).toBe("archived");
    }
  });

  it("live 玩法恰好 7 个", () => {
    expect(plugins.filter((plugin) => plugin.status === "live")).toHaveLength(7);
  });

  it("画册、短片、互动页都带 memorial 调性", () => {
    for (const id of ["pet-time-album", "pl-19", "pl-15"]) {
      const plugin = plugins.find((item) => item.id === id);
      expect(plugin?.toneVariants?.memorial?.name, `${id} 缺 memorial 调性`).toBeTruthy();
    }
  });

  /*
   * 免费玩法必须真的免费。unlockPrice=0 时作品以 locked=false 入库、
   * createOrder 直接拒绝 —— 这里把「哪些是免费的」钉住，
   * 避免有人顺手给钩子层玩法加个价，导致端上又出现 0 元订单流程。
   */
  it("钩子层玩法保持免费", () => {
    for (const id of ["pet-id-card", "pl-15", "pl-23"]) {
      const plugin = plugins.find((item) => item.id === id);
      expect(plugin?.pricing.unlockPrice, `${id} 应免费`).toBe(0);
    }
  });

  /** 一张照片比不出变化，放行 1 张会让用户拿到一张左右一样的图 */
  it("成长对比图要求恰好两张照片", () => {
    const compare = plugins.find((plugin) => plugin.generator.template === "growth-compare-v1");
    expect(compare?.input.photos).toEqual({ min: 2, max: 2 });
    // 属「积累」层，免费带水印作分享钩子。
    expect(compare?.pricing.unlockPrice).toBe(0);
  });

  it("所有样例图路径都指向 /api/plugin-samples/", () => {
    for (const plugin of plugins) {
      const samples = plugin.samples;
      if (!samples) continue;
      const urls = [
        ...(samples.heroUrl ? [samples.heroUrl] : []),
        ...(samples.thumbUrls ?? []),
        ...Object.values(samples.styleUrls ?? {}),
      ];
      for (const url of urls) {
        // 相对路径由 /api/plugins 出口按 PUBLIC_APP_URL 补域名；
        // 这里若混进绝对地址，等于把某个环境的域名焊死进 registry
        expect(url, `${plugin.code} 的样例图路径异常：${url}`).toMatch(/^\/api\/plugin-samples\//);
      }
    }
  });
});
