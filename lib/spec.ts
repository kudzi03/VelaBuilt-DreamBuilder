/**
 * The property. One set of dimensions that every scenario derives from:
 * roof areas for the roofer, panel layout for solar, member schedule for steel,
 * rooms and duct runs for HVAC, the kitchen for the remodeler.
 * Units: metres. Y is up. The street is +Z; the garden is behind the house (-Z, -X).
 * Pure data — no three.js imports so the UI can use it for estimates.
 */

export const WALL = 0.32;
export const FLOOR_Y = 0.15; // finished floor above ground

/**
 * The house: a two-storey glass volume under a thin flat roof slab, and a single-storey glass
 * pavilion (the kitchen) off its garden side. Floor-to-ceiling glazing, pale limestone where a
 * wall is solid, dark slab edges, deep lit soffits. `eave` is the top of the walls — the
 * underside of the roof slab.
 */
export const MAIN = {
  x0: -6,
  x1: 6,
  z0: -4,
  z1: 4,
  level2: 3.3, // first floor, finished
  ceil1: 3.0, // ground-floor ceiling: underside of the first-floor slab
  ceil2: 5.9, // first-floor ceiling (the roof void is above it)
  eave: 6.2,
} as const;

/** Roof slab over the main volume; its west and garden edges reach out over the balcony. */
export const MAIN_ROOF = { t: 0.6, x0: -8.0, x1: 6.8, z0: -5.8, z1: 4.8 } as const;
export const MAIN_TOP = MAIN.eave + MAIN_ROOF.t;

/**
 * First-floor balcony: the slab cantilevers 1.8 m west and 1.6 m over the terrace (as far as the
 * pavilion), edged in frameless glass.
 */
export const BALCONY = { x0: -7.8, z0: -5.6, xs: -1.0, t: 0.3, rail: 1.05 } as const;

export const WING = {
  x0: -1,
  x1: 6,
  z0: -14,
  z1: -4,
  eave: 3.5,
} as const;

/** The pavilion's roof slab, with a deep lit canopy over the terrace on the garden side. */
export const WING_ROOF = { t: 0.45, x0: -2.4, x1: 6.5, z0: -14.8, z1: -4 } as const;
export const WING_TOP = WING.eave + WING_ROOF.t;

export type Vec3 = [number, number, number];

/**
 * A roof section: a flat rectangle at the top of its slab, as origin + two axes (u along x, v
 * toward the garden), so marks, panels and outlines are placed the same way on any roof.
 */
export interface RoofPlane {
  id: RoofSectionId;
  label: string;
  short: string;
  origin: Vec3; // street-side west corner of the roof surface
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  width: number; // along u
  length: number; // along v
  /** slab thickness under the surface */
  thickness: number;
  area: number;
  /** usable rectangle for panels (u0,u1,v0,v1) after setbacks from the edges */
  usable: [number, number, number, number];
}

export type RoofSectionId = "main-roof" | "wing-roof";

function flatRoof(id: RoofSectionId, label: string, short: string, r: { x0: number; x1: number; z0: number; z1: number; t: number }, top: number, setback: number): RoofPlane {
  const width = r.x1 - r.x0;
  const length = r.z1 - r.z0;
  return {
    id,
    label,
    short,
    origin: [r.x0, top, r.z1],
    u: [1, 0, 0],
    v: [0, 0, -1],
    normal: [0, 1, 0],
    width,
    length,
    thickness: r.t,
    area: width * length,
    usable: [setback, width - setback, setback, length - setback],
  };
}

export const ROOF_PLANES: RoofPlane[] = [
  flatRoof("main-roof", "Main roof · upper level", "Upper roof", MAIN_ROOF, MAIN_TOP, 1.2),
  flatRoof("wing-roof", "Kitchen pavilion roof", "Pavilion roof", WING_ROOF, WING_TOP, 1.0),
];
export const ROOF_PLANE_BY_ID = Object.fromEntries(ROOF_PLANES.map((p) => [p.id, p])) as Record<RoofSectionId, RoofPlane>;

export const ROOF_AREA_M2 = ROOF_PLANES.reduce((a, p) => a + p.area, 0);
/** roof edges: coping and edge trim, all round both slabs */
export const ROOF_EDGE_M = ROOF_PLANES.reduce((a, p) => a + 2 * (p.width + p.length), 0);

export function planePoint(p: RoofPlane, u: number, v: number, lift = 0): Vec3 {
  return [
    p.origin[0] + p.u[0] * u + p.v[0] * v + p.normal[0] * lift,
    p.origin[1] + p.u[1] * u + p.v[1] * v + p.normal[1] * lift,
    p.origin[2] + p.u[2] * u + p.v[2] * v + p.normal[2] * lift,
  ];
}

/* ------------------------------------------------------------------ solar */

/** Module; on the flat roof it sits landscape on a low rack, tilted to the sun (+Z). */
export const PANEL = { w: 1.134, h: 1.722, gap: 0.025, watts: 410, tiltDeg: 10 } as const;
/** row to row, front edge to front edge: the panel's footprint plus clearance for winter shade */
const ROW_PITCH = PANEL.w * Math.cos((PANEL.tiltDeg * Math.PI) / 180) + 0.7;

export interface PanelSlot {
  plane: RoofSectionId;
  u: number; // centre
  v: number;
  order: number;
}

function layoutRows(p: RoofPlane): PanelSlot[] {
  const [u0, u1, v0, v1] = p.usable;
  const along = PANEL.h; // landscape: the long side runs along the row
  const cols = Math.floor((u1 - u0 + PANEL.gap) / (along + PANEL.gap));
  const rows = Math.floor((v1 - v0 - PANEL.w) / ROW_PITCH) + 1;
  const usedU = cols * along + (cols - 1) * PANEL.gap;
  const usedV = (rows - 1) * ROW_PITCH + PANEL.w;
  const startU = u0 + (u1 - u0 - usedU) / 2 + along / 2;
  const startV = v0 + (v1 - v0 - usedV) / 2 + PANEL.w / 2;
  const slots: PanelSlot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) slots.push({ plane: p.id, u: startU + c * (along + PANEL.gap), v: startV + r * ROW_PITCH, order: 0 });
  }
  // Fill centre-out, the sunniest (street-side) row first: reads as "placed with intent".
  const mid = (u0 + u1) / 2;
  slots.sort((a, b) => a.v - b.v || Math.abs(a.u - mid) - Math.abs(b.u - mid));
  return slots;
}

/** Rows on the upper roof, filled centre-out. */
export const PANEL_SLOTS: PanelSlot[] = layoutRows(ROOF_PLANE_BY_ID["main-roof"]).map((s, i) => ({ ...s, order: i }));

export const PANEL_CAPACITY = PANEL_SLOTS.length;

/* ------------------------------------------------------------------ garden */

export const GARDEN = {
  x0: -14.5,
  x1: WING.x0,
  z0: -16.5,
  z1: MAIN.z0,
  patio: { x0: -6.6, x1: WING.x0, z0: -12.6, z1: MAIN.z0 },
  pergola: { x0: -6.2, x1: -1.4, z0: -11.8, z1: -6.6, h: 2.75 },
  pool: { x0: -12.8, x1: -8.6, z0: -14.8, z1: -6.8 },
  wallH: 1.9,
} as const;

export const PATIO_AREA_M2 = (GARDEN.patio.x1 - GARDEN.patio.x0) * (GARDEN.patio.z1 - GARDEN.patio.z0);

/* ------------------------------------------------------------------ kitchen */

/**
 * The kitchen pavilion (the wing). Worktop runs on the south wall and the east wall, a bank of
 * tall units on the east wall, an island, and the glass wall to the garden. Heights are above
 * the finished floor.
 */
export const KITCHEN = {
  ix0: WING.x0 + WALL,
  ix1: WING.x1 - WALL,
  iz0: WING.z0 + WALL,
  iz1: MAIN.z0,
  plinth: 0.1,
  top: 0.94, // worktop surface
  counterT: 0.03,
  baseD: 0.62,
  /** tall units and slab backsplash stop here (the clerestory sill) */
  datum: 2.47,
  /** the slatted oak ceiling */
  ceiling: 3.2,
  southRun: { x0: -0.2 },
  eastRun: { z1: -9.5 },
  tall: { z0: -9.5, z1: -7.1 },
  sink: { z: -11.3 },
  cooktop: { x: 2.5 },
  island: { x0: 2.66, x1: 3.86, z0: -12.0, z1: -8.8 },
} as const;
