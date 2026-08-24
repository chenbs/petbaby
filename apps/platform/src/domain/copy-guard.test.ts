import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COPY_GUARD_CATEGORIES,
  assertCopySafe,
  findCopyViolations,
  isCopySafe,
} from "@/domain/copy-guard";

/*
 * 文案门禁的扫描器本身（22 号文 9.2 门禁 11–14 的实现层）。
 *
 * 对抗性用例在 `server/island/diary-adversarial.test.ts` —— 那边测「各种绕法能不能
 * 穿过过滤」，这里测扫描器的行为本身：报全部而不是首个、正则不带状态、
 * 定位片段可用、以及**词表只有一份**这条结构性要求。
 */

describe("扫描器行为", () => {
  it("报告全部违例而不是首个 —— 门禁的价值在于一次说清所有问题", () => {
    const violations = findCopyViolations("它有点偏胖，需要确诊一下，每天喂 20 克");
    const categories = new Set(violations.map((item) => item.category));
    expect(categories.has("judgement")).toBe(true);
    expect(categories.has("clinical")).toBe(true);
    expect(categories.has("feeding")).toBe(true);
  });

  /** 定位片段要能在长文案里找到是哪一处 */
  it("给出原文片段", () => {
    const violations = findCopyViolations("天刚亮，小岛上没什么风。它今天看起来很健康。");
    expect(violations[0].excerpt).toContain("健康");
    expect(violations[0].excerpt.length).toBeGreaterThan("健康".length);
  });

  /*
   * 正则每次新建：带 `g` 的共享实例会因 `lastIndex` 残留而在第二次调用时漏匹配。
   * 这是最容易写出来的那个 bug，且症状是「同一段文案第一次拦住、第二次放过」。
   */
  it("同一段文案连续扫两次结果相同", () => {
    const text = "每天喂 20 克";
    const first = findCopyViolations(text);
    const second = findCopyViolations(text);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it("空输入不算违例", () => {
    expect(findCopyViolations("")).toEqual([]);
    expect(findCopyViolations(undefined as never)).toEqual([]);
    expect(isCopySafe("")).toBe(true);
  });

  /** 只查子集是给「这段本来就在谈体重变化」留的口子，但岛的文案一律全查 */
  it("可以只查指定类别", () => {
    const text = "体力耗尽了";
    expect(findCopyViolations(text, ["judgement"])).toEqual([]);
    expect(findCopyViolations(text, ["gamified"]).length).toBeGreaterThan(0);
  });

  it("断言在干净文案上不抛，在违例上带出定位标签", () => {
    expect(() => assertCopySafe("它把头顶过来", "test")).not.toThrow();
    expect(() => assertCopySafe("体力耗尽了", "island action pet")).toThrow(/island action pet/);
    expect(() => assertCopySafe("体力耗尽了", "x")).toThrow(/体力/);
  });
});

describe("词表只有一份（结构性要求）", () => {
  /*
   * 22 号文 9.2 #11 明确：「复用 `domain/weight-trend.ts` 已有的评价词清单，
   * **不新造一份**（两份必然漂移）」。而漂移的表现是「一边拦住了、另一边放过去了」，
   * 且没人会发现哪边是对的。
   *
   * 这一条从**文件层面**钉住：小程序的 `validate.js` 按相对路径读同一个 JSON，
   * 所以那个路径不能变。它是 CommonJS 的 node 脚本、require 不了 TypeScript，
   * 这也是词表用 JSON 而不是 `.ts` 的唯一理由。
   */
  it("JSON 在 domain/copy-guard.json，小程序按相对路径读同一份", () => {
    const jsonPath = path.join(process.cwd(), "src", "domain", "copy-guard.json");
    const guard = JSON.parse(readFileSync(jsonPath, "utf8"));
    for (const category of COPY_GUARD_CATEGORIES) {
      expect(guard[category], `copy-guard.json 缺 ${category} 段`).toBeTruthy();
      expect(Array.isArray(guard[category].words)).toBe(true);
      expect(guard[category].words.length).toBeGreaterThan(0);
    }
  });

  /*
   * 小程序侧真的读到了这一份，而不是自己抄了一份。
   * 路径写死在这里 —— 换了目录结构这条会先失败，而那正是要拦的：
   * 悄悄挪走会让 `validate.js` 读不到文件，而它读不到时若不报错就等于门禁静默失效。
   */
  it("小程序的 validate.js 引用的是同一个文件", () => {
    const validatePath = path.join(process.cwd(), "..", "miniprogram", "scripts", "validate.js");
    const source = readFileSync(validatePath, "utf8");
    expect(source, "validate.js 没有读 copy-guard.json —— 岛的端上文案就没有门禁了").toContain("copy-guard.json");
    // 相对路径必须指向 apps/platform 那一份，不能是小程序目录下的副本
    expect(source).toMatch(/apps[\\/]?.{0,2}platform|\.\.[\\/]\.\.[\\/]platform|platform.{0,40}copy-guard\.json/);
  });

  /** 没有第二份 JSON。搜到两个文件说明有人复制了一份 */
  it("仓库里没有第二份词表文件", () => {
    const miniprogramCopy = path.join(process.cwd(), "..", "miniprogram", "copy-guard.json");
    expect(() => readFileSync(miniprogramCopy, "utf8")).toThrow();
  });
});
