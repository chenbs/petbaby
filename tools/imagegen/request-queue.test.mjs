import assert from "node:assert/strict";
import test from "node:test";

import {
  LINGSUAN_MAX_CONCURRENCY,
  createRequestQueue,
  normalizeConcurrency
} from "./request-queue.mjs";

test("并发配置默认串行且硬限制为 20", () => {
  assert.equal(normalizeConcurrency(undefined), 1);
  assert.equal(normalizeConcurrency("0"), 1);
  assert.equal(normalizeConcurrency("2"), 2);
  assert.equal(normalizeConcurrency("99"), LINGSUAN_MAX_CONCURRENCY);
});

test("共享队列最多同时运行 20 个任务，并保持 FIFO 启动顺序", async () => {
  const queue = createRequestQueue(99);
  const started = [];
  const releases = [];
  let active = 0;
  let peak = 0;

  const tasks = Array.from({ length: 25 }, (_, index) => queue.run(async () => {
    started.push(index);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return index;
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, Array.from({ length: 20 }, (_, index) => index));
  assert.equal(queue.snapshot().active, 20);
  assert.equal(queue.snapshot().pending, 5);

  while (releases.length) {
    releases.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(await Promise.all(tasks), Array.from({ length: 25 }, (_, index) => index));
  assert.deepEqual(started, Array.from({ length: 25 }, (_, index) => index));
  assert.equal(peak, 20);
});

test("失败任务释放槽位，后续任务仍可继续", async () => {
  const queue = createRequestQueue(1);
  const first = queue.run(async () => { throw new Error("expected"); });
  const second = queue.run(async () => "continued");

  await assert.rejects(first, /expected/);
  assert.equal(await second, "continued");
  assert.deepEqual(queue.snapshot(), { active: 0, pending: 0, limit: 1 });
});
