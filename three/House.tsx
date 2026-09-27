"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOOR_Y, MAIN, MAIN_RIDGE_Y, MAIN_RIDGE_Z, ROOF_PLANES, WALL, WING, WING_RIDGE_X, WING_RIDGE_Y } from "@/lib/spec";
import { emptyWindows, mergeGrouped, wallBand, windows, type WindowParts } from "./arch";
import { box, merge, roofSurface, type Placed, type WallDef } from "./geom";
import { interior, lampLit, registerLamps, unregisterLamps, type Lamp } from "./lamps";
import { glass, pbr, solid } from "./materials";
import { Roof, ROOF_T } from "./Roof";
import { channels, depthFor, fades, ghostMaterial, patch, U } from "./shared";

/**
 * The residence. Stone base (1200×600 travertine panels) with vertical cedar above,
 * a dark metal roof, and every opening lined in dark bronze with the frame set back in
 * the reveal. The kitchen wing is a stone pavilion with an 8.6 m glass wall to the garden.
 * Rooms behind the glazing are furnished and lamp-lit, so the house glows at dusk.
 */

const S = WALL;
const L2 = MAIN.level2;

export const MAIN_WALLS: WallDef[] = [
  {
    face: "z+",
    at: MAIN.z1,
    from: MAIN.x0,
    to: MAIN.x1,
    height: MAIN.eave,
    thickness: S,
    openings: [
      { a: -5.25, b: -2.15, y0: 0.45, y1: 2.8 },
      { a: -0.6, b: 0.6, y0: 0, y1: 2.72, kind: "door" },
      { a: 0.72, b: 1.3, y0: 0, y1: 2.72 },
      { a: 2.15, b: 5.25, y0: 0.45, y1: 2.8 },
      { a: -4.8, b: -3.0, y0: 3.5, y1: 5.55 },
      { a: -0.9, b: 0.9, y0: 3.5, y1: 5.55 },
      { a: 3.0, b: 4.8, y0: 3.5, y1: 5.55 },
    ],
  },
  {
    face: "z-",
    at: MAIN.z0,
    from: MAIN.x0,
    to: MAIN.x1,
    height: MAIN.eave,
    thickness: S,
    openings: [
      { a: -5.45, b: -1.35, y0: 0, y1: 2.8, kind: "slider" },
      { a: 1.6, b: 2.7, y0: 0, y1: 2.4, kind: "void" },
      { a: -5.3, b: -2.1, y0: 3.4, y1: 5.55 },
    ],
  },
  {
    face: "x-",
    at: MAIN.x0,
    from: MAIN.z0,
    to: MAIN.z1,
    height: MAIN.eave,
    gable: { peakAt: MAIN_RIDGE_Z, peakY: MAIN_RIDGE_Y },
    thickness: S,
    openings: [
      { a: -2.5, b: 1.3, y0: 0.45, y1: 2.8 },
      { a: -1.0, b: 1.0, y0: 3.5, y1: 5.55 },
    ],
  },
  {
    face: "x+",
    at: MAIN.x1,
    from: MAIN.z0,
    to: MAIN.z1,
    height: MAIN.eave,
    gable: { peakAt: MAIN_RIDGE_Z, peakY: MAIN_RIDGE_Y },
    thickness: S,
    openings: [
      { a: -0.45, b: 0.45, y0: 0.6, y1: 5.55 },
      { a: 1.4, b: 3.3, y0: 0.45, y1: 2.8 },
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
      { a: -11.9, b: -9.9, y0: 1.15, y1: 2.35 },
      { a: -7.3, b: -5.3, y0: 0.55, y1: 2.6 },
    ],
  },
  {
    face: "z-",
    at: WING.z0,
    from: WING.x0,
    to: WING.x1,
    height: WING.eave,
    gable: { peakAt: WING_RIDGE_X, peakY: WING_RIDGE_Y },
    thickness: S,
    openings: [{ a: 1.15, b: 3.85, y0: 2.62, y1: 4.2 }],
  },
];

export const WING_GLASS_WALL: WallDef = {
  face: "x-",
  at: WING.x0,
  from: WING.z0,
  to: MAIN.z0,
  height: WING.eave,
  thickness: S,
  openings: [{ a: -13.3, b: -4.7, y0: 0, y1: 3.05, kind: "slider" }],
};

/** Warm interior lamps (2700 K), visible through the glazing at dusk. */
const HOUSE_LAMPS: Lamp[] = [
  { pos: [-3.6, 2.35, -1.4], color: "#ffb56b", power: 30, range: 7.5, group: "interior" }, // living, pendant
  { pos: [-5.1, 1.35, 2.7], color: "#ffae5e", power: 18, range: 4.5, group: "interior" }, // living, floor lamp
  { pos: [2.3, 2.5, 1.6], color: "#ffb86e", power: 20, range: 6, group: "interior" }, // hall
  { pos: [-3.6, 5.45, -1.9], color: "#ffb36a", power: 26, range: 6.5, group: "interior" }, // primary suite
  { pos: [-3.3, 5.45, 2.2], color: "#ffbb74", power: 18, range: 5.5, group: "interior" }, // front bedroom
  { pos: [5.3, 4.2, 0], color: "#ffbd78", power: 14, range: 5, group: "interior" }, // stair
];

/** Up/down wall lights on the stone base: warm scallops on the facade after sunset. */
export const FACADE_LIGHTS: [number, number, number, "x" | "z", number][] = [
  // x, y, z, wall normal axis, sign
  [-5.65, 2.3, MAIN.z1, "z", 1],
  [-1.6, 2.3, MAIN.z1, "z", 1],
  [1.75, 2.3, MAIN.z1, "z", 1],
  [5.65, 2.3, MAIN.z1, "z", 1],
  [-5.75, 2.35, MAIN.z0, "z", -1],
  [-0.95, 2.35, MAIN.z0, "z", -1],
  [MAIN.x0, 2.3, -3.2, "x", -1],
  [MAIN.x0, 2.3, 3.1, "x", -1],
];
const FACADE_LAMPS: Lamp[] = FACADE_LIGHTS.map(([x, y, z, ax, sg]) => ({
  pos: ax === "z" ? [x, y, z + sg * 0.16] : [x + sg * 0.16, y, z],
  color: "#ffbd74",
  power: 16,
  range: 3.4,
  group: "exterior",
}));

function wallsOf(defs: WallDef[], bands: (d: WallDef) => { lower: Parameters<typeof wallBand>[1]; upper?: Parameters<typeof wallBand>[1] }) {
  const lower: THREE.BufferGeometry[] = [];
  const upper: THREE.BufferGeometry[] = [];
  for (const d of defs) {
    const b = bands(d);
    const lo = wallBand(d, b.lower);
    if (lo) lower.push(lo);
    if (b.upper) {
      const up = wallBand(d, b.upper);
      if (up) upper.push(up);
    }
  }
  return { lower, upper };
}

function interiorGeometry() {
  const x0 = MAIN.x0 + S;
  const x1 = MAIN.x1 - S;
  const z0 = MAIN.z0 + S;
  const z1 = MAIN.z1 - S;
  const floors: Placed[] = [
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [(x0 + x1) / 2, FLOOR_Y + 0.01, (z0 + z1) / 2] },
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [(x0 + x1) / 2, L2 + 0.01, (z0 + z1) / 2] },
  ];
  const ceilings: Placed[] = [
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [(x0 + x1) / 2, L2 - 0.27, (z0 + z1) / 2] },
    { geo: box(x1 - x0, 0.02, z1 - z0), pos: [(x0 + x1) / 2, MAIN.eave - 0.02, (z0 + z1) / 2] },
  ];
  const slab: Placed[] = [{ geo: box(x1 - x0, 0.25, z1 - z0), pos: [(x0 + x1) / 2, L2 - 0.135, (z0 + z1) / 2] }];
  // partitions: living | hall on the ground floor, suites upstairs
  const t = 0.12;
  const gh = L2 - 0.27 - FLOOR_Y;
  const uh = MAIN.eave - L2;
  const walls: Placed[] = [
    { geo: box(t, gh, z1 - 1.6 - z0), pos: [-1.0, FLOOR_Y + gh / 2, (z0 + z1 - 1.6) / 2 - 0.0] },
    { geo: box(t, uh, z1 - z0), pos: [-0.4, L2 + uh / 2, (z0 + z1) / 2] },
    { geo: box(x1 + 0.4, uh, t), pos: [(x1 - 0.4) / 2, L2 + uh / 2, 0.2] },
    { geo: box(x1 + 0.4 - 1.2, uh, t), pos: [(-0.4 + x1 - 1.2) / 2, L2 + uh / 2, -1.9] },
  ];
  return { floors, ceilings, slab, walls };
}

function furniture() {
  // living room (x < -1): low sofa facing the garden, rug, walnut credenza, floor lamp, art
  const fabric: Placed[] = [];
  const wood: Placed[] = [];
  const dark: Placed[] = [];
  const rug: Placed[] = [];
  const glow: Placed[] = [];
  const art: Placed[] = [];
  const sx = -3.6;
  const sz = 1.2;
  fabric.push({ geo: box(2.6, 0.22, 0.95), pos: [sx, FLOOR_Y + 0.2, sz] }); // seat base
  fabric.push({ geo: box(2.6, 0.14, 0.82), pos: [sx, FLOOR_Y + 0.38, sz - 0.04] }); // cushions
  fabric.push({ geo: box(2.6, 0.42, 0.2), pos: [sx, FLOOR_Y + 0.55, sz + 0.39] }); // back
  fabric.push({ geo: box(0.2, 0.3, 0.95), pos: [sx - 1.2, FLOOR_Y + 0.45, sz] });
  fabric.push({ geo: box(0.2, 0.3, 0.95), pos: [sx + 1.2, FLOOR_Y + 0.45, sz] });
  fabric.push({ geo: box(0.85, 0.36, 0.85), pos: [-5.0, FLOOR_Y + 0.28, -1.6] }); // armchair
  fabric.push({ geo: box(0.85, 0.4, 0.16), pos: [-5.0, FLOOR_Y + 0.62, -2.0] });
  wood.push({ geo: box(1.3, 0.05, 0.7), pos: [sx, FLOOR_Y + 0.38, -0.15] }); // coffee table
  for (const [dx, dz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) wood.push({ geo: box(0.04, 0.34, 0.04), pos: [sx + dx, FLOOR_Y + 0.18, -0.15 + dz] });
  wood.push({ geo: box(2.2, 0.62, 0.45), pos: [-2.6, FLOOR_Y + 0.31, MAIN.z1 - S - 0.25] }); // credenza under the street window
  rug.push({ geo: box(3.4, 0.012, 2.6), pos: [sx, FLOOR_Y + 0.02, 0.3] });
  dark.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 1.4, 8), pos: [-5.1, FLOOR_Y + 0.7, 2.7] });
  dark.push({ geo: new THREE.CylinderGeometry(0.16, 0.16, 0.02, 20), pos: [-5.1, FLOOR_Y + 0.01, 2.7] });
  glow.push({ geo: new THREE.CylinderGeometry(0.16, 0.22, 0.3, 24, 1, true), pos: [-5.1, FLOOR_Y + 1.45, 2.7] });
  // pendant over the coffee table
  glow.push({ geo: new THREE.SphereGeometry(0.2, 24, 16), pos: [-3.6, 2.38, -0.2] });
  dark.push({ geo: new THREE.CylinderGeometry(0.004, 0.004, 0.4, 6), pos: [-3.6, 2.6, -0.2] });
  art.push({ geo: box(1.2, 0.9, 0.03), pos: [-1.0 - 0.08, 1.6, 1.4], rot: [0, Math.PI / 2, 0] });
  // hall: oak bench + tall plant stand-in (lamp-lit)
  wood.push({ geo: box(1.6, 0.44, 0.4), pos: [3.6, FLOOR_Y + 0.22, MAIN.z1 - S - 0.35] });
  // primary suite upstairs (x < -0.4, z < -1.9): bed facing the picture window
  const by = L2;
  fabric.push({ geo: box(1.9, 0.32, 2.1), pos: [-3.4, by + 0.3, -0.6] }); // mattress + base
  fabric.push({ geo: box(2.3, 1.1, 0.12), pos: [-3.4, by + 0.55, 0.47] }); // upholstered headboard
  fabric.push({ geo: box(1.9, 0.08, 0.9), pos: [-3.4, by + 0.5, -1.2] }); // throw
  wood.push({ geo: box(0.5, 0.5, 0.42), pos: [-4.75, by + 0.25, 0.2] });
  wood.push({ geo: box(0.5, 0.5, 0.42), pos: [-2.05, by + 0.25, 0.2] });
  glow.push({ geo: new THREE.CylinderGeometry(0.11, 0.14, 0.2, 20, 1, true), pos: [-4.75, by + 0.72, 0.2] });
  glow.push({ geo: new THREE.CylinderGeometry(0.11, 0.14, 0.2, 20, 1, true), pos: [-2.05, by + 0.72, 0.2] });
  rug.push({ geo: box(3.0, 0.012, 2.4), pos: [-3.4, by + 0.02, -0.9] });
  // front bedroom upstairs
  fabric.push({ geo: box(1.5, 0.3, 2.0), pos: [-3.2, by + 0.28, 2.6] });
  fabric.push({ geo: box(1.8, 0.9, 0.1), pos: [-3.2, by + 0.5, 1.6 - 0.02] });
  return { fabric, wood, dark, rug, glow, art };
}

function buildGeometry() {
  const main = wallsOf(MAIN_WALLS, (d) => {
    const trim: [number, number] = d.face === "x-" || d.face === "x+" ? [S, S] : [0, 0];
    return { lower: { y0: 0, y1: L2, trim }, upper: { y0: L2, y1: MAIN.eave, gable: true, trim } };
  });
  const wing = wallsOf(WING_WALLS, (d) => {
    const trim: [number, number] = d.face === "x+" ? [0, S] : [0, 0];
    return { lower: { y0: 0, y1: WING.eave, trim }, upper: d.gable ? { y0: WING.eave, y1: WING.eave, gable: true, trim } : undefined };
  });
  const gw = wallBand(WING_GLASS_WALL, { y0: 0, y1: WING.eave, trim: [S, 0] });

  const win: WindowParts = emptyWindows();
  MAIN_WALLS.forEach((w) => windows(w, win, { bandLines: [L2] }));
  WING_WALLS.forEach((w) => windows(w, win, { bandLines: [WING.eave] }));
  const gwin: WindowParts = emptyWindows();
  windows(WING_GLASS_WALL, gwin);

  // plinth: a dark, slightly proud concrete base; flashing where stone meets cedar
  const pl = 0.14;
  const plinth: Placed[] = [
    { geo: box(MAIN.x1 - MAIN.x0 + 0.04, pl, MAIN.z1 - MAIN.z0 + 0.04), pos: [(MAIN.x0 + MAIN.x1) / 2, pl / 2 - 0.02, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(WING.x1 - WING.x0 + 0.04, pl, WING.z1 - WING.z0 + 0.02), pos: [(WING.x0 + WING.x1) / 2, pl / 2 - 0.02, (WING.z0 + WING.z1) / 2 - 0.01] },
  ];
  const fl = 0.03;
  const flashing: Placed[] = [
    { geo: box(MAIN.x1 - MAIN.x0 + 0.06, fl, 0.05), pos: [(MAIN.x0 + MAIN.x1) / 2, L2, MAIN.z1 + 0.012] },
    { geo: box(MAIN.x1 - MAIN.x0 + 0.06, fl, 0.05), pos: [(MAIN.x0 + MAIN.x1) / 2, L2, MAIN.z0 - 0.012] },
    { geo: box(0.05, fl, MAIN.z1 - MAIN.z0 + 0.06), pos: [MAIN.x0 - 0.012, L2, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(0.05, fl, MAIN.z1 - MAIN.z0 + 0.06), pos: [MAIN.x1 + 0.012, L2, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(WING.x1 - WING.x0 + 0.06, fl, 0.05), pos: [(WING.x0 + WING.x1) / 2, WING.eave, WING.z0 - 0.012] },
  ];
  // entrance: floating steel canopy + oak soffit
  const canopy: Placed[] = [{ geo: box(3.4, 0.09, 1.25), pos: [0.35, 2.98, MAIN.z1 + 0.62] }];
  const canopySoffit: Placed[] = [{ geo: box(3.3, 0.01, 1.15), pos: [0.35, 2.93, MAIN.z1 + 0.62] }];
  // wall-light bodies (dark bronze) with lit apertures top and bottom
  const fixtures: Placed[] = [];
  const apertures: Placed[] = [];
  for (const [x, y, z, ax, sg] of FACADE_LIGHTS) {
    const px = ax === "x" ? x + sg * 0.06 : x;
    const pz = ax === "z" ? z + sg * 0.06 : z;
    fixtures.push({ geo: new THREE.CylinderGeometry(0.045, 0.045, 0.22, 20), pos: [px, y, pz] });
    apertures.push({ geo: new THREE.CircleGeometry(0.036, 20), pos: [px, y - 0.111, pz], rot: [Math.PI / 2, 0, 0] });
    apertures.push({ geo: new THREE.CircleGeometry(0.036, 20), pos: [px, y + 0.111, pz], rot: [-Math.PI / 2, 0, 0] });
  }

  const ig = interiorGeometry();
  const fu = furniture();
  return {
    stone: mergeGrouped([...main.lower, ...wing.lower]),
    cedar: mergeGrouped([...main.upper, ...wing.upper]),
    glassWall: mergeGrouped(gw ? [gw] : []),
    frames: merge([...win.frames]),
    sills: merge([...win.sills]),
    glass: merge(win.glass),
    doors: merge(win.doors),
    handles: merge(win.handles),
    gwFrames: merge(gwin.frames),
    gwGlass: merge(gwin.glass),
    plinth: merge(plinth),
    flashing: merge(flashing),
    canopy: merge(canopy),
    canopySoffit: merge(canopySoffit),
    fixtures: merge(fixtures),
    apertures: merge(apertures),
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

export function House() {
  const geo = useMemo(() => houseGeometry(), []);
  const mats = useMemo(() => {
    const cut = <T extends THREE.Material>(m: T, fade?: { value: number }) => patch(m, fade ? { cut: "solid", fade } : SOLID);
    const stoneP = { roughness: 1, envMapIntensity: 0.9 };
    const cedarP = { color: "#efe2d4", roughness: 1, envMapIntensity: 0.8 };
    const ext = <T extends THREE.MeshStandardMaterial>(m: T) => lampLit(m, ["exterior"]);
    const bronze = () => solid("#2d2a26", 0.42, 0.75, { envMapIntensity: 1.1 });
    const plaster = () => interior(pbr("plaster", { color: "#efe6d8", roughness: 1, envMapIntensity: 0.25 }));
    return {
      stone: cut(ext(pbr("clad_stone", stoneP))),
      cedar: cut(ext(pbr("cedar", cedarP))),
      plaster: cut(plaster()),
      reveal: cut(bronze()),
      frame: cut(bronze()),
      sill: cut(bronze()),
      glass: glass({ transmittance: 0.82 }),
      door: cut(pbr("oak_veneer", { color: "#a7835f", roughness: 0.9 })),
      handle: cut(solid("#1c1b1a", 0.35, 0.8)),
      plinth: cut(pbr("concrete", { color: "#6f6a64", roughness: 1 })),
      canopy: cut(bronze()),
      canopySoffit: cut(ext(pbr("cedar", cedarP))),
      aperture: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9a8").multiplyScalar(6) }),
      floor: cut(interior(pbr("oak_floor", { color: "#e7cfb4", roughness: 0.8, envMapIntensity: 0.4 }))),
      ceiling: cut(interior(solid("#f4f1ea", 0.95, 0, { envMapIntensity: 0.25 }))),
      slab: cut(solid("#bdb8b0", 0.9)),
      partitions: cut(plaster()),
      fabric: cut(interior(pbr("linen", { color: "#d9d0c2", roughness: 1, envMapIntensity: 0.3 }))),
      wood: cut(interior(pbr("walnut", { color: "#b58d6e", roughness: 0.75, envMapIntensity: 0.4 }))),
      dark: cut(interior(solid("#222120", 0.45, 0.6, { envMapIntensity: 0.4 }))),
      rug: cut(interior(pbr("boucle", { color: "#cbbfae", roughness: 1, envMapIntensity: 0.2 }))),
      glow: cut(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#ffc38a"), emissiveIntensity: 3.2, roughness: 1, side: THREE.DoubleSide })),
      art: cut(interior(solid("#8d8479", 0.8, 0, { envMapIntensity: 0.2 }))),
      // glass-wall set: dither-fades while the camera walks through into the kitchen
      gwStone: cut(pbr("clad_stone", stoneP), fades.glassWall),
      gwPlaster: cut(plaster(), fades.glassWall),
      gwReveal: cut(bronze(), fades.glassWall),
      gwFrame: cut(bronze(), fades.glassWall),
      gwGlass: patch(glass({ transmittance: 0.84 }), { fade: fades.glassWall }),
      ghost: ghostMaterial("#8fa3b8", 1),
      edges: patch(new THREE.LineBasicMaterial({ color: "#3b4654", transparent: true, opacity: 0, depthWrite: false }), { cut: "ghost" }),
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useEffect(() => {
    registerLamps([...HOUSE_LAMPS, ...FACADE_LAMPS]);
    return () => unregisterLamps([...HOUSE_LAMPS, ...FACADE_LAMPS]);
  }, []);

  const ghostRoof = useMemo(() => merge(ROOF_PLANES.map((p) => ({ geo: roofSurface(p, ROOF_T) }))), []);
  const ghostEdges = useMemo(() => {
    const lines = [geo.stone, geo.cedar, geo.glassWall, ghostRoof].map((g) => new THREE.EdgesGeometry(g, 28));
    return merge(lines.map((l) => ({ geo: l }))) as THREE.BufferGeometry;
  }, [geo, ghostRoof]);

  const depthSolid = useMemo(() => depthFor({ cut: "solid" }), []);
  const depthFade = useMemo(() => depthFor({ cut: "solid", fade: fades.glassWall, fadeKey: "glassWall" }), []);
  const ghostGroup = useRef<THREE.Group>(null);
  const glassGroup = useRef<THREE.Group>(null);

  useFrame(() => {
    mats.edges.opacity = channels.ghost * 0.55;
    // lamps glow brighter as the evening comes on
    const on = THREE.MathUtils.smoothstep(channels.dusk, 0.15, 0.55);
    mats.glow.emissiveIntensity = 0.4 + on * 3.4;
    if (ghostGroup.current) ghostGroup.current.visible = channels.ghost > 0.01;
    if (glassGroup.current) glassGroup.current.visible = channels.glassWall > 0.01;
  });

  const solidProps = { castShadow: true, receiveShadow: true, customDepthMaterial: depthSolid };
  const wallMats = (ext: THREE.Material) => [ext, mats.plaster, mats.reveal];

  return (
    <group name="house">
      <mesh geometry={geo.stone} material={wallMats(mats.stone)} {...solidProps} />
      <mesh geometry={geo.cedar} material={wallMats(mats.cedar)} {...solidProps} />
      <mesh geometry={geo.frames} material={mats.frame} {...solidProps} />
      <mesh geometry={geo.sills} material={mats.sill} {...solidProps} />
      <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
      <mesh geometry={geo.doors} material={mats.door} {...solidProps} />
      <mesh geometry={geo.handles} material={mats.handle} castShadow />
      <mesh geometry={geo.plinth} material={mats.plinth} {...solidProps} />
      <mesh geometry={geo.flashing} material={mats.sill} {...solidProps} />
      <mesh geometry={geo.canopy} material={mats.canopy} {...solidProps} />
      <mesh geometry={geo.canopySoffit} material={mats.canopySoffit} receiveShadow />
      <mesh geometry={geo.fixtures} material={mats.frame} castShadow />
      <mesh geometry={geo.apertures} material={mats.aperture} />
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
        <mesh geometry={geo.cedar} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.glassWall} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.slab} material={mats.ghost} renderOrder={2} />
        <mesh geometry={ghostRoof} material={mats.ghost} renderOrder={2} />
        <lineSegments geometry={ghostEdges} material={mats.edges} renderOrder={3} />
      </group>
    </group>
  );
}

export { U };
