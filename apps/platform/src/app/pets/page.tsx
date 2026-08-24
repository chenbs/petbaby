import Link from "next/link";
import { PetsClient } from "@/components/pets-client";

export default function PetsPage() {
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">PETS</span><h1>宠物档案</h1><p>切换默认宠物或删除不再使用的档案。删除后关联订单仍会保留。</p></div><PetsClient /></main>;
}
