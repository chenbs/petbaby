"use client";

import { useEffect } from "react";

export function ShareTracker({ token, source, accessCode }: { token: string; source: string; accessCode?: string }) {
  useEffect(() => {
    const key = "petbaby_visitor";
    let visitorKey = localStorage.getItem(key);
    if (!visitorKey) { visitorKey = crypto.randomUUID(); localStorage.setItem(key, visitorKey); }
    const startedAt = Date.now();
    fetch(`/api/share/${token}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName: "visit", source, visitorKey, accessCode }), keepalive: true }).catch(() => undefined);
    const recordDuration = () => navigator.sendBeacon(`/api/share/${token}/events`, new Blob([JSON.stringify({ eventName: "duration", source, visitorKey, accessCode, durationSeconds: Math.round((Date.now() - startedAt) / 1000) })], { type: "application/json" }));
    window.addEventListener("pagehide", recordDuration, { once: true });
    return () => window.removeEventListener("pagehide", recordDuration);
  }, [accessCode, source, token]);
  return null;
}
