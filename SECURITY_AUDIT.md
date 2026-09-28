# Security audit — VelaBuilt DreamBuilder

**Target:** https://velabuilt-dreambuilder.vercel.app (production deployment `dpl_FRGhzVryFXFs9RrqY6CrVySRwrkW`, commit `ce8ca24`)
**Repository:** `kudzi03/VelaBuilt-DreamBuilder`, all branches (`claude/velabuilt-interactive-demo-t3fmgo`, `claude/velabuilt-visual-upgrade-84x37x`), 20 commits
**Date:** 2026-09-28
**Scope:** source, full git history, the compiled client bundle as deployed, live HTTP behaviour, Vercel project configuration, dependencies.
The first pass changed no code. The findings below describe the deployment as audited; what was
fixed afterwards is under "Remediation status".

---

## Verdict

**Is it safe to publicly share https://velabuilt-dreambuilder.vercel.app right now? — Yes.**

This is not a "the build passes" answer. It rests on these verified facts:

1. **There is nothing secret to leak.** The Vercel project has **zero environment variables**
   (checked through the Vercel API, names only). No key, token, webhook URL or database
   credential exists in production, in the working tree, or in any of the 20 commits on either
   branch (pattern scan of every blob in every revision).
2. **Nothing a visitor does reaches a paid or real-world service.** With no delivery channel
   configured, `POST /api/lead` validates the input, writes one line without personal data to
   the Vercel log, and returns `delivered: false`. The UI then hands the visitor a pre-written
   email from *their own* mail app. No email is sent, no webhook is called, no database is written.
   No AI/LLM API is used anywhere in the project.
3. **The business flow is a client-side simulation.** The CRM card, WhatsApp follow-up,
   booking and job steps make no network calls; the only requests the app makes are to its own
   `/api/track` and `/api/lead`.
4. **No Supabase is in use**, so no RLS or lead-enumeration exposure exists today.
5. **The client bundle holds no server configuration** and no source maps are served.
6. **`npm audit` reports 0 known vulnerabilities**, production and dev dependencies.

The residual exposure is **cost and availability through bandwidth** (the 3D scene is heavy —
see M2) and **abuse of the enquiry form once you connect a real delivery channel** (M1). Neither
is a reason to hold back the link today, but **M1 must be addressed before you set
`RESEND_API_KEY`, `LEAD_WEBHOOK_URL` or Supabase variables**, and M2 needs a two-minute check
of your Vercel plan and spend settings.

| Severity | Count |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 6 |
| INFORMATIONAL | 12 |

Because there were no CRITICAL or HIGH findings, the first pass applied no fixes. The owner then
asked for the MEDIUM and LOW fixes. Their status is below.

---

## Remediation status (second pass, same day)

| Finding | Status | What changed |
| --- | --- | --- |
| **M1** enquiry abuse | **Fixed in code.** One dashboard step is open (edge rate limit). | Both APIs accept only `application/json` from their own origin: `text/plain`/form bodies return 415, a foreign `Origin` returns 403 (`lib/server.ts` → `rejectForeign`). Optional **Cloudflare Turnstile**: the form loads the widget and the server verifies the token when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` are set (`LeadForm.tsx`, `turnstileOk`). A **global backstop**: past 30 deliveries an hour per instance, enquiries fall back to the email hand-off and never reach Resend, the webhook or Supabase, whatever IPs the flood uses. The per-IP limit is unchanged. |
| **M2** bandwidth / invocation cost | **Partly fixed in code.** Dashboard steps are open. | `/api/track` per-IP limit tightened to 120/min and made same-origin only. Static assets are served by Vercel's CDN and never reach application code, so bandwidth can only be capped at the edge: see "Owner actions". |
| **L1** CSP and headers | **Fixed** | Enforced `Content-Security-Policy` (same-origin everything; `'wasm-unsafe-eval'` for the meshopt decoder; Turnstile hosts only when configured; `vercel.live` only on previews; `frame-ancestors 'self'`, `object-src 'none'`, `base-uri`/`form-action 'self'`). Added `Cross-Origin-Opener-Policy: same-origin`. Widened `Permissions-Policy`. `productionBrowserSourceMaps: false` is now explicit. Tested: all ten scenes and the full interaction run with **zero CSP violations**. |
| **L2** `.gitignore` | **Fixed** | `.env*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `service-account*.json`, `.npmrc` are now ignored. Verified with `git check-ignore`. |
| **L3** Supabase RLS | **Fixed (docs)** | The README SQL now enables RLS on both tables, revokes `anon`/`authenticated`, includes an events-retention query, and adds a one-line check that the anon key reads nothing. |
| **L4** cross-site simple POSTs | **Fixed** | Same change as M1 (`rejectForeign` on both routes). |
| **L5** `?company=` spoofing | **Fixed** | Only a plausible company name is shown: letters, digits, `& ' . , ( ) -`, ≤ 60 characters, no URLs. Anything else drops the personalisation (`components/Experience.tsx`). |
| **L6** fabricated analytics | **Mitigated** | Same-origin only and a tighter per-IP limit. A determined script can still send events from our own origin, so treat the numbers as indicative, not audited. |

### Owner actions (need the Vercel dashboard; the API could not create them)

I tried to add the edge rules through the Vercel API. It returned `404 Seawall Config not found`
because this project's firewall has never been initialised; the dashboard does that the first
time the Firewall tab is opened.

1. **Project → Firewall → Configure → Add rule** (three rules, each "Rate limit" by IP, then
   **Deny**, fixed window):
   - `Request Path` equals `/api/lead`: 5 requests / 600 s
   - `Request Path` equals `/api/track`: 120 requests / 60 s
   - `Request Path` starts with `/assets/`: 600 requests / 60 s

   Then **Publish**.
2. **Settings → Billing**: confirm the plan. On **Pro**, turn on **Spend Management** with a
   hard limit and "pause production deployments". On **Hobby**, no bill is possible. The site
   pauses if the monthly transfer allowance runs out.
3. **Before connecting Resend, a webhook or Supabase:** create a Turnstile widget in Cloudflare
   (free) and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel. The CSP
   and the form pick them up on the next deploy.

---

## CRITICAL

None.

## HIGH

None.

---

## MEDIUM

### M1 — The enquiry endpoint becomes an abuse vector as soon as a delivery channel is configured

**Evidence.** `POST /api/lead` needs no authentication (by design: it is a public form). Its
anti-abuse measures are:
- a hidden honeypot field (`hp`), which defeats naive bots only;
- `rateLimited("lead:<ip>", 5, 10 min)` in `lib/server.ts`, which keeps state in an in-memory
  `Map` **per serverless instance**. Vercel runs many instances and recycles them, so the
  effective limit is "5 per IP per warm instance", not a global limit.

Tested against the production build: the 6th request from one IP inside the window returns 429.
Requests from different IPs are not limited. The endpoint also accepts `text/plain` bodies, so
the POST needs no CORS preflight.

**Affected:** `app/api/lead/route.ts`, `lib/server.ts` (`rateLimited`).

**Realistic impact today:** none. No channel is configured, so every submission is a no-op
plus one log line.

**Realistic impact once configured:**
- `RESEND_API_KEY` set: a script with rotating IPs can send hundreds of emails to
  `LEAD_NOTIFY_EMAIL`. That floods your inbox and uses up the Resend quota (free tier: 100/day,
  3,000/month). Recipients stay safe: the `to` address is fixed server-side and can't be chosen
  by the caller, and `reply_to` only affects your own replies.
- `LEAD_WEBHOOK_URL` set: each submission is one Zapier/Make task. On a paid automation
  plan, junk submissions cost money and can push real leads out of view.
- Supabase set: junk rows accumulate in `demo_leads`.

**Remediation — do this before setting any of those variables:**
1. Add a Vercel Firewall rate-limit rule. Project → Firewall → Rules → Rate limit:
   path `/api/lead`, 5 requests / 10 minutes per IP, action Deny. It runs at the edge, across
   all instances.
2. Add a human check: Cloudflare Turnstile (free, no tracking) or Vercel BotID on the form.
   Verify the token server-side in `route.ts` before any delivery call.
3. Reject cross-site submissions. At the top of `POST`:
   `if (req.headers.get("content-type")?.split(";")[0] !== "application/json") return 415;`
   and reject when `Origin` is present and is not your own host.
4. In Resend, set a daily sending cap and alerts. In Zapier/Make, add a filter step that drops
   `source != "velabuilt-contractor-demo"`.

### M2 — Bandwidth and invocation cost exposure has no spend guardrails configured

**Evidence.**
- The first 3D view downloads about **11.6 MB on desktop and 3.8 MB on phones** (textures,
  3D trees, skies, models; figures measured and documented in `README.md` → Performance).
  All of it is publicly cacheable static files.
- `/api/track` accepts unauthenticated POSTs; only the per-instance 240/min/IP limit applies.
  Each POST is one function invocation plus one log line.
- `GET /v1/security/firewall/config` for the project returned "not found": **no firewall
  rules are configured.**
- The Vercel API did not report the plan tier for team `pagiwakudzayi-8828s-projects`.

**Affected:** the whole deployment; `app/api/track/route.ts`.

**Realistic impact:**
- **Hobby plan:** there is no bill. Fast Data Transfer is capped at 100 GB/month, roughly
  8,600 desktop first views or 26,000 phone first views. Past the cap, Vercel can pause the
  project, so the demo goes offline mid-campaign. A viral share or a scripted loop that
  re-downloads assets can reach the cap.
- **Pro plan:** 1 TB is included; overage is billed per GB. A determined attacker hammering
  asset URLs from many IPs could run up a bill unless Spend Management is on.
- `/api/track` flooding costs invocations and log volume, and pollutes the analytics.
  Function cost is small, because each call is sub-millisecond work with no external call
  while Supabase is unset.

**Remediation:**
1. Check the plan: Vercel → Settings → Billing.
2. **Pro:** enable Spend Management (Settings → Billing → Spend Management) with a hard
   limit and "pause projects" on.
3. Add Firewall rules:
   - rate-limit `/api/track` to 120/min per IP;
   - rate-limit `/assets/*` to about 600 requests/min per IP. A real visitor loads roughly 150
     assets once, then serves them from the browser cache for 7 days.
4. Optional: turn on Vercel "Attack Challenge Mode" if you see a spike.

---

## LOW

### L1 — No Content-Security-Policy; clickjacking protection relies on the legacy header only

**Evidence.** Live response headers on `/` include `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()` and `X-Frame-Options: SAMEORIGIN`.
There is **no `Content-Security-Policy`**.
**Affected:** `next.config.ts` (`securityHeaders`).
**Impact:** low. The app renders no user HTML: React escapes all text, and the one
`dangerouslySetInnerHTML` serialises static JSON-LD built from constants. A CSP is
defence-in-depth against a future XSS or a compromised dependency.
**Remediation.** Add to `securityHeaders`, then test with the Report-Only variant first:
```ts
{
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",            // Next inline bootstrap; move to nonces later
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' blob: data:",                // textures/models are same-origin; blob: for GLTF
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
},
```
Keep `X-Frame-Options: SAMEORIGIN` for older browsers. Extend `Permissions-Policy` to
`camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`.
HSTS is already sent by Vercel (`max-age=63072000; includeSubDomains; preload`). When you move to
`demo.velabuilt.com`, confirm the parent domain can take `includeSubDomains` before submitting
it to the preload list.

### L2 — `.gitignore` does not cover every environment or credential filename

**Evidence** (`git check-ignore`):
- ignored: `.env`, `.env.local`, `.env.production.local`, `.vercel/`;
- **not ignored:** `.env.production`, `.env.development`, `key.pem`, `service-account.json`,
  `.npmrc`.

**Affected:** `.gitignore`.
**Impact:** none today, because no such file exists and none was ever committed. The risk is
a future accidental commit.
**Remediation.** Replace the env lines with:
```gitignore
.env*
!.env.example
*.pem
*.key
*.p12
service-account*.json
.npmrc
```

### L3 — Documented Supabase setup does not enable RLS in the SQL itself

**Evidence.** `README.md` → "Supabase tables" creates `demo_leads` and `demo_events`. RLS
appears only as a sentence after the SQL, not as SQL.
**Affected:** `README.md`. This is a future configuration risk only: Supabase is not in use.
**Impact if followed carelessly:** tables in the `public` schema without RLS are readable and
writable by anyone holding the project's **anon** key. That key is public by design, and it
ships in any other Supabase client you build. Anyone holding it could list every lead: names,
companies, emails/phones, free text.
**Remediation.** Put this into the README SQL:
```sql
alter table demo_leads  enable row level security;
alter table demo_events enable row level security;
revoke all on demo_leads, demo_events from anon, authenticated;
-- no policies: only the service role (used server-side by /api/*) can read or write
```
Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. It is read only in `lib/server.ts`, which imports
`server-only`, and it must never get a `NEXT_PUBLIC_` prefix. Add a storage cap or a nightly
cleanup for `demo_events`, because `/api/track` inserts anonymously.

### L4 — The APIs accept cross-site "simple" POSTs

**Evidence.** `/api/lead` and `/api/track` parse `req.text()` whatever the `Content-Type`.
A `text/plain` POST returned 200 in testing. Preflights get no `Access-Control-Allow-Origin`,
so other origins cannot *read* responses, but simple requests still execute.
**Impact:** low. There are no cookies or sessions, so this is not CSRF in the harmful sense.
A third-party page could make its visitors' browsers submit junk enquiries or events, which
spreads spam across many real IPs and weakens M1's per-IP limit.
**Remediation.** Remediation 3 under M1. Apply it to both routes (`sendBeacon` from
`lib/analytics.ts` already sends `application/json`).

### L5 — The `?company=` link parameter shows attacker-chosen text on your domain

**Evidence.** `components/Experience.tsx:166` takes `company` from the URL (trimmed, capped at
60 characters). The intro shows "Prepared for {company}", and the follow-up message uses it.
React escapes it, so there is no XSS.
**Impact:** content spoofing. Someone could circulate
`…/?company=<offensive or misleading text>` links that appear to come from VelaBuilt.
**Remediation.** Allow only `[\p{L}\p{N} &'.,-]`, and collapse anything else to no
personalisation. Optionally, sign personalised links with an HMAC (`?company=…&sig=…`),
verify it server-side, and drop the parameter when the signature is invalid.

### L6 — The analytics endpoint can be fed fabricated events

**Evidence.** `/api/track` accepts any allow-listed event name with short scalar props from any
client (the rate limit is per-instance, as in M1).
**Impact:** "which industries generate interest" figures can be inflated or skewed. No data
exposure.
**Remediation.** Remediation 3 under M1 and the M2 firewall rule. When you rely on the
numbers, count unique `sid` values and discard sessions with implausible event rates.

---

## INFORMATIONAL

| # | Area | Finding |
| --- | --- | --- |
| I1 | Secrets — working tree | Pattern scan (OpenAI `sk-`, Anthropic `sk-ant-`, Resend `re_`, JWTs incl. Supabase keys, GitHub/AWS/Slack tokens, private keys, `postgres://`/`mongodb://` strings, Zapier/Make hook URLs, `*.supabase.co`, Vercel tokens, filled `…_KEY=`/`…_URL=` assignments): **no matches.** |
| I2 | Secrets — git history | Same scan over every blob of all 20 commits on both branches: **no matches.** The only env file ever committed is `.env.example`. Across its whole history the secret variables are always blank; the filled values are public placeholders (the published contact email, the demo domain, the Resend sender format). Files deleted from history are an intermediate share-image render, a `.pyc`, and two superseded scene modules; none contained credentials. |
| I3 | Vercel env | **0 environment variables** in production (and none hidden). Checked by name only; nothing was decrypted. |
| I4 | `NEXT_PUBLIC_*` | Three are read; all are intended to be public. `NEXT_PUBLIC_SITE_URL` (unset; falls back to Vercel's production URL) gives canonical and share-image URLs. `NEXT_PUBLIC_CONTACT_EMAIL` (unset; defaults to the published address) is shown in the UI, mailto links and JSON-LD. `NEXT_PUBLIC_WHATSAPP_NUMBER` (unset; WhatsApp contact is hidden) would expose your business WhatsApp number in `wa.me` links. Also inlined at build time and not secret: `VERCEL` and `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` for the site URL. |
| I5 | Client bundle (live) | Crawled the deployed JS: no server variable names, Resend/Supabase endpoints or keys. The only baked value is the public contact email. **Visible to a visitor in DevTools:** the two same-origin endpoints (`/api/lead`, `/api/track`) and their JSON shapes, the analytics event names, the asset URLs, and, with `?debug`, the client state store and three.js scene (client-only, nothing sensitive). |
| I6 | Source maps | None generated in the build and none served (`.map` → 404 for all 10 deployed chunks); no `sourceMappingURL` comments. |
| I7 | Dependencies | `npm audit`: **0 vulnerabilities** (production and dev). Next 16.3.6, React 19.3.0, three 0.186.1, zod 4.6.5. |
| I8 | Injection / SSRF / redirects | No SQL (Supabase via REST with a JSON body, table names hard-coded). No shell or eval. The webhook URL comes only from env, never from the request, so there is no SSRF. No redirect endpoints; all outbound links are fixed hosts (`wa.me`, `instagram.com`, `velabuilt.com`) with `rel="noopener"`. Email subject and body are plain text via Resend's JSON API, so there is no header injection. The lead log line contains industry and outcome only, JSON-escaped. |
| I9 | Input validation | zod schemas with length caps on both routes; body caps 12 KB (`/api/lead`, 413 verified) and 4 KB (`/api/track`, 413 verified); unknown events return 400 (verified live). `GET /api/lead` returns 405. The honeypot answers bots with `delivered: true`; this is deliberate and never shown to humans. |
| I10 | CORS | API routes send no `Access-Control-Allow-Origin` (preflight verified). HTML and static files carry Vercel's default `Access-Control-Allow-Origin: *`; that is harmless for public, credential-free content. |
| I11 | Third parties | Fonts are self-hosted (`next/font`). Every 3D asset is same-origin. drei's `gstatic.com/draco` decoder URL is in the bundle but never used: every model load passes `useDraco=false` and meshopt is bundled. Vercel Web Analytics loads first-party from `/_vercel/insights/*` (cookieless). No third-party request happens until a visitor clicks WhatsApp, Instagram or velabuilt.com. |
| I12 | Simulations | Pricing is labelled "sample pricing" in the UI. The CRM, follow-up, booking and job steps are client-side and make no calls. Visit slots are computed locally; nothing is booked. The WhatsApp and email buttons open the visitor's own apps with a prefilled message and send nothing automatically. The enquiry form never shows success unless a channel accepted the lead. Preview deployments are behind Vercel Authentication; only the production alias is public. On Vercel, the client IP used for rate limiting comes from `x-forwarded-for`, which Vercel overwrites at the edge. Off Vercel the header would be spoofable, which only matters if the app is ever self-hosted. |

---

## Method (reproducible)

| Check | How |
| --- | --- |
| Secret scan, tree and history | Regex set above via `git grep -I -E` over `git rev-list --all`; filename scan over `git log --all --name-only`; `.env.example` history printed with values redacted to lengths |
| Env vars | Vercel API `GET /v10/projects/{id}/env` without decryption |
| Client exposure | Downloaded the deployed HTML and chunk graph, grepped for server names, endpoints, keys and hosts; requested `<chunk>.map` for each |
| Headers and CORS | `curl -I /`, `OPTIONS /api/lead` with a foreign `Origin` |
| API behaviour | Against the production build locally (so live logs stay clean): valid, invalid, oversize, honeypot, `text/plain`, 7× same IP (6th → 429), rotating IPs, bogus event |
| Dependencies | `npm audit` and `npm audit --omit=dev` |
| Firewall and plan | Vercel API: project firewall config (none), team record (plan not reported) |

## Before you connect real integrations — checklist

- [ ] Firewall rate-limit rules on `/api/lead` and `/api/track` (M1, M2)
- [ ] Turnstile or BotID on the enquiry form (M1)
- [ ] `application/json` + same-origin check in both routes (M1 · L4)
- [ ] Spend Management on (Pro) or plan confirmed (M2)
- [ ] Resend daily cap and alerts; automation filter step (M1)
- [ ] Supabase: RLS enabled, anon revoked, service-role key server-only (L3)
- [ ] `.gitignore` hardened (L2)
- [ ] CSP added (Report-Only first) (L1)
