import "server-only";

import { getDatabase, inTransaction, type Database, type SqlRow } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { DONGAN_NAME, DONGAN_UNIT } from "@/domain/dongan-pricing";

/*
 * 冻干钱包（docs/product/36-冻干钱包与会员下线实施方案.md 第 3 章）。
 *
 * - wallet_accounts：每个用户一行，扣减时 FOR UPDATE 锁住它，余额不能为负。
 * - wallet_lots：每一批入账。购买所得长期有效；赠送所得有到期日。
 * - wallet_ledger：每一次变动一行，biz_key 唯一 —— 同一个业务动作重复提交只算一次。
 *
 * 所有函数都可以在外层事务里调用（inTransaction 会复用外层事务）：
 * 「扣冻干 + 写入任务」必须要么都成功，要么都回滚。
 */

export type WalletPocket = "purchased" | "gift";
type Allocation = { lotId: string; units: number };

/** 新人见面礼：3 颗，7 天有效。 */
export const NEWCOMER_GIFT_UNITS = 3;
export const NEWCOMER_GIFT_DAYS = 7;
/** 已过期的赠送所得因任务失败被退回时，重新给的有效期。 */
const RETURNED_GIFT_DAYS = 7;

async function lockAccount(database: Database, userId: string) {
  await database.query("INSERT INTO wallet_accounts (user_id,balance,updated_at) VALUES ($1,0,now()) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const rows = await database.query("SELECT * FROM wallet_accounts WHERE user_id=$1 FOR UPDATE", [userId]);
  return rows[0];
}

async function ledgerByKey(database: Database, bizKey: string) {
  return (await database.query("SELECT * FROM wallet_ledger WHERE biz_key=$1", [bizKey]))[0];
}

function mapLedger(row: SqlRow) {
  return {
    id: String(row.id),
    delta: Number(row.delta),
    balanceAfter: Number(row.balance_after),
    reason: String(row.reason),
    title: String(row.title),
    refType: row.ref_type ? String(row.ref_type) : undefined,
    refId: row.ref_id ? String(row.ref_id) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

async function writeLedger(database: Database, input: { userId: string; delta: number; balanceAfter: number; reason: string; bizKey: string; sourceBizKey?: string; refType?: string; refId?: string; allocations?: Allocation[]; title: string; actorId?: string }) {
  const rows = await database.query(
    "INSERT INTO wallet_ledger (id,user_id,delta,balance_after,reason,biz_key,source_biz_key,ref_type,ref_id,allocations,title,actor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,now()) RETURNING *",
    [crypto.randomUUID(), input.userId, input.delta, input.balanceAfter, input.reason, input.bizKey, input.sourceBizKey || null, input.refType || null, input.refId || null, JSON.stringify(input.allocations || []), input.title, input.actorId || null],
  );
  return rows[0];
}

/**
 * 把到期的赠送批次清零。扣减与读余额前先跑一次（只针对这个用户），
 * Worker 再每分钟兜底跑全量 —— 余额不能因为 Worker 慢了一拍而多出已过期的颗数。
 */
async function expireLotsForUser(database: Database, userId: string) {
  const account = await lockAccount(database, userId);
  const lots = await database.query("SELECT id,remaining FROM wallet_lots WHERE user_id=$1 AND status='active' AND expires_at IS NOT NULL AND expires_at<=now() FOR UPDATE", [userId]);
  if (!lots.length) return;
  let balance = Number(account.balance);
  for (const lot of lots) {
    const units = Number(lot.remaining);
    await database.query("UPDATE wallet_lots SET status='expired',remaining=0 WHERE id=$1", [lot.id]);
    if (units <= 0) continue;
    balance -= units;
    await writeLedger(database, { userId, delta: -units, balanceAfter: balance, reason: "expire", bizKey: `expire:${String(lot.id)}`, refType: "wallet_lot", refId: String(lot.id), allocations: [{ lotId: String(lot.id), units }], title: "赠送的冻干到期" });
  }
  await database.query("UPDATE wallet_accounts SET balance=$2,updated_at=now() WHERE user_id=$1", [userId, balance]);
}

export async function expireGiftLots(limit = 200) {
  const database = await getDatabase();
  const users = await database.query("SELECT DISTINCT user_id FROM wallet_lots WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=now() LIMIT $1", [limit]);
  for (const row of users) await inTransaction((transaction) => expireLotsForUser(transaction, String(row.user_id)));
  return users.length;
}

export async function credit(userId: string, input: { pocket: WalletPocket; source: "topup" | "newcomer_gift" | "admin_grant"; units: number; bizKey: string; title: string; unitPriceFen?: number; growthOrderId?: string; expiresAt?: Date; actorId?: string; refType?: string; refId?: string }) {
  if (!Number.isInteger(input.units) || input.units <= 0) throw new AppError("WALLET_UNITS_INVALID", "到账数量不正确", 422);
  if (input.pocket === "gift" && !input.expiresAt) throw new AppError("WALLET_GIFT_EXPIRY_REQUIRED", "赠送所得必须有有效期", 422);
  return inTransaction(async (database) => {
    const account = await lockAccount(database, userId);
    const previous = await ledgerByKey(database, input.bizKey);
    if (previous) return mapLedger(previous);
    const lotId = crypto.randomUUID();
    await database.query(
      "INSERT INTO wallet_lots (id,user_id,pocket,source,units,remaining,unit_price_fen,growth_order_id,expires_at,status,created_at) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,'active',now())",
      [lotId, userId, input.pocket, input.source, input.units, input.unitPriceFen ?? null, input.growthOrderId || null, input.expiresAt || null],
    );
    const balance = Number(account.balance) + input.units;
    await database.query("UPDATE wallet_accounts SET balance=$2,updated_at=now() WHERE user_id=$1", [userId, balance]);
    return mapLedger(await writeLedger(database, { userId, delta: input.units, balanceAfter: balance, reason: input.source, bizKey: input.bizKey, refType: input.refType, refId: input.refId, allocations: [{ lotId, units: input.units }], title: input.title, actorId: input.actorId }));
  });
}

export function insufficientError(required: number, balance: number) {
  return new AppError(
    "WALLET_INSUFFICIENT",
    `${DONGAN_NAME}不够啦，这次需要 ${required} ${DONGAN_UNIT}，你还有 ${balance} ${DONGAN_UNIT}`,
    402,
    undefined,
    { required, balance, shortfall: Math.max(0, required - balance) },
  );
}

/**
 * 扣冻干。扣减顺序：赠送所得按到期日先扣，再按入账先后扣购买所得。
 *
 * 同一个 bizKey 重复调用返回第一次的结果（replayed=true），不重复扣。余额不足抛 402 WALLET_INSUFFICIENT，
 * details 里带「需要 / 现有 / 差额」，端上据此弹充值面板并默认选中能补足差额的那一档。
 */
export async function spend(userId: string, input: { units: number; bizKey: string; title: string; refType?: string; refId?: string }) {
  if (!Number.isInteger(input.units) || input.units <= 0) throw new AppError("WALLET_UNITS_INVALID", "扣减数量不正确", 422);
  return inTransaction(async (database) => {
    const account = await lockAccount(database, userId);
    const previous = await ledgerByKey(database, input.bizKey);
    if (previous) return { ...mapLedger(previous), replayed: true };
    if (account.frozen_reason) throw new AppError("WALLET_FROZEN", "账户里的冻干暂时不能使用，请联系客服", 409);
    await expireLotsForUser(database, userId);
    const balance = Number((await database.query("SELECT balance FROM wallet_accounts WHERE user_id=$1", [userId]))[0].balance);
    if (balance < input.units) throw insufficientError(input.units, balance);
    const lots = await database.query(
      "SELECT id,remaining FROM wallet_lots WHERE user_id=$1 AND status='active' AND remaining>0 ORDER BY CASE WHEN pocket='gift' THEN 0 ELSE 1 END, expires_at NULLS LAST, created_at, id FOR UPDATE",
      [userId],
    );
    const allocations: Allocation[] = [];
    let left = input.units;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(left, Number(lot.remaining));
      await database.query("UPDATE wallet_lots SET remaining=remaining-$2 WHERE id=$1", [lot.id, take]);
      allocations.push({ lotId: String(lot.id), units: take });
      left -= take;
    }
    // 余额缓存与批次不一致时宁可拒绝也不透支：缺口说明账本需要对账。
    if (left > 0) throw new AppError("WALLET_LEDGER_MISMATCH", "账户余额需要核对，请稍后再试", 409);
    const after = balance - input.units;
    await database.query("UPDATE wallet_accounts SET balance=$2,updated_at=now() WHERE user_id=$1", [userId, after]);
    return { ...mapLedger(await writeLedger(database, { userId, delta: -input.units, balanceAfter: after, reason: "spend", bizKey: input.bizKey, refType: input.refType, refId: input.refId, allocations, title: input.title })), replayed: false };
  });
}

/**
 * 按扣费流水原路退还（任务终态失败、排队中取消、套餐单张失败）。
 *
 * 只回到冻干余额，现金不退。不传 units 即退还这笔扣费剩余未退的全部；
 * 部分退还（套餐按张退）必须带 part，用来区分同一笔扣费下的多次退还。
 * 原批次是已过期的赠送所得时，退回后重新给 7 天有效期 —— 失败不该让用户的颗数凭空过期。
 *
 * @returns 实际退还的颗数；这笔扣费不存在或已退完时返回 0
 */
export async function refundSpend(bizKey: string, options: { units?: number; part?: string; title?: string } = {}) {
  return inTransaction(async (database) => {
    const source = await ledgerByKey(database, bizKey);
    if (!source || String(source.reason) !== "spend") return 0;
    const userId = String(source.user_id);
    const account = await lockAccount(database, userId);
    const returnKey = `return:${bizKey}${options.part ? `:${options.part}` : ""}`;
    if (await ledgerByKey(database, returnKey)) return 0;
    const returned = await database.query("SELECT allocations FROM wallet_ledger WHERE source_biz_key=$1 AND reason='spend_return'", [bizKey]);
    const returnedByLot = new Map<string, number>();
    for (const row of returned) for (const item of (row.allocations || []) as Allocation[]) returnedByLot.set(item.lotId, (returnedByLot.get(item.lotId) || 0) + item.units);
    const spent = (source.allocations || []) as Allocation[];
    const outstanding = spent.reduce((sum, item) => sum + item.units - (returnedByLot.get(item.lotId) || 0), 0);
    let left = Math.min(outstanding, options.units ?? outstanding);
    if (left <= 0) return 0;
    const allocations: Allocation[] = [];
    // 先退回购买所得（长期有效），再退赠送所得：与扣减顺序相反，用户手里留下更不容易过期的颗数。
    for (const item of [...spent].reverse()) {
      if (left <= 0) break;
      const room = item.units - (returnedByLot.get(item.lotId) || 0);
      const give = Math.min(left, room);
      if (give <= 0) continue;
      const updated = await database.query(
        `UPDATE wallet_lots SET remaining=remaining+$2,status='active',
           expires_at=CASE WHEN expires_at IS NOT NULL AND expires_at<=now() THEN now()+interval '${RETURNED_GIFT_DAYS} days' ELSE expires_at END
         WHERE id=$1 AND status IN ('active','expired') AND remaining+$2<=units RETURNING id`,
        [item.lotId, give],
      );
      if (!updated[0]) continue;
      allocations.push({ lotId: item.lotId, units: give });
      left -= give;
    }
    const units = allocations.reduce((sum, item) => sum + item.units, 0);
    if (!units) return 0;
    const after = Number(account.balance) + units;
    await database.query("UPDATE wallet_accounts SET balance=$2,updated_at=now() WHERE user_id=$1", [userId, after]);
    await writeLedger(database, { userId, delta: units, balanceAfter: after, reason: "spend_return", bizKey: returnKey, sourceBizKey: bizKey, refType: source.ref_type ? String(source.ref_type) : undefined, refId: source.ref_id ? String(source.ref_id) : undefined, allocations, title: options.title || `${String(source.title)} · 已退还` });
    return units;
  });
}

/**
 * 新人见面礼。添加第一只宠物后发放，每个微信身份只发一次。
 *
 * 幂等键优先用 unionid（2026-10-09 起微信账号的唯一标识）：注销后用同一个微信重新注册会得到新的 user_id，
 * 但 unionid 不变，旧流水仍在（注销是软删除），于是不会再发一次。
 */
function newcomerGiftKey(userId: string, unionid: unknown) {
  return unionid ? `gift:newcomer:unionid:${String(unionid)}` : `gift:newcomer:user:${userId}`;
}

export async function grantNewcomerGift(userId: string) {
  return inTransaction(async (database) => {
    const account = await lockAccount(database, userId);
    if (account.newcomer_gift_at) return undefined;
    const users = await database.query("SELECT wechat_unionid FROM users WHERE id=$1", [userId]);
    const bizKey = newcomerGiftKey(userId, users[0]?.wechat_unionid);
    await database.query("UPDATE wallet_accounts SET newcomer_gift_at=now() WHERE user_id=$1", [userId]);
    if (await ledgerByKey(database, bizKey)) return undefined;
    return credit(userId, {
      pocket: "gift", source: "newcomer_gift", units: NEWCOMER_GIFT_UNITS, bizKey,
      expiresAt: new Date(Date.now() + NEWCOMER_GIFT_DAYS * 86_400_000), title: "新人见面礼",
    });
  });
}

/**
 * 见面礼是否还能领、领多少、几天有效（2026-10 新用户引导）。
 * 首页建档卡据此写「建好就送 N 颗冻干」，端上不写死颗数。口径与 grantNewcomerGift 一致：
 * 本账号领过、或同一微信身份领过（注销重注册）都算已领，不再展示。
 */
export async function getNewcomerGiftOffer(userId: string) {
  const database = await getDatabase();
  const [row] = await database.query(
    `SELECT a.newcomer_gift_at, u.wechat_unionid FROM users u LEFT JOIN wallet_accounts a ON a.user_id=u.id WHERE u.id=$1`, [userId],
  );
  const claimed = Boolean(row?.newcomer_gift_at) || Boolean(await ledgerByKey(database, newcomerGiftKey(userId, row?.wechat_unionid)));
  return { available: !claimed, units: NEWCOMER_GIFT_UNITS, days: NEWCOMER_GIFT_DAYS };
}

export async function getWallet(userId: string) {
  return inTransaction(async (database) => {
    await expireLotsForUser(database, userId);
    const account = await lockAccount(database, userId);
    const gifts = await database.query<{ units: number; expires_at: string }>(
      "SELECT coalesce(sum(remaining),0)::int units, min(expires_at) expires_at FROM wallet_lots WHERE user_id=$1 AND pocket='gift' AND status='active' AND remaining>0",
      [userId],
    );
    const nextExpiry = await database.query("SELECT remaining,expires_at FROM wallet_lots WHERE user_id=$1 AND pocket='gift' AND status='active' AND remaining>0 ORDER BY expires_at LIMIT 1", [userId]);
    return {
      balance: Number(account.balance),
      giftBalance: Number(gifts[0]?.units || 0),
      nextGiftExpiry: nextExpiry[0] ? { units: Number(nextExpiry[0].remaining), expiresAt: new Date(String(nextExpiry[0].expires_at)).toISOString() } : undefined,
      firstTopupAvailable: !account.first_topup_at,
      newcomerGiftGranted: Boolean(account.newcomer_gift_at),
      frozen: Boolean(account.frozen_reason),
      name: DONGAN_NAME,
      unit: DONGAN_UNIT,
    };
  });
}

/**
 * 收支明细，按时间倒序分页。游标是上一页最后一条的 id：
 * 只按时间比较会在同一毫秒写入的几条之间漏行（一次扣费 + 退还常常同时落库）。
 */
export async function listWalletLedger(userId: string, options: { before?: string; limit?: number } = {}) {
  const limit = Math.min(50, Math.max(1, options.limit || 20));
  if (options.before && !/^[0-9a-f-]{36}$/i.test(options.before)) throw new AppError("WALLET_CURSOR_INVALID", "分页参数不正确", 422);
  const rows = await (await getDatabase()).query(
    `SELECT * FROM wallet_ledger WHERE user_id=$1
       AND ($2::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM wallet_ledger WHERE id=$2 AND user_id=$1))
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [userId, options.before || null, limit + 1],
  );
  const items = rows.slice(0, limit).map(mapLedger);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : undefined };
}

/** 这笔扣费还有多少颗没退（用于展示与测试）。 */
export async function outstandingSpend(bizKey: string) {
  const database = await getDatabase();
  const source = await ledgerByKey(database, bizKey);
  if (!source) return 0;
  const returned = await database.query<{ units: number }>("SELECT coalesce(sum(delta),0)::int units FROM wallet_ledger WHERE source_biz_key=$1 AND reason='spend_return'", [bizKey]);
  return -Number(source.delta) - Number(returned[0]?.units || 0);
}

/**
 * 后台人工补偿：发一批赠送所得（必须有有效期与原因），不提供直接改余额。
 */
export async function grantByAdmin(actorId: string, userId: string, input: { units: number; days: number; reason: string }) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) throw new AppError("WALLET_GIFT_DAYS_INVALID", "有效期需在 1-365 天之间", 422);
  const users = await (await getDatabase()).query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL", [userId]);
  if (!users[0]) throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
  return credit(userId, {
    pocket: "gift", source: "admin_grant", units: input.units, bizKey: `admin:${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + input.days * 86_400_000), title: `客服补偿 · ${input.reason}`.slice(0, 80), actorId,
  });
}
