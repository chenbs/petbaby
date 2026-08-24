"use client";

import { useEffect, useState } from "react";

import type { Work } from "@/domain/models";
import { apiFetch } from "@/lib/api";

type PhysicalOrder = { id: string; sku: string; amount: number; status: string; tracking_no?: string };
type PhysicalSku = { code: string; name: string; amount: number; required_asset_kind?: string };

export function PhysicalCommerceClient() {
  const [works, setWorks] = useState<Work[]>([]);
  const [skus, setSkus] = useState<PhysicalSku[]>([]);
  const [orders, setOrders] = useState<PhysicalOrder[]>([]);
  const [workId, setWorkId] = useState("");
  const [sku, setSku] = useState("");
  const [address, setAddress] = useState({ name: "", phone: "", province: "", city: "", detail: "" });
  const [message, setMessage] = useState("");
  /*
   * SKU 从 /api/physical-skus 读，不写死。原实现硬编码 `art-print-a4`，
   * 于是 ¥99.9 精装纪念册在 Web 端根本买不到（小程序两个 SKU 都有）——
   * 属 bug 而非功能缺失。
   *
   * 价格也只从接口来：会员实体折扣是服务端在下单时算的（M6），
   * 端上写死「支付 ¥39.90」会在会员那里显示错的金额。
   */
  async function reload() {
    const [nextWorks, nextSkus, nextOrders] = await Promise.all([
      apiFetch<Work[]>("/api/works?locked=false"),
      apiFetch<PhysicalSku[]>("/api/physical-skus"),
      apiFetch<PhysicalOrder[]>("/api/physical-orders"),
    ]);
    setWorks(nextWorks);
    setSkus(nextSkus);
    setOrders(nextOrders);
    setWorkId((id) => id || nextWorks[0]?.id || "");
    setSku((code) => code || nextSkus[0]?.code || "");
  }
  useEffect(() => { void reload().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "订单读取失败")); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  async function create() {
    try {
      const order = await apiFetch<PhysicalOrder>("/api/physical-orders", { method: "POST", body: JSON.stringify({ workId, sku, address }) });
      await apiFetch(`/api/physical-orders/${order.id}/pay`, { method: "POST" });
      setMessage(`已支付 ¥${Number(order.amount).toFixed(2)}，印刷文件正在质检`);
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "下单失败"); }
  }
  const selected = skus.find((item) => item.code === sku);
  return <><section className="panel"><div className="form-grid"><div className="field"><label htmlFor="physical-work">作品</label><select id="physical-work" value={workId} onChange={(event) => setWorkId(event.target.value)}>{works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}</select></div><div className="field"><label htmlFor="physical-sku">商品规格</label><select id="physical-sku" value={sku} onChange={(event) => setSku(event.target.value)}>{skus.map((item) => <option key={item.code} value={item.code}>{item.name} · ¥{Number(item.amount).toFixed(2)}</option>)}</select></div>{Object.entries(address).map(([key, value]) => <div className="field" key={key}><label htmlFor={`address-${key}`}>{key}</label><input id={`address-${key}`} value={value} onChange={(event) => setAddress({ ...address, [key]: event.target.value })} /></div>)}</div><p className="privacy-note">会员的实体折扣在下单时自动生效，实付金额以订单为准。</p><button className="primary-button" onClick={create} disabled={!workId || !sku} type="button">{selected ? `创建订单并支付（${selected.name}）` : "创建订单并支付"}</button></section><div className="settings-list" style={{ marginTop: 20 }}>{orders.map((order) => <div key={order.id}><span><b>{order.sku}</b><small style={{ display: "block" }}>¥{Number(order.amount).toFixed(2)} · {order.status}</small></span><span>{order.tracking_no || "等待履约"}</span></div>)}</div>{message ? <div className="error-banner">{message}</div> : null}</>;
}
