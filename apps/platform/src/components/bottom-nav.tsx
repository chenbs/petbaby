"use client";
import Link from "next/link";import{usePathname}from"next/navigation";
const items=[{href:"/",label:"玩法",icon:"P"},{href:"/works",label:"作品",icon:"W"},{href:"/me",label:"我的",icon:"M"}];
export function BottomNav(){const pathname=usePathname();if(pathname.startsWith("/share/")||pathname.startsWith("/memorial/share/")||pathname.startsWith("/annual-report/share/")||pathname.startsWith("/admin"))return null;return <nav className="bottom-nav" aria-label="主要导航">{items.map(item=>{const active=item.href==="/"?pathname==="/":pathname.startsWith(item.href);return <Link className={active?"nav-item active":"nav-item"} href={item.href} key={item.href}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>})}</nav>}
