"use client";

import { useEffect, useState } from "react";

import type { Order } from "@/domain/models";
import { apiFetch } from "@/lib/api";

export function OrdersClient() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [message, setMessage] = useState("");
  const reload = () => apiFetch<Order[]>("/api/orders/list").then(setOrders).catch(() => setOrders([]));
  useEffect(() => { reload(); }, []);
  async function refund(order: Order) {
    try { const result = await apiFetch<{ amount: number; status: string }>(`/api/orders/${order.id}/refund`, { method: "POST", body: JSON.stringify({ reason: "dissatisfied" }) }); setMessage(`退款 ¥${result.amount.toFixed(2)}：${result.status}`); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "退款失败"); }
  }
  if (orders === null) return <div className="empty-state"><b>正在读取订单…</b></div>;
  return <><div className="settings-list">{orders.length ? orders.map((order) => <div key={order.id}><span><b>¥{order.amount.toFixed(2)}</b> · {order.status}<small style={{ display: "block" }}>SKU：{order.sku} · 成交单价 ¥{order.unitPrice.toFixed(2)}</small></span>{order.status === "paid" ? <button type="button" onClick={() => refund(order)}>不满意退 50%</button> : <span>已退款 ¥{order.refundedAmount.toFixed(2)}</span>}</div>) : <div>还没有订单</div>}</div>{message ? <div className="error-banner">{message}</div> : null}</>;
}
