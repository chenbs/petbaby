"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import {
  Activity, Clapperboard, FlaskConical, Flower2, LayoutDashboard, ListChecks, LogOut, Mail, Menu, Moon, PawPrint, Puzzle,
  ReceiptText, ScrollText, Search, Sparkles, Star, Sun, TrendingUp, Users, Wallet, X,
} from "lucide-react";

import { cn } from "./ui";

type NavItem = { href: string; label: string; icon: typeof Activity; badgeKey?: keyof ShellBadges };
type NavGroup = { title: string; items: NavItem[] };

export type ShellBadges = { tasks?: number; orders?: number; messages?: number };

const NAV: NavGroup[] = [
  { title: "分析", items: [
    { href: "/admin", label: "总览", icon: LayoutDashboard },
    { href: "/admin/growth", label: "用户增长", icon: TrendingUp },
    { href: "/admin/features", label: "功能使用", icon: Sparkles },
    { href: "/admin/revenue", label: "收入与冻干", icon: Wallet },
  ] },
  { title: "运营", items: [
    { href: "/admin/users", label: "用户", icon: Users },
    { href: "/admin/orders", label: "订单与履约", icon: ReceiptText, badgeKey: "orders" },
    { href: "/admin/tasks", label: "任务监控", icon: ListChecks, badgeKey: "tasks" },
    { href: "/admin/messages", label: "消息与报告", icon: Mail, badgeKey: "messages" },
  ] },
  { title: "内容", items: [
    { href: "/admin/curation", label: "麻麻精选", icon: Star },
    { href: "/admin/plugins", label: "玩法配置", icon: Puzzle },
    { href: "/admin/experiments", label: "玩法赛马", icon: FlaskConical },
    { href: "/admin/video", label: "视频目录", icon: Clapperboard },
    { href: "/admin/memorials", label: "纪念空间", icon: Flower2 },
  ] },
  { title: "系统", items: [
    { href: "/admin/system", label: "系统健康", icon: Activity },
    { href: "/admin/audit", label: "审计日志", icon: ScrollText },
  ] },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ badges, onNavigate }: { badges: ShellBadges; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="后台导航" className="space-y-5">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const badge = item.badgeKey ? badges[item.badgeKey] || 0 : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors",
                      active ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-surface-3/70 hover:text-ink",
                    )}
                  >
                    <item.icon aria-hidden className={cn("size-4 shrink-0", active ? "text-accent" : "text-muted group-hover:text-ink-2")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge > 0 ? <span className="rounded-full bg-[color-mix(in_srgb,var(--critical)_14%,transparent)] px-1.5 text-[11px] font-semibold text-critical-ink tnum" aria-label={`${badge} 项待处理`}>{badge > 99 ? "99+" : badge}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5 px-3">
      <span className="grid size-8 place-items-center rounded-lg bg-accent text-white shadow-card"><PawPrint aria-hidden className="size-4.5" /></span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">麻麻抱我</span>
        <span className="block text-[11px] text-muted">运营控制台</span>
      </span>
    </Link>
  );
}

export function AdminShell({ children, badges, operator, environment }: { children: React.ReactNode; badges: ShellBadges; operator: { id: string; name: string }; environment: { mode: string; label: string } }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface-2/60 py-4 lg:flex">
        <Brand />
        <div className="scrollbar-thin mt-6 flex-1 overflow-y-auto px-2"><NavList badges={badges} /></div>
        <Operator operator={operator} environment={environment} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] px-4 backdrop-blur-md sm:px-6">
          <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <Dialog.Trigger className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 lg:hidden" aria-label="打开导航"><Menu className="size-5" /></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface py-4 shadow-pop lg:hidden">
                <Dialog.Title className="sr-only">后台导航</Dialog.Title>
                <Dialog.Description className="sr-only">选择要进入的后台页面</Dialog.Description>
                <div className="flex items-center justify-between pr-3"><Brand /><Dialog.Close className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="关闭导航"><X className="size-4" /></Dialog.Close></div>
                <div className="scrollbar-thin mt-6 flex-1 overflow-y-auto px-2"><NavList badges={badges} onNavigate={() => setMobileOpen(false)} /></div>
                <Operator operator={operator} environment={environment} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            {environment.mode !== "production" ? <span className="hidden rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs text-ink-2 sm:inline">{environment.label}</span> : null}
            <ThemeToggle />
          </div>
        </header>
        <main id="admin-main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function Operator({ operator, environment }: { operator: { id: string; name: string }; environment: { label: string } }) {
  return (
    <div className="mx-2 mt-3 flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
      <span className="grid size-7 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2">{operator.name.slice(0, 1)}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-xs font-medium text-ink">{operator.name}</span>
        <span className="block truncate text-[11px] text-muted">{environment.label}</span>
      </span>
      <LogoutButton />
    </div>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-Petbaby-Client": "web" } }).catch(() => undefined);
    // 会话已清，回登录页并刷新服务端外壳（未登录时 layout 不渲染侧栏）
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={() => void logout()} disabled={busy} className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="退出登录" title="退出登录">
      <LogOut className="size-4" />
    </button>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("admin-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(event) => { event.preventDefault(); const q = value.trim(); if (q) router.push(`/admin/search?q=${encodeURIComponent(q)}`); }}
    >
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <label htmlFor="admin-search" className="sr-only">搜索用户、订单号</label>
      <input
        id="admin-search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="搜索用户 ID、昵称、openid、订单号…"
        className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-14 text-sm text-ink placeholder:text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--focus)_25%,transparent)]"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface-2 px-1.5 font-mono text-[10px] text-muted sm:block">Ctrl K</kbd>
    </form>
  );
}

const THEME_KEY = "petbaby-admin-theme";

/** 明暗主题：首屏由 layout 里的内联脚本先设好 data-theme，这里只负责切换与持久化。 */
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    // 首屏主题已由内联脚本写到 <html data-theme>，这里只同步给按钮显示。
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 隐私模式下写不了，不影响本次切换 */ }
    setTheme(next);
  }
  return (
    <button type="button" onClick={toggle} className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}>
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();`;
