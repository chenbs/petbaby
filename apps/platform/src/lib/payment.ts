import { apiFetch } from "./api";

export const webPaymentEnabled = process.env.NODE_ENV !== "production";
export const webPaymentNotice = "此页面仅支持查看订单和使用已有权益，暂不支持付款。";

export async function payWebOrder<Result = unknown>(kind: "work" | "growth" | "physical", id: string): Promise<Result> {
  if (!webPaymentEnabled) throw new Error(webPaymentNotice);
  const paths = { work: "/api/orders/", growth: "/api/growth-orders/", physical: "/api/physical-orders/" };
  const path = paths[kind] + id;
  const prepared = await apiFetch<{ clientParams: { mode: string } }>(path + "/prepare", { method: "POST", body: "{}" });
  if (prepared.clientParams.mode !== "development") throw new Error(webPaymentNotice);
  return apiFetch<Result>(path + "/pay", { method: "POST", body: "{}" });
}
