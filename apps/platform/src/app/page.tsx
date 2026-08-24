import Link from "next/link";
import { redirect } from "next/navigation";
import { listRuntimePlugins } from "@/plugins/runtime";
import { getOptionalUserId } from "@/server/auth/session";
import { recordEvent } from "@/server/platform-service";
import { findOnThisDay } from "@/server/timeline-service";
export const dynamic = "force-dynamic";
export default async function Home(){const userId=await getOptionalUserId();if(!userId)redirect("/login");const plugins=(await listRuntimePlugins()).filter(plugin=>plugin.status==="live");
/*
 * 「去年今日」（改造方案 A7）。服务端早已实现，此前端上没有任何调用方 ——
 * 已付出的开发成本拿不到任何用户价值，而它正是「积累层要有回报」最便宜的一件。
 *
 * **命中才显示，没命中静默隐藏**：不要渲染一句「今天没有回忆」，
 * 那是在提醒用户产品没内容。
 */
const onThisDay=await findOnThisDay(userId);
await recordEvent(userId,"visited",undefined,"web");return <main className="screen home-screen"><header className="topbar"><Link className="brand" href="/" aria-label="宠物造物局首页"><span className="brand-mark">P</span><span>宠物造物局</span></Link><span className="quota-chip"><b>1</b> 次今日免费</span></header>{onThisDay.length>0&&<section className="section-block" aria-labelledby="on-this-day-title"><span className="eyebrow">{onThisDay[0].yearsAgo===1?"去年今日":`${onThisDay[0].yearsAgo} 年前的今天`}</span><h2 id="on-this-day-title">{onThisDay[0].petName}的第 {onThisDay[0].day} 天</h2><p>{onThisDay[0].date} 拍下的{onThisDay.length>1?`，还有另外 ${onThisDay.length-1} 张`:""}。</p>{/* 指时间线而不是照片库（E6）：照片库是管理视图（批量删改），时间线是叙事视图（第 N 天、里程碑）—— 从一条回忆点进去，用户要看的是后者 */}<Link className="card-action" href={`/timeline?petId=${onThisDay[0].petId}`}>去看看 <b>→</b></Link></section>}<section className="hero"><div className="hero-copy"><span className="eyebrow">PET CREATIVE LAB · 今日营业</span><h1>让它的每张照片，<em>都有新的去处。</em></h1><p>从一张作品、一段短片到一本纪念册，把共同生活认真保存下来。</p></div><div className="pet-orbit" aria-hidden="true"><span className="orbit-copy">已认证 · 好看可爱 · 已认证 · 好看可爱 ·</span><span className="pet-face">P</span><span className="orbit-stamp">PET<br/>OK</span></div></section><section className="catalog" aria-labelledby="catalog-title"><div className="section-heading"><div><span className="eyebrow">正式产品</span><h2 id="catalog-title">今天想为它做什么？</h2></div><span className="hand-note">先预览，满意再解锁</span></div><div className="plugin-grid">{plugins.map((plugin,index)=>{const href=plugin.category==="ai-image"?"/ai/create":plugin.category==="interactive"?"/interactive/create":plugin.category==="video"?"/video/create":plugin.category==="memorial"?"/memorials":plugin.category==="report"?"/commerce":`/create/${plugin.id}`;return <Link className={`plugin-card accent-${plugin.accent}`} href={href} key={plugin.id}><div className="plugin-card-top"><span className="plugin-code">{plugin.code}</span><span className="plugin-price">{plugin.pricing.unlockPrice?`¥${plugin.pricing.unlockPrice}`:"免费"}</span></div><div className="plugin-visual" aria-hidden="true"><span className="visual-number">{String(index+1).padStart(2,"0")}</span><span className="visual-paw">●</span></div><h3>{plugin.name}</h3><p>{plugin.tagline}</p><span className="card-action">开始制作 <b>→</b></span></Link>})}</div></section><section className="promise-strip"><div><b>01</b><span>照片默认私密</span></div><div><b>02</b><span>免费预览成品</span></div><div><b>03</b><span>支付权益可追溯</span></div></section></main>}
