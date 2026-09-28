import "server-only";

/** Server-side integration boundary. Every destination is optional and configured by env vars. */

export const env = {
  notify: process.env.LEAD_NOTIFY_EMAIL || "jace@velabuilt.com",
  resendKey: process.env.RESEND_API_KEY || "",
  from: process.env.LEAD_FROM_EMAIL || "VelaBuilt Demo <onboarding@resend.dev>",
  webhook: process.env.LEAD_WEBHOOK_URL || "",
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  /** Cloudflare Turnstile secret: when set, /api/lead requires a valid token from the form */
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || "",
};

/**
 * Only our own pages may call the APIs: a JSON body (so a cross-site request needs a CORS
 * preflight, which we never grant) and, when the browser sends an Origin, our own host.
 * Returns a response to send back, or null to carry on.
 */
export function rejectForeign(req: Request): Response | null {
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return new Response(null, { status: 415 });
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    let from = "";
    try {
      from = new URL(origin).host;
    } catch {}
    if (!host || from !== host) return new Response(null, { status: 403 });
  }
  return null;
}

/** Cloudflare Turnstile server-side check. True when Turnstile is not configured. */
export async function turnstileOk(token: string | undefined, ip: string): Promise<boolean> {
  if (!env.turnstileSecret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.turnstileSecret, response: token });
  if (ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(6000) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export const hasSupabase = () => !!(env.supabaseUrl && env.supabaseKey);

export async function supabaseInsert(table: string, row: Record<string, unknown>): Promise<boolean> {
  if (!hasSupabase()) return false;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: env.supabaseKey,
      authorization: `Bearer ${env.supabaseKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(6000),
  });
  return res.ok;
}

const hits = new Map<string, number[]>();
/** Best-effort per-instance rate limit. */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
