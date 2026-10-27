import { afterEach, describe, expect, it, vi } from "vitest";

import { maxPhotosFor } from "@/domain/video-duration";
import { buildStoryFilmArgs, melodyExpression, planStoryFilm } from "@/server/video/story-film";

const SHOTS = (count: number) => Array.from({ length: count }, (_, index) => ({ file: `/tmp/${index}.jpg`, day: 10 + index, date: `2026-01-0${(index % 9) + 1}`, caption: index % 2 ? "第一次下楼梯" : undefined }));
const base = { title: "年糕的秋天", petName: "年糕", companionDays: 386, endCaption: "谢谢你", outputFile: "/tmp/out.mp4" };

function filterOf(args: string[]) {
  return args[args.indexOf("-filter_complex") + 1];
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("记忆短片 v2", () => {
  it("片头 + 每张 + 片尾 − 转场重叠 = 所选总时长；输出 -t 等于档位", () => {
    for (const total of [10, 20, 30]) {
      for (const count of [1, 3, maxPhotosFor(total)]) {
        const { args, plan, renderedSeconds } = buildStoryFilmArgs({ ...base, shots: SHOTS(count), totalSeconds: total });
        expect(renderedSeconds).toBeCloseTo(total, 6);
        expect(args[args.lastIndexOf("-t") + 1]).toBe(String(total));
        // 每张至少完整露出约半秒：单张时长减去两侧转场仍为正
        expect(plan.perShot - 2 * plan.transition).toBeGreaterThan(0.45);
      }
    }
  });

  it("不用 zoompan，所有时长参数带前导零", () => {
    const { args } = buildStoryFilmArgs({ ...base, shots: SHOTS(8), totalSeconds: 20, bgm: "bright" });
    const joined = args.join(" ");
    expect(joined).not.toContain("zoompan");
    expect(joined).not.toMatch(/[=:,\s(]\.\d/);
    expect(joined).not.toContain("NaN");
  });

  it("每张照片带平移、计数、第 N 天与照片说明；转场用 xfade 串起全部段落", () => {
    const { args, segmentCount } = buildStoryFilmArgs({ ...base, shots: SHOTS(4), totalSeconds: 20 });
    const filter = filterOf(args);
    expect(segmentCount).toBe(6);
    expect(filter.match(/xfade=/g)).toHaveLength(5);
    expect(filter).toContain("crop=720:1280:x=");
    expect(filter).toContain("01 / 04");
    expect(filter).toContain("第 10 天");
    expect(filter).toContain("第一次下楼梯");
    expect(filter).toContain("今日份可爱");
    expect(filter).toContain("4 张照片");
  });

  it("纪念语气：只用淡化转场、不贴趣味贴纸，天数用过去式", () => {
    const { args } = buildStoryFilmArgs({ ...base, memorial: true, shots: SHOTS(3), totalSeconds: 20 });
    const filter = filterOf(args);
    expect(filter.match(/xfade=transition=(\w+)/g)?.every((item) => item.endsWith("fade"))).toBe(true);
    expect(filter).not.toContain("今日份可爱");
    expect(filter).toContain("天的陪伴");
    expect(filter).toContain("陪伴了 386 天");
  });

  it("配乐是合成旋律而不是单音正弦；不选音乐时没有音轨", () => {
    const withMusic = buildStoryFilmArgs({ ...base, shots: SHOTS(3), totalSeconds: 10, bgm: "calm" });
    expect(withMusic.args.join(" ")).toContain("aevalsrc=");
    expect(withMusic.args).toContain("-c:a");
    expect(melodyExpression("bright")).not.toBe(melodyExpression("calm"));
    const silent = buildStoryFilmArgs({ ...base, shots: SHOTS(3), totalSeconds: 10, bgm: "none" });
    expect(silent.args.join(" ")).not.toContain("aevalsrc");
    expect(silent.args).not.toContain("-c:a");
  });

  it("用户文字里的特殊字符不会打断 filtergraph", () => {
    const { args } = buildStoryFilmArgs({ ...base, title: "年糕's 50% day: \\x", endCaption: "a:b'c%d", shots: [{ file: "/tmp/a.jpg", caption: "it's 100%" }], totalSeconds: 10 });
    const texts = filterOf(args).match(/text='[^']*'/g) || [];
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((item) => !/[%\\]/.test(item.slice(6, -1)) || item.includes("%{eif"))).toBe(true);
  });

  it("没有照片时仍是片头 + 片尾，时长等于档位", () => {
    const plan = planStoryFilm({ totalSeconds: 10, shotCount: 0 });
    expect(plan.opening + plan.closing - plan.transition).toBeCloseTo(10, 6);
    const { renderedSeconds } = buildStoryFilmArgs({ ...base, shots: [], totalSeconds: 10 });
    expect(renderedSeconds).toBeCloseTo(10, 6);
  });

  it("配了 FFMPEG_FONT_FILE 时每段文字都带字体，盘符冒号被转义", () => {
    vi.stubEnv("FFMPEG_FONT_FILE", "C:/fonts/noto.ttc");
    const filter = filterOf(buildStoryFilmArgs({ ...base, shots: SHOTS(2), totalSeconds: 10 }).args);
    expect(filter).toContain("fontfile='C\\:/fonts/noto.ttc'");
    expect(filter.split("drawtext=").slice(1).every((item) => item.startsWith("fontfile="))).toBe(true);
  });
});
