"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AccountProfile } from "@/domain/models";

export function AccountClient() {
  const [profile, setProfile] = useState<AccountProfile>(); const [name, setName] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch<AccountProfile>("/api/account").then((item) => { setProfile(item); setName(item.displayName || ""); }); }, []);
  async function save() { setBusy(true); try { const item = await apiFetch<AccountProfile>("/api/account", { method: "PATCH", body: JSON.stringify({ displayName: name }) }); setProfile(item); setMessage("账户信息已保存"); } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); } }
  async function remove() { if (!window.confirm("删除后照片和作品将不再展示，订单记录会保留。确认继续？")) return; setBusy(true); try { await apiFetch("/api/account/delete", { method: "POST" }); window.location.href = "/"; } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); setBusy(false); } }
  return <section className="panel"><div className="form-grid"><div className="field"><label htmlFor="display-name">显示名称</label><input id="display-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：小林" /></div><button className="primary-button" disabled={busy || !name.trim()} onClick={save} type="button">保存资料</button></div><div className="button-row" style={{ marginTop: 18 }}><a className="secondary-button" href="/api/account/export">导出我的数据</a><button className="secondary-button" disabled={busy} onClick={remove} type="button">删除账户</button></div>{profile ? <p className="privacy-note">账户创建于 {new Date(profile.createdAt).toLocaleDateString("zh-CN")}</p> : null}{message ? <div className="error-banner" role="status">{message}</div> : null}</section>;
}
