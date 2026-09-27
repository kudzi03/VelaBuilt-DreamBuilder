/**
 * The property. One set of dimensions that every scenario derives from:
 * roof areas for the roofer, panel layout for solar, member schedule for steel,
 * rooms and duct runs for HVAC, the kitchen for the remodeler.
 * Units: metres. Y is up. The street is +Z; the garden is behind the house (-Z, -X).
 * Pure data — no three.js imports so the UI can use it for estimates.
 */

export const WALL = 0.28;
export const FLOOR_Y = 0.15; // finished floor above ground

export const MAIN = {
  x0: -6,
  x1: 6,
  z0: -4,
  z1: 4,
  eave: 5.9,
  level2: 3.05,
  pitchDeg: 35,
  eaveOverhang: 0.5,
  rakeOverhang: 0.35,
} as const;

export const WING = {
  x0: -1,
  x1: 6,
  z0: -14,
  z1: -4,
  eave: 3.4,
  pitchDeg: 25,
  eaveOverhang: 0.45,
  rakeOverhang: 0.35,
} as const;

const rad = (d: number) => (d * Math.PI) / 180;

export const MAIN_HALF = (MAIN.z1 - MAIN.z0) / 2; // 4
export const MAIN_TAN = Math.tan(rad(MAIN.pitchDeg));
export const MAIN_RIDGE_Y = MAIN.eave + MAIN_HALF * MAIN_TAN;
export const MAIN_RIDGE_Z = (MAIN.z0 + MAIN.z1) / 2;

export const WING_HALF = (WING.x1 - WING.x0) / 2; // 3.5
export const WING_TAN = Math.tan(rad(WING.pitchDeg));
export const WING_RIDGE_Y = WING.eave + WING_HALF * WING_TAN;
export const WING_RIDGE_X = (WING.x0 + WING.x1) / 2;

export type Vec3 = [number, number, number];

/** A roof plane expressed as origin + two axes. u runs along the eave, v runs up-slope. */
export interface RoofPlane {
  id: RoofSectionId;
  label: string;
  short: string;
  origin: Vec3; // eave edge, start of u
  u: Vec3; // unit vector along eave
  v: Vec3; // unit vector up the slope
  normal: Vec3;
  width: number; // along u
  length: number; // along v (eave edge → ridge)
  /** v distance from eave edge to the wall line (overhang measured on slope) */
  overhangV: number;
  area: number;
  /** usable rectangle for panels (u0,u1,v0,v1) after setbacks */
  usable: [number, number, number, number];
}

export type RoofSectionId = "main-front" | "main-rear" | "wing-garden" | "wing-side";

function mainPlane(side: 1 | -1): RoofPlane {
  // side 1 = front (+Z), -1 = rear
  const slopeLen = (MAIN_HALF + MAIN.eaveOverhang) / Math.cos(rad(MAIN.pitchDeg));
  const width = MAIN.x1 - MAIN.x0 + MAIN.rakeOverhang * 2;
  const eaveY = MAIN.eave - MAIN.eaveOverhang * MAIN_TAN;
  const eaveZ = MAIN_RIDGE_Z + side * (MAIN_HALF + MAIN.eaveOverhang);
  const c = Math.cos(rad(MAIN.pitchDeg));
  const s = Math.sin(rad(MAIN.pitchDeg));
  const v: Vec3 = [0, s, -side * c];
  const normal: Vec3 = [0, c, side * s];
  const u: Vec3 = side === 1 ? [1, 0, 0] : [-1, 0, 0];
  const origin: Vec3 = side === 1 ? [MAIN.x0 - MAIN.rakeOverhang, eaveY, eaveZ] : [MAIN.x1 + MAIN.rakeOverhang, eaveY, eaveZ];
  const overhangV = MAIN.eaveOverhang / c;
  const setback = 0.5;
  return {
    id: side === 1 ? "main-front" : "main-rear",
    label: side === 1 ? "Main roof · front slope" : "Main roof · rear slope",
    short: side === 1 ? "Front slope" : "Rear slope",
    origin,
    u,
    v,
    normal,
    width,
    length: slopeLen,
    overhangV,
    area: width * slopeLen,
    usable: [MAIN.rakeOverhang + setback, width - MAIN.rakeOverhang - setback, overhangV + 0.3, slopeLen - setback],
  };
}

function wingPlane(side: 1 | -1): RoofPlane {
  // side -1 = garden (-X), 1 = side (+X)
  const slopeLen = (WING_HALF + WING.eaveOverhang) / Math.cos(rad(WING.pitchDeg));
  const z0 = WING.z0 - WING.rakeOverhang;
  const z1 = WING.z1; // dies into the main wall
  const width = z1 - z0;
  const eaveY = WING.eave - WING.eaveOverhang * WING_TAN;
  const eaveX = WING_RIDGE_X + side * (WING_HALF + WING.eaveOverhang);
  const c = Math.cos(rad(WING.pitchDeg));
  const s = Math.sin(rad(WING.pitchDeg));
  const v: Vec3 = [-side * c, s, 0];
  const normal: Vec3 = [side * s, c, 0];
  const u: Vec3 = side === -1 ? [0, 0, 1] : [0, 0, -1];
  const origin: Vec3 = side === -1 ? [eaveX, eaveY, z0] : [eaveX, eaveY, z1];
  const overhangV = WING.eaveOverhang / c;
  const setback = 0.5;
  const uStart = side === -1 ? WING.rakeOverhang + setback : setback + 0.3;
  const uEnd = side === -1 ? width - setback - 0.3 : width - WING.rakeOverhang - setback;
  return {
    id: side === -1 ? "wing-garden" : "wing-side",
    label: side === -1 ? "Kitchen wing · garden slope" : "Kitchen wing · side slope",
    short: side === -1 ? "Wing, garden side" : "Wing, street side",
    origin,
    u,
    v,
    normal,
    width,
    length: slopeLen,
    overhangV,
    area: width * slopeLen,
    usable: [uStart, uEnd, overhangV + 0.3, slopeLen - setback],
  };
}

export const ROOF_PLANES: RoofPlane[] = [mainPlane(1), mainPlane(-1), wingPlane(-1), wingPlane(1)];
export const ROOF_PLANE_BY_ID = Object.fromEntries(ROOF_PLANES.map((p) => [p.id, p])) as Record<RoofSectionId, RoofPlane>;

export const ROOF_AREA_M2 = ROOF_PLANES.reduce((a, p) => a + p.area, 0);
export const RIDGE_LENGTH_M = MAIN.x1 - MAIN.x0 + MAIN.rakeOverhang * 2 + (WING.z1 - WING.z0 + WING.rakeOverhang);
export const EAVE_LENGTH_M = 2 * (MAIN.x1 - MAIN.x0 + MAIN.rakeOverhang * 2) + 2 * (WING.z1 - WING.z0 + WING.rakeOverhang);
export const FLASHING_LENGTH_M = 2 * ROOF_PLANE_BY_ID["wing-garden"].length;

export function planePoint(p: RoofPlane, u: number, v: number, lift = 0): Vec3 {
  return [
    p.origin[0] + p.u[0] * u + p.v[0] * v + p.normal[0] * lift,
    p.origin[1] + p.u[1] * u + p.v[1] * v + p.normal[1] * lift,
    p.origin[2] + p.u[2] * u + p.v[2] * v + p.normal[2] * lift,
  ];
}

/* ------------------------------------------------------------------ solar */

export const PANEL = { w: 1.134, h: 1.722, gap: 0.025, watts: 410 } as const;

export interface PanelSlot {
  plane: RoofSectionId;
  u: number; // centre
  v: number;
  portrait: boolean;
  order: number;
}

function layoutPlane(p: RoofPlane, portrait: boolean): PanelSlot[] {
  const [u0, u1, v0, v1] = p.usable;
  const pw = portrait ? PANEL.w : PANEL.h; // along u
  const ph = portrait ? PANEL.h : PANEL.w; // along v
  const cols = Math.floor((u1 - u0 + PANEL.gap) / (pw + PANEL.gap));
  const rows = Math.floor((v1 - v0 + PANEL.gap) / (ph + PANEL.gap));
  const usedU = cols * pw + (cols - 1) * PANEL.gap;
  const usedV = rows * ph + (rows - 1) * PANEL.gap;
  const startU = u0 + (u1 - u0 - usedU) / 2 + pw / 2;
  const startV = v0 + (v1 - v0 - usedV) / 2 + ph / 2;
  const slots: PanelSlot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ plane: p.id, u: startU + c * (pw + PANEL.gap), v: startV + r * (ph + PANEL.gap), portrait, order: 0 });
    }
  }
  // Fill centre-out, lower row first: reads as "placed with intent".
  const mid = (u0 + u1) / 2;
  slots.sort((a, b) => a.v - b.v || Math.abs(a.u - mid) - Math.abs(b.u - mid));
  return slots;
}

/** The sun-facing main slope, filled centre-out. */
export const PANEL_SLOTS: PanelSlot[] = layoutPlane(ROOF_PLANE_BY_ID["main-front"], true).map((s, i) => ({ ...s, order: i }));

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

export const KITCHEN = {
  ix0: WING.x0 + WALL,
  ix1: WING.x1 - WALL,
  iz0: WING.z0 + WALL,
  iz1: MAIN.z0,
  baseH: 0.9,
  baseD: 0.62,
  counterT: 0.04,
  upperY0: 1.55,
  upperY1: 2.35,
  upperD: 0.36,
  runZ0: WING.z0 + WALL,
  runZ1: -8.2,
  backX0: 1.7,
  window: { z0: -11.9, z1: -9.9, y0: 1.2, y1: 2.35 },
  island: { cx: 3.0, z0: -12.1, z1: -9.4, w: 1.05 },
} as const;
