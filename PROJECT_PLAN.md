# VelaBuilt — The Future of Contractor Sales

Interactive demo. One 3D property that becomes six contractor showrooms, then shows
the sales system behind them: lead → CRM → follow-up → booking → job.

## 1. Audit (starting point)

- Repository: empty (no commits). Everything here is new.
- Brand source: velabuilt.com (Next.js). Extracted and reused:
  - Voice: plain, specific, honest. "The systems a business runs on."
    "A person reads every enquiry." Demos are labelled **SYSTEM DEMO · sample data**.
    No performance/revenue claims.
  - Type: **Archivo** (display/body) + **Geist Mono** (labels, uppercase, tracked).
  - Colour tokens: paper `#f4f1ec`, obsidian `#ece8e1`, raised `#faf8f5`,
    ink `#151412`, ink-dim `#34322e`, muted `#5a564f`, champagne `#7a4f15`,
    champagne-deep `#d49a4e`, amber `#e3892a`, hairline `#16151321`.
    Mark: champagne `#e0c398` V/B monogram on `#050506`.
  - Motion: `cubic-bezier(.16, 1, .3, 1)` ("cinematic"), reveal 0.9s.
  - Contact: `jace@velabuilt.com`, instagram.com/velabuilt. No public WhatsApp
    number → configured by env var, hidden when unset (no dead buttons).
  - Pipeline language already on the site: New → Qualified → Quoted →
    Following up → Booked → Closed. Follow-up: day 1 / 3 / 10, stops on reply.

## 2. Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript | Same stack as velabuilt.com, first-class Vercel deploy, metadata API, route handlers for leads/analytics. |
| 3D | three.js r186 via React Three Fiber 9 + drei | Mature, declarative, shares state with the DOM UI. |
| Renderer | **WebGL2** (`WebGLRenderer`) | Primary traffic arrives through WhatsApp/Instagram in-app browsers (WKWebView / Android WebView) where WebGPU is unreliable. WebGL2 is universal. WebGPU adds risk without visible benefit for this scene size. |
| Geometry | **Procedural / parametric** house from one spec | Every scenario derives from the same dimensions: roof planes (areas, solar layout), steel frame (columns/trusses), HVAC ducts, kitchen. Zero model download, exact alignment, instant transforms. |
| Textures | Procedural canvas textures + a few CC0 photo textures (Poly Haven, 1K → WebP) lazy-loaded per scenario | Small first load; realism where the customer is choosing a material. |
| Lighting | Golden-hour sun + procedural environment (Lightformers), dusk variant for lighting design | No HDRI download; warm, architectural, on-brand. |
| Camera | drei `CameraControls` with a shot system + UI-safe framing | Smooth, interruptible transitions; constrained orbit so nobody gets lost; subject framed in the area not covered by the panel. |
| Before/after | Screen-space wipe via shader injection (`discard` on `gl_FragCoord.x`) | One render pass, works with post FX, draggable split like contractors' before/after photos. |
| State | zustand | Shared by DOM and canvas without re-render storms. |
| UI motion | `motion` (DOM), damped values (3D) | Interruptible; rapid tapping never breaks a transition. |
| Styling | CSS Modules + CSS custom properties | Bespoke UI, no framework overhead. |
| Leads | `POST /api/lead` (zod-validated, honeypot, rate-limited) → Resend email / webhook / Supabase when configured | No secrets in code. When nothing is configured the API says so and the UI offers email/WhatsApp with the enquiry prefilled — a real path, never a fake success. |
| Analytics | `track()` → Vercel Analytics + `dataLayer` + first-party beacon `POST /api/track` (allow-listed events, no PII) | Works without third-party accounts; industry interest is queryable. |

## 3. Architecture

```
app/
  layout.tsx            fonts, metadata, viewport, analytics
  page.tsx              SSR shell (headline + loader) → client <Experience/>
  api/lead/route.ts     enquiry intake (delivery adapters)
  api/track/route.ts    analytics beacon
  robots.ts sitemap.ts manifest.ts icon.svg apple-icon.png
components/
  Experience.tsx        phase machine: loading → intro → scenario → flow → reveal
  ui/*                  Sheet, Chip, Swatch, Button, CompareHandle
  intro/*               arrival copy + industry picker
  panels/*              one control panel per industry (DOM, accessible)
  flow/*                business-system demonstration
  reveal/*              closing + lead form
three/
  Stage.tsx             Canvas, renderer, quality tiers, post FX, perf monitor
  Lighting.tsx          sun, sky, environment, time-of-day blend
  CameraRig.tsx         shots, safe framing, arrival move, reduced motion
  house/*               spec.ts (dimensions), House, Roof, Windows, Kitchen
  scenarios/*           Roofing, Solar, Steel, Landscape, Hvac, Remodel layers
  materials/*           procedural textures, wipe injection, x-ray
lib/
  store.ts              zustand store
  scenarios.ts          industry definitions, options, copy
  pricing.ts            sample pricing (clearly labelled)
  lead.ts               lead builder + scoring from real configuration
  analytics.ts quality.ts units.ts config.ts
```

## 4. Performance budgets

| Budget | Target |
| --- | --- |
| First-load JS (gzip) | ≤ 400 KB (three.js is ~160 KB of it) |
| First meaningful paint | SSR headline + loader, < 1 s on 4G |
| 3D first frame | < 3 s on a modern phone over 4G |
| Initial textures | ≤ 600 KB; scenario textures lazy (≤ 400 KB each) |
| Draw calls | ≤ 180 desktop / ≤ 120 mobile (instancing for repeats) |
| Triangles | ≤ 350k desktop / ≤ 200k mobile |
| Frame rate | 60 fps desktop; ≥ 45 fps iPhone 12 / Pixel 6 class; usable ≥ 30 fps low tier |
| Memory | textures ≤ 64 MB GPU (iOS WebView kill threshold safety) |

Quality tiers (initial guess from device + GPU string, then `PerformanceMonitor`
steps down/up at runtime; `?quality=ultra|standard|mobile` (or `high|medium|low`) overrides):

| | High | Medium | Low |
| --- | --- | --- | --- |
| DPR cap | 2 | 1.5 | 1 |
| Shadows | PCF soft 2048 | PCF 1024 | baked contact shadow only |
| AO (N8AO) | yes | half-res | off |
| Bloom (dusk only) | yes | yes | emissive only |
| Planting density | 100% | 70% | 40% |
| Texture size | 1K | 1K | 512 |

`prefers-reduced-motion`: camera cuts with short fades, no idle drift, flow steps
appear without staggered motion.

### Measured (production build)

| | gzip / as served |
| --- | --- |
| Initial page JS (React, Next, UI, motion) | 244 KB — within budget |
| 3D stage chunk (three.js, R3F, camera controls, scene) | 325 KB, loaded after first paint |
| Post-processing chunk | 102 KB, medium/high tiers only |
| Arrival-shot assets, desktop | 11.6 MB (textures 6.2, plant atlases 4.6, props 0.6, skies 0.3) |
| Arrival-shot assets, phones | 3.8 MB (512 px variants on every tier) |

The visual overhaul (section 8) traded the original "initial textures ≤ 600 KB" budget for
photographed materials and vegetation. What keeps it honest: the loader shows real progress
and lifts only when the arrival shot is complete (capped at 10 s), scenario layers load after
the reveal, normal maps are encoded at WebP q84, and phones never download the 1024 px sets.

## 5. Assets

All geometry procedural. Photo textures (CC0, Poly Haven) converted to WebP,
logged in `ASSET_SOURCES.md`. Fonts via `next/font/google` (OFL), self-hosted at
build. Share image rendered from the actual scene.

## 6. Build order

1. Scaffold, tokens, fonts, SSR shell.
2. Core scene: site, house, golden-hour light, camera rig, arrival, industry picker.
3. Roofing end-to-end (options, compare, inspection marks, estimate) → business
   flow → reveal → lead form. Whole story works for one industry.
4. Solar, Remodeling, Landscaping, HVAC, Steel.
5. Analytics, metadata, share image, icons, fallbacks.
6. Browser QA at 1440×900, 390×844 (iPhone), 412×915 (Android); fix; perf pass.
7. Docs, push.

## 7. Integration boundaries (env vars)

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | canonical/OG absolute URLs |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | VelaBuilt WhatsApp (E.164 digits). Unset → WhatsApp contact hidden |
| `LEAD_NOTIFY_EMAIL` | where enquiries go (default jace@velabuilt.com) |
| `RESEND_API_KEY`, `LEAD_FROM_EMAIL` | email delivery via Resend |
| `LEAD_WEBHOOK_URL` | POST each lead to Zapier/Make/n8n/CRM |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | persist leads + events (tables in README) |

## 8. Visual overhaul (2026-09): from diagram to architectural visualisation

The system, flow and data model above are unchanged. What changed is how it looks:
the first version read as a well-made diagram (procedural textures, primitive furniture,
orbiting isometric views). This pass rebuilt the art direction toward twilight
architectural photography. Pre-overhaul state: git tag `pre-visual-upgrade`.

| Area | Before | Now |
| --- | --- | --- |
| Sky and light | Procedural light studio, flat sky | Two photographed CC0 skies (golden hour → blue hour) drive the visible sky, the image-based light and the sun; a blue-hour grade; fog that matches the horizon behind it |
| Materials | Canvas-generated textures | CC0 PBR scans at true scale (colour, normal, AO/roughness/metal), composited where needed (limestone panels, porcelain, roof membrane) — `scripts/assets` |
| Vegetation | Primitive "lollipop" trees | Poly Haven plant scans baked in Cycles to hemi-octahedral impostors, lit live (wrap + translucency), kept off every camera's near field |
| Architecture | Boxes with holes | A modern glass house: floor-to-ceiling glazing on both floors, thin flat roof slabs with deep lit soffits, a cantilevered balcony with a frameless glass rail, limestone piers, lit and furnished rooms behind the glass |
| Kitchen | Dollhouse (roof lifted off) | Walk-in, eye-level pavilion: eased-edge joinery, slab backsplash, waterfall island, oak-slat vault, CC0 props, lamps, an interior reflection probe; dated "before" with uppers and a hood |
| Roofing | Procedural shingles | Flat-roof systems on two roofs: single-ply membrane (composed from scans), standing seam, sedum green roof in a gravel margin, gravel ballast; coping, drains; a weathered "before" |
| Steel | Plain extrusions | Filleted I sections, hollow sections, end plates, bolts, gussets, anchor bolts on pads; the house burns away along a glowing section plane; spec callouts |
| HVAC | Glowing tubes and light cones | X-ray sheet-metal ducts with restrained airflow particles (cool blue / warm amber), solid equipment (CC0 outdoor unit), an east shot for outdoor-unit problems |
| Camera | Orbit targets with focal offset (moved the camera to clear the UI); damped moves that cut through walls and tree crowns | Photographer shots: position, target, lens; level verticals with real lens shift (off-axis projection) so the UI never moves the camera. Moves between shots are planned flights (`three/flight.ts`): round the building, lifted over tree crowns, into the kitchen only through its glass wall, re-framed mid-flight without stopping |
| UI | Light paper glass, sans headline, icon cards | Dark smoked glass over the scene, warm off-white type, bronze accent, Instrument Serif display, industry filmstrip of rendered stills, a loader that draws the house |

Rules that came out of the QA passes (worth keeping):

- Impostor trees look wrong inside ~25 m of a camera; place specimen trees with every shot in mind.
- Straight-alpha atlases need their colour kept under transparent texels (WebP `exact`) or mips go black.
- The sky photographs have their own hills: mask them near the horizon, and paint the dome below the horizon with the fog colour.
- Interiors lit by the open sky look flat and tinted; a captured room probe fixes both.
- Lamps are warm white, not orange: an interior photographer white-balances for them.
- Don't edit source files while a QA render is running: hot reload restarts the page.
- Check every camera move against the scene, not just the shots: a damped orbit round a moving
  target happily flies through the house. The planner's volumes are the spec; the QA probe raycasts
  the planned path against the real meshes and tree crowns (`scripts/qa-camera-paths.mjs`).
- Measure UI insets where panels come to rest, not mid-entry-animation, or the shot re-frames
  (and the camera re-plans) several times while the panel slides in.
