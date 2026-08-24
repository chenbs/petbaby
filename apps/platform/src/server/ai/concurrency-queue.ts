export const LINGSUAN_MAX_CONCURRENCY = 20;

export function normalizeConcurrency(value: string | number | undefined, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(LINGSUAN_MAX_CONCURRENCY, Math.floor(parsed));
}

/** 进程内共享 FIFO 队列。任务只有取得槽位后才会真正发起供应商请求。 */
export class ConcurrencyQueue {
  private active = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push(() => {
        void Promise.resolve()
          .then(task)
          .then((value) => {
            this.active -= 1;
            this.drain();
            resolve(value);
          }, (error: unknown) => {
            this.active -= 1;
            this.drain();
            reject(error);
          });
      });
      this.drain();
    });
  }

  snapshot() {
    return { active: this.active, pending: this.pending.length, limit: this.limit };
  }

  private drain() {
    while (this.active < this.limit && this.pending.length) {
      const start = this.pending.shift();
      if (!start) return;
      this.active += 1;
      start();
    }
  }
}
