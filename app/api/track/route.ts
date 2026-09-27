import { z } from "zod";
import { EVENTS } from "@/lib/events";
import { clientIp, hasSupabase, rateLimited, supabaseInsert } from "@/lib/server";

export const runtime = "nodejs";

const Event = z.object({
  name: z.enum(EVENTS),
  props: z.record(z.string().max(40), z.union([z.string().max(64), z.number(), z.boolean(), z.null()])).default({}),
  sid: z.string().max(40),
  path: z.string().max(200).default("/"),
  ts: z.number(),
});

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 4000) return new Response(null, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = Event.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });
  if (rateLimited(`track:${clientIp(req)}`, 240, 60 * 1000)) return new Response(null, { status: 429 });
  const e = parsed.data;
  const row = { name: e.name, props: e.props, sid: e.sid, path: e.path, country: req.headers.get("x-vercel-ip-country") ?? null };
  if (hasSupabase()) {
    await supabaseInsert("demo_events", row).catch(() => false);
  } else {
    // One JSON line per event — searchable in Vercel runtime logs.
    console.log(JSON.stringify({ type: "event", ...row }));
  }
  return new Response(null, { status: 204 });
}
