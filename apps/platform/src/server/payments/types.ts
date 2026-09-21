import type { SqlRow } from "@/server/db/client";

export type OrderKind = "work" | "growth" | "physical";
export type PaymentChannel = "development" | "wechat" | "virtual";
export interface Payment extends SqlRow {
  id: string;
  user_id: string;
  order_id: string;
  order_kind: OrderKind;
  sku: string;
  amount_fen: number;
  provider: PaymentChannel;
  out_trade_no: string;
  openid: string | null;
  product_id: string | null;
  environment: number;
  status: "pending" | "paid" | "closed" | "refunded";
  provider_transaction_id: string | null;
  channel: string | null;
  refunded_fen: number;
  acknowledged_at: Date | null;
}
export interface PaymentRefund extends SqlRow {
  id: string;
  payment_id: string;
  out_refund_no: string;
  amount_fen: number;
  reason: string;
  status: "pending" | "processing" | "succeeded" | "failed";
}
export interface PaymentConfirmation {
  paid: boolean;
  closed?: boolean;
  transactionId?: string;
  channel?: string;
  refundedFen?: number;
}
export interface PaymentProvider {
  create(payment: Payment): Promise<{ providerOrderId: string; clientParams: Record<string, string> }>;
  query(payment: Payment): Promise<PaymentConfirmation>;
  refund(payment: Payment, refund: PaymentRefund): Promise<void>;
  queryRefund(payment: Payment, refund: PaymentRefund): Promise<"processing" | "succeeded" | "failed">;
  acknowledge?(payment: Payment): Promise<void>;
}
