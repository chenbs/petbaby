import Link from "next/link";

/** 后台的 404：非管理员与不存在的后台页都落到这里，文案不提「后台」。 */
export default function AdminNotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <p className="text-sm font-medium text-muted">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">页面不存在</h1>
        <Link href="/" className="mt-6 inline-block text-sm text-ink-2 underline underline-offset-4 hover:text-ink">返回首页</Link>
      </div>
    </main>
  );
}
