# Experience spec

Audience: an owner of a contracting business who opened a link from WhatsApp,
Instagram or email, usually on a phone, with no interest in software.

Goal inside 20 seconds: *"I understand how this could work for my company."*
Goal by the end: *"I want VelaBuilt to build this for us."*

Rule for every effect: it must show a customer **choosing, seeing, or asking for
something** a contractor sells. If it doesn't, it goes.

---

## Scene 1 — Arrival

- SSR shell paints instantly: paper background, VelaBuilt mark, thin progress line.
- First 3D frame: a contemporary two-storey house with a single-storey kitchen wing,
  golden hour, long shadows, warm light in the windows. Camera starts low and
  close, rises and eases back over ~6 s (reduced motion: static hero shot).
- Copy (staggered):
  - eyebrow: `INTERACTIVE DEMO · VELABUILT`
  - H1: **What if your customers could experience your work before they ever called you?**
  - then: **Choose a business.** + six choices.
- Personalised link: `?company=Acme%20Roofing` shows "Prepared for Acme Roofing";
  `?industry=roofing` preselects. `?ref=` recorded for attribution.

## Scene 2 — One property, six showrooms

Shared layout: the 3D scene stays full-bleed. Controls live in a panel:
bottom sheet on phones (peek → expanded), right-hand panel on desktop.
Industry switcher always reachable at the top.

Panel anatomy (identical across industries so the platform idea reads):
1. Title + one line: what the customer is doing.
2. 2–4 option groups that visibly change the 3D scene.
3. Live summary + **estimate range** ("Sample pricing — your business sets its own").
4. One primary action that turns the configuration into a lead.

| Industry | Camera / transformation | Customer controls | Primary action |
| --- | --- | --- | --- |
| **Remodeling** | Wing roof lifts, glass wall clears: kitchen as a section cutaway | Cabinets (4), countertop (4), flooring (4), island (none / island / waterfall + seating), before/after wipe | Get my kitchen estimate |
| **Roofing** | Elevated view of the main roof | Material (4), colour (per material), before/after wipe, **tap roof areas to flag problems** (leak, damage, age) with computed area per plane | Request free inspection |
| **Structural steel** | Building dissolves to its steel frame; assembly sequence plays | Truss type (Fink / Howe / Pratt), coating (galvanised / red oxide / painted), explode slider, tap any member for its spec, live member schedule & approx. tonnage, **attach drawings** (PDF/DWG/IFC) | Request fabrication quote |
| **Solar** | Sun-facing roof plane; panels placed by a layout that respects roof edges | System size (panel count within the plane's real capacity), panel finish, battery storage (0–2), qualification: homeowner, roof age, monthly bill | Get my solar design |
| **Outdoor living** | Camera moves to the back garden | Surface (lawn / timber deck / stone patio), pergola, pool, planting density, **evening lighting** (scene goes to dusk, lights come on), before/after wipe | Book a design consultation |
| **HVAC / home services** | House becomes an X-ray section: equipment, supply/return ducts, airflow | What's happening (not cooling, uneven rooms, noise, maintenance, replacement) → the relevant equipment/zone lights up; tap zones; system age; choose a visit slot | Book a technician |

Honesty rules: sizes/areas come from the model's geometry. Prices are labelled
sample pricing. Solar shows panel count and nominal kW only (no production
claims). Steel tonnage = member lengths × nominal section mass, labelled as a
demonstration schedule, not a design.

## Scene 3 — The business system (SYSTEM DEMO · sample data)

Triggered by the primary action. Two quick taps first (timeline, preferred
channel) — these are the qualification questions a real customer would answer.
Customer name is a sample, editable.

Then a guided sequence built from what the visitor actually configured:

1. **Customer explores** — time spent, views used.
2. **Configures project** — the exact options chosen.
3. **Estimate / requirements** — range shown, areas flagged, files attached.
4. **Qualified lead** — score with visible reasons (e.g. +25 homeowner,
   +20 wants it within 3 months, +15 budget matches estimate).
5. **CRM** — the record lands in the pipeline (New → Qualified), fields filled.
6. **Automated follow-up** — the WhatsApp message and email that went out,
   personalised with their configuration; day 3 / day 10 queued, stop-on-reply.
7. **Appointment** — visitor picks one of the offered slots in the message →
   booked, reminder scheduled.
8. **Job** — job created with the configuration attached (materials list,
   cutting list, panel schedule...).

Headline beats: "Your customer just became a qualified lead." →
"Follow-up sent automatically." → "Consultation booked."

## Scene 4 — Reveal

- **This is what VelaBuilt builds.**
- We turn websites into interactive sales systems.
- Imagine this built around your business.
- Primary: **BUILD THIS FOR MY BUSINESS** → enquiry form.
- Secondary: **SEE HOW IT WORKS** → the five parts of the system, mapped to what
  they just used.
- Also: WhatsApp (if configured), email, "Try another business",
  "Send this to a business owner" (Web Share / WhatsApp share / copy link).

Enquiry form: name, company, industry (prefilled from what they explored),
website (optional), email or WhatsApp, "What would you like customers to be able
to do?" (with tap-to-add suggestions). Honeypot, no marketing opt-in.

## Mobile

- Designed portrait-first: 3D subject framed in the space above the sheet.
- Sheet: 3 snap points, internal scroll, 44px+ targets, safe-area padding,
  `100dvh`, no page scroll bounce under the canvas.
- One-finger orbit (constrained), pinch zoom (bounded), tap to select.
- Landscape phone: side panel. Orientation change reframes.

## Accessibility

- Every 3D state is also stated in the DOM panel.
- Radio groups for options, labelled buttons, visible focus, AA contrast.
- Before/after handle is a keyboard-operable slider.
- Canvas is decorative (`aria-hidden`), with a live region announcing changes.
- `prefers-reduced-motion` honoured throughout.

## Analytics events

`demo_loaded`, `demo_started`, `industry_selected`, `option_changed`,
`compare_used`, `interaction_completed`, `business_flow_viewed`,
`business_flow_completed`, `cta_clicked`, `contact_started`, `lead_submitted`,
`share_clicked`. Properties: industry, option, tier, ref — never names or
contact details.
