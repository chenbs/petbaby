/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";
import { payWebOrder, webPaymentEnabled, webPaymentNotice } from "@/lib/payment";
import { useEffect, useState } from "react"; import { apiFetch } from "@/lib/api";
type Report={id:string;year:number;locked:boolean;share_token?:string};
type GrowthOrder={id:string;kind:string;status:string;amount:number;resource_id?:string};
/*
 * 会员已于 2026-10-08 下线，付费改扣冻干（docs/product/36-冻干钱包与会员下线实施方案.md）。
 * Web 端不上线（D6），这一页只保留提醒、年度报告与短片的测试入口；充值只在小程序里。
 */
export function CommerceClient(){
  const[subscriptions,setSubscriptions]=useState<any[]>([]);
  const[reports,setReports]=useState<Report[]>([]);
  const[orders,setOrders]=useState<GrowthOrder[]>([]);
  const[message,setMessage]=useState("");
  const[busyPlan,setBusyPlan]=useState("");
  async function reload(){const [s,r,o]=await Promise.all([apiFetch<any[]>("/api/subscriptions"),apiFetch<Report[]>("/api/annual-reports"),apiFetch<GrowthOrder[]>("/api/growth-orders")]);setSubscriptions(s);setReports(r);setOrders(o);}
  useEffect(()=>{reload().catch((error)=>setMessage(error.message));},[]);
  async function reminder(){try{await apiFetch("/api/subscriptions",{method:"POST",body:JSON.stringify({eventType:"birthday",consent:true,wechatAuthorization:"accept"})});await reload();}catch(error){setMessage(error instanceof Error?error.message:"订阅失败");}}
  async function report(){try{await apiFetch("/api/annual-reports",{method:"POST",body:JSON.stringify({year:new Date().getFullYear(),idempotencyKey:crypto.randomUUID()})});await reload();}catch(error){setMessage(error instanceof Error?error.message:"报告生成失败");}}
  /*
   * 叙事年度视频（改造项 E5）。`POST /api/annual-films` 早已建成但**零端上调用方** ——
   * 已建成的能力零触达是纯浪费。
   *
   * 只入队不轮询：叙事视频是四段 filtergraph 而队列并发是 1，渲染要几十秒到几分钟，
   * 让用户停在这一页等是错的。完成后作品会进作品库。
   */
  async function film(){setBusyPlan("film");setMessage("");try{const created=await apiFetch<{shots?:number;petName:string}>("/api/annual-films",{method:"POST",body:JSON.stringify({year:new Date().getFullYear(),durationSeconds:20})});setMessage(`已为 ${created.petName} 开始渲染年度短片${created?.shots?`，用了 ${created.shots} 张照片`:""}。完成后会出现在作品库里。`);}catch(error){setMessage(error instanceof Error?error.message:"年度短片生成失败");}finally{setBusyPlan("");}}
  // 冻干上线前的锁定报告：解锁直接扣冻干，不再走现金订单。
  async function reportAction(report:Report,action:"unlock"|"share"|"revoke"){try{await apiFetch<any>(`/api/annual-reports/${report.id}`,{method:"PATCH",body:JSON.stringify({action})});await reload();}catch(error){setMessage(error instanceof Error?error.message:"操作失败");}}
  async function cancel(id:string){await apiFetch(`/api/subscriptions/${id}`,{method:"DELETE"});await reload();}
  return <>
    {!webPaymentEnabled ? <p className="privacy-note">{webPaymentNotice}</p> : null}
    <section className="panel">
      <div className="button-row"><button className="secondary-button" onClick={reminder} type="button">订阅生日提醒</button><button className="secondary-button" onClick={report} type="button">生成年度报告</button><button className="secondary-button" disabled={busyPlan==="film"} onClick={film} type="button">{busyPlan==="film"?"正在排队…":"生成年度短片"}</button></div>
    </section>
    <section className="settings-list">
      {subscriptions.map((item)=><div key={item.id}><span><b>{item.event_type}</b><small style={{display:"block"}}>{item.status} · {item.template_code||"默认模板"}</small></span><button onClick={()=>cancel(item.id)} type="button">退订</button></div>)}
    </section>
    <div className="work-list" style={{marginTop:20}}>{reports.map((report)=><div className="work-list-item" key={report.id}><div className="work-list-copy"><span>{report.year} 年度报告</span><h2>{report.locked?"预览版":"高清版"}</h2></div><div className="button-row"><a className="secondary-button" href={`/api/annual-reports/${report.id}/download`}>下载</a>{report.locked?<button className="primary-button" onClick={()=>reportAction(report,"unlock")} type="button">解锁高清版</button>:<button className="secondary-button" onClick={()=>reportAction(report,"share")} type="button">开启分享</button>}<button className="secondary-button" onClick={()=>reportAction(report,"revoke")} type="button">撤销分享</button></div></div>)}</div>
    <section className="panel" style={{marginTop:20}}><span className="eyebrow">权益订单</span>{orders.map((order)=><div className="settings-list" key={order.id}><span>{order.kind} · ¥{Number(order.amount).toFixed(2)} · {order.status}</span>{order.status==="pending"?<button disabled={!webPaymentEnabled} onClick={()=>payWebOrder("growth", order.id).then(reload).catch((error) => setMessage(error.message))} type="button">支付</button>:null}</div>)}</section>
    {message?<div className="error-banner">{message}</div>:null}
  </>;
}
