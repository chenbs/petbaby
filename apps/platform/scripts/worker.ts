import { runNextTask } from "../src/server/worker/generation-worker";
import { closeExpiredOrders, cleanupExpiredContent, healthSnapshot, sendOperationalAlert } from "../src/server/maintenance";
import { processDueMessages } from "../src/server/messaging/worker";
import { processNextVideo } from "../src/server/video/ffmpeg";
import { expirePastDueMemberships, processNextAiRun, resetMembershipQuotas, scheduleAllUpcomingReminders } from "../src/server/growth-service";
import { runHealthReminders } from "../src/server/health/reminders";
import { scheduleAllOnThisDay } from "../src/server/timeline-service";

const interval = Number(process.env.WORKER_POLL_INTERVAL_MS || 1_000);

/**
 * 「去年今日」按天扫，不进 60 秒的运维轮次。
 *
 * `scheduleAllOnThisDay` 会遍历全部用户、每人一次命中查询，一分钟跑一遍纯属浪费 ——
 * 它一天最多产出一条订阅消息（函数内部按天去重）。
 */
const ON_THIS_DAY_INTERVAL_MS = 3_600_000;

/**
 * 健康提示（L5）同样按小时扫，不进 60 秒的运维轮次。
 *
 * 它判断的是「疫苗到期日」「体重变化」「季度体检」—— 全是**天级**事实，
 * 一分钟跑一遍纯属浪费；而 `health_reminders` 的唯一约束保证了重复调用
 * 不会推出多条，所以间隔只影响成本不影响正确性。
 *
 * 不与「去年今日」共用一个计时器：那条每天最多产出一条订阅消息，
 * 而这条要遍历疫苗记录与体重记录，两者的成本量级不同，
 * 将来要单独调频时共用计时器会绑死。
 */
const HEALTH_REMINDER_INTERVAL_MS = 3_600_000;

async function loop() {
  let maintenanceAt = 0;
  let onThisDayAt = 0;
  let healthReminderAt = 0;
  for (;;) {
    const [generation, video, ai] = await Promise.all([runNextTask(), processNextVideo(), processNextAiRun()]);
    if (Date.now() - maintenanceAt > 60_000) {
      maintenanceAt = Date.now();
      const [health] = await Promise.all([healthSnapshot(), closeExpiredOrders(), cleanupExpiredContent(), processDueMessages(), resetMembershipQuotas(), expirePastDueMemberships(), scheduleAllUpcomingReminders()]);
      if (health.status !== "ok" || health.queued > 100) await sendOperationalAlert("Petbaby worker degraded", health);
    }
    if (Date.now() - onThisDayAt > ON_THIS_DAY_INTERVAL_MS) {
      onThisDayAt = Date.now();
      await scheduleAllOnThisDay();
    }
    if (Date.now() - healthReminderAt > HEALTH_REMINDER_INTERVAL_MS) {
      healthReminderAt = Date.now();
      await runHealthReminders();
    }
    if (!generation && !video && !ai) await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

loop().catch((error) => {
  console.error("Generation worker stopped", error);
  process.exitCode = 1;
});
