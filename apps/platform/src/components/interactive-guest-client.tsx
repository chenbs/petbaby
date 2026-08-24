"use client";

import { useEffect, useState } from "react";
import type { InteractiveSession } from "@/domain/models";
import { InteractiveCanvas } from "@/components/interactive-canvas";
import { apiFetch } from "@/lib/api";

export function InteractiveGuestClient({ session, token, source }: { session: InteractiveSession; token: string; source: string }) {
  const [visitorKey, setVisitorKey] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { const existing = localStorage.getItem("petbaby_interactive_visitor"); if (existing) { setVisitorKey(existing); return; } const created = crypto.randomUUID(); localStorage.setItem("petbaby_interactive_visitor", created); setVisitorKey(created); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (!visitorKey) return;
    const startedAt = Date.now(); apiFetch(`/api/interactive-share/${token}`, { method: "POST", body: JSON.stringify({ name: "visit", visitorKey, source, payload: {} }) }).catch(() => undefined);
    return () => { fetch(`/api/interactive-share/${token}`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "duration", visitorKey, source, durationMs: Date.now() - startedAt, payload: {} }) }).catch(() => undefined); };
  }, [source, token, visitorKey]);
  return <InteractiveCanvas photoUrl={`/api/interactive-share/${token}/media/${encodeURIComponent(session.photoIds[0])}`} snapshot={session.snapshot} token={token} visitorKey={visitorKey} />;
}
