import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFfmpegArgs } from "@/server/video/ffmpeg";
import { FADE_SECONDS, maxPhotosFor } from "@/domain/video-duration";

/** 从参数表里取某个 flag 的全部取值，用于断言而不依赖参数顺序 */
function valuesOf(args: string[], flag: string) {
  return args.reduce<string[]>((collected, item, index) => {
    if (item === flag && args[index + 1] !== undefined) collected.push(args[index + 1]);
    return collected;
  }, []);
}

const PHOTOS = (count: number) => Array.from({ length: count }, (_, index) => `/tmp/${index}.jpg`);

afterEach(() => { vi.unstubAllEnvs(); });

describe("buildFfmpegArgs", () => {
  it("成片总时长等于所选档位，与张数无关", () => {
    for (const total of [10, 20, 30]) {
      const { args } = buildFfmpegArgs({ photoFiles: PHOTOS(6), totalSeconds: total, caption: "PETBABY", outputFile: "/tmp/out.mp4" });
      // 输出侧的 -t 是最后一个，前面的属于每张输入。
      expect(valuesOf(args, "-t").at(-1)).toBe(String(total));
    }
  });

  it("单张停留 = 总时长 ÷ 张数，各输入取值一致", () => {
    const { args, perPhotoSeconds } = buildFfmpegArgs({ photoFiles: PHOTOS(8), totalSeconds: 20, caption: "x", outputFile: "/tmp/out.mp4" });
    expect(perPhotoSeconds).toBeCloseTo(2.5, 10);
    const inputDurations = valuesOf(args, "-t").slice(0, -1);
    expect(inputDurations).toHaveLength(8);
    expect(new Set(inputDurations)).toEqual(new Set(["2.500"]));
  });

  /**
   * 附录 A 的缺陷 ①：`fade=...:d=.45` 让 ffmpeg 6+ 拒绝解析，线上渲染 100% 失败。
   * 这条断言把「不得出现无前导零的时长」钉住 —— 除不尽的档位（30 ÷ 7）最容易复发。
   */
  it("所有时长参数都带前导零，不出现 .45 这种写法", () => {
    for (const [total, count] of [[10, 3], [20, 7], [30, 7], [30, 20]] as const) {
      const { args } = buildFfmpegArgs({ photoFiles: PHOTOS(count), totalSeconds: total, caption: "x", outputFile: "/tmp/out.mp4" });
      const joined = args.join(" ");
      expect(joined).not.toMatch(/[=:\s]\.\d/);
    }
  });

  /** 附录 A 的缺陷 ②：单张停留短于两段 fade 时画面大半在黑场 */
  it("任一档取满张数时，单张停留仍高于两段 fade 之和", () => {
    for (const total of [10, 20, 30]) {
      const { perPhotoSeconds } = buildFfmpegArgs({ photoFiles: PHOTOS(maxPhotosFor(total)), totalSeconds: total, caption: "x", outputFile: "/tmp/out.mp4" });
      expect(perPhotoSeconds).toBeGreaterThan(FADE_SECONDS * 2);
    }
  });

  it("fade 淡出起点不为负（单张停留短于一段 fade 的极端情况）", () => {
    const { args } = buildFfmpegArgs({ photoFiles: PHOTOS(20), totalSeconds: 10, caption: "x", outputFile: "/tmp/out.mp4" });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).not.toMatch(/st=-/);
  });

  it("非法档位归一到缺省 20 秒，而不是产出 0 秒或 NaN 的片子", () => {
    const { args, totalSeconds } = buildFfmpegArgs({ photoFiles: PHOTOS(4), totalSeconds: 17, caption: "x", outputFile: "/tmp/out.mp4" });
    expect(totalSeconds).toBe(20);
    expect(args.join(" ")).not.toContain("NaN");
  });

  it("没有照片时用纯色兜底，时长仍是所选档位", () => {
    const { args } = buildFfmpegArgs({ photoFiles: [], totalSeconds: 30, caption: "x", outputFile: "/tmp/out.mp4" });
    expect(args.join(" ")).toContain("color=c=#14251c:s=720x1280:d=30");
    expect(valuesOf(args, "-t").at(-1)).toBe("30");
  });

  it("bgm 的正弦时长跟随所选档位，none 时不加音轨", () => {
    const withBgm = buildFfmpegArgs({ photoFiles: PHOTOS(3), totalSeconds: 10, caption: "x", bgm: "bright", outputFile: "/tmp/out.mp4" });
    expect(withBgm.args.join(" ")).toContain("sine=frequency=523:sample_rate=44100:duration=10");
    expect(withBgm.args).toContain("-c:a");
    const silent = buildFfmpegArgs({ photoFiles: PHOTOS(3), totalSeconds: 10, caption: "x", bgm: "none", outputFile: "/tmp/out.mp4" });
    expect(silent.args.join(" ")).not.toContain("sine=");
    expect(silent.args).not.toContain("-c:a");
  });

  /**
   * 附录 A 的缺陷 ③：alpine 镜像不含中文字体，drawtext 不指定 fontfile 时
   * 中文静默丢失且退出码仍为 0。字体路径里的 ":"（Windows 盘符）必须转义。
   */
  it("配了 FFMPEG_FONT_FILE 时写进 drawtext，盘符冒号被转义", () => {
    vi.stubEnv("FFMPEG_FONT_FILE", "C:/fonts/noto.ttc");
    const { args } = buildFfmpegArgs({ photoFiles: PHOTOS(2), totalSeconds: 10, caption: "陪伴", outputFile: "/tmp/out.mp4" });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fontfile='C\\:/fonts/noto.ttc'");
  });

  it("每张照片各出一个输入，帧序与传入顺序一致", () => {
    const { args } = buildFfmpegArgs({ photoFiles: ["/tmp/a.jpg", "/tmp/b.jpg", "/tmp/c.jpg"], totalSeconds: 10, caption: "x", outputFile: "/tmp/out.mp4" });
    expect(valuesOf(args, "-i")).toEqual(["/tmp/a.jpg", "/tmp/b.jpg", "/tmp/c.jpg"]);
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=3:v=1:a=0");
  });
});
