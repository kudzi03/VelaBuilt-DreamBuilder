"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { CabinetId, CounterId, FloorId } from "@/lib/options";
import { FLOOR_Y, KITCHEN as K } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { box, merge, rbox, type Placed } from "./geom";
import { glowMaterial } from "./glow";
import { lampLevel, lampLit, registerLamps, unregisterLamps, type Lamp } from "./lamps";
import { pbr, solid } from "./materials";
import { REMODEL_DUSK } from "./Director";
import { useInteriorProbe } from "./probe";
import { channels as anim, lazyCache, patch, wipes } from "./shared";

/**
 * The kitchen pavilion: worktop runs on the gable wall and the east wall, a bank of tall
 * units, an island under three pendants, a slatted white-oak ceiling, and the garden through
 * the glass wall. Everything the customer can change (fronts, worktop + slab backsplash,
 * floor, island) is a material or a mesh swap; the "before" is a dated kitchen on the same
 * carcasses (oak shaker, uppers and a hood, speckled granite, checker tiles) shown through
 * the before/after wipe.
 */

type V3 = [number, number, number];
const Y0 = FLOOR_Y;
const X0 = K.ix0; // glazed side
const X1 = K.ix1; // east wall
const Z0 = K.iz0; // gable wall
const Z1 = K.iz1; // house wall
const D = K.baseD;
const TOP = Y0 + K.top;
const CT = K.counterT;
const DATUM = Y0 + K.datum;
const PL = Y0 + K.plinth;
const GAP = 0.003;
const F_Y0 = PL + GAP; // fronts: bottom
const F_Y1 = TOP - CT - GAP; // fronts: top (under the worktop)
/** tall units run to the slatted ceiling */
const TALL_Y1 = Y0 + K.ceiling - GAP;
const RUN_S0 = K.southRun.x0;
const RUN_S1 = X1 - D; // gable-run fronts stop where the east run starts (blind corner behind)
const RUN_E0 = Z0 + D; // the east run starts in front of the gable run
const RUN_E1 = K.eastRun.z1;
const IS = K.island;
const WIN = { z0: -12.3, z1: -10.3, y0: 1.15, y1: 2.35 }; // sink window (House.tsx, wing x+)

/* ------------------------------------------------------------------ helpers */

/** A run of joinery along a wall: `along` runs with the wall, `out` points into the room. */
interface Run {
  o: [number, number]; // world x,z at along = 0, out = 0
  dir: [number, number];
  n: [number, number];
}
const SOUTH: Run = { o: [0, Z0], dir: [1, 0], n: [0, 1] };
const EAST: Run = { o: [X1, 0], dir: [0, 1], n: [-1, 0] };
const ISLAND: Run = { o: [IS.x1 - D, 0], dir: [0, -1], n: [1, 0] }; // worked from the east side

function at(run: Run, along: number, y: number, out: number) {
  const dir = new THREE.Vector3(run.dir[0], 0, run.dir[1]);
  const n = new THREE.Vector3(run.n[0], 0, run.n[1]);
  const m = new THREE.Matrix4().makeBasis(dir, new THREE.Vector3(0, 1, 0), n);
  m.setPosition(run.o[0] + dir.x * along + n.x * out, y, run.o[1] + dir.z * along + n.z * out);
  return m;
}

type Style = "shaker" | "slab" | "handleless";
interface Parts {
  fronts: Placed[];
  pulls: Placed[];
  glass: Placed[];
}
const parts = (): Parts => ({ fronts: [], pulls: [], glass: [] });

/** One front (door or drawer face), centred at `along`, from y0 to y1, on the run's front plane. */
function front(run: Run, style: Style, along: number, w: number, y0: number, y1: number, into: Parts) {
  const h = y1 - y0;
  const cy = (y0 + y1) / 2;
  const t = 0.019;
  const out = D - t / 2;
  if (style !== "shaker") {
    into.fronts.push({ geo: rbox(w, h, t, 0.0015), matrix: at(run, along, cy, out) });
    return;
  }
  // shaker: a frame and a recessed centre panel
  const f = Math.min(0.068, w * 0.2, h * 0.25);
  into.fronts.push({ geo: rbox(f, h, t, 0.0015), matrix: at(run, along - w / 2 + f / 2, cy, out) });
  into.fronts.push({ geo: rbox(f, h, t, 0.0015), matrix: at(run, along + w / 2 - f / 2, cy, out) });
  into.fronts.push({ geo: rbox(w - 2 * f, f, t, 0.0015), matrix: at(run, along, y1 - f / 2, out) });
  into.fronts.push({ geo: rbox(w - 2 * f, f, t, 0.0015), matrix: at(run, along, y0 + f / 2, out) });
  into.fronts.push({ geo: rbox(w - 2 * f + 0.004, h - 2 * f + 0.004, 0.009, 0.001), matrix: at(run, along, cy, out - 0.006) });
}

function barPull(run: Run, along: number, y: number, len: number, vertical: boolean, into: Parts, r = 0.0055) {
  const bar = new THREE.CylinderGeometry(r, r, len, 12);
  if (!vertical) bar.rotateZ(Math.PI / 2);
  into.pulls.push({ geo: bar, matrix: at(run, along, y, D + 0.03) });
  const leg = new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.03, 10);
  leg.rotateX(Math.PI / 2);
  const s = len / 2 - 0.02;
  for (const k of [-1, 1]) into.pulls.push({ geo: leg, matrix: vertical ? at(run, along, y + k * s, D + 0.015) : at(run, along + k * s, y, D + 0.015) });
}

function knob(run: Run, along: number, y: number, into: Parts) {
  const g = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0001, 0.032),
      new THREE.Vector2(0.013, 0.031),
      new THREE.Vector2(0.016, 0.026),
      new THREE.Vector2(0.012, 0.018),
      new THREE.Vector2(0.006, 0.012),
      new THREE.Vector2(0.008, 0.0),
    ],
    16,
  );
  g.rotateX(Math.PI / 2);
  into.pulls.push({ geo: g, matrix: at(run, along, y, D) });
}

type Unit = { w: number; kind: "drawers3" | "drawers2" | "sink" | "dw" | "oven" | "pantry" | "fridge" };

function baseFronts(run: Run, start: number, units: Unit[], style: Style, into: Parts) {
  let a = start;
  for (const u of units) {
    const c = a + u.w / 2;
    const w = u.w - GAP * 2;
    const topY = style === "shaker" ? F_Y1 : F_Y1 - 0.032; // flat fronts: the handle is a channel under the worktop
    const hs = u.kind === "drawers3" ? [0.18, 0.31] : u.kind === "drawers2" ? [0.3] : u.kind === "sink" ? [0.18] : [];
    let y = topY;
    const rows: [number, number][] = [];
    for (const h of hs) {
      rows.push([y - h, y]);
      y -= h + GAP;
    }
    rows.push([F_Y0, y]);
    rows.forEach(([y0, y1], i) => {
      if (u.kind === "sink" && i === rows.length - 1) {
        front(run, style, c - u.w / 4, u.w / 2 - GAP * 2, y0, y1, into);
        front(run, style, c + u.w / 4, u.w / 2 - GAP * 2, y0, y1, into);
        if (style === "shaker") {
          barPull(run, c - 0.05, y1 - 0.09, 0.14, true, into);
          barPull(run, c + 0.05, y1 - 0.09, 0.14, true, into);
        }
        return;
      }
      front(run, style, c, w, y0, y1, into);
      if (style === "shaker") {
        if (u.kind === "dw") barPull(run, c, y1 - 0.06, Math.min(0.32, w * 0.5), false, into);
        else barPull(run, c, i === 0 ? (y0 + y1) / 2 : y1 - 0.07, Math.min(0.2, w * 0.4), false, into);
      }
    });
    a += u.w;
  }
}

/** The open niche in the tall bank: a lower door, lit open shelves, a door over. */
const NICHE = { y0: Y0 + 0.9, y1: Y0 + 2.34, shelves: [Y0 + 1.38, Y0 + 1.86] };

function tallFronts(run: Run, start: number, units: Unit[], style: Style, into: Parts, pantry: Parts) {
  let a = start;
  const pulls = style !== "handleless";
  for (const u of units) {
    const c = a + u.w / 2;
    const w = u.w - GAP * 2;
    const pullAt = c - w / 2 + 0.05;
    if (u.kind === "oven") {
      // drawer, oven, compact oven, door over
      front(run, style, c, w, F_Y0, Y0 + 0.66, into);
      into.glass.push({ geo: rbox(w, 0.59, 0.02, 0.002), matrix: at(run, c, Y0 + 0.665 + 0.295 + GAP, D - 0.01) });
      into.glass.push({ geo: rbox(w, 0.45, 0.02, 0.002), matrix: at(run, c, Y0 + 1.26 + 0.225 + GAP * 2, D - 0.01) });
      front(run, style, c, w, Y0 + 1.72, TALL_Y1, into);
      barPull(run, c, Y0 + 1.19, w - 0.12, false, into, 0.007);
      barPull(run, c, Y0 + 1.65, w - 0.12, false, into, 0.007);
      if (style === "shaker") barPull(run, c, Y0 + 0.6, 0.2, false, into);
    } else if (u.kind === "pantry") {
      // after: the lit niche (doors below and above it); before: a pantry cupboard
      front(run, style, c, w, F_Y0, NICHE.y0 - GAP, into);
      front(run, style, c, w, NICHE.y1 + GAP, TALL_Y1, into);
      front(run, style, c, w, NICHE.y0, NICHE.y1, pantry);
      if (pulls) {
        barPull(run, pullAt, Y0 + 0.62, 0.2, true, into);
        barPull(run, pullAt, NICHE.y1 + 0.16, 0.2, true, into);
        barPull(run, pullAt, Y0 + 1.2, 0.3, true, pantry);
      }
    } else {
      // integrated fridge / freezer: one tall door each
      front(run, style, c, w, F_Y0, TALL_Y1, into);
      if (pulls) barPull(run, pullAt, Y0 + 1.25, style === "slab" ? 0.9 : 0.45, true, into);
    }
    a += u.w;
  }
}

/** Where the niche sits along the east run (the pantry slot of the tall bank). */
function nicheSpan() {
  let a = K.tall.z0;
  for (const u of TALL_UNITS) {
    if (u.kind === "pantry") return { a0: a, a1: a + u.w };
    a += u.w;
  }
  return { a0: a, a1: a };
}

/** Walnut-lined open niche: back, sides, shelves; LED strips under each shelf and the head. */
function niche() {
  const { a0, a1 } = nicheSpan();
  const w = a1 - a0 - 0.02;
  const mid = (a0 + a1) / 2;
  const depth = D - 0.03;
  const lining: Placed[] = [];
  const led: Placed[] = [];
  const back: Placed[] = [];
  const shelves: Placed[] = [];
  const bays: number[] = [NICHE.y0, ...NICHE.shelves, NICHE.y1];
  // sides, bottom, head
  lining.push({ geo: box(0.018, NICHE.y1 - NICHE.y0, depth), matrix: at(EAST, a0 + 0.01 + 0.009, (NICHE.y0 + NICHE.y1) / 2, depth / 2) });
  lining.push({ geo: box(0.018, NICHE.y1 - NICHE.y0, depth), matrix: at(EAST, a1 - 0.01 - 0.009, (NICHE.y0 + NICHE.y1) / 2, depth / 2) });
  lining.push({ geo: box(w, 0.025, depth), matrix: at(EAST, mid, NICHE.y0 + 0.0125, depth / 2) });
  lining.push({ geo: box(w, 0.025, depth), matrix: at(EAST, mid, NICHE.y1 - 0.0125, depth / 2) });
  for (const y of NICHE.shelves) shelves.push({ geo: box(w - 0.036, 0.028, depth - 0.02), matrix: at(EAST, mid, y, (depth - 0.02) / 2) });
  // one back panel per bay (each carries its own light gradient)
  for (let i = 0; i < bays.length - 1; i++) {
    const y0 = bays[i] + (i === 0 ? 0.025 : 0.014);
    const y1 = bays[i + 1] - (i === bays.length - 2 ? 0.025 : 0.014);
    back.push({ geo: box(w - 0.036, y1 - y0, 0.01), matrix: at(EAST, mid, (y0 + y1) / 2, 0.02) });
  }
  // LED strips just behind the front edge, under each shelf and the head
  for (const y of [...NICHE.shelves.map((y) => y - 0.016), NICHE.y1 - 0.027]) led.push({ geo: box(w - 0.06, 0.004, 0.012), matrix: at(EAST, mid, y, depth - 0.05) });
  return { lining, led, back, shelves, mid };
}

const SIDE = 0.7033;
const SOUTH_UNITS: Unit[] = [
  { w: 0.75, kind: "drawers3" },
  { w: 0.75, kind: "drawers3" },
  { w: 0.75, kind: "drawers3" },
  { w: 0.9, kind: "drawers2" }, // under the hob
  { w: SIDE, kind: "drawers3" },
  { w: SIDE, kind: "drawers3" },
  { w: RUN_S1 - (K.cooktop.x + 0.45 + 2 * SIDE), kind: "drawers3" },
];
const EAST_UNITS: Unit[] = [
  { w: K.sink.z - 0.45 - 0.6 - RUN_E0, kind: "drawers3" },
  { w: 0.6, kind: "dw" },
  { w: 0.9, kind: "sink" },
  { w: (RUN_E1 - (K.sink.z + 0.45)) / 2, kind: "drawers3" },
  { w: (RUN_E1 - (K.sink.z + 0.45)) / 2, kind: "drawers3" },
];
const TALL_UNITS: Unit[] = [
  { w: 0.6, kind: "oven" },
  { w: 0.6, kind: "pantry" },
  { w: 0.6, kind: "fridge" },
  { w: 0.6, kind: "fridge" },
];
const ISLAND_UNITS: Unit[] = Array.from({ length: 4 }, () => ({ w: (IS.z1 - IS.z0) / 4, kind: "drawers2" as const }));

function joinery(style: Style) {
  const run = parts();
  const pantry = parts();
  baseFronts(SOUTH, RUN_S0, SOUTH_UNITS, style, run);
  baseFronts(EAST, RUN_E0, EAST_UNITS, style, run);
  tallFronts(EAST, K.tall.z0, TALL_UNITS, style, run, pantry);
  const island = parts();
  // the island's working side faces the east run; along runs south from its north end
  baseFronts(ISLAND, -IS.z1, ISLAND_UNITS, style, island);
  return { run, island, pantry };
}

/** Carcasses, end panels, plinths. */
function carcasses() {
  const body: Placed[] = [];
  const plinth: Placed[] = [];
  const h = F_Y1 - PL + GAP;
  const cy = PL + h / 2;
  const dd = D - 0.02;
  // gable run, to the east wall (the blind corner sits behind the east run)
  body.push({ geo: box(X1 - RUN_S0, h, dd), pos: [(RUN_S0 + X1) / 2, cy, Z0 + dd / 2] });
  body.push({ geo: box(dd, h, RUN_E1 - RUN_E0), pos: [X1 - dd / 2, cy, (RUN_E0 + RUN_E1) / 2] });
  // the tall bank, open round the niche
  const th = TALL_Y1 - PL;
  const n = nicheSpan();
  body.push({ geo: box(dd, th, n.a0 - K.tall.z0), pos: [X1 - dd / 2, PL + th / 2, (K.tall.z0 + n.a0) / 2] });
  body.push({ geo: box(dd, th, K.tall.z1 - n.a1), pos: [X1 - dd / 2, PL + th / 2, (n.a1 + K.tall.z1) / 2] });
  body.push({ geo: box(dd, NICHE.y0 - PL, n.a1 - n.a0), pos: [X1 - dd / 2, (PL + NICHE.y0) / 2, (n.a0 + n.a1) / 2] });
  body.push({ geo: box(dd, TALL_Y1 - NICHE.y1, n.a1 - n.a0), pos: [X1 - dd / 2, (NICHE.y1 + TALL_Y1) / 2, (n.a0 + n.a1) / 2] });
  // end panel of the tall bank, flush with the fronts
  body.push({ geo: rbox(D, TALL_Y1 - Y0, 0.019, 0.0015), pos: [X1 - D / 2, Y0 + (TALL_Y1 - Y0) / 2, K.tall.z1 + 0.0095] });
  // plinths, set back 50 mm
  const ph = K.plinth;
  plinth.push({ geo: box(RUN_S1 - RUN_S0, ph, 0.02), pos: [(RUN_S0 + RUN_S1) / 2, Y0 + ph / 2, Z0 + D - 0.06] });
  plinth.push({ geo: box(0.02, ph, K.tall.z1 - RUN_E0), pos: [X1 - D + 0.06, Y0 + ph / 2, (RUN_E0 + K.tall.z1) / 2] });
  return { body, plinth };
}

/** Handleless channel under the worktop (flat-panel fronts). */
function channels(): Placed[] {
  const y = F_Y1 - 0.016;
  return [
    { geo: box(RUN_S1 - RUN_S0, 0.032, 0.02), pos: [(RUN_S0 + RUN_S1) / 2, y, Z0 + D - 0.035] },
    { geo: box(0.02, 0.032, RUN_E1 - RUN_E0), pos: [X1 - D + 0.035, y, (RUN_E0 + RUN_E1) / 2] },
  ];
}
function islandChannel(): Placed[] {
  return [{ geo: box(0.02, 0.032, IS.z1 - IS.z0 - 0.02), pos: [IS.x1 - 0.035, F_Y1 - 0.016, (IS.z0 + IS.z1) / 2] }];
}

const SINK = { z0: K.sink.z - 0.4, z1: K.sink.z + 0.4, x0: X1 - D + 0.07, x1: X1 - 0.13 };
const HOB = { x0: K.cooktop.x - 0.4, x1: K.cooktop.x + 0.4, z0: Z0 + 0.1, z1: Z0 + 0.6 };

function worktops(): Placed[] {
  const y = TOP - CT / 2;
  const dd = D + 0.02;
  return [
    { geo: rbox(X1 - RUN_S0 + 0.02, CT, dd, 0.002), pos: [(RUN_S0 - 0.02 + X1) / 2, y, Z0 + dd / 2] },
    // east run, round the undermount sink
    { geo: rbox(dd, CT, SINK.z0 - (Z0 + dd), 0.002), pos: [X1 - dd / 2, y, (Z0 + dd + SINK.z0) / 2] },
    { geo: rbox(dd, CT, RUN_E1 - SINK.z1, 0.002), pos: [X1 - dd / 2, y, (SINK.z1 + RUN_E1) / 2] },
    { geo: rbox(SINK.x0 - (X1 - dd), CT, SINK.z1 - SINK.z0, 0.002), pos: [(X1 - dd + SINK.x0) / 2, y, K.sink.z] },
    { geo: rbox(X1 - SINK.x1, CT, SINK.z1 - SINK.z0, 0.002), pos: [(SINK.x1 + X1) / 2, y, K.sink.z] },
    // a stone return down to the floor at the open end of the gable run
    { geo: rbox(CT, TOP - Y0, dd, 0.002), pos: [RUN_S0 - 0.02 - CT / 2 + 0.001, Y0 + (TOP - Y0) / 2, Z0 + dd / 2] },
  ];
}

/** Full-height slab backsplash (to the datum), cut round the sink window. */
function backsplash(): Placed[] {
  const t = 0.012;
  const h = DATUM - TOP;
  const cy = TOP + h / 2;
  return [
    { geo: box(X1 - RUN_S0 + 0.02, h, t), pos: [(RUN_S0 - 0.02 + X1) / 2, cy, Z0 + t / 2] },
    { geo: box(t, h, WIN.z0 - Z0 - t), pos: [X1 - t / 2, cy, (Z0 + t + WIN.z0) / 2] },
    { geo: box(t, h, RUN_E1 - WIN.z1), pos: [X1 - t / 2, cy, (WIN.z1 + RUN_E1) / 2] },
    { geo: box(t, WIN.y0 - TOP, WIN.z1 - WIN.z0), pos: [X1 - t / 2, (TOP + WIN.y0) / 2, (WIN.z0 + WIN.z1) / 2] },
    { geo: box(t, DATUM - WIN.y1, WIN.z1 - WIN.z0), pos: [X1 - t / 2, (WIN.y1 + DATUM) / 2, (WIN.z0 + WIN.z1) / 2] },
  ];
}

/** A stone ledge along the gable backsplash, lit from beneath. */
const LEDGE_Y = TOP + 0.5;
const LEDGE_D = 0.15;
function ledge() {
  const len = RUN_S1 - RUN_S0 - 0.3;
  const cx = (RUN_S0 + RUN_S1) / 2 - 0.02;
  return {
    stone: [{ geo: rbox(len, 0.025, LEDGE_D, 0.002), pos: [cx, LEDGE_Y, Z0 + 0.012 + LEDGE_D / 2] as V3 }],
    led: [{ geo: box(len - 0.04, 0.004, 0.012), pos: [cx, LEDGE_Y - 0.0145, Z0 + 0.012 + LEDGE_D - 0.025] as V3 }],
  };
}

function sinkAndHob() {
  const steel: Placed[] = [];
  const bw = SINK.x1 - SINK.x0;
  const bl = SINK.z1 - SINK.z0;
  const depth = 0.2;
  const yb = TOP - CT - depth;
  steel.push({ geo: box(bw, 0.004, bl), pos: [(SINK.x0 + SINK.x1) / 2, yb, K.sink.z] });
  steel.push({ geo: box(0.004, depth, bl), pos: [SINK.x0, yb + depth / 2, K.sink.z] });
  steel.push({ geo: box(0.004, depth, bl), pos: [SINK.x1, yb + depth / 2, K.sink.z] });
  steel.push({ geo: box(bw, depth, 0.004), pos: [(SINK.x0 + SINK.x1) / 2, yb + depth / 2, SINK.z0] });
  steel.push({ geo: box(bw, depth, 0.004), pos: [(SINK.x0 + SINK.x1) / 2, yb + depth / 2, SINK.z1] });
  // faucet: a gooseneck behind the bowl
  const fx = X1 - 0.08;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(fx, TOP, K.sink.z),
    new THREE.Vector3(fx, TOP + 0.3, K.sink.z),
    new THREE.Vector3(fx - 0.05, TOP + 0.4, K.sink.z),
    new THREE.Vector3(fx - 0.16, TOP + 0.38, K.sink.z),
    new THREE.Vector3(fx - 0.22, TOP + 0.3, K.sink.z),
    new THREE.Vector3(fx - 0.225, TOP + 0.24, K.sink.z),
  ]);
  const tap: Placed[] = [
    { geo: new THREE.TubeGeometry(curve, 40, 0.012, 12, false) },
    { geo: new THREE.CylinderGeometry(0.024, 0.026, 0.05, 20), pos: [fx, TOP + 0.025, K.sink.z] },
    { geo: new THREE.CylinderGeometry(0.009, 0.009, 0.1, 10), pos: [fx + 0.004, TOP + 0.13, K.sink.z + 0.035], rot: [Math.PI / 2, 0, 0] },
  ];
  const hob: Placed[] = [{ geo: rbox(HOB.x1 - HOB.x0, 0.006, HOB.z1 - HOB.z0, 0.002), pos: [K.cooktop.x, TOP + 0.002, (HOB.z0 + HOB.z1) / 2] }];
  return { steel, tap, hob };
}

function island(kind: "island" | "waterfall") {
  const wf = kind === "waterfall";
  const t = wf ? 0.05 : CT;
  const seat = wf ? 0.32 : 0.26;
  const x0 = IS.x0 - seat;
  const carc: Placed[] = [];
  const h = F_Y1 - PL + GAP;
  const inset = wf ? 0.1 : 0.02;
  carc.push({ geo: box(IS.x1 - IS.x0 - 0.02, h, IS.z1 - IS.z0 - inset), pos: [(IS.x0 + IS.x1 - 0.02) / 2, PL + h / 2, (IS.z0 + IS.z1) / 2] });
  // panelled seating side
  carc.push({ geo: rbox(0.019, TOP - t - Y0, IS.z1 - IS.z0 - inset, 0.0015), pos: [IS.x0 + 0.0095, Y0 + (TOP - t - Y0) / 2, (IS.z0 + IS.z1) / 2] });
  const len = IS.z1 - IS.z0 + (wf ? 0 : 0.04);
  const top: Placed[] = [{ geo: rbox(IS.x1 + 0.02 - x0, t, len, 0.003), pos: [(x0 + IS.x1 + 0.02) / 2, TOP - t / 2, (IS.z0 + IS.z1) / 2] }];
  if (wf) for (const z of [IS.z0 + t / 2, IS.z1 - t / 2]) top.push({ geo: rbox(IS.x1 + 0.02 - x0, TOP - t - Y0, t, 0.003), pos: [(x0 + IS.x1 + 0.02) / 2, Y0 + (TOP - t - Y0) / 2, z] });
  const plinth: Placed[] = [{ geo: box(0.02, K.plinth, IS.z1 - IS.z0 - inset - 0.06), pos: [IS.x1 - 0.06, Y0 + K.plinth / 2, (IS.z0 + IS.z1) / 2] }];
  return { carc, top, plinth };
}

const STOOL_X = IS.x0 - 0.42;
function stools(n: number) {
  const zs = n === 3 ? [-11.3, -10.4, -9.5] : [-10.85, -9.95];
  const seat: Placed[] = [];
  const frame: Placed[] = [];
  const sy = Y0 + 0.66;
  for (const z of zs) {
    seat.push({ geo: rbox(0.4, 0.055, 0.36, 0.02), pos: [STOOL_X, sy, z] });
    // splayed legs
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const top = new THREE.Vector3(STOOL_X + dx * 0.15, sy - 0.03, z + dz * 0.13);
      const foot = new THREE.Vector3(STOOL_X + dx * 0.19, Y0, z + dz * 0.17);
      const g = new THREE.CylinderGeometry(0.009, 0.009, top.distanceTo(foot), 8);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      frame.push({ geo: g, matrix: new THREE.Matrix4().compose(top.clone().add(foot).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) });
    }
    // footrest
    const fy = Y0 + 0.24;
    frame.push({ geo: box(0.36, 0.012, 0.012), pos: [STOOL_X, fy, z - 0.155] });
    frame.push({ geo: box(0.36, 0.012, 0.012), pos: [STOOL_X, fy, z + 0.155] });
    frame.push({ geo: box(0.012, 0.012, 0.31), pos: [STOOL_X - 0.175, fy, z] });
    frame.push({ geo: box(0.012, 0.012, 0.31), pos: [STOOL_X + 0.175, fy, z] });
  }
  return { seat, frame };
}

/* ------------------------------------------------------ integrated lighting */

/**
 * Plinth (toe-kick) LEDs: a strip under the carcass front on each run, and the pool of light it
 * throws on the floor, drawn as an additive gradient (the floor is lit, the strip is not seen).
 */
function toeKick(run: Run, a0: number, a1: number) {
  const len = Math.abs(a1 - a0);
  const mid = (a0 + a1) / 2;
  const strip: Placed = { geo: box(len, 0.006, 0.01), matrix: at(run, mid, PL - 0.004, D - 0.045) };
  const reach = 0.42;
  const g = new THREE.PlaneGeometry(len, reach);
  // lying flat, facing up; in the run's frame x runs along it and z out into the room, so
  // uv.y = 1 falls on the plinth side and 0 on the far edge
  g.rotateX(-Math.PI / 2);
  return { strip, glow: { geo: g, matrix: at(run, mid, Y0 + 0.003, D - 0.06 + reach / 2) } as Placed };
}

function ledPlan() {
  const strips: Placed[] = [];
  const glows: Placed[] = [];
  const islandStrips: Placed[] = [];
  const islandGlows: Placed[] = [];
  for (const [run, a0, a1] of [
    [SOUTH, RUN_S0, RUN_S1],
    [EAST, RUN_E0, K.tall.z1],
  ] as [Run, number, number][]) {
    const t = toeKick(run, a0, a1);
    strips.push(t.strip);
    glows.push(t.glow);
  }
  const it = toeKick(ISLAND, -IS.z1 + 0.05, -IS.z0 - 0.05);
  islandStrips.push(it.strip);
  islandGlows.push(it.glow);
  return { strips, glows, islandStrips, islandGlows };
}

/** Recessed downlights over the gable run: they scallop the stone splash. [x, z] */
const DOWNLIGHTS: [number, number][] = [
  [0.55, Z0 + 0.42],
  [2.5, Z0 + 0.42],
  [4.3, Z0 + 0.42],
  [X1 - 0.42, -9.92],
];

/* -------------------------------------------------------------- the ceiling */

/** Underside of the slatted white-oak ceiling (flat, under the pavilion's roof slab). */
const CEIL_Y = Y0 + K.ceiling;
export function ceilingY() {
  return CEIL_Y;
}

function vault() {
  const slats: Placed[] = [];
  const backing: Placed[] = [];
  const len = Z1 - Z0;
  const pitch = 0.085;
  const n = Math.floor((X1 - X0) / pitch);
  for (let i = 0; i < n; i++) {
    slats.push({ geo: box(0.058, 0.024, len), pos: [X0 + (i + 0.5) * pitch, CEIL_Y + 0.012, (Z0 + Z1) / 2] });
  }
  // dark acoustic backing between the slats
  backing.push({ geo: box(X1 - X0, 0.01, len), pos: [(X0 + X1) / 2, CEIL_Y + 0.03, (Z0 + Z1) / 2] });
  // a shadow-gap trim where the ceiling meets the walls
  const plate: Placed[] = [
    { geo: box(0.06, 0.04, len), pos: [X1 - 0.03, CEIL_Y - 0.01, (Z0 + Z1) / 2] },
    { geo: box(0.06, 0.04, len), pos: [X0 + 0.03, CEIL_Y - 0.01, (Z0 + Z1) / 2] },
  ];
  // a linear light slot down the middle of the room
  const ridge: Placed[] = [{ geo: box(0.05, 0.012, len - 0.6), pos: [(X0 + X1) / 2, CEIL_Y - 0.004, (Z0 + Z1) / 2] }];
  return { slats, backing, plate, ridge };
}

/* ------------------------------------------------------------- before-only */

function beforeOnly() {
  const uppers = parts();
  const carc: Placed[] = [];
  const y0 = Y0 + 1.42;
  const y1 = Y0 + 2.15;
  const ud = 0.34;
  // shift the runs back so the same front builder puts upper fronts `ud` off the wall
  const shift = (r: Run): Run => ({ o: [r.o[0] - r.n[0] * (D - ud), r.o[1] - r.n[1] * (D - ud)], dir: r.dir, n: r.n });
  const S = shift(SOUTH);
  const E = shift(EAST);
  const spans: [Run, number, number][] = [
    [S, RUN_S0, K.cooktop.x - 0.5],
    [S, K.cooktop.x + 0.5, X1 - ud],
    [E, Z0 + ud, WIN.z0],
    [E, WIN.z1, RUN_E1],
  ];
  for (const [r, a0, a1] of spans) {
    const n = Math.max(1, Math.round((a1 - a0) / 0.45));
    const w = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      front(r, "shaker", a0 + w * (i + 0.5), w - GAP * 2, y0, y1, uppers);
      knob(r, a0 + w * (i + 0.5) + (i % 2 ? -1 : 1) * (w / 2 - 0.05), y0 + 0.07, uppers);
    }
    const mid = (a0 + a1) / 2;
    carc.push({ geo: box(a1 - a0, y1 - y0, ud - 0.02), matrix: at(r, mid, (y0 + y1) / 2, D - ud + (ud - 0.02) / 2) });
    // soffit box above the uppers
    carc.push({ geo: box(a1 - a0, DATUM - y1, ud), matrix: at(r, mid, (y1 + DATUM) / 2, D - ud / 2) });
  }
  // a boxy hood between the gable uppers
  const hood: Placed[] = [
    { geo: box(0.96, 0.14, 0.5), pos: [K.cooktop.x, y0 + 0.07, Z0 + 0.25] },
    { geo: box(0.96, DATUM - y0 - 0.14, 0.32), pos: [K.cooktop.x, (y0 + 0.14 + DATUM) / 2, Z0 + 0.16] },
  ];
  // coil range: four burner rings on a white enamel top
  const range: Placed[] = [{ geo: box(0.76, 0.012, 0.56), pos: [K.cooktop.x, TOP + 0.004, Z0 + 0.34] }];
  const rings: Placed[] = [];
  for (const [dx, dz] of [
    [-0.18, -0.12],
    [0.18, -0.12],
    [-0.18, 0.14],
    [0.18, 0.14],
  ]) {
    const r = new THREE.TorusGeometry(0.08, 0.008, 6, 28);
    r.rotateX(Math.PI / 2);
    rings.push({ geo: r, pos: [K.cooktop.x + dx, TOP + 0.013, Z0 + 0.34 + dz] });
  }
  // tile splash between worktop and uppers (round the sink window)
  const t = 0.008;
  const h = y0 - TOP;
  const splash: Placed[] = [
    { geo: box(X1 - RUN_S0, h, t), pos: [(RUN_S0 + X1) / 2, TOP + h / 2, Z0 + t / 2] },
    { geo: box(t, h, WIN.z0 - Z0 - t), pos: [X1 - t / 2, TOP + h / 2, (Z0 + t + WIN.z0) / 2] },
    { geo: box(t, h, RUN_E1 - WIN.z1), pos: [X1 - t / 2, TOP + h / 2, (WIN.z1 + RUN_E1) / 2] },
    { geo: box(t, WIN.y0 - TOP, WIN.z1 - WIN.z0), pos: [X1 - t / 2, (TOP + WIN.y0) / 2, (WIN.z0 + WIN.z1) / 2] },
  ];
  return { uppers, carc, hood, range, rings, splash };
}

/* ---------------------------------------------------------------- lighting */

const PENDANT_Z = [-11.25, -10.4, -9.55];
const PENDANT_X = (IS.x0 + IS.x1) / 2;
const PENDANT_Y = TOP + 0.74; // bottom of the shade
const LAMPS: Lamp[] = [
  ...PENDANT_Z.map((z) => ({ pos: [PENDANT_X, PENDANT_Y + 0.06, z] as V3, color: "#ffd6ae", power: 14, range: 3.6, group: "kitchen" as const })),
  // the light slot in the ceiling
  { pos: [(X0 + X1) / 2, CEIL_Y - 0.1, -11.6], color: "#fff0e2", power: 3, range: 6, group: "kitchen" },
  { pos: [(X0 + X1) / 2, CEIL_Y - 0.1, -6.6], color: "#fff0e2", power: 3, range: 6, group: "kitchen" },
  // recessed downlights close to the walls: the scallops on the stone
  ...DOWNLIGHTS.map(([x, z]) => {
    const toWall: [number, number, number] = z === Z0 + 0.42 ? [0, -1, -0.16] : [0.16, -1, 0];
    return { pos: [x, CEIL_Y - 0.02, z] as V3, color: "#ffe2c2", power: 9, range: 3.8, group: "kitchen" as const, cone: { dir: toWall, inner: 14, outer: 36 } };
  }),
];

/* ---------------------------------------------------------------- materials */

const CAB_PAINT: Record<Exclude<CabinetId, "walnut-slab">, { color: string; roughness: number }> = {
  graphite: { color: "#3d3e41", roughness: 0.62 },
  "two-tone": { color: "#cdcac4", roughness: 0.55 },
  "shaker-white": { color: "#e8e2d6", roughness: 0.46 },
  "sage-shaker": { color: "#7f8c74", roughness: 0.5 },
};

/** Veneer with the grain turned vertical (doors are cut that way). */
function rotated(t: THREE.Texture | null) {
  if (!t) return null;
  const c = t.clone();
  c.center.set(0.5, 0.5);
  c.rotation = Math.PI / 2;
  c.repeat.set(t.repeat.y, t.repeat.x);
  return c;
}

/* --------------------------------------------------------------- component */

export function Kitchen() {
  const cfg = useDemo((s) => s.remodeling);
  const compare = useDemo((s) => s.compare);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const beforeOn = compare && industry === "remodeling" && phase === "explore";

  const geo = useMemo(() => {
    const shaker = joinery("shaker");
    const slab = joinery("slab");
    const hl = joinery("handleless");
    const c = carcasses();
    const n = niche();
    const lp = ledPlan();
    const trims: Placed[] = DOWNLIGHTS.map(([x, z]) => ({ geo: new THREE.CircleGeometry(0.036, 20), pos: [x, CEIL_Y - 0.002, z] as V3, rot: [Math.PI / 2, 0, 0] as V3 }));
    const ledgeGlow = new THREE.PlaneGeometry(RUN_S1 - RUN_S0 - 0.34, 0.36);
    ledgeGlow.rotateX(-Math.PI / 2);
    ledgeGlow.translate((RUN_S0 + RUN_S1) / 2 - 0.02, TOP + 0.0015, Z0 + 0.012 + 0.18);
    // uv.y = 1 at the wall (under the ledge), fading toward the front of the worktop
    const nicheGlow: Placed[] = [];
    const bays = [NICHE.y0 + 0.025, NICHE.shelves[0] - 0.014, NICHE.shelves[0] + 0.014, NICHE.shelves[1] - 0.014, NICHE.shelves[1] + 0.014, NICHE.y1 - 0.025];
    const span = nicheSpan();
    for (let i = 0; i < bays.length; i += 2) {
      const g = new THREE.PlaneGeometry(span.a1 - span.a0 - 0.06, bays[i + 1] - bays[i]);
      nicheGlow.push({ geo: g, matrix: at(EAST, n.mid, (bays[i] + bays[i + 1]) / 2, 0.027) });
    }
    const isl = island("island");
    const wf = island("waterfall");
    const s2 = stools(2);
    const s3 = stools(3);
    const v = vault();
    const sh = sinkAndHob();
    const l = ledge();
    const floor = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0);
    floor.rotateX(-Math.PI / 2);
    const uv = floor.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0), uv.getY(i) * (Z1 - Z0));
    return {
      floor,
      carcass: merge(c.body),
      plinth: merge(c.plinth),
      shaker: merge(shaker.run.fronts),
      shakerPulls: merge(shaker.run.pulls),
      slab: merge(slab.run.fronts),
      slabPulls: merge(slab.run.pulls),
      hlPulls: merge(hl.run.pulls),
      pantryShaker: merge(shaker.pantry.fronts),
      pantryShakerPulls: merge(shaker.pantry.pulls),
      nicheLining: merge([...n.lining, ...n.shelves]),
      nicheBack: merge(n.back),
      nicheLed: merge(n.led),
      nicheGlow: merge(nicheGlow),
      toeStrips: merge(lp.strips),
      toeGlow: merge(lp.glows),
      isToeStrips: merge(lp.islandStrips),
      isToeGlow: merge(lp.islandGlows),
      ledgeGlow,
      trims: merge(trims),
      appliance: merge(shaker.run.glass),
      channel: merge(channels()),
      iShaker: merge(shaker.island.fronts),
      iShakerPulls: merge(shaker.island.pulls),
      iSlab: merge(slab.island.fronts),
      iChannel: merge(islandChannel()),
      isCarc: merge(isl.carc),
      isTop: merge(isl.top),
      isPlinth: merge(isl.plinth),
      wfCarc: merge(wf.carc),
      wfTop: merge(wf.top),
      wfPlinth: merge(wf.plinth),
      seat2: merge(s2.seat),
      frame2: merge(s2.frame),
      seat3: merge(s3.seat),
      frame3: merge(s3.frame),
      worktop: merge(worktops()),
      splash: merge(backsplash()),
      ledge: merge(l.stone),
      led: merge(l.led),
      sink: merge(sh.steel),
      tap: merge(sh.tap),
      hob: merge(sh.hob),
      slats: merge(v.slats),
      backing: merge(v.backing),
      plate: merge(v.plate),
      ridge: merge(v.ridge),
    };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  const lazy = useMemo(() => lazyCache<THREE.Material>(), []);
  const mats = useMemo(() => {
    const lit = <T extends THREE.MeshStandardMaterial>(m: T) => lampLit(m, ["kitchen"]);
    const side = (s: "after" | "before") => ({ cut: "solid" as const, wipe: { side: s, u: wipes.kitchen } });
    const after = <T extends THREE.MeshStandardMaterial>(m: T) => patch(lit(m), side("after"));
    const before = <T extends THREE.MeshStandardMaterial>(m: T) => patch(lit(m), side("before"));
    const shared = <T extends THREE.MeshStandardMaterial>(m: T) => patch(lit(m), { cut: "solid" });
    const L = (key: string, make: () => THREE.MeshStandardMaterial) => lazy.get(key, make) as THREE.MeshStandardMaterial;

    // Built on first use: only the chosen finishes cost a download.
    const counter = (id: CounterId) =>
      L(`c-${id}`, () => {
        switch (id) {
          case "black-granite":
            return after(pbr("black_granite", { roughness: 0.55, normalScale: 0.25, envMapIntensity: 0.45 }));
          case "butcher-block":
            return after(pbr("oak_veneer", { color: "#e8c6a0", roughness: 0.75, envMapIntensity: 0.3 }));
          case "concrete":
            return after(pbr("concrete_polished", { color: "#d9d4cc", roughness: 0.85, normalScale: 0.4, envMapIntensity: 0.35 }));
          default:
            return after(pbr("calacatta_oro", { roughness: 1.25, normalScale: 0.2, envMapIntensity: 0.6 }));
        }
      });
    // butcher block gets a polished lime-plaster splash; stone and concrete run up the wall
    const splash = (id: CounterId) =>
      id === "butcher-block" ? L("s-tadelakt", () => after(pbr("plaster", { color: "#efe6da", roughness: 0.75, normalScale: 0.5, envMapIntensity: 0.3 }))) : counter(id);
    const floor = (id: FloorId) =>
      L(`f-${id}`, () => {
        switch (id) {
          case "herringbone":
            return after(pbr("herringbone", { color: "#e8e2da", roughness: 0.9, envMapIntensity: 0.35 }));
          case "porcelain":
            return after(pbr("porcelain", { roughness: 0.9, normalScale: 0.6, envMapIntensity: 0.45 }));
          case "concrete":
            return after(pbr("concrete_polished", { color: "#cfcac2", roughness: 0.75, normalScale: 0.3, envMapIntensity: 0.4 }));
          default:
            return after(pbr("oak_floor", { color: "#cfc4b8", roughness: 0.7, envMapIntensity: 0.45 }));
        }
      });
    const walnut = () =>
      L("walnut", () => {
        const m = after(pbr("walnut", { color: "#d9a57a", roughness: 0.7, envMapIntensity: 0.35 }));
        const arm = rotated(m.roughnessMap);
        m.map = rotated(m.map);
        m.normalMap = rotated(m.normalMap);
        m.roughnessMap = arm;
        m.aoMap = arm;
        return m;
      });
    // the niche lining: walnut with its grain running along the shelves (no rotated copies to wait for)
    const nicheWood = () => L("nicheWood", () => after(pbr("walnut", { color: "#d9a57a", roughness: 0.7, envMapIntensity: 0.35 })));
    const beforeSet = () => ({
      oak: L("b-oak", () => before(pbr("oak_veneer", { color: "#d8b690", roughness: 0.5, envMapIntensity: 0.45 }))),
      granite: L("b-granite", () => before(pbr("black_granite", { color: "#d9b58c", roughness: 0.4, envMapIntensity: 0.5 }))),
      floor: L("b-floor", () => before(pbr("old_tiles", { color: "#efe6d2", roughness: 0.8, envMapIntensity: 0.4 }))),
      tile: L("b-tile", () => before(pbr("pool_tile", { color: "#efe2c4", roughness: 0.35, envMapIntensity: 0.4 }))),
      brass: L("b-brass", () => before(solid("#c9a45a", 0.25, 1, { envMapIntensity: 0.8 }))),
      steel: L("b-steel", () => before(solid("#b9bcbf", 0.45, 1, { envMapIntensity: 0.6 }))),
      enamel: L("b-enamel", () => before(solid("#ece9e2", 0.35, 0, { envMapIntensity: 0.5 }))),
      almond: L("b-almond", () => before(solid("#cfc4ad", 0.55, 0, { envMapIntensity: 0.4 }))),
      coil: L("b-coil", () => before(solid("#1b1b1b", 0.6, 0.4))),
      dark: L("b-dark", () => before(solid("#3a2c20", 0.8, 0))),
    });
    return {
      counter,
      splash,
      floor,
      walnut,
      nicheWood,
      beforeSet,
      paint: after(solid("#e8e2d6", 0.46, 0, { envMapIntensity: 0.35 })),
      brass: after(solid("#b8925c", 0.3, 1, { envMapIntensity: 0.7 })),
      bronze: after(solid("#2b2724", 0.42, 0.85, { envMapIntensity: 0.6 })),
      plinth: after(solid("#1d1c1b", 0.8, 0, { envMapIntensity: 0.2 })),
      channel: after(solid("#1f1d1b", 0.5, 0.6, { envMapIntensity: 0.3 })),
      steel: after(pbr("brushed_steel", { color: "#c9ccce", metalness: 1, roughness: 0.32, envMapIntensity: 0.7 })),
      tap: after(solid("#b8925c", 0.28, 1, { envMapIntensity: 0.8 })),
      blackGlass: after(solid("#070708", 0.05, 0, { envMapIntensity: 0.9 })),
      // counter stools: charcoal bouclé seats
      stoolSeat: after(pbr("boucle", { color: "#5b5854", roughness: 1, envMapIntensity: 0.25 })),
      stoolFrame: after(solid("#161514", 0.45, 0.7, { envMapIntensity: 0.4 })),
      led: after(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#ffe1c0"), emissiveIntensity: 6 })),
      islandPaint: after(solid("#1d1d1f", 0.5, 0, { envMapIntensity: 0.4 })),
      // light the LED strips throw: additive gradients (floor, niche backs, worktop)
      toeGlow: patch(glowMaterial("#ffb877", 0.95), side("after")),
      nicheGlow: patch(glowMaterial("#ffc58f", 1.25), side("after")),
      ledgeGlow: patch(glowMaterial("#ffcf9e", 0.55), side("after")),
      trim: patch(new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff0dc").multiplyScalar(5) }), { cut: "solid" }),
      // the room itself does not change
      oak: shared(pbr("white_oak", { color: "#f2e9de", roughness: 0.85, envMapIntensity: 0.25 })),
      backing: shared(solid("#1a1816", 1, 0, { envMapIntensity: 0 })),
      plaster: shared(pbr("plaster", { color: "#efe8dd", roughness: 1, envMapIntensity: 0.25 })),
      ridge: shared(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#ffd6a6"), emissiveIntensity: 3 })),
    };
  }, [lazy]);

  useEffect(
    () => () => {
      lazy.dispose();
      Object.values(mats).forEach((m) => {
        if (m instanceof THREE.Material) m.dispose();
      });
    },
    [lazy, mats],
  );

  useEffect(() => {
    registerLamps(LAMPS);
    return () => unregisterLamps(LAMPS);
  }, []);

  // the room lights itself: an interior probe replaces the sky as the environment inside
  const tier = useDemo((s) => s.tier);
  const inside = industry === "remodeling" && (phase === "explore" || phase === "qualify" || phase === "flow");
  useInteriorProbe({
    position: [1.7, 1.6, -10.4],
    active: inside && tier !== "low",
    version: `${cfg.cabinets}|${cfg.counter}|${cfg.floor}|${cfg.island}`,
    ready: () => Math.abs(anim.dusk - REMODEL_DUSK) < 0.02,
    size: tier === "high" ? 256 : 128,
    intensity: 0.75,
  });

  const style: Style = cfg.cabinets.includes("shaker") ? "shaker" : cfg.cabinets === "walnut-slab" ? "slab" : "handleless";
  const cabMat = cfg.cabinets === "walnut-slab" ? mats.walnut() : mats.paint;
  const islandMat = cfg.cabinets === "two-tone" ? mats.islandPaint : cabMat;
  const nicheWood = mats.nicheWood();
  const led = cfg.lighting;
  useEffect(() => {
    if (cfg.cabinets === "walnut-slab") return;
    const p = CAB_PAINT[cfg.cabinets];
    mats.paint.color.set(p.color);
    mats.paint.roughness = p.roughness;
  }, [cfg.cabinets, mats]);

  const pulls = style === "shaker" ? mats.brass : mats.bronze;
  const runPulls = style === "shaker" ? geo.shakerPulls : style === "slab" ? geo.slabPulls : geo.hlPulls;
  const counter = mats.counter(cfg.counter);
  const splash = mats.splash(cfg.counter);
  const floorMat = mats.floor(cfg.floor);
  const B = beforeOn ? mats.beforeSet() : null;
  const beforeGeo = useMemo(() => {
    if (!beforeOn) return null;
    const b = beforeOnly();
    return {
      fronts: merge(b.uppers.fronts),
      knobs: merge(b.uppers.pulls),
      carc: merge(b.carc),
      hood: merge(b.hood),
      range: merge(b.range),
      rings: merge(b.rings),
      splash: merge(b.splash),
    };
  }, [beforeOn]);
  useEffect(
    () => () => {
      if (beforeGeo) Object.values(beforeGeo).forEach((g) => g.dispose());
    },
    [beforeGeo],
  );

  const sh = { castShadow: true, receiveShadow: true };
  const floorPos: V3 = [(X0 + X1) / 2, Y0 + 0.002, (Z0 + Z1) / 2];
  const hasIsland = cfg.island !== "none";
  const wf = cfg.island === "waterfall";

  return (
    <group name="kitchen">
      {/* the room */}
      <mesh geometry={geo.slats} material={mats.oak} receiveShadow />
      <mesh geometry={geo.backing} material={mats.backing} />
      <mesh geometry={geo.plate} material={mats.plaster} receiveShadow />
      <mesh geometry={geo.ridge} material={mats.ridge} />

      {/* after */}
      <mesh geometry={geo.floor} material={floorMat} position={floorPos} receiveShadow />
      <mesh geometry={geo.carcass} material={cabMat} {...sh} />
      <mesh geometry={style === "shaker" ? geo.shaker : geo.slab} material={cabMat} {...sh} />
      <mesh geometry={runPulls} material={pulls} castShadow />
      {style !== "shaker" && <mesh geometry={geo.channel} material={mats.channel} />}
      {/* the open niche in the tall bank */}
      <mesh geometry={geo.nicheLining} material={nicheWood} {...sh} />
      <mesh geometry={geo.nicheBack} material={nicheWood} receiveShadow />
      {led && (
        <>
          <mesh geometry={geo.nicheLed} material={mats.led} />
          <mesh geometry={geo.nicheGlow} material={mats.nicheGlow} renderOrder={3} />
          <mesh geometry={geo.toeStrips} material={mats.led} />
          <mesh geometry={geo.toeGlow} material={mats.toeGlow} renderOrder={3} />
          <mesh geometry={geo.ledgeGlow} material={mats.ledgeGlow} renderOrder={3} />
        </>
      )}
      <mesh geometry={geo.trims} material={mats.trim} />
      <mesh geometry={geo.appliance} material={mats.blackGlass} receiveShadow />
      <mesh geometry={geo.plinth} material={mats.plinth} />
      <mesh geometry={geo.worktop} material={counter} {...sh} />
      <mesh geometry={geo.splash} material={splash} receiveShadow />
      <mesh geometry={geo.ledge} material={splash} {...sh} />
      {led && <mesh geometry={geo.led} material={mats.led} />}
      <mesh geometry={geo.sink} material={mats.steel} receiveShadow />
      <mesh geometry={geo.tap} material={mats.tap} castShadow />
      <mesh geometry={geo.hob} material={mats.blackGlass} receiveShadow />
      {hasIsland && (
        <>
          <mesh geometry={wf ? geo.wfCarc : geo.isCarc} material={islandMat} {...sh} />
          <mesh geometry={style === "shaker" ? geo.iShaker : geo.iSlab} material={islandMat} {...sh} />
          {led && (
            <>
              <mesh geometry={geo.isToeStrips} material={mats.led} />
              <mesh geometry={geo.isToeGlow} material={mats.toeGlow} renderOrder={3} />
            </>
          )}
          {style === "shaker" ? <mesh geometry={geo.iShakerPulls} material={pulls} castShadow /> : <mesh geometry={geo.iChannel} material={mats.channel} />}
          <mesh geometry={wf ? geo.wfTop : geo.isTop} material={counter} {...sh} />
          <mesh geometry={wf ? geo.wfPlinth : geo.isPlinth} material={mats.plinth} />
          <mesh geometry={wf ? geo.seat3 : geo.seat2} material={mats.stoolSeat} {...sh} />
          <mesh geometry={wf ? geo.frame3 : geo.frame2} material={mats.stoolFrame} castShadow />
        </>
      )}
      <Suspense fallback={null}>
        <Props island={hasIsland} />
      </Suspense>

      {/* before (only while comparing) */}
      {B && beforeGeo && (
        <>
          <mesh geometry={geo.floor} material={B.floor} position={[floorPos[0], floorPos[1] + 0.001, floorPos[2]]} receiveShadow />
          <mesh geometry={geo.carcass} material={B.oak} {...sh} />
          <mesh geometry={geo.shaker} material={B.oak} {...sh} />
          <mesh geometry={geo.shakerPulls} material={B.brass} />
          <mesh geometry={geo.pantryShaker} material={B.oak} {...sh} />
          <mesh geometry={geo.pantryShakerPulls} material={B.brass} />
          <mesh geometry={geo.plinth} material={B.dark} />
          <mesh geometry={geo.worktop} material={B.granite} {...sh} />
          <mesh geometry={geo.sink} material={B.steel} />
          <mesh geometry={beforeGeo.splash} material={B.tile} receiveShadow />
          <mesh geometry={beforeGeo.fronts} material={B.oak} {...sh} />
          <mesh geometry={beforeGeo.carc} material={B.oak} {...sh} />
          <mesh geometry={beforeGeo.knobs} material={B.brass} />
          <mesh geometry={beforeGeo.hood} material={B.almond} castShadow />
          <mesh geometry={beforeGeo.range} material={B.enamel} />
          <mesh geometry={beforeGeo.rings} material={B.coil} />
        </>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ props */

const PROPS = ["pendant", "bowl", "lemon", "vase_a", "vase_b", "board", "aloe"] as const;
const URLS = PROPS.map((id) => `/assets/models/${id}.glb`);

/** Poly Haven props (CC0): pendants, a bowl of lemons, vases, a board, an aloe. */
function Props({ island }: { island: boolean }) {
  const gltfs = useGLTF(URLS, false, true);
  const glowing = useMemo(() => [] as Array<{ mat: THREE.MeshStandardMaterial; peak: number }>, []);
  const scenes = useMemo(() => {
    const prep = (root: THREE.Object3D, glow = false) => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = !glow;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial & { transmission?: number };
        // opal shades glow with the kitchen lamps: lit globes after dark, a faint warmth by day
        if (glow && /glass|globe/i.test(mat.name)) glowing.push({ mat, peak: /globe/i.test(mat.name) ? 7 : 2.4 });
        if (mat.userData.vb) return; // shared by clones and remounts: patch once
        mat.userData.vb = true;
        mat.envMapIntensity = 0.45;
        if (mat.transmission) mat.transmission = 0;
        if (glow && /glass|globe/i.test(mat.name)) mat.emissive = new THREE.Color("#ffc68a");
        lampLit(mat, ["kitchen"]);
        patch(mat, { cut: "solid", wipe: { side: "after", u: wipes.kitchen } });
      });
      return root;
    };
    const [pendant, bowl, lemon, vase_a, vase_b, board, aloe] = gltfs.map((g, i) => prep(g.scene, PROPS[i] === "pendant"));
    return { pendant, bowl, lemon, vase_a, vase_b, board, aloe };
  }, [gltfs, glowing]);
  useFrame(() => {
    const k = lampLevel("kitchen");
    for (const g of glowing) g.mat.emissiveIntensity = g.peak * (0.2 + 0.8 * k);
  });

  const pendants = useMemo(() => PENDANT_Z.map(() => scenes.pendant.clone(true)), [scenes]);
  const lemons = useMemo(() => [0, 1, 2].map(() => scenes.lemon.clone(true)), [scenes]);
  const vase2 = useMemo(() => scenes.vase_b.clone(true), [scenes]);
  const cable = useMemo(() => new THREE.CylinderGeometry(0.003, 0.003, 1, 6), []);
  const cableMat = useMemo(() => patch(lampLit(solid("#141414", 0.5, 0.3), ["kitchen"]), { cut: "solid", wipe: { side: "after", u: wipes.kitchen } }), []);
  useEffect(
    () => () => {
      cable.dispose();
      cableMat.dispose();
    },
    [cable, cableMat],
  );

  // the pendant model: shade rim at y 0.221, stem top at 1.173
  const rodTop = PENDANT_Y + (1.173 - 0.221);
  const cableLen = Math.max(0.05, ceilingY() - rodTop);

  return (
    <group>
      {island &&
        pendants.map((p, i) => (
          <group key={i} position={[PENDANT_X, PENDANT_Y - 0.221, PENDANT_Z[i]]}>
            <primitive object={p} />
            <mesh geometry={cable} material={cableMat} position={[0, 1.173 + cableLen / 2, 0]} scale={[1, cableLen, 1]} />
          </group>
        ))}
      {island && (
        <>
          <group position={[PENDANT_X - 0.1, TOP, -10.0]} rotation={[0, 0.6, 0]}>
            <primitive object={scenes.bowl} />
            {lemons.map((l, i) => (
              <primitive key={i} object={l} position={[[-0.05, 0.05, 0.0][i], 0.07 + (i === 2 ? 0.035 : 0), [0.03, -0.02, 0.0][i]]} rotation={[i, i * 2, 0.4 * i]} />
            ))}
          </group>
          <primitive object={scenes.vase_b} position={[PENDANT_X + 0.15, TOP, -11.1]} />
        </>
      )}
      <primitive object={scenes.vase_a} position={[0.25, TOP, Z0 + 0.2]} scale={0.85} />
      <primitive object={vase2} position={[4.3, LEDGE_Y + 0.0125, Z0 + 0.012 + LEDGE_D / 2]} scale={0.7} />
      <primitive object={scenes.board} position={[1.35, TOP + 0.123, Z0 + 0.05]} rotation={[1.37, 0, 0.05]} />
      <primitive object={scenes.aloe} position={[X1 - 0.3, TOP, RUN_E0 + 0.3]} scale={1.5} />
    </group>
  );
}

if (typeof window !== "undefined") {
  // fetch the props once the page is idle; they are small (≈ 0.6 MB together)
  const idle = (cb: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 6000 }) : setTimeout(cb, 3000));
  idle(() => useGLTF.preload(URLS, false, true));
}
