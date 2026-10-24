import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { channelForScene, normalizeSource } from "@/domain/acquisition";
import { signInWechatUser } from "@/server/auth/wechat-account";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { ensureInviteCode, getInviteSummary, INVITE_DAILY_CAP, normalizeInviteCode, settleInviteReward } from "@/server/invite-service";
import { createPet } from "@/server/platform-service";
import { getWallet } from "@/server/wallet/service";

const KEY = Buffer.alloc(32, 7).toString("base64");
let serial = 0;

/** 一个新微信用户登录（可带归因），返回 user_id。 */
async function signIn(attribution?: Parameters<typeof signInWechatUser>[1], unionid = `union-${++serial}`) {
  return signInWechatUser({ unionid, openid: `openid-${unionid}`, session_key: `session-${serial}` }, attribution);
}

async function userRow(id: string) {
  return (await (await getDatabase()).query("SELECT acquisition_channel, acquisition_src, acquisition_scene, invited_by FROM users WHERE id=$1", [id]))[0];
}

describe("渠道归因", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", KEY);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("场景值归类与投放标记清洗", () => {
    expect(channelForScene(1007)).toBe("share");
    expect(channelForScene(1047)).toBe("qrcode");
    expect(channelForScene(1053)).toBe("search");
    expect(channelForScene(1177)).toBe("channels");
    expect(channelForScene(1035)).toBe("official_account");
    expect(channelForScene(9999)).toBe("other");
    expect(channelForScene(undefined)).toBe("other");
    expect(normalizeSource(" XHS-1012-Human ")).toBe("xhs-1012-human");
    expect(normalizeSource("<script>")).toBeUndefined();
    expect(normalizeSource("a".repeat(41))).toBeUndefined();
    expect(normalizeInviteCode("abcd2345")).toBe("ABCD2345");
    expect(normalizeInviteCode("ABCD0O1I")).toBeUndefined();
  });

  it("只在新建账号时写入，老用户再登录不覆盖", async () => {
    const id = await signIn({ scene: 1053, src: "xhs-1012-human" }, "union-first");
    expect(await userRow(id)).toMatchObject({ acquisition_channel: "search", acquisition_src: "xhs-1012-human", acquisition_scene: 1053, invited_by: null });
    await signIn({ scene: 1007, src: "other-src" }, "union-first");
    expect(await userRow(id)).toMatchObject({ acquisition_channel: "search", acquisition_src: "xhs-1012-human" });
  });

  it("有效邀请码记为好友邀请；无效或邀请人已停用时按场景值归类", async () => {
    const inviter = await signIn();
    const code = await ensureInviteCode(inviter);
    expect(await ensureInviteCode(inviter)).toBe(code);
    const invited = await signIn({ scene: 1007, inviteCode: code.toLowerCase() });
    expect(await userRow(invited)).toMatchObject({ acquisition_channel: "invite", invited_by: inviter });
    const bogus = await signIn({ scene: 1007, inviteCode: "ZZZZZZZZ" });
    expect(await userRow(bogus)).toMatchObject({ acquisition_channel: "share", invited_by: null });
    await (await getDatabase()).query("UPDATE users SET admin_suspended_at=now() WHERE id=$1", [inviter]);
    const late = await signIn({ scene: 1011, inviteCode: code });
    expect(await userRow(late)).toMatchObject({ acquisition_channel: "qrcode", invited_by: null });
  });
});

describe("邀请奖励", () => {
  let inviter: string;
  let code: string;

  beforeEach(async () => {
    await resetDatabaseForTest();
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", KEY);
    inviter = await signIn();
    code = await ensureInviteCode(inviter);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("被邀请人建好第一只宠物才结算 1 颗，再建宠物不重复给", async () => {
    const friend = await signIn({ inviteCode: code });
    expect((await getWallet(inviter)).balance).toBe(0);
    await createPet(friend, { name: "年糕", species: "cat" });
    expect((await getWallet(inviter)).balance).toBe(1);
    await createPet(friend, { name: "汤圆", species: "dog" });
    expect(await settleInviteReward(friend)).toBeUndefined();
    const wallet = await getWallet(inviter);
    expect(wallet).toMatchObject({ balance: 1, giftBalance: 1 });
    expect(wallet.nextGiftExpiry).toBeDefined();
    const notes = await (await getDatabase()).query("SELECT type FROM user_notifications WHERE user_id=$1", [inviter]);
    expect(notes.map((row) => row.type)).toEqual(["invite_reward"]);
    // 被邀请人自己的见面礼不受影响
    expect((await getWallet(friend)).balance).toBe(3);
  });

  it(`每天最多 ${INVITE_DAILY_CAP} 颗，超出的登记为 capped 且不补发`, async () => {
    for (let index = 0; index < INVITE_DAILY_CAP + 2; index += 1) {
      const friend = await signIn({ inviteCode: code });
      await createPet(friend, { name: `宠物${index}`, species: "cat" });
    }
    expect((await getWallet(inviter)).balance).toBe(INVITE_DAILY_CAP);
    expect(await getInviteSummary(inviter)).toMatchObject({ code, joined: INVITE_DAILY_CAP + 2, qualified: INVITE_DAILY_CAP + 2, totalUnits: INVITE_DAILY_CAP, todayUnits: INVITE_DAILY_CAP, dailyCap: INVITE_DAILY_CAP });
    const rows = await (await getDatabase()).query("SELECT status, count(*)::int n FROM invite_rewards GROUP BY status ORDER BY status");
    expect(rows).toEqual([{ status: "capped", n: 2 }, { status: "granted", n: INVITE_DAILY_CAP }]);
    // 次日额度重新计算：把已有奖励挪到昨天，再来一个
    await (await getDatabase()).query("UPDATE invite_rewards SET reward_date=reward_date - 1");
    const tomorrow = await signIn({ inviteCode: code });
    await createPet(tomorrow, { name: "次日", species: "dog" });
    expect((await getWallet(inviter)).balance).toBe(INVITE_DAILY_CAP + 1);
  });

  it("注销后用同一个微信重新注册，不再给邀请人结算", async () => {
    const friend = await signIn({ inviteCode: code }, "union-repeat");
    await createPet(friend, { name: "年糕", species: "cat" });
    expect((await getWallet(inviter)).balance).toBe(1);
    // 模拟注销：软删除并清空 unionid；同一微信再来会得到新 user_id
    await (await getDatabase()).query("UPDATE users SET deleted_at=now(), wechat_unionid=NULL, wechat_openid=NULL WHERE id=$1", [friend]);
    const again = await signIn({ inviteCode: code }, "union-repeat");
    expect(again).not.toBe(friend);
    await createPet(again, { name: "年糕", species: "cat" });
    expect((await getWallet(inviter)).balance).toBe(1);
  });

  it("没有邀请人或邀请人已注销时不结算", async () => {
    const plain = await signIn();
    await createPet(plain, { name: "无邀请", species: "cat" });
    expect(await settleInviteReward(plain)).toBeUndefined();
    const friend = await signIn({ inviteCode: code });
    await (await getDatabase()).query("UPDATE users SET deleted_at=now() WHERE id=$1", [inviter]);
    await createPet(friend, { name: "年糕", species: "cat" });
    expect((await (await getDatabase()).query("SELECT count(*)::int n FROM invite_rewards"))[0]).toEqual({ n: 0 });
  });
});
