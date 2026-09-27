import { z } from "zod";
import { clientIp, env, rateLimited, supabaseInsert, hasSupabase } from "@/lib/server";

export const runtime = "nodejs";

const Lead = z.object({
  name: z.string().trim().min(1).max(80),
  company: z.string().trim().min(1).max(120),
  industry: z.string().trim().max(60).default(""),
  website: z.string().trim().max(200).default(""),
  contact: z.string().trim().min(5).max(120),
  wants: z.string().trim().max(1500).default(""),
  hp: z.string().max(200).optional(),
  explored: z.array(z.string().max(24)).max(8).default([]),
  ref: z.string().max(60).nullish(),
});

type LeadInput = z.infer<typeof Lead>;

function body(l: LeadInput) {
  return [
    `New enquiry from the contractor sales demo`,
    ``,
    `Name: ${l.name}`,
    `Company: ${l.company}`,
    `Industry: ${l.industry || "—"}`,
    `Website: ${l.website || "—"}`,
    `Reply to: ${l.contact}`,
    `Explored in the demo: ${l.explored.join(", ") || "—"}`,
    `Source: ${l.ref || "direct"}`,
    ``,
    `What they'd like customers to be able to do:`,
    l.wants || "—",
  ].join("\n");
}

async function viaResend(l: LeadInput): Promise<boolean> {
  if (!env.resendKey) return false;
  const email = /\S+@\S+\.\S+/.test(l.contact) ? l.contact : undefined;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.from,
      to: [env.notify],
      reply_to: email,
      subject: `Demo enquiry: ${l.company}${l.industry ? ` (${l.industry})` : ""}`,
      text: body(l),
    }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

async function viaWebhook(l: LeadInput): Promise<boolean> {
  if (!env.webhook) return false;
  const res = await fetch(env.webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "velabuilt-contractor-demo", receivedAt: new Date().toISOString(), ...l, hp: undefined }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

async function viaSupabase(l: LeadInput): Promise<boolean> {
  if (!hasSupabase()) return false;
  return supabaseInsert("demo_leads", {
    name: l.name,
    company: l.company,
    industry: l.industry,
    website: l.website,
    contact: l.contact,
    wants: l.wants,
    explored: l.explored,
    ref: l.ref ?? null,
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 12000) return Response.json({ ok: false, error: "Too long." }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = Lead.safeParse(json);
  if (!parsed.success) return Response.json({ ok: false, error: "Please check the name, company and contact fields." }, { status: 400 });
  const lead = parsed.data;

  // Bots fill the hidden field. Pretend success, deliver nothing.
  if (lead.hp) return Response.json({ ok: true, delivered: true });
  if (rateLimited(`lead:${clientIp(req)}`, 5, 10 * 60 * 1000)) return Response.json({ ok: false, error: "Too many enquiries — please email us directly." }, { status: 429 });

  const channels = [
    ["email", viaResend],
    ["webhook", viaWebhook],
    ["database", viaSupabase],
  ] as const;
  const results = await Promise.allSettled(channels.map(([, fn]) => fn(lead)));
  const delivered = channels.filter((_, i) => results[i].status === "fulfilled" && (results[i] as PromiseFulfilledResult<boolean>).value).map(([n]) => n);
  const configured = !!(env.resendKey || env.webhook || hasSupabase());

  // No personal data in logs: industry and outcome only.
  console.log(JSON.stringify({ type: "lead", industry: lead.industry, explored: lead.explored, delivered, configured }));

  // delivered=false tells the UI to hand the enquiry over to email/WhatsApp — never a fake success.
  return Response.json({ ok: true, delivered: delivered.length > 0, channels: delivered });
}
