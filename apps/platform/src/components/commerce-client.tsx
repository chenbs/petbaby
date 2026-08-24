/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react"; import { apiFetch } from "@/lib/api";
import type { MembershipBenefit } from "@/domain/membership";
type Report={id:string;year:number;locked:boolean;share_token?:string};
type Membership={id:string;plan:string;status:string;orderId?:string;order_id?:string;expires_at?:string;benefits?:MembershipBenefit[];annualReportRemaining?:number};
type GrowthOrder={id:string;kind:string;status:string;amount:number;resource_id?:string};
/*
 * 套餐名、价格、权益全部来自 /api/membership-plans（改造项 M3）。
 *
 * 改造前这里写死「月会员 ¥25 / 年会员 ¥199」：迁移 0020 已把月会员置 inactive
 * （点了直接 409）并把年费改成 ¥128（界面承诺 ¥199、实收 ¥128）。
 * 端上任何写死的价格都会以这种方式与迁移走散，所以一律不写。
 */
type Plan={plan:string;label:string;amount:number;period:string;benefits:MembershipBenefit[];singleBuyValue:number;saving:number;breakEven?:number};
const PERIOD_TEXT:Record<string,string>={month:"月",year:"年"};
export function CommerceClient(){
  const[plans,setPlans]=useState<Plan[]>([]);
  const[memberships,setMemberships]=useState<Membership[]>([]);
  const[subscriptions,setSubscriptions]=useState<any[]>([]);
  const[reports,setReports]=useState<Report[]>([]);
  const[orders,setOrders]=useState<GrowthOrder[]>([]);
  const[message,setMessage]=useState("");
  const[busyPlan,setBusyPlan]=useState("");
  async function reload(){const [p,m,s,r,o]=await Promise.all([apiFetch<Plan[]>("/api/membership-plans"),apiFetch<Membership[]>("/api/memberships"),apiFetch<any[]>("/api/subscriptions"),apiFetch<Report[]>("/api/annual-reports"),apiFetch<GrowthOrder[]>("/api/growth-orders")]);setPlans(p);setMemberships(m);setSubscriptions(s);setReports(r);setOrders(o);}
  useEffect(()=>{reload().catch((error)=>setMessage(error.message));},[]);
  async function member(plan:string){setBusyPlan(plan);setMessage("");try{const item=await apiFetch<Membership>("/api/memberships",{method:"POST",body:JSON.stringify({plan})});if(item.orderId||item.order_id){await apiFetch(`/api/growth-orders/${item.orderId||item.order_id}/pay`,{method:"POST"});}await reload();}catch(error){setMessage(error instanceof Error?error.message:"会员支付失败");}finally{setBusyPlan("");}}
  async function reminder(){try{await apiFetch("/api/subscriptions",{method:"POST",body:JSON.stringify({eventType:"birthday",consent:true,wechatAuthorization:"accept"})});await reload();}catch(error){setMessage(error instanceof Error?error.message:"订阅失败");}}
  async function report(){try{await apiFetch("/api/annual-reports",{method:"POST",body:JSON.stringify({year:new Date().getFullYear()})});await reload();}catch(error){setMessage(error instanceof Error?error.message:"报告生成失败");}}
  /*
   * 叙事年度视频（改造项 E5）。`POST /api/annual-films` 早已建成但**零端上调用方** ——
   * 已建成的能力零触达是纯浪费。
   *
   * 只入队不轮询：叙事视频是四段 filtergraph 而队列并发是 1，渲染要几十秒到几分钟，
   * 让用户停在这一页等是错的。完成后作品会进作品库。
   */
  async function film(){setBusyPlan("film");setMessage("");try{const created=await apiFetch<{shots?:number}>("/api/annual-films",{method:"POST",body:JSON.stringify({year:new Date().getFullYear(),durationSeconds:20})});setMessage(`年度短片已开始渲染${created?.shots?`，用了 ${created.shots} 张照片`:""}。完成后会出现在作品库里。`);}catch(error){setMessage(error instanceof Error?error.message:"年度短片生成失败");}finally{setBusyPlan("");}}
  /*
   * 年报解锁可能**不产生订单**：会员的 annualReport 权益命中时服务端直接解锁
   * 并返回 `{unlocked:true}`（M4）。所以这里必须判 result.id 存在才去支付 ——
   * 无条件调支付会对一个不存在的订单 ID 发请求。
   */
  async function reportAction(report:Report,action:"unlock"|"share"|"revoke"){try{const result=await apiFetch<any>(`/api/annual-reports/${report.id}`,{method:"PATCH",body:JSON.stringify({action})});if(action==="unlock"){if(result?.id)await apiFetch(`/api/growth-orders/${result.id}/pay`,{method:"POST"});else if(result?.viaEntitlement)setMessage("已用会员权益解锁高清版");}await reload();}catch(error){setMessage(error instanceof Error?error.message:"操作失败");}}
  async function cancel(id:string){await apiFetch(`/api/subscriptions/${id}`,{method:"DELETE"});await reload();}
  return <>
    <section className="panel">
      {plans.length?<div className="work-list">{plans.map((plan)=><div className="work-list-item" key={plan.plan}>
        <div className="work-list-copy">
          <span>{plan.label}</span>
          <h2>¥{plan.amount} / {PERIOD_TEXT[plan.period]||plan.period}</h2>
          {/*
            「省 ¥N」只在真的为正时说。按「只做一件交付物」的保守口径，
            ¥69 会员的权益值 ¥49 —— 低于定价，这时给「做几件回本」，
            那是用户能自己算的账，而「省 ¥N」在他只做一件时是假的。
          */}
          {plan.saving>0?<small>单买这些权益约 ¥{plan.singleBuyValue}，省 ¥{plan.saving}</small>
            :plan.breakEven?<small>做 {plan.breakEven} 件画册或短片即回本</small>:null}
          <ul className="settings-list">{plan.benefits.map((benefit)=><li key={benefit.key}>{benefit.text}</li>)}</ul>
        </div>
        <div className="button-row"><button className="primary-button" disabled={busyPlan===plan.plan} onClick={()=>member(plan.plan)} type="button">{busyPlan===plan.plan?"正在开通…":"开通"}</button></div>
      </div>)}</div>:<p className="privacy-note">会员套餐正在调整，暂不可开通。</p>}
      <div className="button-row"><button className="secondary-button" onClick={reminder} type="button">订阅生日提醒</button><button className="secondary-button" onClick={report} type="button">生成年度报告</button><button className="secondary-button" disabled={busyPlan==="film"} onClick={film} type="button">{busyPlan==="film"?"正在排队…":"生成年度短片"}</button></div>
    </section>
    <section className="settings-list">
      {memberships.map((item)=><div key={item.id}><span><b>{item.plan} 会员</b><small style={{display:"block"}}>{item.status}{item.expires_at?` · 有效期至 ${new Date(item.expires_at).toLocaleDateString("zh-CN")}`:""}</small>{item.benefits?.map((benefit)=><small key={benefit.key} style={{display:"block"}}>· {benefit.text}</small>)}{item.status==="active"&&typeof item.annualReportRemaining==="number"?<small style={{display:"block"}}>年度报告免费解锁剩余 {item.annualReportRemaining} 次</small>:null}</span></div>)}
      {subscriptions.map((item)=><div key={item.id}><span><b>{item.event_type}</b><small style={{display:"block"}}>{item.status} · {item.template_code||"默认模板"}</small></span><button onClick={()=>cancel(item.id)} type="button">退订</button></div>)}
    </section>
    <div className="work-list" style={{marginTop:20}}>{reports.map((report)=><div className="work-list-item" key={report.id}><div className="work-list-copy"><span>{report.year} 年度报告</span><h2>{report.locked?"预览版":"高清版"}</h2></div><div className="button-row"><a className="secondary-button" href={`/api/annual-reports/${report.id}/download`}>下载</a>{report.locked?<button className="primary-button" onClick={()=>reportAction(report,"unlock")} type="button">解锁高清版</button>:<button className="secondary-button" onClick={()=>reportAction(report,"share")} type="button">开启分享</button>}<button className="secondary-button" onClick={()=>reportAction(report,"revoke")} type="button">撤销分享</button></div></div>)}</div>
    <section className="panel" style={{marginTop:20}}><span className="eyebrow">权益订单</span>{orders.map((order)=><div className="settings-list" key={order.id}><span>{order.kind} · ¥{Number(order.amount).toFixed(2)} · {order.status}</span>{order.status==="pending"?<button onClick={()=>apiFetch(`/api/growth-orders/${order.id}/pay`,{method:"POST"}).then(reload)} type="button">支付</button>:null}</div>)}</section>
    {message?<div className="error-banner">{message}</div>:null}
  </>;
}
