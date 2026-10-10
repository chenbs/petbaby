import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { isRealProduction, isStaging } from "@/server/runtime-mode";
import type { OrderKind, PaymentChannel } from "./types";

export function requiredPaymentConfig(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AppError("PAYMENT_CONFIG_PENDING", `${name} 尚未配置`, 503);
  return value.replaceAll("\\n", "\n");
}

export function selectPaymentChannel(kind: OrderKind, sku: string): PaymentChannel {
  /*
   * 2026-10 起虚拟商品只剩冻干充值档（fd-topup-*）。其余 SKU 只为历史订单的查单 / 退款保留：
   * 新订单已不会再创建它们（会员下线，作品与权益改扣冻干）。
   */
  const virtual = kind === "work" || (kind === "growth" && /^(fd-topup-(6-first|6|18|38|68|128)|membership-(monthly|yearly)-v\d+|annual-report-hd|health-archive-pdf|pet-art-photo-bundle-(10|24|36))$/.test(sku));
  if (kind !== "physical" && !virtual) throw new AppError("PAYMENT_SKU_UNSUPPORTED", "商品尚未配置支付类型", 422);
  const setting = kind === "physical" ? (process.env.PHYSICAL_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER) : process.env.PAYMENT_PROVIDER;
  if (!isRealProduction() && (setting === "development" || (!setting && !isStaging()))) return "development";
  return kind === "physical" ? "wechat" : "virtual";
}

export function virtualEnvironment(): number {
  const environment = Number(process.env.WECHAT_VIRTUAL_ENV || "0");
  if (![0, 1].includes(environment) || (isRealProduction() && environment !== 0)) {
    throw new AppError("VIRTUAL_ENV_INVALID", "正式生产必须使用虚拟支付现网环境", 503);
  }
  return environment;
}

export function virtualAppKey(environment: number): string {
  return requiredPaymentConfig(environment === 1 ? "WECHAT_VIRTUAL_SANDBOX_APP_KEY" : "WECHAT_VIRTUAL_APP_KEY");
}

export function virtualProduct(sku: string, amountFen: number): string {
  const schema = z.record(z.string(), z.string().min(1).max(128));
  let mapping: Record<string, string>;
  try { mapping = schema.parse(JSON.parse(requiredPaymentConfig("WECHAT_VIRTUAL_PRODUCTS"))); }
  catch { throw new AppError("VIRTUAL_PRODUCTS_PENDING", "虚拟支付商品及分档价格尚未配置", 503); }
  const product = mapping[`${sku}:${amountFen}`];
  if (!product) throw new AppError("VIRTUAL_PRODUCT_PENDING", "当前商品价格尚未在微信上架", 503);
  return product;
}
