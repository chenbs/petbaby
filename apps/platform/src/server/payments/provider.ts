import "server-only";
import { AppError } from "@/server/errors";
import { isRealProduction } from "@/server/runtime-mode";
import { VirtualPaymentProvider } from "./virtual-provider";
import { WechatPaymentProvider } from "./wechat-provider";
import type { Payment, PaymentChannel, PaymentProvider } from "./types";

class DevelopmentPaymentProvider implements PaymentProvider {
  async create(payment: Payment) { return { providerOrderId: payment.out_trade_no, clientParams: { mode: "development" } }; }
  async query() { return { paid: false }; }
  async refund() {}
  async queryRefund() { return "succeeded" as const; }
}

export function paymentProviderFor(channel: PaymentChannel): PaymentProvider {
  if (channel === "virtual") return new VirtualPaymentProvider();
  if (channel === "wechat") return new WechatPaymentProvider();
  if (isRealProduction()) throw new AppError("PAYMENT_ADAPTER_REQUIRED", "正式生产禁止模拟支付", 503);
  return new DevelopmentPaymentProvider();
}
