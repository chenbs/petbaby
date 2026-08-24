import Link from "next/link";

export default function SupportPage() {
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">SUPPORT</span><h1>常见错误与处理</h1><p>先按对应指引恢复流程；订单和退款状态以订单页数据为准。</p></div><section className="settings-list"><div><span><b>照片上传失败</b><small style={{ display: "block" }}>保留已成功文件，检查网络后点击重试；大图会在客户端自动压缩。</small></span></div><div><span><b>生成失败</b><small style={{ display: "block" }}>系统自动重试一次，最终失败会返还免费额度，可从作品页重新尝试。</small></span></div><div><span><b>长时间排队</b><small style={{ display: "block" }}>生成页会显示真实位次和预计耗时；超过五分钟可返回作品页查看状态。</small></span></div><div><span><b>支付后仍有水印</b><small style={{ display: "block" }}>先刷新作品详情；仍未解锁时保留订单号并联系正式客服。</small></span></div><Link href="/orders"><b>订单与退款进度</b><span>查看</span></Link><Link href="/legal/refund"><b>退款规则</b><span>查看</span></Link><Link href="/account"><b>数据导出与删除</b><span>管理</span></Link></section></main>;
}
