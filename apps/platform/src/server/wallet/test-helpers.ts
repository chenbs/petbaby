import { credit } from "./service";

/**
 * 测试用：给用户充一笔购买所得的冻干（长期有效）。只在测试里调用。
 *
 * 2026-10-08 起所有付费任务先扣冻干再执行，测试要先给余额，否则一律 402 WALLET_INSUFFICIENT。
 */
export async function fundWallet(userId: string, units = 500) {
  return credit(userId, { pocket: "purchased", source: "topup", units, bizKey: `test:fund:${userId}:${crypto.randomUUID()}`, title: "测试充值" });
}
