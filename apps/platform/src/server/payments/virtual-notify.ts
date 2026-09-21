import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { requiredPaymentConfig as required } from "./config";
import { reconcilePayment } from "./service";
import type { Payment } from "./types";

function signature(parts: string[]) {
  return createHash("sha1").update(parts.sort().join("")).digest("hex");
}

function verifySignature(url: URL, encrypted?: string) {
  const timestamp = url.searchParams.get("timestamp") || "";
  const nonce = url.searchParams.get("nonce") || "";
  const supplied = url.searchParams.get(encrypted ? "msg_signature" : "signature") || "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce || !/^[0-9a-f]{40}$/.test(supplied)) throw new AppError("VIRTUAL_SIGNATURE_INVALID", "微信消息签名参数无效", 401);
  const parts = [required("WECHAT_MESSAGE_TOKEN"), timestamp, nonce];
  if (encrypted) parts.push(encrypted);
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(parts)))) throw new AppError("VIRTUAL_SIGNATURE_INVALID", "微信消息验签失败", 401);
  return nonce;
}

function aesKey() {
  const key = Buffer.from(`${required("WECHAT_MESSAGE_AES_KEY")}=`, "base64");
  if (key.length !== 32) throw new AppError("VIRTUAL_AES_INVALID", "消息加密密钥配置无效", 503);
  return key;
}

export function decryptVirtualMessage(encrypted: string): unknown {
  const key = aesKey();
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  const padding = padded[padded.length - 1];
  if (!padding || padding > 32 || !padded.subarray(-padding).every((value) => value === padding)) throw new AppError("VIRTUAL_AES_INVALID", "消息填充无效", 401);
  const plain = padded.subarray(0, -padding);
  if (plain.length < 20) throw new AppError("VIRTUAL_AES_INVALID", "消息长度无效", 401);
  const length = plain.readUInt32BE(16);
  if (length > plain.length - 20 || plain.subarray(20 + length).toString("utf8") !== required("WECHAT_APP_ID")) throw new AppError("VIRTUAL_APPID_MISMATCH", "消息 AppID 不匹配", 401);
  return JSON.parse(plain.subarray(20, 20 + length).toString("utf8"));
}

export function encryptVirtualReply(payload: unknown, nonce: string) {
  const key = aesKey();
  const message = Buffer.from(JSON.stringify(payload));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length);
  const plain = Buffer.concat([randomBytes(16), length, message, Buffer.from(required("WECHAT_APP_ID"))]);
  const padding = 32 - plain.length % 32;
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const Encrypt = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
  const TimeStamp = Math.floor(Date.now() / 1000);
  return { Encrypt, MsgSignature: signature([required("WECHAT_MESSAGE_TOKEN"), String(TimeStamp), nonce, Encrypt]), TimeStamp, Nonce: nonce };
}

export function verifyVirtualEndpoint(request: Request) {
  const url = new URL(request.url);
  verifySignature(url);
  return new Response(z.string().min(1).max(256).parse(url.searchParams.get("echostr")));
}

const eventSchema = z.object({ Event: z.string() }).passthrough();

export async function iosRefundInquiry(payload: Record<string, unknown>) {
  const input = z.object({ pay_order_id: z.string().min(8).max(64) }).passthrough().parse(payload);
  const database = await getDatabase();
  const rows = await database.query("SELECT p.id,p.status,p.delivered_at,(SELECT count(*)::int FROM entitlement_ledger e WHERE (e.order_id=p.order_id OR e.membership_id=(SELECT resource_id FROM growth_orders WHERE id=p.order_id)) AND e.status='consumed') consumed FROM payment_transactions p WHERE p.out_trade_no=$1 AND p.provider='virtual'", [input.pay_order_id]);
  const order = rows[0];
  const deliveredAt = order?.delivered_at || null;
  const consumedEntitlements = Number(order?.consumed || 0);
  const denyRefund = Boolean(deliveredAt && consumedEntitlements > 0);
  const evidence = { policy: denyRefund ? "deny_refund_consumed" : "allow_refund", orderFound: Boolean(order), deliveredAt, consumedEntitlements };
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = await database.query<{ result_code: number; evidence: unknown }>("SELECT result_code,evidence FROM payment_refund_inquiries WHERE request_hash=$1", [requestHash]);
  if (previous[0]) {
    return { result_code: Number(previous[0].result_code), result_info: Number(previous[0].result_code) === 0 ? "同意退款" : "权益已交付并使用", evidence: typeof previous[0].evidence === "string" ? previous[0].evidence : JSON.stringify(previous[0].evidence) };
  }
  await database.query("INSERT INTO payment_refund_inquiries (id,payment_id,request_hash,result_code,evidence) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (request_hash) DO NOTHING", [crypto.randomUUID(), order?.id || null, requestHash, denyRefund ? 1 : 0, JSON.stringify(evidence)]);
  return { result_code: denyRefund ? 1 : 0, result_info: denyRefund ? "权益已交付并使用" : "同意退款", evidence: JSON.stringify(evidence) };
}

export async function handleVirtualNotification(request: Request) {
  const body = await request.text();
  if (body.length > 100_000) throw new AppError("NOTIFICATION_TOO_LARGE", "通知过大", 413);
  const envelope = z.object({ Encrypt: z.string().min(1).max(100_000) }).parse(JSON.parse(body));
  const nonce = verifySignature(new URL(request.url), envelope.Encrypt);
  const payload = eventSchema.parse(decryptVirtualMessage(envelope.Encrypt));
  if (payload.Event === "xpay_subscribe_ios_refund_query_notify") {
    return Response.json(encryptVirtualReply(await iosRefundInquiry(payload), nonce));
  }
  if (payload.Event === "xpay_goods_deliver_notify" || payload.Event === "xpay_refund_notify") {
    const number = payload.Event === "xpay_goods_deliver_notify" ? payload.OutTradeNo : payload.MchOrderId;
    const outTradeNo = z.string().min(8).max(32).parse(number);
    const payment = (await (await getDatabase()).query<Payment>("SELECT * FROM payment_transactions WHERE out_trade_no=$1 AND provider='virtual'", [outTradeNo]))[0];
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "支付记录不存在", 404);
    if (payload.OpenId !== payment.openid || (payload.Env !== undefined && Number(payload.Env) !== payment.environment)) throw new AppError("PAYMENT_MISMATCH", "通知用户或环境不匹配", 409);
    await reconcilePayment(payment);
  }
  return new Response("success");
}
