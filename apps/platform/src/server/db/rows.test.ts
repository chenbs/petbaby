import { describe, expect, it } from "vitest";

import { jsonIdArray, jsonObject, mapTask } from "./rows";

/**
 * 这组测试盯的是一个只在真 PostgreSQL 上暴露的问题：
 * jsonb 列若被驱动交回字符串，`as string[]` 断言不会做任何转换，
 * 值就带着 `["uuid"]` 的形态流到 `id = ANY($1::uuid[])`，
 * PG 报 malformed array literal（它的数组字面量是 `{...}`，不是 `[...]`）。
 *
 * 本地 PGlite 返回的是已解析的数组，所以这条路径在本地永远是绿的 ——
 * 因此这里显式覆盖「字符串形态」，不依赖驱动行为。
 */
describe("jsonIdArray", () => {
  it("数组原样归一为字符串数组", () => {
    expect(jsonIdArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("JSON 字符串形态被解析成数组", () => {
    const raw = '["75df94ad-5593-48cf-9eac-671f278c0854"]';
    expect(jsonIdArray(raw)).toEqual(["75df94ad-5593-48cf-9eac-671f278c0854"]);
  });

  it("空值与非法输入归一为空数组，不抛异常", () => {
    expect(jsonIdArray(null)).toEqual([]);
    expect(jsonIdArray(undefined)).toEqual([]);
    expect(jsonIdArray("")).toEqual([]);
    expect(jsonIdArray("not json")).toEqual([]);
    expect(jsonIdArray('{"a":1}')).toEqual([]);
  });
});

describe("jsonObject", () => {
  it("对象原样返回", () => {
    expect(jsonObject({ a: 1 }, {})).toEqual({ a: 1 });
  });

  it("JSON 字符串形态被解析", () => {
    expect(jsonObject('{"name":"宠物身份证"}', {})).toEqual({ name: "宠物身份证" });
  });

  it("解析不出对象时回落到 fallback", () => {
    // fallback 传 undefined 时要保留「快照缺失」语义，让调用方的取运行时配置分支生效
    expect(jsonObject(null, undefined)).toBeUndefined();
    expect(jsonObject("not json", undefined)).toBeUndefined();
    expect(jsonObject("[1,2]", undefined)).toBeUndefined();
    expect(jsonObject("", {})).toEqual({});
  });
});

describe("mapTask", () => {
  const base = {
    id: "t1", user_id: "u1", plugin_id: "pet-id-card", pet_id: "p1",
    idempotency_key: "k1", status: "queued", progress: 8, attempt: 0,
    created_at: new Date("2026-07-30T00:00:00.000Z"),
    updated_at: new Date("2026-07-30T00:00:00.000Z"),
  };

  it("photo_ids 是字符串时也映射成真数组", () => {
    // 真 PostgreSQL 上出现过这个形态，直接传给 ::uuid[] 会 malformed array literal
    const task = mapTask({ ...base, photo_ids: '["75df94ad-5593-48cf-9eac-671f278c0854"]' });
    expect(Array.isArray(task.photoIds)).toBe(true);
    expect(task.photoIds).toEqual(["75df94ad-5593-48cf-9eac-671f278c0854"]);
  });

  it("plugin_snapshot 是字符串时也映射成对象", () => {
    // 若留成字符串，processTask 里 task.pluginSnapshot 判真、plugin.name 变 undefined
    const task = mapTask({ ...base, photo_ids: ["a"], plugin_snapshot: '{"name":"宠物身份证"}' });
    expect(task.pluginSnapshot).toMatchObject({ name: "宠物身份证" });
  });

  it("photo_ids 已是数组时保持不变", () => {
    const task = mapTask({ ...base, photo_ids: ["a", "b"] });
    expect(task.photoIds).toEqual(["a", "b"]);
  });
});
