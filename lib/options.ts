/**
 * Every choice a customer can make, in one place. The 3D scene reads the ids,
 * the panels read labels + swatches, pricing reads the sample rates.
 * Prices are SAMPLE PRICING for the demo — a real build uses the business's own.
 */

export interface Choice<T extends string = string> {
  id: T;
  label: string;
  detail?: string;
  swatch?: string;
  /** sample price range contribution */
  price?: [number, number];
}

/* ---------------------------------------------------------------- remodeling */

export type CabinetId = "shaker-white" | "sage-shaker" | "walnut-slab" | "charcoal-slab";
export type CounterId = "calacatta" | "black-granite" | "butcher-block" | "concrete";
export type FloorId = "oak-plank" | "herringbone" | "porcelain" | "concrete";
export type IslandId = "none" | "island" | "waterfall";

export const CABINETS: Choice<CabinetId>[] = [
  { id: "shaker-white", label: "Warm white", detail: "Shaker", swatch: "#ebe5da", price: [9500, 12500] },
  { id: "sage-shaker", label: "Sage green", detail: "Shaker", swatch: "#7c8a72", price: [10500, 13800] },
  { id: "walnut-slab", label: "Walnut", detail: "Flat panel", swatch: "linear-gradient(135deg,#6b4a33,#4a3121 60%,#7a5639)", price: [14200, 18800] },
  { id: "charcoal-slab", label: "Charcoal", detail: "Flat panel", swatch: "#2f3033", price: [11200, 14600] },
];

export const COUNTERS: Choice<CounterId>[] = [
  { id: "calacatta", label: "Calacatta quartz", swatch: "linear-gradient(120deg,#f3f1ec 0%,#f3f1ec 42%,#c9c4bb 45%,#f3f1ec 48%,#ecebe6 100%)", price: [5200, 7100] },
  { id: "black-granite", label: "Black granite", swatch: "radial-gradient(circle at 30% 30%,#3a3a3c 0 2px,#161617 3px) 0 0/7px 7px,#1b1b1c", price: [3900, 5300] },
  { id: "butcher-block", label: "Oak butcher block", swatch: "linear-gradient(90deg,#b98a57,#a57443 25%,#c0925f 50%,#a8784a 75%,#bb8c5a)", price: [2400, 3400] },
  { id: "concrete", label: "Polished concrete", swatch: "#a9a59e", price: [4200, 5800] },
];

export const FLOORS: Choice<FloorId>[] = [
  { id: "oak-plank", label: "Wide-plank oak", swatch: "linear-gradient(90deg,#b68b5e,#a47a4f 33%,#b48a5f 34%,#9f7449 66%,#b0865a 67%)", price: [5600, 7600] },
  { id: "herringbone", label: "Herringbone oak", swatch: "repeating-linear-gradient(45deg,#b58d61 0 6px,#a07650 6px 12px)", price: [7900, 10600] },
  { id: "porcelain", label: "Large porcelain", swatch: "linear-gradient(#d8d3cb,#d8d3cb) 0 0/48% 48% no-repeat,linear-gradient(#dcd7cf,#dcd7cf) 100% 0/48% 48% no-repeat,linear-gradient(#d5d0c8,#d5d0c8) 0 100%/48% 48% no-repeat,linear-gradient(#dad5cd,#dad5cd) 100% 100%/48% 48% no-repeat,#bdb7ad", price: [4800, 6700] },
  { id: "concrete", label: "Polished concrete", swatch: "#9f9b94", price: [3600, 5000] },
];

export const ISLANDS: Choice<IslandId>[] = [
  { id: "none", label: "No island", price: [0, 0] },
  { id: "island", label: "Island", price: [4600, 6200] },
  { id: "waterfall", label: "Waterfall + seating", price: [7600, 9900] },
];

export const REMODEL_BASE: [number, number] = [14000, 18500];

/* ------------------------------------------------------------------ roofing */

export type RoofMaterialId = "membrane" | "metal" | "green" | "ballast";

export interface RoofColor {
  id: string;
  label: string;
  hex: string;
}

export interface RoofMaterial extends Choice<RoofMaterialId> {
  perSquare: [number, number];
  colors: RoofColor[];
  life: string;
}

/** Flat and low-slope systems (the house has two flat roofs). */
export const ROOF_MATERIALS: RoofMaterial[] = [
  {
    id: "membrane",
    label: "Single-ply membrane",
    life: "20–30 yr warranty (typical)",
    perSquare: [560, 820],
    colors: [
      { id: "white", label: "Reflective white", hex: "#dedcd6" },
      { id: "light-grey", label: "Light grey", hex: "#a9aaa8" },
      { id: "charcoal", label: "Charcoal (EPDM)", hex: "#2f3032" },
    ],
  },
  {
    id: "metal",
    label: "Standing-seam metal",
    life: "40+ yr service life (typical)",
    perSquare: [1050, 1480],
    colors: [
      { id: "matte-black", label: "Matte black", hex: "#1c1d20" },
      { id: "galvalume", label: "Galvalume", hex: "#a3a8ac" },
      { id: "bronze", label: "Dark bronze", hex: "#56432f" },
    ],
  },
  {
    id: "green",
    label: "Green roof (sedum)",
    life: "40+ yr membrane life under planting (typical)",
    perSquare: [1650, 2600],
    colors: [
      { id: "summer", label: "Summer green", hex: "#6f7d45" },
      { id: "autumn", label: "Autumn bronze", hex: "#8a6a45" },
    ],
  },
  {
    id: "ballast",
    label: "Ballasted gravel",
    life: "25–30 yr membrane under stone (typical)",
    perSquare: [640, 920],
    colors: [
      { id: "river", label: "River pebble", hex: "#b7b0a3" },
      { id: "granite", label: "Granite chip", hex: "#8b8c8c" },
    ],
  },
];

export const ROOF_MATERIAL_BY_ID = Object.fromEntries(ROOF_MATERIALS.map((m) => [m.id, m])) as Record<RoofMaterialId, RoofMaterial>;
export const ROOF_TEAROFF_PER_SQUARE: [number, number] = [120, 180];
/** coping, upstands, drains and edge trim */
export const ROOF_FLASHING: [number, number] = [2600, 3800];

export type RoofIssueId = "leak" | "damage" | "storm" | "age";
export const ROOF_ISSUES: Choice<RoofIssueId>[] = [
  { id: "leak", label: "Leak or water stain" },
  { id: "damage", label: "Ponding, blisters or splits" },
  { id: "storm", label: "Storm or hail damage" },
  { id: "age", label: "Just old — worried" },
];

/* -------------------------------------------------------------------- steel */

export type CoatingId = "galvanised" | "red-oxide" | "charcoal";
export const COATINGS: (Choice<CoatingId> & { perTonne: [number, number]; hex: string })[] = [
  { id: "galvanised", label: "Hot-dip galvanised", hex: "#b9bdc0", swatch: "linear-gradient(135deg,#d3d6d8,#9fa4a8 50%,#c7cacc)", perTonne: [520, 680] },
  { id: "red-oxide", label: "Red-oxide primer", hex: "#8a3b27", swatch: "#8a3b27", perTonne: [140, 200] },
  { id: "charcoal", label: "Painted charcoal", hex: "#2d2f33", swatch: "#2d2f33", perTonne: [310, 420] },
];
export const STEEL_FAB_PER_TONNE: [number, number] = [2350, 2950];

/** Parallel-chord roof trusses spanning the upper floor (the flat roof sits on them). */
export const TRUSSES = [
  { id: "warren" as const, label: "Warren", detail: "Alternating diagonals, no verticals: light and even" },
  { id: "pratt" as const, label: "Pratt", detail: "Diagonals in tension under roof load" },
  { id: "howe" as const, label: "Howe", detail: "Verticals in tension, diagonals in compression" },
];

/* -------------------------------------------------------------------- solar */

export type PanelFinishId = "black" | "silver";
export const PANEL_FINISHES: Choice<PanelFinishId>[] = [
  { id: "black", label: "All-black", swatch: "#14161a" },
  { id: "silver", label: "Silver frame", swatch: "linear-gradient(#1c2a3f,#1c2a3f) 3px 3px/calc(100% - 6px) calc(100% - 6px) no-repeat,#c9ccd0" },
];
export const SOLAR_PER_WATT: [number, number] = [2.55, 3.15];
export const BATTERY_EACH: [number, number] = [9200, 12400];

export type OffsetId = "some" | "most" | "all";
export const OFFSETS: (Choice<OffsetId> & { panels: number })[] = [
  { id: "some", label: "Some", detail: "Take the edge off", panels: 8 },
  { id: "most", label: "Most", detail: "Cover the daytime", panels: 14 },
  { id: "all", label: "As much as fits", detail: "Use the whole roof", panels: 18 },
];

export type RoofAgeId = "<10" | "10-20" | "20+" | "unsure";
export const ROOF_AGES: Choice<RoofAgeId>[] = [
  { id: "<10", label: "Under 10 yrs" },
  { id: "10-20", label: "10–20 yrs" },
  { id: "20+", label: "20+ yrs" },
  { id: "unsure", label: "Not sure" },
];

/* -------------------------------------------------------------- landscaping */

export type SurfaceId = "lawn" | "deck" | "stone";
export const SURFACES: Choice<SurfaceId>[] = [
  { id: "lawn", label: "Lawn", swatch: "#6f8150", price: [0, 0] },
  { id: "deck", label: "Hardwood deck", swatch: "repeating-linear-gradient(0deg,#8f6d55 0 7px,#6b5040 7px 8px)", price: [12200, 16800] },
  { id: "stone", label: "Limestone patio", swatch: "linear-gradient(#e2dbcb,#e2dbcb) 0 0/48% 48% no-repeat,linear-gradient(#dad2c1,#dad2c1) 100% 0/48% 48% no-repeat,linear-gradient(#e0d8c8,#e0d8c8) 0 100%/48% 48% no-repeat,linear-gradient(#d6cebd,#d6cebd) 100% 100%/48% 48% no-repeat,#aaa192", price: [9800, 14100] },
];
export const LANDSCAPE_LAWN: [number, number] = [3800, 5400];
export const LANDSCAPE_PERGOLA: [number, number] = [7800, 11500];
export const LANDSCAPE_POOL: [number, number] = [52000, 78000];
export const LANDSCAPE_PLANTING = { minimal: [2400, 3600] as [number, number], lush: [7200, 10800] as [number, number] };
export const LANDSCAPE_LIGHTING: [number, number] = [3900, 6200];

/* --------------------------------------------------------------------- hvac */

export type HvacIssueId = "cooling" | "uneven" | "noise" | "maintenance" | "replace";
export const HVAC_ISSUES: (Choice<HvacIssueId> & { explain: string; checks: string[]; visit: [number, number]; visitLabel: string })[] = [
  {
    id: "cooling",
    label: "Not cooling or heating",
    explain: "The outdoor unit and the refrigerant lines are the first things a technician checks.",
    checks: ["Outdoor unit", "Refrigerant lines", "Thermostat"],
    visit: [89, 129],
    visitLabel: "Diagnostic visit",
  },
  {
    id: "uneven",
    label: "Some rooms too hot or cold",
    explain: "Upstairs runs warm. Usually duct balance, airflow or zoning — not the equipment.",
    checks: ["Supply ducts upstairs", "Return airflow", "Zoning"],
    visit: [89, 129],
    visitLabel: "Airflow assessment",
  },
  {
    id: "noise",
    label: "Strange noises",
    explain: "Rattles and hums usually start at the air handler: blower, motor or a loose panel.",
    checks: ["Air handler blower", "Motor", "Ductwork joints"],
    visit: [89, 129],
    visitLabel: "Diagnostic visit",
  },
  {
    id: "maintenance",
    label: "Due for a service",
    explain: "Filter, coils, drain and a safety check — the visit that prevents the other ones.",
    checks: ["Filter", "Coils", "Condensate drain"],
    visit: [149, 199],
    visitLabel: "Tune-up",
  },
  {
    id: "replace",
    label: "Thinking of replacing",
    explain: "The whole system at a glance: outdoor unit, air handler, ducts and controls.",
    checks: ["Outdoor unit", "Air handler", "Ducts & controls"],
    visit: [0, 0],
    visitLabel: "Free replacement estimate",
  },
];
export const HVAC_ISSUE_BY_ID = Object.fromEntries(HVAC_ISSUES.map((i) => [i.id, i])) as Record<HvacIssueId, (typeof HVAC_ISSUES)[number]>;
export const HVAC_REPLACEMENT: [number, number] = [9800, 15500];

export type SystemAgeId = "<5" | "5-10" | "10-15" | "15+";
export const SYSTEM_AGES: Choice<SystemAgeId>[] = [
  { id: "<5", label: "Under 5 yrs" },
  { id: "5-10", label: "5–10 yrs" },
  { id: "10-15", label: "10–15 yrs" },
  { id: "15+", label: "15+ yrs" },
];

/* ------------------------------------------------------------ qualification */

export type TimelineId = "asap" | "1-3m" | "3-6m" | "research";
export const TIMELINES: Choice<TimelineId>[] = [
  { id: "asap", label: "As soon as possible" },
  { id: "1-3m", label: "In 1–3 months" },
  { id: "3-6m", label: "In 3–6 months" },
  { id: "research", label: "Just researching" },
];

export type ChannelId = "whatsapp" | "call" | "email";
export const CHANNELS: Choice<ChannelId>[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "call", label: "Phone call" },
  { id: "email", label: "Email" },
];
