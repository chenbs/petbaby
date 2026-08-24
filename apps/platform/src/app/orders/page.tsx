import Link from "next/link";
import { OrdersClient } from "@/components/orders-client";

export default function OrdersPage() { return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">ORDERS</span><h1>订单与退款</h1><p>生成失败全额退；效果不满意可退 50%，每位用户限一次。</p></div><OrdersClient /></main>; }
