import Link from "next/link";

import { UserStatusClient } from "@/components/user-status-client";
import { isAdmin } from "@/server/auth/admin";
import { getOptionalUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const userId = await getOptionalUserId();
  const showAdmin = Boolean(userId && isAdmin(userId));
  return <main className="screen"><div className="page-heading"><span className="eyebrow">ACCOUNT</span><h1>我的宠物造物局</h1><p>在这里管理宠物资产、作品、订单、额度和隐私。</p></div><UserStatusClient /><section className="settings-list">{/* 时间线排在第一位（E6）：它是积累层的底座，而不是又一个玩法入口 */}<Link href="/timeline"><b>成长时间线</b><span>按拍摄时间回看，含里程碑与年度短片</span></Link><Link href="/video/create"><b>宠物记忆短片</b><span>照片、字幕、转场和高清视频</span></Link><Link href="/pets"><b>宠物档案</b><span>头像、日期与生命阶段</span></Link><Link href="/photos"><b>照片库</b><span>浏览、排序与删除</span></Link><Link href="/works"><b>我的作品</b><span>状态、版本、下载与分享</span></Link><Link href="/orders"><b>订单与退款</b><span>查看退款进度</span></Link><Link href="/account"><b>账户与隐私</b><span>资料、导出和删除</span></Link><Link href="/login"><b>登录与退出</b><span>切换账号或退出当前登录</span></Link><Link href="/support"><b>常见错误指引</b><span>上传、生成、支付与退款</span></Link><Link href="/memorials"><b>纪念空间</b><span>安静保存故事</span></Link><Link href="/commerce"><b>会员与实体订单</b><span>会员、订阅、实体订单和年度报告</span></Link>{showAdmin ? <Link href="/admin"><b>运营后台</b><span>管理员专用入口</span></Link> : null}</section></main>;
}
