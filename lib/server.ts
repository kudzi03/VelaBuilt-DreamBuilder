import "server-only";

/** Server-side integration boundary. Every destination is optional and configured by env vars. */

export const env = {
  notify: process.env.LEAD_NOTIFY_EMAIL || "jace@velabuilt.com",
  resendKey: process.env.RESEND_API_KEY || "",
  from: process.env.LEAD_FROM_EMAIL || "VelaBuilt Demo <onboarding@resend.dev>",
  webhook: process.env.LEAD_WEBHOOK_URL || "",
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
};

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
