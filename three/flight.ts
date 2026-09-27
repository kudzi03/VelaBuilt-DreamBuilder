import * as THREE from "three";
import { GARDEN, MAIN, MAIN_RIDGE_Y, MAIN_RIDGE_Z, MAIN_TAN, WING, WING_RIDGE_X, WING_RIDGE_Y, WING_TAN } from "@/lib/spec";
import { plant, type PlantId } from "./impostor";

/**
 * Camera flights between shots. A move is flown the way a drone or a steadicam operator would take
 * it: round the building (never through it), rising over trees that are in the way, and into the
 * kitchen only through its glass wall. The path is planned once per move and flown at an eased pace
 * by the rig; camera-controls takes over again when the camera lands.
 */

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Centre of the building's footprint: flights orbit it. */
const PIVOT = v3(0.5, 0, -4.5);
/** keep this far off walls and roofs (the near plane, and a little air) */
const MARGIN = 0.7;

/** Solid volumes: each roofed block as walls up to the soffit and a roof prism (with its overhangs) above; the pergola; the entrance canopy. */
function solid(p: V, m = MARGIN): boolean {
  // main house
  const mSoffit = MAIN.eave - MAIN.eaveOverhang * MAIN_TAN - 0.35;
  const mo = p.y > mSoffit - m ? 1 : 0;
  if (p.x > MAIN.x0 - mo * MAIN.rakeOverhang - m && p.x < MAIN.x1 + mo * MAIN.rakeOverhang + m && p.z > MAIN.z0 - mo * MAIN.eaveOverhang - m && p.z < MAIN.z1 + mo * MAIN.eaveOverhang + m) {
    const roof = Math.max(MAIN.eave, MAIN_RIDGE_Y - Math.abs(p.z - MAIN_RIDGE_Z) * MAIN_TAN);
    if (p.y < roof + m) return true;
  }
  // kitchen wing (dies into the main house at z1)
  const wSoffit = WING.eave - WING.eaveOverhang * WING_TAN - 0.35;
  const wo = p.y > wSoffit - m ? 1 : 0;
  if (p.x > WING.x0 - wo * WING.eaveOverhang - m && p.x < WING.x1 + wo * WING.eaveOverhang + m && p.z > WING.z0 - wo * WING.rakeOverhang - m && p.z < WING.z1) {
    const roof = Math.max(WING.eave, WING_RIDGE_Y - Math.abs(p.x - WING_RIDGE_X) * WING_TAN);
    if (p.y < roof + m) return true;
  }
  const g = GARDEN.pergola;
  if (p.x > g.x0 - m && p.x < g.x1 + m && p.z > g.z0 - m && p.z < g.z1 + m && p.y < g.h + m) return true;
  // entrance canopy on the street front
  if (Math.abs(p.x - 0.35) < 1.7 + m && p.z > MAIN.z1 && p.z < MAIN.z1 + 1.25 + m && p.y < 3.05 + m) return true;
  return false;
}

/** Inside the kitchen pavilion (the one interior shot). */
export function inKitchen(p: V): boolean {
  return p.x > WING.x0 && p.x < WING.x1 && p.z > WING.z0 && p.z < WING.z1 && p.y < WING.eave;
}

/** The way in: across the terrace in front of the glass wall (north of the pergola), at eye height. */
const PORTAL = { out: v3(-9.5, 1.55, -5.25), door: v3(-2.2, 1.5, -5.1) };

/** A tree crown as an upright ellipsoid. */
export interface Crown {
  c: V;
  rh: number;
  rv: number;
}

/** Crown shape by species, as fractions of the tree's height: [horizontal radius, crown base]. */
function crownShape(id: string): [number, number] {
  if (id.startsWith("fir")) return [0.24, 0.04];
  if (id === "jacaranda") return [0.4, 0.3];
  if (id === "island") return [0.48, 0.2];
  return [0.5, 0]; // shrubs
}

/** Tree crowns, read from the impostor instances in the scene. */
export function crowns(scene: THREE.Object3D): Crown[] {
  const out: Crown[] = [];
  const m = new THREE.Matrix4();
  const p = v3();
  const q = new THREE.Quaternion();
  const s = v3();
  scene.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || !o.name.startsWith("plants:")) return;
    const id = o.name.slice(7);
    const rec = plant(id as PlantId);
    if (!rec) return;
    const [kh, k0] = crownShape(id);
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      m.decompose(p, q, s);
      if (Math.hypot(p.x - PIVOT.x, p.z - PIVOT.z) > 48) continue;
      const H = s.x * rec.height;
      if (H < 1.2) continue; // knee-high planting never matters
      const base = k0 * H;
      out.push({ c: v3(p.x, p.y + (base + H) / 2, p.z), rh: kh * H, rv: (H - base) / 2 });
    }
  });
  return out;
}

function inCrown(p: V, t: Crown, grow = 1): boolean {
  const dx = p.x - t.c.x;
  const dy = p.y - t.c.y;
  const dz = p.z - t.c.z;
  const rh = t.rh * grow;
  const rv = t.rv * grow;
  return (dx * dx + dz * dz) / (rh * rh) + (dy * dy) / (rv * rv) < 1;
}

/** Orbits give the building a wide berth; only the walk in through the glass comes close. */
const ORBIT_CLEARANCE = 2;

function blocked(p: V, trees: Crown[]): boolean {
  if (p.y < 0.8 || solid(p, ORBIT_CLEARANCE)) return true;
  for (const t of trees) if (inCrown(p, t)) return true;
  return false;
}

/** Orbit round the pivot from a to b, bowed out by `bow` and lifted by `lift` at the middle. */
function orbit(a: V, b: V, lift: number, bow: number, n: number): V[] {
  const ra = Math.hypot(a.x - PIVOT.x, a.z - PIVOT.z);
  const rb = Math.hypot(b.x - PIVOT.x, b.z - PIVOT.z);
  const ta = Math.atan2(a.x - PIVOT.x, a.z - PIVOT.z);
  let dt = Math.atan2(b.x - PIVOT.x, b.z - PIVOT.z) - ta;
  dt -= Math.round(dt / (Math.PI * 2)) * Math.PI * 2;
  const pts: V[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const bump = Math.sin(Math.PI * s);
    const r = ra + (rb - ra) * s + bow * bump;
    const th = ta + dt * s;
    pts.push(v3(PIVOT.x + Math.sin(th) * r, a.y + (b.y - a.y) * s + lift * bump, PIVOT.z + Math.cos(th) * r));
  }
  return pts;
}

function pathLength(pts: V[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  return L;
}

const LIFTS = [0, 1.5, 3, 5, 7.5, 10, 13, 17];
/** outward bows swing wide of what's in the way; inward ones slip between the house and the trees */
const BOWS = [0, 3, 6, -4, -8];

/** The best clear orbit: the shortest, flattest one that keeps off the building and out of the trees. */
function clearOrbit(a: V, b: V, all: Crown[]): V[] {
  // a shot composed with foliage close to the lens is the photographer's choice: those crowns don't count
  let trees = all.filter((t) => !inCrown(a, t, 1.15) && !inCrown(b, t, 1.15));
  // only crowns near the ring the orbit can sweep
  const ra = Math.hypot(a.x - PIVOT.x, a.z - PIVOT.z);
  const rb = Math.hypot(b.x - PIVOT.x, b.z - PIVOT.z);
  const lo = Math.min(ra, rb) - 9;
  const hi = Math.max(ra, rb) + 7;
  trees = trees.filter((t) => {
    const r = Math.hypot(t.c.x - PIVOT.x, t.c.z - PIVOT.z);
    return r + t.rh > lo && r - t.rh < hi;
  });
  const n = Math.max(24, Math.ceil(a.distanceTo(b) / 0.4));
  const candidates: Array<{ pts: V[]; cost: number }> = [];
  for (const lift of LIFTS) for (const bow of BOWS) {
    const pts = orbit(a, b, lift, bow, n);
    // inward bows cost more: sweeping close past the house reads as a near miss
    candidates.push({ pts, cost: pathLength(pts) + 3 * lift + (bow < 0 ? 3 : 1.5) * Math.abs(bow) });
  }
  candidates.sort((x, y) => x.cost - y.cost);
  let best = candidates[0].pts;
  let bestHits = Infinity;
  for (const { pts } of candidates) {
    let hits = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      // the first and last couple of metres are the shots themselves
      if (pts[i].distanceTo(a) < 2 || pts[i].distanceTo(b) < 2) continue;
      if (blocked(pts[i], trees)) hits++;
    }
    if (hits === 0) return pts;
    if (hits < bestHits) {
      bestHits = hits;
      best = pts;
    }
  }
  return best;
}

function line(a: V, b: V, step = 0.4): V[] {
  const n = Math.max(2, Math.ceil(a.distanceTo(b) / step));
  return Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n));
}

/** Round the corner where two legs meet (quadratic Bézier over `r` metres either side). */
function fillet(pts: V[], at: number, r: number): V[] {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = len[at];
  const i0 = Math.max(0, len.findIndex((l) => l >= L - r) - 1);
  let i1 = len.findIndex((l) => l >= L + r);
  if (i1 < 0) i1 = pts.length - 1;
  if (i0 >= at || i1 <= at) return pts;
  const p0 = pts[i0];
  const p1 = pts[at];
  const p2 = pts[i1];
  const n = i1 - i0;
  const mid: V[] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const u = 1 - t;
    mid.push(v3().addScaledVector(p0, u * u).addScaledVector(p1, 2 * u * t).addScaledVector(p2, t * t));
  }
  return [...pts.slice(0, i0 + 1), ...mid, ...pts.slice(i1)];
}

function parametrise(pts: V[]) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = len[len.length - 1] || 1e-6;
  const at = (u: number, out: V) => {
    const d = THREE.MathUtils.clamp(u, 0, 1) * total;
    let lo = 0;
    let hi = len.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (len[m] < d) lo = m;
      else hi = m;
    }
    const seg = len[hi] - len[lo] || 1;
    return out.copy(pts[lo]).lerp(pts[hi], (d - len[lo]) / seg);
  };
  return { at, total };
}

export interface Flight {
  /** position along the path, u = 0..1 of its length */
  at: (u: number, out: V) => V;
  /** how far along the path at time t (0..1 of the move) */
  progress: (t: number) => number;
  length: number;
  /** seconds */
  dur: number;
  look0: V;
  look1: V;
  /** when (0..1 of the move) the look target starts and finishes turning */
  lookFrom: number;
  lookTo: number;
  points: V[];
}

/**
 * Plan a move from where the camera is to a shot. `speed` (m/s) is how fast the camera is already
 * travelling, when a move is re-planned mid-flight, so the new one picks up without a stop.
 */
export function planFlight(p0: V, look0: V, p1: V, look1: V, trees: Crown[], speed = 0): Flight {
  const fromIn = inKitchen(p0);
  const toIn = inKitchen(p1);
  let pts: V[];
  let lookFrom = 0;
  let lookTo = 1;
  if (fromIn === toIn && (fromIn || p0.distanceTo(p1) < 1.5)) {
    pts = line(p0, p1, 0.1);
  } else if (toIn) {
    // across the terrace, through the glass
    const a = clearOrbit(p0, PORTAL.out, trees);
    const b = line(PORTAL.out, PORTAL.door);
    const c = line(PORTAL.door, p1);
    pts = [...a, ...b.slice(1), ...c.slice(1)];
    pts = fillet(pts, a.length - 1, 3.5);
    pts = fillet(pts, a.length + b.length - 2, 1.2);
    lookTo = 0.72;
  } else if (fromIn) {
    // back out through the glass, then away
    const c = line(p0, PORTAL.door);
    const b = line(PORTAL.door, PORTAL.out);
    const a = clearOrbit(PORTAL.out, p1, trees);
    pts = [...c, ...b.slice(1), ...a.slice(1)];
    pts = fillet(pts, c.length - 1, 1.2);
    pts = fillet(pts, c.length + b.length - 2, 3.5);
    lookFrom = 0.2;
  } else {
    pts = clearOrbit(p0, p1, trees);
  }
  const { at, total } = parametrise(pts);
  const turn = look0.clone().sub(p0).normalize().angleTo(look1.clone().sub(p1).normalize());
  // pace: long moves take longer but never drag; a big turn in place still gets its time
  const dur = THREE.MathUtils.clamp(1.2 + total / 20 + turn * 0.3, 1.5, 3.4);
  // cubic Hermite: eased landing, and an eased start or the speed the camera already has
  // (monotonic for v0 <= 3, so the camera never backs up)
  const v0 = THREE.MathUtils.clamp((speed * dur) / total, 0, 2.5);
  const progress = (t: number) => THREE.MathUtils.clamp(t * t * (3 - 2 * t) + v0 * t * (1 - t) * (1 - t), 0, 1);
  return { at, progress, length: total, dur, look0: look0.clone(), look1: look1.clone(), lookFrom, lookTo, points: pts };
}
