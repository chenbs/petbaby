"use client";

import { useEffect, useState } from "react";

import type { PluginManifest } from "@/domain/models";
import { apiFetch } from "@/lib/api";

type Version = { id: string; version: number; template_version: string; created_at: string };

export function PluginAdminClient() {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [pluginId, setPluginId] = useState("");
  const [manifest, setManifest] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("玩法配置运营调整");
  useEffect(() => { apiFetch<PluginManifest[]>("/api/plugins").then((items) => { setPlugins(items); if (items[0]) select(items[0], items); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function select(plugin: PluginManifest, all = plugins) { setPluginId(plugin.id); setManifest(JSON.stringify(plugin, null, 2)); setPlugins(all); apiFetch<Version[]>(`/api/admin/plugins/${plugin.id}`).then(setVersions); }
  async function save() { try { const parsed = JSON.parse(manifest) as PluginManifest; const result = await apiFetch<{ manifest: PluginManifest; version: number }>(`/api/admin/plugins/${pluginId}`, { method: "PUT", body: JSON.stringify({ manifest: parsed, reason }) }); setMessage(`已发布 v${result.version}`); select(result.manifest); } catch (error) { setMessage(error instanceof Error ? error.message : "发布失败"); } }
  async function rollback(version: number) { try { const result = await apiFetch<{ manifest: PluginManifest; version: number }>(`/api/admin/plugins/${pluginId}`, { method: "POST", body: JSON.stringify({ version, reason }) }); setMessage(`已将 v${version} 重新发布为 v${result.version}`); select(result.manifest); } catch (error) { setMessage(error instanceof Error ? error.message : "回滚失败"); } }
  return <><section className="panel"><div className="field"><label htmlFor="plugin-select">玩法</label><select id="plugin-select" value={pluginId} onChange={(event) => { const plugin = plugins.find((item) => item.id === event.target.value); if (plugin) select(plugin); }}>{plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.code} · {plugin.name}</option>)}</select></div><div className="field"><label htmlFor="plugin-manifest">Manifest JSON</label><textarea id="plugin-manifest" style={{ minHeight: 420, fontFamily: "monospace" }} value={manifest} onChange={(event) => setManifest(event.target.value)} /></div><div className="field"><label htmlFor="plugin-reason">操作原因</label><input id="plugin-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div><button className="primary-button" onClick={save} type="button">发布新版本</button>{message ? <div className="error-banner" role="status">{message}</div> : null}</section><section className="panel" style={{ marginTop: 20 }}><h2>配置历史</h2><div className="settings-list">{versions.map((version, index) => <div key={version.id}><span><b>v{version.version}</b><small style={{ display: "block" }}>模板 {version.template_version} · {new Date(version.created_at).toLocaleString("zh-CN")}</small></span>{index ? <button className="secondary-button" onClick={() => void rollback(version.version)} type="button">一键回滚</button> : <span>当前版本</span>}</div>)}</div></section></>;
}
