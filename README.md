# The Future of Contractor Sales — an interactive demo by VelaBuilt

One 3D property that becomes six contractor showrooms, then shows the sales system
behind them. A visitor picks a business, configures a real project on a real house,
sees a sample estimate, answers two qualification questions — and watches the enquiry
become a qualified lead, a CRM record, an automated WhatsApp/email follow-up, a booked
appointment and a job.

It ends on: **This is what VelaBuilt builds.** · *Build this for my business.*

| Business | What the customer does in 3D |
| --- | --- |
| Remodeling | Walk into the kitchen pavilion: fronts, stone worktop and slab backsplash, floors, island layout, before/after wipe |
| Roofing | Four roof systems and colours, **tap the roof to mark problems**, areas measured from the model, before/after |
| Structural steel | The building burns away along a section plane to its frame; erection sequence, explode, tap any member for section/length/mass, member schedule, attach drawings |
| Solar | Panels laid out inside the roof's setbacks, system size, finish, batteries, homeowner/roof-age qualification |
| Outdoor living | Terrace, pergola, pool, planting, **evening lighting**, before/after |
| HVAC | X-ray view with the air moving through the ducts; symptoms bring the right equipment or zone forward; pick a visit slot |

Everything is labelled honestly: prices are **sample pricing**, the business flow is a
**system demo with sample data**, solar shows panel count and nominal kW only, and the
steel schedule is a demonstration, not a structural design.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start
npm run lint && npm run typecheck
```

Node 20.9+ (tested on Node 22).

## Link parameters (for outreach)

| Parameter | Effect |
| --- | --- |
| `?company=Acme%20Roofing` | Intro shows "Prepared for Acme Roofing"; the follow-up message and CRM use the name |
| `?industry=roofing` | Opens straight into a business after the arrival (`remodeling`, `roofing`, `steel`, `solar`, `landscaping`, `hvac`) |
| `?ref=whatsapp-status` | Attribution, recorded with every analytics event (also reads `utm_source`) |
| `?quality=ultra\|standard\|mobile` | Force a rendering tier (useful when demoing on an older phone); `high\|medium\|low` also work |
| `?motion=reduced` | Force reduced motion |

Example for cold outreach:
`https://demo.velabuilt.com/?company=Kingson%20Engineering&industry=steel&ref=email`

## Configuration

Copy `.env.example` to `.env.local` (or set the variables in Vercel). Nothing is
required to run the demo; each variable switches on one integration.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical/OG absolute URL. On Vercel it falls back to the production domain automatically. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | VelaBuilt WhatsApp in international format, digits only (e.g. `263771234567`). **Unset = WhatsApp contact buttons are hidden**, never faked. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Defaults to `jace@velabuilt.com` |
| `LEAD_NOTIFY_EMAIL` | Where enquiries are emailed (default `jace@velabuilt.com`) |
| `RESEND_API_KEY`, `LEAD_FROM_EMAIL` | Email delivery via [Resend](https://resend.com). The from-domain must be verified in Resend. |
| `LEAD_WEBHOOK_URL` | POSTs each enquiry as JSON — Zapier, Make, n8n, HubSpot/Pipedrive workflows |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Stores enquiries and analytics events (SQL below) |

### How the enquiry form behaves

`POST /api/lead` validates (zod), drops bots (honeypot), rate-limits, then delivers to
every configured channel. If **no** channel is configured — or delivery fails — the API
says so and the form hands the visitor a pre-written email (and WhatsApp, if a number
is set) containing their enquiry. It never shows a success message for an enquiry that
went nowhere.

### Supabase tables (optional)

```sql
create table demo_leads (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  name text, company text, industry text, website text,
  contact text, wants text, explored text[], ref text
);

create table demo_events (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  name text not null, props jsonb, sid text, path text, country text
);

-- Which industries generate the most interest?
select props->>'industry' as industry,
       count(*) filter (where name = 'industry_selected')        as opened,
       count(*) filter (where name = 'business_flow_viewed')     as requested,
       count(*) filter (where name = 'business_flow_completed')  as finished_flow
from demo_events
group by 1 order by opened desc;
```

Enable RLS on both tables; the API uses the service-role key server-side only.

## Analytics

`lib/analytics.ts` sends allow-listed events to Vercel Web Analytics (custom events),
`window.dataLayer` (GTM-ready) and a first-party beacon `POST /api/track`. Without
Supabase, each event is written to the server log as one JSON line (visible in Vercel
runtime logs). No names, emails or free text are ever sent — only event names and
short enumerated properties.

| Event | When |
| --- | --- |
| `demo_loaded` | First 3D frame (tier, ms since navigation, DPR) |
| `demo_started` | First business chosen |
| `industry_selected` | Any business chosen (`industry`, `source`: intro/switcher/link) |
| `option_changed` | A configuration choice (`industry`, `option`) — throttled |
| `compare_used` | Before/after opened |
| `interaction_completed` | Estimate/request started, appointment slot booked |
| `business_flow_viewed` / `business_flow_completed` | The lead-to-job sequence |
| `cta_clicked` | Build-this, see-how, see-what-we-build |
| `contact_started` | Form opened, WhatsApp/email tapped |
| `lead_submitted` | Enquiry sent (`delivered` true/false) |
| `share_clicked` | Native share, WhatsApp, email, copy |

## Deploy (Vercel)

1. Import the repository in Vercel (framework preset: Next.js, no overrides needed).
2. Add the environment variables you want (at minimum `NEXT_PUBLIC_WHATSAPP_NUMBER`
   and one lead-delivery channel), and enable **Web Analytics** in the project's
   Analytics tab (the script is only included on Vercel builds).
3. Point a domain (e.g. `demo.velabuilt.com`) and set `NEXT_PUBLIC_SITE_URL` to it.
4. Share the link. Check the preview with WhatsApp or https://www.opengraph.xyz.

## Architecture

```
app/            layout (fonts, metadata, JSON-LD), page, API routes, robots/sitemap/manifest
components/     DOM UI — top bar, intro, panels, before/after handle, flow, reveal, forms
lib/            spec (the house), steel frame, options + sample pricing, estimates,
                lead builder/scoring, store (zustand), analytics, quality tiers, units
three/          the 3D scene — stage, atmosphere (sky, IBL, sun, fog), camera rig, house,
                roof, kitchen, garden, landscape, solar, steel, hvac, materials,
                impostors, lamps, interior probe, shader patch
public/assets/  CC0 skies, texture sets, props (GLB) and plant atlases, built by scripts/assets
scripts/        asset pipeline, QA screenshots, interaction and accessibility checks,
                share image, poster and industry stills
```

Key ideas:

- **One spec, six stories.** `lib/spec.ts` defines the house once. Roof areas (for the
  roofer), panel slots (for solar), members (for steel), rooms and duct runs (for HVAC)
  and the kitchen all derive from it, so every number shown comes from the model.
- **Real materials, honest provenance.** Architecture and joinery are modelled in code from
  the spec; surfaces are CC0 PBR scans at true scale, props are CC0 models, plants are CC0
  scans baked to impostors. Every source and licence is in `ASSET_SOURCES.md`, generated
  from `scripts/assets/sources.json`. Scenario assets load on first use.
- **One shader patch** (`three/shared.ts`) adds section cuts, before/after wipes and
  dither fades to standard three.js materials; shadows follow the cut.
- **Photographer's camera.** Each shot is a position, a subject and a lens. Ground-level
  shots stay level (verticals vertical) and use lens shift — an off-axis projection — to put
  the subject in the space the panel or bottom sheet leaves free, on any screen shape.
  Moves between shots are planned, not interpolated (`three/flight.ts`): the camera orbits the
  building instead of cutting through it, lifts over tree crowns, walks into the kitchen through
  the glass wall, and bends onto a new mark if the layout changes mid-move.
- **Light you can believe.** Two photographed skies drive sky, image-based light and sun
  across golden and blue hour; rooms use lamps and (in the kitchen) a captured room probe.

## Performance

Measured production build (gzip):

| | Size |
| --- | --- |
| Initial page JS (React, Next, UI) | ~245 KB |
| 3D stage (three.js, R3F, camera controls, scene code) — loaded after first paint | ~285 KB |
| Post-processing (AO, bloom, tone mapping) — **only medium/high tier** | ~100 KB |
| Photo textures — lazy, per scenario | 20–150 KB each (512 px variants on low tier) |
| Share image | 93 KB |

Quality tiers are guessed from the device and GPU, then adjusted live by a frame-rate
monitor (resolution first, then ambient occlusion, then a lower tier). The shadow map
only re-renders when something moves. Low tier: DPR 1.25, no shadows or post-processing,
half-resolution procedural textures. Without WebGL the demo shows a poster and every
panel, estimate and the full business flow still work.

`prefers-reduced-motion` replaces camera flights with cuts, removes idle drift and
shortens the flow sequence.

## QA scripts

With the dev server running:

```bash
node scripts/shot.mjs "/?quality=medium&motion=reduced" out.png 390 844 15000   # any viewport
node scripts/qa-interactions.mjs ./qa     # roof marking, compare, lighting, steel, enquiry
node scripts/qa-a11y.mjs                  # axe-core across intro → explore → flow → reveal → form
node scripts/og/render.mjs                # re-render the share image from the live scene
node scripts/og/poster.mjs                # re-render the no-WebGL poster
node scripts/og/previews.mjs              # re-render the industry stills on the intro
```

Asset pipeline (sources are downloaded to `.cache/`, never committed):

```bash
python3 scripts/assets/fetch.py           # CC0 skies, textures, models, plants + credits
python3 scripts/assets/build_textures.py  # PBR sets → public/assets/tex (Pillow + NumPy)
node scripts/assets/build_models.mjs      # props → meshopt GLB (gltf-transform)
python3 scripts/assets/sources_md.py      # regenerate ASSET_SOURCES.md
# skies and plant impostors use Blender as a Python module: build_env.py, bake_impostors.py, pack_impostors.py
```

## Customising for a client

- Options, labels and **sample prices**: `lib/options.ts`
- Estimate rules: `lib/estimate.ts`
- Industry copy, CTAs and appointment names: `lib/industries.ts`
- Lead scoring and follow-up wording: `lib/lead.ts`
- Camera shots: `three/CameraRig.tsx` (`SHOTS`)

See also `PROJECT_PLAN.md`, `EXPERIENCE_SPEC.md` and `ASSET_SOURCES.md`.
