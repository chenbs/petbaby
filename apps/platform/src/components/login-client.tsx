"use client";

import Link from "next/link";
import { useState } from "react";

import { apiFetch } from "@/lib/api";

type Mode = "login" | "register";

function nextPath() {
  const raw = new URLSearchParams(window.location.search).get("next");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginClient({ authenticated, inviteRequired, passwordAuthEnabled }: { authenticated: boolean; inviteRequired: boolean; passwordAuthEnabled: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const path = mode === "login" ? "/api/auth/password/login" : "/api/auth/password/register";
      const body = mode === "login"
        ? { accountName, password }
        : { accountName, password, displayName: displayName || undefined, inviteCode: inviteCode || undefined };
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      window.location.href = nextPath();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请稍后再试");
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败，请稍后再试");
      setBusy(false);
    }
  }

  if (authenticated) {
    return <section className="panel"><span className="eyebrow">当前状态</span><p>你已经登录，可以直接开始创作。</p><div className="button-row"><Link className="primary-button" href="/">进入首页</Link><Link className="secondary-button" href="/me">我的账户</Link><button className="secondary-button" disabled={busy} onClick={logout} type="button">退出登录</button></div>{message ? <div className="error-banner">{message}</div> : null}</section>;
  }

  if (!passwordAuthEnabled) {
    return <section className="panel"><span className="eyebrow">当前状态</span><p>本环境未开启账号密码登录，请在微信小程序内使用微信登录。</p></section>;
  }

  const canSubmit = accountName.trim().length >= 3 && password.length >= (mode === "login" ? 1 : 10) && (!inviteRequired || mode === "login" || inviteCode.trim().length > 0);

  return <section className="panel">
    <div className="button-row" style={{ marginBottom: 16 }}>
      <button className={mode === "login" ? "primary-button" : "secondary-button"} onClick={() => { setMode("login"); setMessage(""); }} type="button">登录</button>
      <button className={mode === "register" ? "primary-button" : "secondary-button"} onClick={() => { setMode("register"); setMessage(""); }} type="button">注册新账号</button>
    </div>
    <div className="form-grid">
      <div className="field"><label htmlFor="login-account">账号</label><input autoComplete="username" id="login-account" maxLength={32} onChange={(event) => setAccountName(event.target.value)} placeholder="字母开头，3-32 位" value={accountName} /></div>
      <div className="field"><label htmlFor="login-password">密码</label><input autoComplete={mode === "login" ? "current-password" : "new-password"} id="login-password" maxLength={72} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />{mode === "register" ? <span className="field-hint">至少 10 位，需同时包含字母和数字</span> : null}</div>
      {mode === "register" ? <div className="field"><label htmlFor="login-nickname">昵称（可选）</label><input id="login-nickname" maxLength={40} onChange={(event) => setDisplayName(event.target.value)} value={displayName} /></div> : null}
      {mode === "register" && inviteRequired ? <div className="field"><label htmlFor="login-invite">邀请码</label><input id="login-invite" maxLength={64} onChange={(event) => setInviteCode(event.target.value)} value={inviteCode} /><span className="field-hint">本环境仅限受邀注册，邀请码由管理员提供</span></div> : null}
      <div className="button-row"><button className="primary-button" disabled={!canSubmit || busy} onClick={submit} type="button">{busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}</button></div>
    </div>
    {message ? <div className="error-banner">{message}</div> : null}
    <p className="field-hint" style={{ marginTop: 12 }}>登录代表你同意<Link href="/legal/terms">用户协议</Link>与<Link href="/legal/privacy">隐私政策</Link>。</p>
  </section>;
}
