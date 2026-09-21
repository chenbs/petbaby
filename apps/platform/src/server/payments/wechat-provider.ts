import "server-only";
import { createSign, createVerify, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { requiredPaymentConfig as required } from "./config";
import type { Payment, PaymentProvider, PaymentRefund } from "./types";

export function verifyWechatSignature(headers: Headers, body: string) {
  const timestamp = headers.get("Wechatpay-Timestamp") || "";
  const nonce = headers.get("Wechatpay-Nonce") || "";
  const signature = headers.get("Wechatpay-Signature") || "";
  const serial = headers.get("Wechatpay-Serial");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce || !signature || serial !== required("WECHAT_PLATFORM_SERIAL")) {
    throw new AppError("WECHAT_SIGNATURE_INVALID", "微信支付通知签名参数无效", 401);
  }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}\n${nonce}\n${body}\n`);
  if (!verifier.verify(required("WECHAT_PLATFORM_PUBLIC_KEY"), signature, "base64")) throw new AppError("WECHAT_SIGNATURE_INVALID", "微信支付通知验签失败", 401);
}

async function wechatRequest(method: "GET" | "POST", requestPath: string, payload?: unknown) {
  const body = payload ? JSON.stringify(payload) : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");
  const signer = createSign("RSA-SHA256");
  signer.update(`${method}\n${requestPath}\n${timestamp}\n${nonce}\n${body}\n`);
  const signature = signer.sign(required("WECHAT_MCH_PRIVATE_KEY"), "base64");
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${required("WECHAT_MCH_ID")}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${required("WECHAT_CERT_SERIAL")}",signature="${signature}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${requestPath}`, {
    method, headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "petbaby/1.0" },
    ...(body ? { body } : {}), signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error",
  });
  const text = await response.text();
  if (!response.ok) throw new AppError("WECHAT_PAY_FAILED", `微信支付请求失败（${response.status}）`, 502);
  return JSON.parse(text) as unknown;
}

export const wechatTransactionSchema = z.object({
  appid: z.string(), mchid: z.string(), out_trade_no: z.string(), transaction_id: z.string().min(1).optional(),
  trade_state: z.string(), amount: z.object({ total: z.number().int(), currency: z.literal("CNY") }),
  payer: z.object({ openid: z.string() }),
});

export function verifyWechatTransaction(payment: Payment, payload: unknown) {
  const transaction = wechatTransactionSchema.parse(payload);
  if (transaction.trade_state === "SUCCESS" && !transaction.transaction_id) throw new AppError("PAYMENT_UNCONFIRMED", "微信交易凭据缺失", 409);
  if (payment.provider !== "wechat" || transaction.appid !== required("WECHAT_APP_ID") || transaction.mchid !== required("WECHAT_MCH_ID") || transaction.out_trade_no !== payment.out_trade_no || transaction.amount.total !== payment.amount_fen || transaction.payer.openid !== payment.openid) {
    throw new AppError("PAYMENT_MISMATCH", "微信商户、用户或订单金额不匹配", 409);
  }
  return { paid: transaction.trade_state === "SUCCESS", closed: ["CLOSED", "REVOKED", "PAYERROR"].includes(transaction.trade_state), transactionId: transaction.transaction_id, channel: "wechat" };
}

export class WechatPaymentProvider implements PaymentProvider {
  async create(payment: Payment) {
    if (!payment.openid) throw new AppError("WECHAT_OPENID_REQUIRED", "请在小程序登录后支付", 422);
    const appid = required("WECHAT_APP_ID");
    const result = z.object({ prepay_id: z.string().min(1) }).parse(await wechatRequest("POST", "/v3/pay/transactions/jsapi", {
      appid, mchid: required("WECHAT_MCH_ID"), description: `麻麻抱我 ${payment.sku}`,
      out_trade_no: payment.out_trade_no, notify_url: required("WECHAT_PAY_NOTIFY_URL"),
      amount: { total: payment.amount_fen, currency: "CNY" }, payer: { openid: payment.openid },
    }));
    const packageValue = `prepay_id=${result.prepay_id}`;
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomBytes(16).toString("hex");
    const signer = createSign("RSA-SHA256");
    signer.update(`${appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
    return { providerOrderId: result.prepay_id, clientParams: { mode: "wechat", timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign: signer.sign(required("WECHAT_MCH_PRIVATE_KEY"), "base64") } };
  }

  async query(payment: Payment) {
    return verifyWechatTransaction(payment, await wechatRequest("GET", `/v3/pay/transactions/out-trade-no/${payment.out_trade_no}?mchid=${encodeURIComponent(required("WECHAT_MCH_ID"))}`));
  }

  async refund(payment: Payment, refund: PaymentRefund) {
    await wechatRequest("POST", "/v3/refund/domestic/refunds", {
      out_trade_no: payment.out_trade_no, out_refund_no: refund.out_refund_no, reason: refund.reason,
      notify_url: required("WECHAT_REFUND_NOTIFY_URL"), amount: { refund: refund.amount_fen, total: payment.amount_fen, currency: "CNY" },
    });
  }

  async queryRefund(payment: Payment, refund: PaymentRefund) {
    const result = z.object({ out_trade_no: z.string(), out_refund_no: z.string(), status: z.string(), amount: z.object({ refund: z.number(), total: z.number(), currency: z.literal("CNY") }) }).parse(await wechatRequest("GET", `/v3/refund/domestic/refunds/${refund.out_refund_no}`));
    if (result.out_trade_no !== payment.out_trade_no || result.out_refund_no !== refund.out_refund_no || result.amount.refund !== refund.amount_fen || result.amount.total !== payment.amount_fen) throw new AppError("REFUND_MISMATCH", "微信退款金额或订单不匹配", 409);
    if (result.status === "SUCCESS") return "succeeded" as const;
    if (["CLOSED", "ABNORMAL"].includes(result.status)) return "failed" as const;
    return "processing" as const;
  }
}
