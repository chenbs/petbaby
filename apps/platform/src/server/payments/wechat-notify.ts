import "server-only";
import { createDecipheriv } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { requiredPaymentConfig } from "./config";
import { applyPaymentConfirmation, completeRefund } from "./service";
import { verifyWechatSignature, verifyWechatTransaction } from "./wechat-provider";
import type { Payment } from "./types";

const envelopeSchema = z.object({ event_type: z.string(), resource: z.object({ algorithm: z.literal("AEAD_AES_256_GCM"), ciphertext: z.string().max(100000), nonce: z.string(), associated_data: z.string().optional() }) });

export async function handleWechatNotification(request: Request) {
  const body = await request.text();
  if (body.length > 100000) throw new AppError("NOTIFICATION_TOO_LARGE", "通知过大", 413);
  verifyWechatSignature(request.headers, body);
  const envelope = envelopeSchema.parse(JSON.parse(body));
  const key = Buffer.from(requiredPaymentConfig("WECHAT_PAY_KEY"));
  if (key.length !== 32) throw new AppError("WECHAT_PAY_KEY_INVALID", "API v3 Key 必须为 32 字节", 503);
  const encrypted = Buffer.from(envelope.resource.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.resource.nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  if (envelope.resource.associated_data) decipher.setAAD(Buffer.from(envelope.resource.associated_data));
  const payload: unknown = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]).toString("utf8"));
  const database = await getDatabase();
  if (envelope.event_type === "TRANSACTION.SUCCESS") {
    const data = z.object({ out_trade_no: z.string() }).parse(payload);
    const payment = (await database.query<Payment>("SELECT * FROM payment_transactions WHERE out_trade_no=$1 AND provider=\'wechat\'", [data.out_trade_no]))[0];
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "支付记录不存在", 404);
    await applyPaymentConfirmation(payment.id, verifyWechatTransaction(payment, payload));
  } else if (envelope.event_type.startsWith("REFUND.")) {
    const data = z.object({ mchid: z.string(), out_refund_no: z.string() }).parse(payload);
    if (data.mchid !== requiredPaymentConfig("WECHAT_MCH_ID")) throw new AppError("PAYMENT_MISMATCH", "退款商户不匹配", 409);
    const refund = (await database.query("SELECT r.id FROM payment_refunds r JOIN payment_transactions p ON p.id=r.payment_id WHERE r.out_refund_no=$1 AND p.provider=\'wechat\'", [data.out_refund_no]))[0];
    if (!refund) throw new AppError("REFUND_NOT_FOUND", "退款记录不存在", 404);
    await completeRefund(String(refund.id));
  }
  return { accepted: true };
}
