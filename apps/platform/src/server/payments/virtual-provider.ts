import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { readWechatSession } from "@/server/auth/wechat-session";
import { AppError } from "@/server/errors";
import { getWechatAccessToken } from "@/server/wechat/access-token";
import { requiredPaymentConfig, virtualAppKey } from "./config";
import type { Payment, PaymentProvider, PaymentRefund } from "./types";

export function virtualSignature(key: string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

async function virtualRequest(endpoint: string, payment: Payment, payload: Record<string, unknown>) {
  const body = JSON.stringify({ ...payload, env: payment.environment });
  const url = new URL(`https://api.weixin.qq.com/xpay/${endpoint}`);
  url.searchParams.set("access_token", await getWechatAccessToken());
  url.searchParams.set("pay_sig", virtualSignature(virtualAppKey(payment.environment), `/xpay/${endpoint}&${body}`));
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error" });
  const result = z.object({ errcode: z.number(), errmsg: z.string().optional() }).passthrough().parse(await response.json());
  if (!response.ok || result.errcode !== 0) throw new AppError(result.errcode === 268490009 ? "WECHAT_SESSION_EXPIRED" : "VIRTUAL_PAYMENT_FAILED", `微信虚拟支付暂不可用（${result.errcode}）`, 502);
  return result;
}

const orderSchema = z.object({
  order_id: z.string(), status: z.number().int(), order_fee: z.number().int().nonnegative(),
  paid_fee: z.number().int().nonnegative(), order_type: z.number().int(), env_type: z.number().int(),
  wx_order_id: z.string().min(1), left_fee: z.number().int().nonnegative(),
  refund_fee: z.number().int().nonnegative().optional(),
});

async function queryOrder(payment: Payment, orderId = payment.out_trade_no) {
  const result = await virtualRequest("query_order", payment, { openid: payment.openid, order_id: orderId });
  const order = orderSchema.parse(result.order);
  if (order.order_id !== orderId || order.env_type !== payment.environment + 1) throw new AppError("PAYMENT_MISMATCH", "微信订单或支付环境不匹配", 409);
  return order;
}

export class VirtualPaymentProvider implements PaymentProvider {
  async create(payment: Payment) {
    if (!payment.openid || !payment.product_id) throw new AppError("WECHAT_OPENID_REQUIRED", "请在小程序重新登录后支付", 422);
    const signData = JSON.stringify({
      offerId: requiredPaymentConfig("WECHAT_VIRTUAL_OFFER_ID"), buyQuantity: 1,
      env: payment.environment, currencyType: "CNY", productId: payment.product_id,
      goodsPrice: payment.amount_fen, outTradeNo: payment.out_trade_no, attach: payment.id,
    });
    const sessionKey = await readWechatSession(payment.user_id);
    return {
      providerOrderId: payment.out_trade_no,
      clientParams: {
        mode: "virtual", paymentMode: "short_series_goods", signData,
        paySig: virtualSignature(virtualAppKey(payment.environment), `requestVirtualPayment&${signData}`),
        signature: virtualSignature(sessionKey, signData),
      },
    };
  }

  async query(payment: Payment) {
    const order = await queryOrder(payment);
    if (order.order_fee !== payment.amount_fen || order.paid_fee !== payment.amount_fen || ![0, 7].includes(order.order_type)) {
      if ([0, 1, 6].includes(order.status) && order.order_fee === payment.amount_fen) return { paid: false, closed: order.status === 6 };
      throw new AppError("PAYMENT_MISMATCH", "微信订单金额或类型不匹配", 409);
    }
    if (order.left_fee > payment.amount_fen) throw new AppError("PAYMENT_MISMATCH", "微信订单退款余额不匹配", 409);
    return {
      paid: [2, 3, 4, 5, 8].includes(order.status), closed: order.status === 6,
      transactionId: order.wx_order_id, channel: order.order_type === 7 ? "ios" : "wechat",
      refundedFen: payment.amount_fen - order.left_fee,
    };
  }

  async refund(payment: Payment, refund: PaymentRefund) {
    const order = await queryOrder(payment);
    if (order.order_type === 7) throw new AppError("IOS_REFUND_VIA_APPLE", "此订单请在 Apple 购买记录中申请退款", 409);
    if (order.order_fee !== payment.amount_fen || order.left_fee < refund.amount_fen) throw new AppError("REFUND_AMOUNT_INVALID", "当前订单可退金额不足", 409);
    const result = await virtualRequest("refund_order", payment, {
      openid: payment.openid, order_id: payment.out_trade_no, refund_order_id: refund.out_refund_no,
      left_fee: order.left_fee, refund_fee: refund.amount_fen, biz_meta: refund.id,
      refund_reason: refund.reason === "generation_failed" ? "1" : "3", req_from: "2",
    });
    if (result.refund_order_id !== refund.out_refund_no || result.pay_order_id !== payment.out_trade_no) throw new AppError("REFUND_MISMATCH", "微信退款单不匹配", 502);
  }

  async queryRefund(payment: Payment, refund: PaymentRefund) {
    const order = await queryOrder(payment, refund.out_refund_no);
    if (![1, 8].includes(order.order_type) || order.refund_fee !== refund.amount_fen) throw new AppError("REFUND_MISMATCH", "微信退款金额或类型不匹配", 409);
    if ([5, 8].includes(order.status)) return "succeeded" as const;
    if (order.status === 7) return "failed" as const;
    return "processing" as const;
  }

  async acknowledge(payment: Payment) {
    await virtualRequest("notify_provide_goods", payment, { order_id: payment.out_trade_no });
  }
}
