import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNarrativeArgs, escapeDrawtext, planSegments, type NarrativeInput } from "@/server/video/narrative";
import { FADE_SECONDS } from "@/domain/video-duration";

afterEach(() => { vi.unstubAllEnvs(); });

const SHOTS = (count: number) => Array.from({ length: count }, (_, index) => ({
  file: `/tmp/${index}.jpg`,
  day: 10 + index * 30,
  date: `2025-0${(index % 9) + 1}-15`,
}));

const COMPARE = { earliestFile: "/tmp/a.jpg", latestFile: "/tmp/b.jpg", earliestDay: 10, latestDay: 360, gapDays: 350 };

function input(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    petName: "年糕",
    companionDays: 743,
    shots: SHOTS(6),
    compare: COMPARE,
    counts: { photos: 128, works: 9, interactions: 42 },
    year: 2025,
    totalSeconds: 20,
    outputFile: "/tmp/out.mp4",
    ...overrides,
  };
}

function filterOf(args: string[]) {
  return args[args.indexOf("-filter_complex") + 1];
}

describe("planSegments", () => {
  it("四段之和等于总时长", () => {
    for (const total of [10, 20, 30]) {
      const plan = planSegments({ totalSeconds: total, shotCount: 6, hasCompare: true });
      expect(plan.opening + plan.timeline + plan.compare + plan.closing).toBeCloseTo(total, 6);
    }
  });

  /**
   * 时间不够时砍可选段，而不是把每段压到看不清 ——
   * 一段 0.3 秒的数据卡等于没有。对比段先砍：它是四段里唯一
   * 能用一张静图替代表达的。
   */
  it("时间不够时先砍对比段，不把每段压成一闪而过", () => {
    const plan = planSegments({ totalSeconds: 10, shotCount: 10, hasCompare: true });
    expect(plan.compare).toBe(0);
    expect(plan.opening).toBeGreaterThanOrEqual(1.2);
    expect(plan.closing).toBeGreaterThanOrEqual(1.2);
  });

  it("没有对比素材时该段为 0，时间给回时间线", () => {
    const withCompare = planSegments({ totalSeconds: 30, shotCount: 6, hasCompare: true });
    const without = planSegments({ totalSeconds: 30, shotCount: 6, hasCompare: false });
    expect(without.compare).toBe(0);
    expect(without.timeline).toBeGreaterThan(withCompare.timeline);
  });

  it("非法总时长归一到 20 秒", () => {
    expect(planSegments({ totalSeconds: 17, shotCount: 4, hasCompare: false }).total).toBe(20);
  });
});

describe("buildNarrativeArgs", () => {
  /**
   * ## 这条是 zoompan 帧数陷阱的守卫
   *
   * `zoompan` 对每个输入帧都输出 `d` 帧，用 `-loop 1 -t 2.4`（72 帧）喂它会
   * 输出 72×72 帧 —— 实测把 26 秒撑成 3 分 16 秒。本实现刻意不用 zoompan；
   * 这条断言保证将来有人加进来时，总时长的约束会立刻报警。
   */
  it("输出侧 -t 等于所选总时长，且不使用 zoompan", () => {
    for (const total of [10, 20, 30]) {
      const { args, plan } = buildNarrativeArgs(input({ totalSeconds: total }));
      expect(args.at(-2)).not.toBe("-t");
      expect(args[args.length - 1]).toBe("/tmp/out.mp4");
      const outputDuration = args[args.lastIndexOf("-t") + 1];
      expect(Number(outputDuration)).toBeCloseTo(total, 3);
      expect(plan.total).toBe(total);
      expect(filterOf(args)).not.toContain("zoompan");
    }
  });

  it("四段齐全：计数开场 + 时间线 + 对比 + 数据卡", () => {
    const { args, segmentCount } = buildNarrativeArgs(input({ totalSeconds: 30 }));
    const filter = filterOf(args);
    // 开场的计数动画
    expect(filter).toContain("%{eif");
    // 时间线的「第 N 天」与真实日期
    expect(filter).toContain("第 10 天");
    expect(filter).toContain("2025-01-15");
    // 对比段的 vstack
    expect(filter).toContain("vstack=inputs=2");
    expect(filter).toContain("这中间过了 350 天");
    // 数据卡的真实计数
    expect(filter).toContain("128 张照片");
    expect(filter).toContain("9 件作品");
    expect(filter).toContain("42 次互动");
    // 1 开场 + 6 时间线 + 1 对比 + 1 数据卡
    expect(segmentCount).toBe(9);
    expect(filter).toContain(`concat=n=${segmentCount}:v=1:a=0`);
  });

  /** 验收标准：照片不足（只有 1 张）时降级为单段，不崩 */
  it("只有一张照片时不崩，段数降级", () => {
    const { args, segmentCount } = buildNarrativeArgs(input({ shots: SHOTS(1), compare: undefined, totalSeconds: 10 }));
    // 1 开场 + 1 时间线 + 1 数据卡
    expect(segmentCount).toBe(3);
    expect(filterOf(args)).not.toContain("vstack");
    expect(Number(args[args.lastIndexOf("-t") + 1])).toBeCloseTo(10, 3);
  });

  it("没有照片时仍产出合法参数（调用方负责先拦住）", () => {
    const { args, segmentCount } = buildNarrativeArgs(input({ shots: [], compare: undefined }));
    expect(segmentCount).toBe(2);
    expect(args.join(" ")).not.toContain("NaN");
  });

  /** 附录 A 缺陷 ①：无前导零的时长会让 ffmpeg 6+ 拒绝解析，整条渲染失败 */
  it("所有时长参数带前导零，不出现 .45 这类写法", () => {
    for (const [total, count] of [[10, 3], [20, 7], [30, 11]] as const) {
      const { args } = buildNarrativeArgs(input({ totalSeconds: total, shots: SHOTS(count) }));
      expect(args.join(" ")).not.toMatch(/[=:\s]\.\d/);
    }
  });

  it("fade 淡出起点不为负", () => {
    const filter = filterOf(buildNarrativeArgs(input({ totalSeconds: 10, shots: SHOTS(9), compare: undefined })).args);
    expect(filter).not.toMatch(/st=-/);
    expect(filter).toContain(`d=${FADE_SECONDS.toFixed(2)}`);
  });

  /** 计数动画必须夹住上界：t 超过区间后表达式仍在求值，不夹会涨过目标值 */
  it("计数动画夹在 [0, 陪伴天数] 之间", () => {
    const filter = filterOf(buildNarrativeArgs(input({ companionDays: 743 })).args);
    expect(filter).toContain("min(743");
    expect(filter).toContain("max(0");
  });

  /** 纪念语气：过去式，不出现仍在继续的说法 */
  it("纪念场景用过去式文案", () => {
    const normal = filterOf(buildNarrativeArgs(input()).args);
    const memorial = filterOf(buildNarrativeArgs(input({ memorial: true })).args);
    expect(normal).toContain("陪伴第 743 天");
    expect(memorial).toContain("陪伴了 743 天");
    expect(memorial).not.toContain("一起过来的");
  });

  /** 附录 A 缺陷 ③：alpine 不含中文字体，缺 fontfile 时中文静默丢失且退出码为 0 */
  it("配了 FFMPEG_FONT_FILE 时每个 drawtext 都带上，盘符冒号转义", () => {
    vi.stubEnv("FFMPEG_FONT_FILE", "C:/fonts/noto.ttc");
    const filter = filterOf(buildNarrativeArgs(input()).args);
    const drawtextCount = (filter.match(/drawtext=/g) || []).length;
    const fontCount = (filter.match(/fontfile='C\\:\/fonts\/noto\.ttc'/g) || []).length;
    expect(drawtextCount).toBeGreaterThan(5);
    expect(fontCount).toBe(drawtextCount);
  });

  it("每张照片一个输入，顺序与传入一致", () => {
    const { args } = buildNarrativeArgs(input({ shots: SHOTS(3), compare: undefined }));
    const files = args.reduce<string[]>((collected, item, index) => {
      if (item === "-i" && args[index + 1]?.endsWith(".jpg")) collected.push(args[index + 1]);
      return collected;
    }, []);
    expect(files).toEqual(["/tmp/0.jpg", "/tmp/1.jpg", "/tmp/2.jpg"]);
  });
});

describe("escapeDrawtext", () => {
  /**
   * filtergraph 里 `:` 是分隔符、`'` 会提前闭合引号、`\` 是转义引导符、
   * `%` 是 drawtext 的 strftime 格式符。漏掉任何一个会让整条 filtergraph
   * 解析失败，或更糟：静默画出错误内容。
   */
  it("危险字符被剔除，不会破坏 filtergraph", () => {
    expect(escapeDrawtext("a:b")).toBe("a b");
    expect(escapeDrawtext("it's")).toBe("its");
    expect(escapeDrawtext("50%")).toBe("50 ");
    expect(escapeDrawtext("a\\b")).toBe("ab");
    expect(escapeDrawtext("line1\nline2")).toBe("line1 line2");
  });

  it("超长文本被截断，不撑破画面", () => {
    expect(escapeDrawtext("x".repeat(200))).toHaveLength(60);
  });
});
