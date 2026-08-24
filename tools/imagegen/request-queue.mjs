export const LINGSUAN_MAX_CONCURRENCY = 20;

export function normalizeConcurrency(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(LINGSUAN_MAX_CONCURRENCY, Math.floor(parsed));
}

/** 进程内共享 FIFO 队列。调用方只能入队，只有取得槽位后才会真正发起请求。 */
export function createRequestQueue(initialLimit = 1) {
  let limit = normalizeConcurrency(initialLimit);
  let active = 0;
  const pending = [];

  function drain() {
    while (active < limit && pending.length) {
      const item = pending.shift();
      active += 1;
      Promise.resolve()
        .then(item.run)
        .then((value) => {
          active -= 1;
          drain();
          item.resolve(value);
        }, (error) => {
          active -= 1;
          drain();
          item.reject(error);
        });
    }
  }

  return {
    configure(value) {
      limit = normalizeConcurrency(value);
      drain();
      return limit;
    },
    run(run) {
      return new Promise((resolve, reject) => {
        pending.push({ run, resolve, reject });
        drain();
      });
    },
    snapshot() {
      return { active, pending: pending.length, limit };
    }
  };
}
