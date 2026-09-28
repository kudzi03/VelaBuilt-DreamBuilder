"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BALCONY, FLOOR_Y, MAIN, MAIN_ROOF, MAIN_TOP, WALL, WING, WING_ROOF, WING_TOP } from "@/lib/spec";
import { emptyWindows, mergeGrouped, wallBand, windows, type WindowParts } from "./arch";
import { box, merge, type Placed, type WallDef } from "./geom";
import { interior, lampLevel, lampLit, registerLamps, unregisterLamps, type Lamp } from "./lamps";
import { glowMaterial } from "./glow";
import { glass, pbr, solid } from "./materials";
import { Roof, ROOF_EDGE } from "./Roof";
import { channels, depthFor, fades, ghostMaterial, patch, U } from "./shared";

/**
 * The residence: a two-storey glass volume under a thin flat roof, and a single-storey glass
 * pavilion (the kitchen) off its garden side. Floor-to-ceiling glass on both floors wherever the
 * garden sees the house; pale limestone piers and end walls; dark bronze frames and slab edges.
 * The first-floor slab cantilevers into a balcony edged in frameless glass; the roof and the
 * pavilion's canopy reach out beyond it. Their soffits carry downlights, and the rooms behind
 * the glass are furnished and lamp-lit, so after sunset the house glows from inside.
 */

const S = WALL;
const L2 = MAIN.level2;
const C1 = MAIN.ceil1;
const C2 = MAIN.ceil2;
const E = MAIN.eave;
/** glass heads stop just under the slab above */
const HEAD1 = C1 - 0.02;
const HEAD2 = E - 0.03;

export const MAIN_WALLS: WallDef[] = [
  {
    // street front
    face: "z+",
    at: MAIN.z1,
    from: MAIN.x0,
    to: MAIN.x1,
    height: E,
    thickness: S,
    openings: [
      { a: -5.3, b: -2.0, y0: 0.5, y1: HEAD1 },
      { a: -0.6, b: 0.6, y0: 0, y1: 2.72, kind: "door" },
      { a: 0.72, b: 1.3, y0: 0, y1: 2.72 },
      { a: 2.0, b: 5.3, y0: 0.5, y1: HEAD1 },
      { a: -5.3, b: -1.2, y0: 4.35, y1: HEAD2 },
      { a: 1.2, b: 5.3, y0: 4.35, y1: HEAD2 },
    ],
  },
  {
    // garden side: glass on both floors west of the pavilion, high windows above its roof
    face: "z-",
    at: MAIN.z0,
    from: MAIN.x0,
    to: MAIN.x1,
    height: E,
    thickness: S,
    openings: [
      { a: -5.72, b: -1.25, y0: 0, y1: HEAD1, kind: "slider" },
      { a: 1.6, b: 2.7, y0: 0, y1: 2.4, kind: "void" },
      { a: -5.72, b: -1.25, y0: L2, y1: HEAD2, kind: "slider" },
      { a: -0.5, b: 2.6, y0: WING_TOP + 0.2, y1: HEAD2 },
      { a: 3.2, b: 5.72, y0: WING_TOP + 0.2, y1: HEAD2 },
    ],
  },
  {
    // west: the showpiece, glass floor to ceiling on both floors
    face: "x-",
    at: MAIN.x0,
    from: MAIN.z0,
    to: MAIN.z1,
    height: E,
    thickness: S,
    openings: [
      { a: -3.66, b: 3.66, y0: 0, y1: HEAD1, kind: "slider" },
      { a: -3.66, b: 3.66, y0: L2, y1: HEAD2, kind: "slider" },
    ],
  },
  {
    face: "x+",
    at: MAIN.x1,
    from: MAIN.z0,
    to: MAIN.z1,
    height: E,
    thickness: S,
    openings: [
      { a: -0.45, b: 0.45, y0: 0.6, y1: HEAD2 },
      { a: 1.4, b: 3.3, y0: 0.45, y1: HEAD1 },
      { a: 1.4, b: 3.3, y0: 3.9, y1: HEAD2 },
    ],
  },
];

export const WING_WALLS: WallDef[] = [
  {
    face: "x+",
    at: WING.x1,
    from: WING.z0,
    to: MAIN.z0,
    height: WING.eave,
    thickness: S,
    openings: [
      // over the sink (sill just above the worktop), and the breakfast corner
      { a: -12.3, b: -10.3, y0: 1.15, y1: 2.35 },
      { a: -6.7, b: -4.8, y0: 0.55, y1: 2.6 },
    ],
  },
  {
    // south: a clerestory band above the joinery
    face: "z-",
    at: WING.z0,
    from: WING.x0,
    to: WING.x1,
    height: WING.eave,
    thickness: S,
    openings: [{ a: -0.2, b: 5.2, y0: 2.72, y1: 3.3 }],
  },
];

export const WING_GLASS_WALL: WallDef = {
  face: "x-",
  at: WING.x0,
  from: WING.z0,
  to: MAIN.z0,
  height: WING.eave,
  thickness: S,
  openings: [{ a: -13.3, b: -4.7, y0: 0, y1: 3.32, kind: "slider" }],
};

/** Warm interior lamps (2700 K): the rooms behind the glass read as lived in and lit. */
const HOUSE_LAMPS: Lamp[] = [
  // ground floor: living and dining behind the west and garden glass
  { pos: [-3.6, 2.75, 0.2], color: "#ffb56b", power: 34, range: 8, group: "interior" },
  { pos: [-5.0, 2.75, -2.5], color: "#ffb870", power: 24, range: 5.5, group: "interior" },
  { pos: [-4.6, 2.75, 2.7], color: "#ffb56b", power: 22, range: 5.5, group: "interior" },
  { pos: [-2.2, 2.75, -2.6], color: "#ffbb74", power: 22, range: 5.5, group: "interior" },
  { pos: [2.3, 2.75, 1.6], color: "#ffb86e", power: 18, range: 6, group: "interior" },
  { pos: [-5.35, 1.4, 3.2], color: "#ffae5e", power: 14, range: 4, group: "interior" }, // floor lamp
  // first floor: the suite behind the west and garden glass, a landing, the east room
  { pos: [-3.5, 5.62, 0.4], color: "#ffb36a", power: 30, range: 7.5, group: "interior" },
  { pos: [-5.1, 5.62, -2.6], color: "#ffb870", power: 20, range: 5, group: "interior" },
  { pos: [-4.8, 5.62, 3.0], color: "#ffbb74", power: 18, range: 5, group: "interior" },
  { pos: [-1.6, 5.62, -2.8], color: "#ffb870", power: 16, range: 5, group: "interior" },
  { pos: [3.0, 5.62, 0.2], color: "#ffbd78", power: 18, range: 6, group: "interior" },
  { pos: [5.3, 4.4, 0], color: "#ffbd78", power: 12, range: 5, group: "interior" }, // stair
];

/** Undersides of the thin roof plates over the overhangs. */
const ROOF_SOFFIT = MAIN_TOP - ROOF_EDGE;
const WING_SOFFIT = WING_TOP - ROOF_EDGE;

/**
 * Downlights in the soffits: under the balcony (lighting the ground-floor glass and the terrace),
 * under the roof overhang (the balcony and the upper glass), and under the pavilion's canopy.
 * Each throws a warm cone down the facade. [x, y, z]
 */
export const SOFFIT_LIGHTS: [number, number, number][] = [
  ...[-3.3, -1.1, 1.1, 3.3].map((z): [number, number, number] => [-7.0, L2 - BALCONY.t - 0.01, z]),
  ...[-5.3, -3.4, -1.6].map((x): [number, number, number] => [x, L2 - BALCONY.t - 0.01, -4.9]),
  ...[-2.9, 0.2, 3.3].map((z): [number, number, number] => [-7.2, ROOF_SOFFIT - 0.004, z]),
  ...[-5.2, -3.2, -1.3].map((x): [number, number, number] => [x, ROOF_SOFFIT - 0.004, -5.15]),
  ...[-13.2, -11.0, -8.8, -6.6].map((z): [number, number, number] => [-1.8, WING_SOFFIT - 0.004, z]),
];
const SOFFIT_LAMPS: Lamp[] = SOFFIT_LIGHTS.map(([x, y, z]) => ({
  pos: [x, y - 0.03, z],
  color: "#ffd3a0",
  power: 16,
  range: 5.2,
  group: "exterior",
  cone: { dir: [0, -1, 0], inner: 18, outer: 42 },
}));

/** Recessed ceiling downlights seen through the glass: small bright discs. [x, y, z] */
const CEILING_LIGHTS: [number, number, number][] = [
  ...[-5.0, -3.6, -2.2].flatMap((x) => [-3.0, -1.0, 1.0, 3.0].map((z): [number, number, number] => [x, C1 - 0.005, z])),
  ...[-5.0, -3.6, -2.2].flatMap((x) => [-3.0, -1.0, 1.0, 3.0].map((z): [number, number, number] => [x, C2 - 0.005, z])),
  ...[1.0, 3.0, 5.0].map((x): [number, number, number] => [x, C1 - 0.005, 1.8]),
  ...[1.0, 3.0].map((x): [number, number, number] => [x, C2 - 0.005, -2.6]),
];

function wallsOf(defs: WallDef[], top: number, trimFor: (d: WallDef) => [number, number]) {
  const out: THREE.BufferGeometry[] = [];
  for (const d of defs) {
    const g = wallBand(d, { y0: 0, y1: top, trim: trimFor(d) });
    if (g) out.push(g);
  }
  return out;
}

function interiorGeometry() {
  const x0 = MAIN.x0 + S;
  const x1 = MAIN.x1 - S;
  const z0 = MAIN.z0 + S;
  const z1 = MAIN.z1 - S;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const floors: Placed[] = [
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [cx, FLOOR_Y + 0.01, cz] },
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [cx, L2 + 0.01, cz] },
  ];
  const ceilings: Placed[] = [
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [cx, C1 - 0.01, cz] },
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [cx, C2 + 0.01, cz] },
  ];
  // the first-floor slab inside the walls (seen in the section cut and the x-ray)
  const slab: Placed[] = [{ geo: box(x1 - x0, L2 - C1, z1 - z0), pos: [cx, (C1 + L2) / 2, cz] }];
  // partitions: living | hall on the ground floor; suite | east rooms upstairs
  const t = 0.12;
  const gh = C1 - FLOOR_Y;
  const uh = C2 - L2;
  const walls: Placed[] = [
    { geo: box(t, gh, z1 - 1.6 - z0), pos: [-1.0, FLOOR_Y + gh / 2, (z0 + z1 - 1.6) / 2] },
    { geo: box(t, uh, z1 - z0), pos: [-0.4, L2 + uh / 2, cz] },
    { geo: box(x1 + 0.4, uh, t), pos: [(x1 - 0.4) / 2, L2 + uh / 2, 0.2] },
  ];
  return { floors, ceilings, slab, walls };
}

function furniture() {
  const fabric: Placed[] = [];
  const wood: Placed[] = [];
  const dark: Placed[] = [];
  const rug: Placed[] = [];
  const glow: Placed[] = [];
  const art: Placed[] = [];
  const F = FLOOR_Y;
  // living (x < -1): a long low sofa facing the west glass, armchairs, coffee table, rug
  const sx = -2.2;
  const sz = 0.9;
  fabric.push({ geo: box(0.95, 0.22, 2.8), pos: [sx, F + 0.2, sz] }); // seat base
  fabric.push({ geo: box(0.82, 0.14, 2.8), pos: [sx - 0.04, F + 0.38, sz] }); // cushions
  fabric.push({ geo: box(0.2, 0.42, 2.8), pos: [sx + 0.39, F + 0.55, sz] }); // back
  fabric.push({ geo: box(0.95, 0.3, 0.2), pos: [sx, F + 0.45, sz - 1.3] });
  fabric.push({ geo: box(0.95, 0.3, 0.2), pos: [sx, F + 0.45, sz + 1.3] });
  for (const z of [-0.2, 2.0]) {
    fabric.push({ geo: box(0.85, 0.36, 0.85), pos: [-4.9, F + 0.28, z] }); // armchairs, facing in
    fabric.push({ geo: box(0.16, 0.4, 0.85), pos: [-5.28, F + 0.62, z] });
  }
  wood.push({ geo: box(0.8, 0.05, 1.5), pos: [-3.5, F + 0.38, sz] }); // coffee table
  for (const [dx, dz] of [[-0.3, -0.65], [0.3, -0.65], [-0.3, 0.65], [0.3, 0.65]]) wood.push({ geo: box(0.04, 0.34, 0.04), pos: [-3.5 + dx, F + 0.18, sz + dz] });
  rug.push({ geo: box(3.0, 0.012, 3.6), pos: [-3.5, F + 0.02, sz] });
  // dining by the garden glass: table, six chairs, a trio of glass pendants
  const dx0 = -3.4;
  const dz0 = -2.55;
  wood.push({ geo: box(2.2, 0.05, 0.95), pos: [dx0, F + 0.74, dz0] });
  wood.push({ geo: box(0.08, 0.7, 0.7), pos: [dx0 - 0.85, F + 0.36, dz0] });
  wood.push({ geo: box(0.08, 0.7, 0.7), pos: [dx0 + 0.85, F + 0.36, dz0] });
  for (const cx of [-0.7, 0, 0.7]) {
    for (const s of [-1, 1]) {
      fabric.push({ geo: box(0.46, 0.06, 0.46), pos: [dx0 + cx, F + 0.46, dz0 + s * 0.72] });
      fabric.push({ geo: box(0.46, 0.4, 0.06), pos: [dx0 + cx, F + 0.68, dz0 + s * 0.93] });
      dark.push({ geo: box(0.4, 0.44, 0.02), pos: [dx0 + cx, F + 0.22, dz0 + s * 0.72] });
    }
  }
  for (const px of [-0.65, 0, 0.65]) {
    glow.push({ geo: new THREE.SphereGeometry(0.15, 24, 16), pos: [dx0 + px, F + 1.72, dz0] });
    dark.push({ geo: new THREE.CylinderGeometry(0.004, 0.004, C1 - F - 1.87, 6), pos: [dx0 + px, (F + 1.87 + C1) / 2, dz0] });
  }
  // floor lamp, sideboard and art on the partition
  dark.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 1.4, 8), pos: [-5.35, F + 0.7, 3.2] });
  dark.push({ geo: new THREE.CylinderGeometry(0.16, 0.16, 0.02, 20), pos: [-5.35, F + 0.01, 3.2] });
  glow.push({ geo: new THREE.CylinderGeometry(0.16, 0.22, 0.3, 24, 1, true), pos: [-5.35, F + 1.45, 3.2] });
  wood.push({ geo: box(0.45, 0.62, 2.2), pos: [-1.3, F + 0.31, 0.9] });
  art.push({ geo: box(1.4, 1.0, 0.03), pos: [-1.08, 1.75, 0.9], rot: [0, Math.PI / 2, 0] });
  // hall: oak bench
  wood.push({ geo: box(1.6, 0.44, 0.4), pos: [3.6, F + 0.22, MAIN.z1 - S - 0.35] });
  // first-floor suite (x < -0.4): the bed faces the west glass
  const by = L2;
  fabric.push({ geo: box(2.1, 0.32, 1.9), pos: [-3.2, by + 0.3, 0.5] }); // mattress + base
  fabric.push({ geo: box(0.12, 1.1, 2.3), pos: [-2.1, by + 0.55, 0.5] }); // headboard
  fabric.push({ geo: box(0.9, 0.08, 1.9), pos: [-3.8, by + 0.5, 0.5] }); // throw
  wood.push({ geo: box(0.42, 0.5, 0.5), pos: [-2.25, by + 0.25, -0.85] });
  wood.push({ geo: box(0.42, 0.5, 0.5), pos: [-2.25, by + 0.25, 1.85] });
  glow.push({ geo: new THREE.CylinderGeometry(0.11, 0.14, 0.2, 20, 1, true), pos: [-2.25, by + 0.72, -0.85] });
  glow.push({ geo: new THREE.CylinderGeometry(0.11, 0.14, 0.2, 20, 1, true), pos: [-2.25, by + 0.72, 1.85] });
  rug.push({ geo: box(2.6, 0.012, 3.2), pos: [-3.4, by + 0.02, 0.5] });
  // a pair of lounge chairs by the garden glass upstairs
  for (const x of [-4.8, -3.6]) {
    fabric.push({ geo: box(0.8, 0.34, 0.8), pos: [x, by + 0.26, -2.9] });
    fabric.push({ geo: box(0.8, 0.44, 0.16), pos: [x, by + 0.6, -2.55] });
  }
  return { fabric, wood, dark, rug, glow, art };
}

/** Slabs, soffits, decks, the glass rail, the slab edges and the lights set into them. */
function slabsAndSoffits() {
  const bt = BALCONY.t;
  const edge: Placed[] = [];
  const soffit: Placed[] = [];
  const deck: Placed[] = [];
  const rail: Placed[] = [];
  const railShoe: Placed[] = [];
  // the balcony: west strip (full depth of the house) and garden strip (to the pavilion)
  const west = { x0: BALCONY.x0, x1: MAIN.x0 + 0.02, z0: BALCONY.z0, z1: MAIN.z1 };
  const south = { x0: BALCONY.x0, x1: BALCONY.xs, z0: BALCONY.z0, z1: MAIN.z0 + 0.02 };
  for (const r of [west, south]) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    edge.push({ geo: box(w, bt, d), pos: [cx, L2 - bt / 2, cz] });
    deck.push({ geo: box(w - 0.02, 0.02, d - 0.02), pos: [cx, L2 + 0.01, cz] });
    soffit.push({ geo: box(w - 0.01, 0.01, d - 0.01), pos: [cx, L2 - bt - 0.004, cz] });
  }
  // the first-floor slab edge on the street and east fronts: a dark band, a finger proud
  const band = L2 - C1 + 0.02;
  edge.push({ geo: box(MAIN.x1 - MAIN.x0 + 0.08, band, 0.04), pos: [(MAIN.x0 + MAIN.x1) / 2, (C1 + L2) / 2, MAIN.z1 + 0.02] });
  edge.push({ geo: box(0.04, band, MAIN.z1 - MAIN.z0 + 0.08), pos: [MAIN.x1 + 0.02, (C1 + L2) / 2, (MAIN.z0 + MAIN.z1) / 2] });
  // soffits under the roof slab and the pavilion's canopy (inside, the ceilings hide them)
  soffit.push({ geo: box(MAIN_ROOF.x1 - MAIN_ROOF.x0, 0.01, MAIN_ROOF.z1 - MAIN_ROOF.z0), pos: [(MAIN_ROOF.x0 + MAIN_ROOF.x1) / 2, ROOF_SOFFIT - 0.006, (MAIN_ROOF.z0 + MAIN_ROOF.z1) / 2] });
  soffit.push({ geo: box(WING_ROOF.x1 - WING_ROOF.x0, 0.01, WING_ROOF.z1 - WING_ROOF.z0), pos: [(WING_ROOF.x0 + WING_ROOF.x1) / 2, WING_SOFFIT - 0.006, (WING_ROOF.z0 + WING_ROOF.z1) / 2] });
  // frameless glass balustrade in a low bronze shoe, round the balcony's open edges
  const rh = BALCONY.rail;
  const gy = L2 + 0.02 + rh / 2;
  const x0 = BALCONY.x0 + 0.06;
  const z0 = BALCONY.z0 + 0.06;
  const runs: Array<[number, number, number, number]> = [
    [x0, z0, x0, MAIN.z1], // west edge
    [x0, z0, BALCONY.xs, z0], // garden edge
    [x0, MAIN.z1 - 0.02, MAIN.x0, MAIN.z1 - 0.02], // north end
  ];
  for (const [ax, az, bx, bz] of runs) {
    const len = Math.hypot(bx - ax, bz - az);
    const along = Math.abs(bx - ax) > Math.abs(bz - az);
    const n = Math.max(1, Math.round(len / 1.5));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const px = ax + (bx - ax) * f;
      const pz = az + (bz - az) * f;
      const pw = len / n - 0.012;
      rail.push({ geo: along ? box(pw, rh, 0.012) : box(0.012, rh, pw), pos: [px, gy, pz] });
    }
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    railShoe.push({ geo: along ? box(len, 0.08, 0.06) : box(0.06, 0.08, len), pos: [cx, L2 + 0.06, cz] });
  }
  return { edge, soffit, deck, rail, railShoe };
}

/**
 * A linear LED cove just inside the fascia of the roof and the pavilion canopy (the garden and
 * west edges), and the warm wash it throws across the soffit.
 */
function soffitCoves() {
  const strips: Placed[] = [];
  const wash: Placed[] = [];
  const inset = 0.16;
  const reach = 1.7;
  // [x0, z0, x1, z1, y, outward]: outward is the fascia side (-x west, -z garden)
  const edges: [number, number, number, number, number, "x" | "z"][] = [
    [MAIN_ROOF.x0 + inset, MAIN_ROOF.z0 + inset, MAIN_ROOF.x0 + inset, MAIN_ROOF.z1 - inset, ROOF_SOFFIT, "x"],
    [MAIN_ROOF.x0 + inset, MAIN_ROOF.z0 + inset, MAIN_ROOF.x1 - inset, MAIN_ROOF.z0 + inset, ROOF_SOFFIT, "z"],
    [WING_ROOF.x0 + inset, WING_ROOF.z0 + inset, WING_ROOF.x0 + inset, WING_ROOF.z1, WING_SOFFIT, "x"],
    [WING_ROOF.x0 + inset, WING_ROOF.z0 + inset, WING_ROOF.x1 - inset, WING_ROOF.z0 + inset, WING_SOFFIT, "z"],
  ];
  for (const [x0, z0, x1, z1, y, out] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // a diffused profile, wide enough to stay one continuous line at any distance
    strips.push({ geo: out === "z" ? box(len, 0.008, 0.05) : box(0.05, 0.008, len), pos: [cx, y - 0.014, cz] });
    // facing down, uv.y = 1 on the LED line, fading in toward the house
    const g = new THREE.PlaneGeometry(len, reach);
    g.rotateX(Math.PI / 2);
    g.rotateY(out === "x" ? -Math.PI / 2 : Math.PI);
    wash.push({ geo: g, pos: out === "x" ? [cx + reach / 2, y - 0.0115, cz] : [cx, y - 0.0115, cz + reach / 2] });
  }
  return { strips, wash };
}

function buildGeometry() {
  const main = wallsOf(MAIN_WALLS, E, (d) => (d.face === "x-" || d.face === "x+" ? [S, S] : [0, 0]));
  const wing = wallsOf(WING_WALLS, WING.eave, (d) => (d.face === "x+" ? [0, S] : [0, 0]));
  const gw = wallBand(WING_GLASS_WALL, { y0: 0, y1: WING.eave, trim: [S, 0] });

  const win: WindowParts = emptyWindows();
  MAIN_WALLS.forEach((w) => windows(w, win));
  WING_WALLS.forEach((w) => windows(w, win));
  const gwin: WindowParts = emptyWindows();
  windows(WING_GLASS_WALL, gwin);

  // plinth: a dark shadow line where the house meets the ground
  const pl = 0.14;
  const plinth: Placed[] = [
    { geo: box(MAIN.x1 - MAIN.x0 - 0.04, pl, MAIN.z1 - MAIN.z0 - 0.04), pos: [(MAIN.x0 + MAIN.x1) / 2, pl / 2 - 0.02, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(WING.x1 - WING.x0 - 0.04, pl, WING.z1 - WING.z0 - 0.02), pos: [(WING.x0 + WING.x1) / 2, pl / 2 - 0.02, (WING.z0 + WING.z1) / 2 - 0.01] },
  ];
  // entrance: floating steel canopy + oak soffit
  const canopy: Placed[] = [{ geo: box(3.4, 0.09, 1.25), pos: [0.35, 2.98, MAIN.z1 + 0.62] }];
  const canopySoffit: Placed[] = [{ geo: box(3.3, 0.01, 1.15), pos: [0.35, 2.93, MAIN.z1 + 0.62] }];
  // downlight trims in the soffits and the ceilings
  const apertures: Placed[] = [];
  for (const [x, y, z] of SOFFIT_LIGHTS) apertures.push({ geo: new THREE.CircleGeometry(0.045, 20), pos: [x, y - 0.012, z], rot: [Math.PI / 2, 0, 0] });
  const ceilingDots: Placed[] = CEILING_LIGHTS.map(([x, y, z]) => ({ geo: new THREE.CircleGeometry(0.04, 16), pos: [x, y - 0.012, z], rot: [Math.PI / 2, 0, 0] }));

  const ig = interiorGeometry();
  const fu = furniture();
  const ss = slabsAndSoffits();
  const cv = soffitCoves();
  return {
    stone: mergeGrouped([...main, ...wing]),
    glassWall: mergeGrouped(gw ? [gw] : []),
    frames: merge([...win.frames]),
    sills: merge([...win.sills]),
    glass: merge(win.glass),
    doors: merge(win.doors),
    handles: merge(win.handles),
    gwFrames: merge(gwin.frames),
    gwGlass: merge(gwin.glass),
    plinth: merge(plinth),
    canopy: merge(canopy),
    canopySoffit: merge(canopySoffit),
    apertures: merge(apertures),
    ceilingDots: merge(ceilingDots),
    edge: merge(ss.edge),
    soffit: merge(ss.soffit),
    coveStrips: merge(cv.strips),
    coveWash: merge(cv.wash),
    deck: merge(ss.deck),
    rail: merge(ss.rail),
    railShoe: merge(ss.railShoe),
    floors: merge(ig.floors),
    ceilings: merge(ig.ceilings),
    slab: merge(ig.slab),
    partitions: merge(ig.walls),
    fabric: merge(fu.fabric),
    wood: merge(fu.wood),
    dark: merge(fu.dark),
    rug: merge(fu.rug),
    glow: merge(fu.glow),
    art: merge(fu.art),
  };
}

export type HouseGeometry = ReturnType<typeof buildGeometry>;
let geometryCache: HouseGeometry | null = null;
export function houseGeometry() {
  if (!geometryCache) geometryCache = buildGeometry();
  return geometryCache;
}

const SOLID = { cut: "solid" as const };

/** Roof slabs as plain boxes: the ghost and x-ray views draw the house as a massing model. */
function ghostRoofGeometry() {
  return merge([
    { geo: box(MAIN_ROOF.x1 - MAIN_ROOF.x0, MAIN_ROOF.t, MAIN_ROOF.z1 - MAIN_ROOF.z0), pos: [(MAIN_ROOF.x0 + MAIN_ROOF.x1) / 2, MAIN_TOP - MAIN_ROOF.t / 2, (MAIN_ROOF.z0 + MAIN_ROOF.z1) / 2] },
    { geo: box(WING_ROOF.x1 - WING_ROOF.x0, WING_ROOF.t, WING_ROOF.z1 - WING_ROOF.z0), pos: [(WING_ROOF.x0 + WING_ROOF.x1) / 2, WING_TOP - WING_ROOF.t / 2, (WING_ROOF.z0 + WING_ROOF.z1) / 2] },
  ]);
}

export function House() {
  const geo = useMemo(() => houseGeometry(), []);
  const mats = useMemo(() => {
    const cut = <T extends THREE.Material>(m: T, fade?: { value: number }) => patch(m, fade ? { cut: "solid", fade } : SOLID);
    const stoneP = { roughness: 1, envMapIntensity: 0.9 };
    const ext = <T extends THREE.MeshStandardMaterial>(m: T) => lampLit(m, ["exterior"]);
    // frames, slab edges, canopy: near-black charcoal aluminium
    const bronze = () => solid("#212224", 0.45, 0.5, { envMapIntensity: 1.0 });
    // warm plaster inside; the pavilion's walls take the kitchen's lamps too
    const plaster = () => lampLit(pbr("plaster", { color: "#ebdfcf", roughness: 1, envMapIntensity: 0.22 }), ["interior", "kitchen"]);
    return {
      stone: cut(ext(pbr("limestone", stoneP))),
      plaster: cut(plaster()),
      reveal: cut(bronze()),
      frame: cut(bronze()),
      sill: cut(bronze()),
      glass: glass({ transmittance: 0.86 }),
      door: cut(pbr("oak_veneer", { color: "#a7835f", roughness: 0.9 })),
      handle: cut(solid("#1c1b1a", 0.35, 0.8)),
      plinth: cut(solid("#1f1d1b", 0.9, 0)),
      canopy: cut(bronze()),
      canopySoffit: cut(ext(pbr("white_oak", { color: "#f2e4d2", roughness: 0.9 }))),
      aperture: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9a8").multiplyScalar(6) }),
      ceilingDot: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe2bf").multiplyScalar(5) }),
      // slab edges: dark bronze, as the frames
      edge: cut(ext(solid("#1e1f21", 0.55, 0.3, { envMapIntensity: 0.8 }))),
      // soffits: warm cedar boards, lit by the downlights set into them and the cove at the edge
      soffit: cut(lampLit(pbr("cedar", { color: "#e9cfb4", roughness: 0.9, envMapIntensity: 0.5 }), ["exterior", "garden"])),
      coveStrip: cut(new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9ae").multiplyScalar(6) })),
      coveWash: cut(glowMaterial("#ffbf85", 1)),
      deck: cut(ext(pbr("paver_stone", { roughness: 1, envMapIntensity: 0.8 }))),
      rail: glass({ transmittance: 0.9, envMapIntensity: 1.3 }),
      floor: cut(interior(pbr("oak_floor", { color: "#e9d2b6", roughness: 0.75, envMapIntensity: 0.45 }))),
      ceiling: cut(interior(solid("#f6f2ea", 0.95, 0, { envMapIntensity: 0.25 }))),
      slab: cut(solid("#bdb8b0", 0.9)),
      partitions: cut(plaster()),
      fabric: cut(interior(pbr("linen", { color: "#e2d8c8", roughness: 1, envMapIntensity: 0.3 }))),
      wood: cut(interior(pbr("walnut", { color: "#b58d6e", roughness: 0.7, envMapIntensity: 0.4 }))),
      dark: cut(interior(solid("#222120", 0.45, 0.6, { envMapIntensity: 0.4 }))),
      rug: cut(interior(pbr("boucle", { color: "#d3c8b8", roughness: 1, envMapIntensity: 0.2 }))),
      glow: cut(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#ffc38a"), emissiveIntensity: 3.2, roughness: 1, side: THREE.DoubleSide })),
      art: cut(interior(solid("#8d8479", 0.8, 0, { envMapIntensity: 0.2 }))),
      // glass-wall set: dither-fades while the camera walks through into the kitchen
      gwStone: cut(ext(pbr("limestone", stoneP)), fades.glassWall),
      gwPlaster: cut(plaster(), fades.glassWall),
      gwReveal: cut(bronze(), fades.glassWall),
      gwFrame: cut(bronze(), fades.glassWall),
      gwGlass: patch(glass({ transmittance: 0.86 }), { fade: fades.glassWall }),
      ghost: ghostMaterial("#8fa3b8", 1),
      edges: patch(new THREE.LineBasicMaterial({ color: "#3b4654", transparent: true, opacity: 0, depthWrite: false }), { cut: "ghost" }),
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useEffect(() => {
    registerLamps([...HOUSE_LAMPS, ...SOFFIT_LAMPS]);
    return () => unregisterLamps([...HOUSE_LAMPS, ...SOFFIT_LAMPS]);
  }, []);

  const ghostRoof = useMemo(() => ghostRoofGeometry(), []);
  const ghostEdges = useMemo(() => {
    const lines = [geo.stone, geo.glassWall, geo.edge, ghostRoof].map((g) => new THREE.EdgesGeometry(g, 28));
    return merge(lines.map((l) => ({ geo: l }))) as THREE.BufferGeometry;
  }, [geo, ghostRoof]);

  const depthSolid = useMemo(() => depthFor({ cut: "solid" }), []);
  const depthFade = useMemo(() => depthFor({ cut: "solid", fade: fades.glassWall, fadeKey: "glassWall" }), []);
  const ghostGroup = useRef<THREE.Group>(null);
  const coves = useRef<THREE.Group>(null);
  const glassGroup = useRef<THREE.Group>(null);

  useFrame(() => {
    mats.edges.opacity = channels.ghost * 0.55;
    // lamps glow brighter as the evening comes on
    const on = THREE.MathUtils.smoothstep(channels.dusk, 0.15, 0.55);
    mats.glow.emissiveIntensity = 0.4 + on * 3.4;
    mats.ceilingDot.color.setRGB(1, 0.886, 0.75).multiplyScalar(0.6 + on * 4.6);
    const ext = lampLevel("exterior");
    mats.coveStrip.color.setRGB(1, 0.82, 0.62).multiplyScalar(0.25 + ext * 2.6);
    mats.coveWash.color.setRGB(1, 0.72, 0.48).multiplyScalar(ext * 2.2);
    coves.current && (coves.current.visible = ext > 0.02 || channels.dusk > 0.3);
    if (ghostGroup.current) ghostGroup.current.visible = channels.ghost > 0.01;
    if (glassGroup.current) glassGroup.current.visible = channels.glassWall > 0.01;
  });

  const solidProps = { castShadow: true, receiveShadow: true, customDepthMaterial: depthSolid };
  const wallMats = (ext: THREE.Material) => [ext, mats.plaster, mats.reveal];

  return (
    <group name="house">
      <mesh geometry={geo.stone} material={wallMats(mats.stone)} {...solidProps} />
      <mesh geometry={geo.frames} material={mats.frame} {...solidProps} />
      <mesh geometry={geo.sills} material={mats.sill} {...solidProps} />
      <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
      <mesh geometry={geo.doors} material={mats.door} {...solidProps} />
      <mesh geometry={geo.handles} material={mats.handle} castShadow />
      <mesh geometry={geo.plinth} material={mats.plinth} {...solidProps} />
      <mesh geometry={geo.canopy} material={mats.canopy} {...solidProps} />
      <mesh geometry={geo.canopySoffit} material={mats.canopySoffit} receiveShadow />
      <mesh geometry={geo.edge} material={mats.edge} {...solidProps} />
      <mesh geometry={geo.soffit} material={mats.soffit} receiveShadow />
      <group ref={coves}>
        <mesh geometry={geo.coveStrips} material={mats.coveStrip} />
        <mesh geometry={geo.coveWash} material={mats.coveWash} renderOrder={3} />
      </group>
      <mesh geometry={geo.deck} material={mats.deck} receiveShadow />
      <mesh geometry={geo.railShoe} material={mats.frame} castShadow />
      <mesh geometry={geo.rail} material={mats.rail} renderOrder={2} />
      <mesh geometry={geo.apertures} material={mats.aperture} />
      <mesh geometry={geo.ceilingDots} material={mats.ceilingDot} />
      {/* interiors */}
      <mesh geometry={geo.floors} material={mats.floor} receiveShadow />
      <mesh geometry={geo.ceilings} material={mats.ceiling} receiveShadow />
      <mesh geometry={geo.slab} material={mats.slab} {...solidProps} />
      <mesh geometry={geo.partitions} material={mats.partitions} receiveShadow />
      <mesh geometry={geo.fabric} material={mats.fabric} receiveShadow />
      <mesh geometry={geo.wood} material={mats.wood} receiveShadow />
      <mesh geometry={geo.dark} material={mats.dark} />
      <mesh geometry={geo.rug} material={mats.rug} receiveShadow />
      <mesh geometry={geo.glow} material={mats.glow} />
      <mesh geometry={geo.art} material={mats.art} />
      <group ref={glassGroup}>
        <mesh geometry={geo.glassWall} material={[mats.gwStone, mats.gwPlaster, mats.gwReveal]} castShadow receiveShadow customDepthMaterial={depthFade} />
        <mesh geometry={geo.gwFrames} material={mats.gwFrame} castShadow customDepthMaterial={depthFade} />
        <mesh geometry={geo.gwGlass} material={mats.gwGlass} renderOrder={2} />
      </group>
      <Roof />
      <group ref={ghostGroup} visible={false}>
        <mesh geometry={geo.stone} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.glassWall} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.edge} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.slab} material={mats.ghost} renderOrder={2} />
        <mesh geometry={ghostRoof} material={mats.ghost} renderOrder={2} />
        <lineSegments geometry={ghostEdges} material={mats.edges} renderOrder={3} />
      </group>
    </group>
  );
}

export { U };
