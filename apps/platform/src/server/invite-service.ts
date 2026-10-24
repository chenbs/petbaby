import "server-only";

import { createHash, randomInt } from "node:crypto";

import { channelForScene, normalizeSource } from "@/domain/acquisition";
import { getDatabase, inTransaction, type Database } from "@/server/db/client";
import { credit } from "@/server/wallet/service";

/*
 * 渠道归因与邀请奖励（2026-10-12，迁移 0044）。
 *
 * 归因：新建账号那一次写入 acquisition_*，之后不覆盖。带有效邀请码的新用户记为 invite 渠道并登记邀请人。
 * 奖励：被邀请人添加第一只宠物后，给邀请人发 1 颗赠送冻干；邀请人每天（北京时间）最多拿 5 颗，
 *      超出的照样登记（capped，0 颗），之后不补发。只注册不建档不算——否则刷号只需要反复授权登录。
 *
 * 防重复：invite_rewards 以被邀请人 user_id 与 unionid 哈希双唯一。注销会清空 unionid、重新注册会得到新的 user_id，
 * 所以另外核对见面礼流水：同一个微信身份以前领过见面礼（老用户注销重来），不算新用户，不给邀请人结算。
 */

export const INVITE_REWARD_UNITS = 1;
export const INVITE_DAILY_CAP = 5;
/** 奖励是赠送所得，必须有有效期（钱包约束）。比见面礼长：邀请人往往攒几颗再一起用。 */
export const INVITE_REWARD_DAYS = 30;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export type LaunchAttribution = { scene?: number; src?: string; inviteCode?: string };

export function normalizeInviteCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code) ? code : undefined;
}

function generateCode() {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * 新账号的渠道归因。只由 signInWechatUser 在「刚插入用户行」的同一事务里调用。
 * 邀请码无效、邀请人已注销或停用时，按场景值归类，不报错——归因失败不能挡住登录。
 */
export async function applyAcquisition(database: Database, userId: string, input: LaunchAttribution = {}) {
  const scene = Number.isInteger(input.scene) && Number(input.scene) > 0 && Number(input.scene) < 100_000 ? Number(input.scene) : null;
  const code = normalizeInviteCode(input.inviteCode);
  const inviter = code
    ? (await database.query<{ id: string }>("SELECT id FROM users WHERE invite_code=$1 AND id<>$2 AND deleted_at IS NULL AND admin_suspended_at IS NULL", [code, userId]))[0]?.id
    : undefined;
  await database.query(
    "UPDATE users SET acquisition_channel=$2, acquisition_src=$3, acquisition_scene=$4, invited_by=$5 WHERE id=$1",
    [userId, inviter ? "invite" : channelForScene(scene), normalizeSource(input.src) || null, scene, inviter || null],
  );
}

/** 我的邀请码，没有就生成一个。撞码（唯一索引冲突）时换一个重试。 */
export async function ensureInviteCode(userId: string) {
  const database = await getDatabase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await database.query<{ invite_code: string | null }>("SELECT invite_code FROM users WHERE id=$1", [userId]);
    if (existing[0]?.invite_code) return existing[0].invite_code;
    try {
      const rows = await database.query<{ invite_code: string }>("UPDATE users SET invite_code=$2 WHERE id=$1 AND invite_code IS NULL RETURNING invite_code", [userId, generateCode()]);
      if (rows[0]) return rows[0].invite_code;
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("INVITE_CODE_GENERATION_FAILED");
}

export async function getInviteSummary(userId: string) {
  const code = await ensureInviteCode(userId);
  const database = await getDatabase();
  const [row] = await database.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE invited_by=$1) joined,
       (SELECT count(*)::int FROM invite_rewards WHERE inviter_id=$1) qualified,
       (SELECT coalesce(sum(units),0)::int FROM invite_rewards WHERE inviter_id=$1) total_units,
       (SELECT coalesce(sum(units),0)::int FROM invite_rewards WHERE inviter_id=$1 AND reward_date=timezone('Asia/Shanghai', now())::date) today_units`,
    [userId],
  );
  return {
    code,
    unitsPerInvite: INVITE_REWARD_UNITS,
    dailyCap: INVITE_DAILY_CAP,
    rewardDays: INVITE_REWARD_DAYS,
    joined: Number(row?.joined || 0),
    qualified: Number(row?.qualified || 0),
    totalUnits: Number(row?.total_units || 0),
    todayUnits: Number(row?.today_units || 0),
  };
}

function inviteeKey(userId: string, unionid: unknown) {
  return unionid ? `unionid:${createHash("sha256").update(String(unionid)).digest("hex")}` : `user:${userId}`;
}

/**
 * 被邀请人建好第一只宠物后调用。重复调用、没有邀请人、邀请人已不可用、被邀请人是注销重来的老用户，都直接返回 undefined。
 * 邀请人行 FOR UPDATE：同一邀请人的并发结算排队，每日上限不会被并发击穿。
 */
export async function settleInviteReward(inviteeId: string) {
  return inTransaction(async (database) => {
    const [invitee] = await database.query<{ invited_by: string | null; wechat_unionid: string | null }>(
      "SELECT invited_by, wechat_unionid FROM users WHERE id=$1 AND deleted_at IS NULL",
      [inviteeId],
    );
    if (!invitee?.invited_by) return undefined;
    const inviterId = invitee.invited_by;
    const [inviter] = await database.query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL AND admin_suspended_at IS NULL FOR UPDATE", [inviterId]);
    if (!inviter) return undefined;
    if (invitee.wechat_unionid) {
      const earlier = await database.query("SELECT 1 FROM wallet_ledger WHERE biz_key=$1 AND user_id<>$2", [`gift:newcomer:unionid:${invitee.wechat_unionid}`, inviteeId]);
      if (earlier[0]) return undefined;
    }
    const [today] = await database.query<{ day: string; units: number }>(
      "SELECT to_char(timezone('Asia/Shanghai', now())::date,'YYYY-MM-DD') AS day, (SELECT coalesce(sum(units),0)::int FROM invite_rewards WHERE inviter_id=$1 AND reward_date=timezone('Asia/Shanghai', now())::date) AS units",
      [inviterId],
    );
    const units = Math.max(0, Math.min(INVITE_REWARD_UNITS, INVITE_DAILY_CAP - Number(today.units)));
    const id = crypto.randomUUID();
    const inserted = await database.query(
      "INSERT INTO invite_rewards (id,inviter_id,invitee_id,invitee_key,reward_date,units,status,created_at) VALUES ($1,$2,$3,$4,$5::date,$6,$7,now()) ON CONFLICT DO NOTHING RETURNING id",
      [id, inviterId, inviteeId, inviteeKey(inviteeId, invitee.wechat_unionid), today.day, units, units > 0 ? "granted" : "capped"],
    );
    if (!inserted[0]) return undefined;
    if (!units) return { inviterId, units: 0, capped: true };
    await credit(inviterId, {
      pocket: "gift", source: "invite_reward", units, bizKey: `invite:${id}`, title: "邀请好友奖励",
      expiresAt: new Date(Date.now() + INVITE_REWARD_DAYS * 86_400_000), refType: "invite_reward", refId: id,
    });
    await database.query(
      "INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,'invite_reward',$3,$4,'/pages/invite/invite',now())",
      [crypto.randomUUID(), inviterId, "邀请奖励到账", `你邀请的好友建好了宠物档案，送你 ${units} 颗冻干，${INVITE_REWARD_DAYS} 天内有效。`],
    );
    return { inviterId, units, capped: false };
  });
}
