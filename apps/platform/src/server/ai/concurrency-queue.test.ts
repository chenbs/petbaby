import { describe, expect, it } from "vitest";

import {
  ConcurrencyQueue,
  LINGSUAN_MAX_CONCURRENCY,
  normalizeConcurrency,
} from "@/server/ai/concurrency-queue";

describe("ConcurrencyQueue", () => {
  it("将配置硬限制在 1 到 20", () => {
    expect(normalizeConcurrency(undefined)).toBe(1);
    expect(normalizeConcurrency("0")).toBe(1);
    expect(normalizeConcurrency("2")).toBe(2);
    expect(normalizeConcurrency("99")).toBe(LINGSUAN_MAX_CONCURRENCY);
  });

  it("最多同时运行二十个任务并按 FIFO 启动", async () => {
    const queue = new ConcurrencyQueue(normalizeConcurrency(99));
    const started: number[] = [];
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;

    const tasks = Array.from({ length: 25 }, (_, index) => queue.run(async () => {
      started.push(index);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return index;
    }));

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(started).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(queue.snapshot()).toEqual({ active: 20, pending: 5, limit: 20 });

    while (releases.length) {
      releases.shift()?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await expect(Promise.all(tasks)).resolves.toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(started).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(peak).toBe(20);
  });

  it("任务失败后释放槽位", async () => {
    const queue = new ConcurrencyQueue(1);
    const failed = queue.run(async () => { throw new Error("expected"); });
    const continued = queue.run(async () => "continued");

    await expect(failed).rejects.toThrow("expected");
    await expect(continued).resolves.toBe("continued");
    expect(queue.snapshot()).toEqual({ active: 0, pending: 0, limit: 1 });
  });
});
