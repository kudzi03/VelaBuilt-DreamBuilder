/**
 * Steel frame of the same house, generated from lib/spec.ts.
 * Used by the 3D frame (instanced members), the assembly sequence and the member
 * schedule in the panel. Section masses are nominal catalogue values. This is a
 * demonstration schedule, not a structural design.
 */
import { MAIN, MAIN_HALF, MAIN_RIDGE_Z, MAIN_TAN, WING, WING_RIDGE_X, WING_RIDGE_Y, WING_TAN, type Vec3 } from "./spec";

export type TrussType = "fink" | "howe" | "pratt";
export type MemberKind = "plate" | "column" | "beam" | "chord" | "web" | "rafter" | "purlin" | "brace";
export type Profile = "I" | "SHS" | "C" | "ROD" | "PLATE";

export interface Section {
  id: string;
  profile: Profile;
  /** depth (local y), width (local x), flange t, web t — metres */
  d: number;
  b: number;
  tf: number;
  tw: number;
  metric: { name: string; kgPerM: number };
  us: { name: string; lbPerFt: number };
}

export const SECTIONS = {
  UC203: { id: "UC203", profile: "I", d: 0.203, b: 0.203, tf: 0.011, tw: 0.0072, metric: { name: "203×203×46 UC", kgPerM: 46.1 }, us: { name: "W8×31", lbPerFt: 31 } },
  UB254: { id: "UB254", profile: "I", d: 0.254, b: 0.146, tf: 0.0086, tw: 0.006, metric: { name: "254×146×31 UB", kgPerM: 31.1 }, us: { name: "W10×22", lbPerFt: 22 } },
  UC152: { id: "UC152", profile: "I", d: 0.152, b: 0.152, tf: 0.0068, tw: 0.0058, metric: { name: "152×152×23 UC", kgPerM: 23.0 }, us: { name: "W6×15", lbPerFt: 15 } },
  UB203: { id: "UB203", profile: "I", d: 0.203, b: 0.133, tf: 0.0078, tw: 0.0057, metric: { name: "203×133×25 UB", kgPerM: 25.1 }, us: { name: "W8×18", lbPerFt: 18 } },
  SHS76: { id: "SHS76", profile: "SHS", d: 0.076, b: 0.076, tf: 0.003, tw: 0.003, metric: { name: "76×76×3.0 SHS", kgPerM: 6.74 }, us: { name: "HSS3×3×1/8", lbPerFt: 4.75 } },
  SHS50: { id: "SHS50", profile: "SHS", d: 0.05, b: 0.05, tf: 0.003, tw: 0.003, metric: { name: "50×50×3.0 SHS", kgPerM: 4.25 }, us: { name: "HSS2×2×1/8", lbPerFt: 3.05 } },
  LC150: { id: "LC150", profile: "C", d: 0.15, b: 0.065, tf: 0.002, tw: 0.002, metric: { name: "150×65×20×2.0 lipped channel", kgPerM: 4.52 }, us: { name: "C6 purlin, 14 ga", lbPerFt: 3.3 } },
  ROD16: { id: "ROD16", profile: "ROD", d: 0.016, b: 0.016, tf: 0, tw: 0, metric: { name: "Ø16 mm round bar", kgPerM: 1.58 }, us: { name: "Ø5/8\" rod", lbPerFt: 1.04 } },
  PL300: { id: "PL300", profile: "PLATE", d: 0.02, b: 0.3, tf: 0, tw: 0, metric: { name: "300×300×20 base plate", kgPerM: 0 }, us: { name: "PL 12×12×3/4\"", lbPerFt: 0 } },
} satisfies Record<string, Section>;

export type SectionId = keyof typeof SECTIONS;
export const PLATE_KG = 14.1;
export const PLATE_LB = 30.6;

export interface Member {
  id: string;
  kind: MemberKind;
  section: SectionId;
  a: Vec3;
  b: Vec3;
  /** erection order group (0 = first) */
  group: number;
  label: string;
  /** which way a column/beam web faces: rotate the I about its axis */
  roll: number;
}

export const KIND_LABEL: Record<MemberKind, string> = {
  plate: "Base plate",
  column: "Column",
  beam: "Beam",
  chord: "Truss chord",
  web: "Truss web",
  rafter: "Portal rafter",
  purlin: "Purlin",
  brace: "Bracing",
};

export const ERECTION_STEPS = [
  "Base plates & anchors",
  "Columns",
  "First-floor beams",
  "Eave beams & ties",
  "Roof trusses",
  "Portal rafters",
  "Purlins",
  "Bracing",
] as const;

const COL_X = [MAIN.x0, -2, 2, MAIN.x1];
const TRUSS_X = [-6, -4, -2, 0, 2, 4, 6];
// portal frames of the kitchen wing: clear of the sink window (z -12.3…-10.3) and the tall units
const WING_FRAME_Z = [MAIN.z0 - 0.35, -7.35, -9.9, WING.z0];

function topChordY(z: number) {
  return MAIN.eave + (MAIN_HALF - Math.abs(z - MAIN_RIDGE_Z)) * MAIN_TAN;
}

function trussWebs(type: TrussType): Array<[number, number, number, number]> {
  // returns [zBottom|zTop pairs] as [z1, y1, z2, y2]
  const e = MAIN.eave;
  const h = MAIN_HALF;
  const webs: Array<[number, number, number, number]> = [];
  if (type === "fink") {
    const zb = h / 3;
    const zt = h / 2;
    for (const s of [-1, 1]) {
      webs.push([s * zt, topChordY(s * zt), s * zb, e]);
      webs.push([s * zb, e, 0, topChordY(0)]);
    }
    return webs;
  }
  const n = 3; // panels per half
  const step = h / n;
  // verticals
  for (let i = 1; i < n; i++) {
    for (const s of [-1, 1]) webs.push([s * (h - i * step), e, s * (h - i * step), topChordY(s * (h - i * step))]);
  }
  webs.push([0, e, 0, topChordY(0)]); // king post
  for (let i = 1; i < n; i++) {
    for (const s of [-1, 1]) {
      const zo = s * (h - i * step); // outer panel point
      const zi = s * (h - (i + 1) * step); // inner panel point
      if (type === "pratt") webs.push([zo, topChordY(zo), zi, e]); // slopes down toward centre
      else webs.push([zo, e, zi, topChordY(zi)]); // howe: slopes up toward centre
    }
  }
  return webs;
}

export function buildFrame(truss: TrussType): Member[] {
  const m: Member[] = [];
  let n = 0;
  const add = (kind: MemberKind, section: SectionId, a: Vec3, b: Vec3, group: number, label: string, roll = 0) => {
    n++;
    m.push({ id: `${kind.slice(0, 2).toUpperCase()}-${String(n).padStart(3, "0")}`, kind, section, a, b, group, label, roll });
  };

  // --- main block columns (+ two internal at the centre line)
  const cols: Vec3[] = [];
  for (const x of COL_X) for (const z of [MAIN.z0, MAIN.z1]) cols.push([x, 0, z]);
  cols.push([-2, 0, MAIN_RIDGE_Z], [2, 0, MAIN_RIDGE_Z]);
  // wing portal columns
  const wingCols: Vec3[] = [];
  for (const z of WING_FRAME_Z) for (const x of [WING.x0, WING.x1]) wingCols.push([x, 0, z]);

  for (const c of [...cols, ...wingCols]) add("plate", "PL300", [c[0], 0, c[2]], [c[0], 0.02, c[2]], 0, "Base plate");
  cols.forEach((c, i) => add("column", "UC203", [c[0], 0.02, c[2]], [c[0], MAIN.eave, c[2]], 1, `Main column ${i + 1}`, c[2] === MAIN_RIDGE_Z ? Math.PI / 2 : 0));
  wingCols.forEach((c, i) => add("column", "UC152", [c[0], 0.02, c[2]], [c[0], WING.eave, c[2]], 1, `Wing column ${i + 1}`, Math.PI / 2));

  // --- first floor beams
  const y2 = MAIN.level2;
  for (const z of [MAIN.z0, MAIN.z1]) {
    for (let i = 0; i < COL_X.length - 1; i++) add("beam", "UB254", [COL_X[i], y2, z], [COL_X[i + 1], y2, z], 2, "Floor edge beam");
  }
  for (const x of COL_X) add("beam", "UB254", [x, y2, MAIN.z0], [x, y2, MAIN.z1], 2, "Floor beam", Math.PI / 2);
  for (const x of [-4, 0, 4]) add("beam", "UB203", [x, y2, MAIN.z0], [x, y2, MAIN.z1], 2, "Secondary floor beam", Math.PI / 2);

  // --- eave beams + gable ties
  for (const z of [MAIN.z0, MAIN.z1]) {
    for (let i = 0; i < COL_X.length - 1; i++) add("beam", "UB203", [COL_X[i], MAIN.eave, z], [COL_X[i + 1], MAIN.eave, z], 3, "Eave beam");
  }
  for (const x of [WING.x0, WING.x1]) {
    for (let i = 0; i < WING_FRAME_Z.length - 1; i++) add("beam", "UB203", [x, WING.eave, WING_FRAME_Z[i]], [x, WING.eave, WING_FRAME_Z[i + 1]], 3, "Wing eave beam", Math.PI / 2);
  }

  // --- roof trusses (main block)
  const eaveZf = MAIN_RIDGE_Z + MAIN_HALF + MAIN.eaveOverhang;
  const eaveZr = MAIN_RIDGE_Z - MAIN_HALF - MAIN.eaveOverhang;
  const eaveY = MAIN.eave - MAIN.eaveOverhang * MAIN_TAN;
  const apex: [number, number] = [MAIN_RIDGE_Z, topChordY(MAIN_RIDGE_Z)];
  TRUSS_X.forEach((x, ti) => {
    const t = `Truss T${ti + 1}`;
    add("chord", "SHS76", [x, eaveY, eaveZr], [x, apex[1], apex[0]], 4, `${t} · top chord`);
    add("chord", "SHS76", [x, eaveY, eaveZf], [x, apex[1], apex[0]], 4, `${t} · top chord`);
    add("chord", "SHS76", [x, MAIN.eave, MAIN.z0], [x, MAIN.eave, MAIN.z1], 4, `${t} · bottom chord`);
    for (const [z1, yy1, z2, yy2] of trussWebs(truss)) add("web", "SHS50", [x, yy1, z1 + MAIN_RIDGE_Z], [x, yy2, z2 + MAIN_RIDGE_Z], 4, `${t} · web`);
  });

  // --- wing portal rafters
  const wEaveY = WING.eave - WING.eaveOverhang * WING_TAN;
  for (const z of WING_FRAME_Z) {
    add("rafter", "UB203", [WING.x0 - WING.eaveOverhang, wEaveY, z], [WING_RIDGE_X, WING_RIDGE_Y, z], 5, "Portal rafter");
    add("rafter", "UB203", [WING.x1 + WING.eaveOverhang, wEaveY, z], [WING_RIDGE_X, WING_RIDGE_Y, z], 5, "Portal rafter");
  }

  // --- purlins
  const xa = MAIN.x0 - MAIN.rakeOverhang;
  const xb = MAIN.x1 + MAIN.rakeOverhang;
  const slope = MAIN_HALF + MAIN.eaveOverhang;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const f = 0.06 + (i / 4) * 0.86; // along the slope, eave → ridge
      const z = MAIN_RIDGE_Z + side * slope * (1 - f);
      const y = eaveY + (apex[1] - eaveY) * f + 0.12;
      add("purlin", "LC150", [xa, y, z], [xb, y, z], 6, "Roof purlin");
    }
  }
  const wz0 = WING.z0 - WING.rakeOverhang;
  const wz1 = MAIN.z0 - 0.35;
  for (const side of [-1, 1]) {
    const edgeX = WING_RIDGE_X + side * (WING.x1 - WING_RIDGE_X + WING.eaveOverhang);
    for (let i = 0; i < 4; i++) {
      const f = 0.08 + (i / 3) * 0.82;
      const x = edgeX + (WING_RIDGE_X - edgeX) * f;
      const y = wEaveY + (WING_RIDGE_Y - wEaveY) * f + 0.12;
      add("purlin", "LC150", [x, y, wz0], [x, y, wz1], 6, "Wing purlin");
    }
  }

  // --- bracing: X in the end bays of the long walls, both storeys
  for (const z of [MAIN.z0, MAIN.z1]) {
    for (const [ya, yb] of [
      [0.25, MAIN.level2],
      [MAIN.level2, MAIN.eave],
    ]) {
      add("brace", "ROD16", [COL_X[0], ya, z], [COL_X[1], yb, z], 7, "Wall bracing");
      add("brace", "ROD16", [COL_X[1], ya, z], [COL_X[0], yb, z], 7, "Wall bracing");
      add("brace", "ROD16", [COL_X[2], ya, z], [COL_X[3], yb, z], 7, "Wall bracing");
      add("brace", "ROD16", [COL_X[3], ya, z], [COL_X[2], yb, z], 7, "Wall bracing");
    }
  }
  return m;
}

export function memberLength(mb: Member) {
  const dx = mb.b[0] - mb.a[0];
  const dy = mb.b[1] - mb.a[1];
  const dz = mb.b[2] - mb.a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function memberMassKg(mb: Member) {
  if (mb.kind === "plate") return PLATE_KG;
  return memberLength(mb) * SECTIONS[mb.section].metric.kgPerM;
}

export interface ScheduleRow {
  kind: MemberKind;
  section: SectionId;
  count: number;
  length: number; // m
  mass: number; // kg
}

export function schedule(members: Member[]): { rows: ScheduleRow[]; totalKg: number; count: number } {
  const map = new Map<string, ScheduleRow>();
  for (const mb of members) {
    const key = `${mb.kind}:${mb.section}`;
    const row = map.get(key) ?? { kind: mb.kind, section: mb.section, count: 0, length: 0, mass: 0 };
    row.count++;
    row.length += mb.kind === "plate" ? 0 : memberLength(mb);
    row.mass += memberMassKg(mb);
    map.set(key, row);
  }
  const order: MemberKind[] = ["column", "beam", "rafter", "chord", "web", "purlin", "brace", "plate"];
  const rows = [...map.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { rows, totalKg: rows.reduce((a, r) => a + r.mass, 0), count: members.length };
}
