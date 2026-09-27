"use client";

/**
 * One call site for every analytics destination. Never sends names, emails,
 * phone numbers or free text — only event names and short enumerated properties.
 *
 * Destinations:
 *  1. Vercel Web Analytics custom events (when enabled on the project)
 *  2. window.dataLayer (GTM-compatible, if a tag manager is added later)
 *  3. First-party beacon to /api/track (stored in Supabase when configured,
 *     otherwise written to the server log as one JSON line per event)
 */

import { EVENTS, type EventName } from "./events";

export { EVENTS };
export type { EventName };
type Props = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let sessionId = "";
let context: Props = {};
const recent = new Map<string, number>();

function sid() {
  if (!sessionId) {
    sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
  }
  return sessionId;
}

export function setAnalyticsContext(p: Props) {
  context = { ...context, ...p };
}

function clean(p: Props): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" ? v.slice(0, 64) : v;
  }
  return out;
}

export function track(name: EventName, props: Props = {}) {
  if (typeof window === "undefined") return;
  // De-duplicate bursts (e.g. rapid slider changes) per event+primary prop.
  const key = `${name}:${props.industry ?? ""}:${props.option ?? ""}:${props.cta ?? ""}`;
  const now = Date.now();
  if (name === "option_changed" && now - (recent.get(key) ?? 0) < 1500) return;
  recent.set(key, now);

  const payload = clean({ ...context, ...props });

  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: name, ...payload });
  } catch {}

  import("@vercel/analytics")
    .then((m) => m.track(name, payload))
    .catch(() => {});

  try {
    const body = JSON.stringify({ name, props: payload, sid: sid(), path: location.pathname, ts: now });
    const ok = navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }));
    if (!ok) fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch {}

  if (location.search.includes("debug")) console.info("[track]", name, payload);
}
