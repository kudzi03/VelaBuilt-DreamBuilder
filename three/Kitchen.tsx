"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOOR_Y, KITCHEN as K, MAIN, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { box, merge, type Placed } from "./geom";
import { granite, laminate, marble, polishedConcrete, porcelain, zellige } from "./proc";
import { channels, lazyCache, patch, wipes } from "./shared";
import { photo } from "./textures";

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const Y0 = FLOOR_Y; // finished floor
const TOE = 0.1;
const BASE_TOP = Y0 + K.baseH; // top of carcass
const CT = K.counterT;

interface Face {
  origin: V3; // start of the run on the face plane (at floor level)
  dir: V3; // run direction
  normal: V3; // outward (into the room)
  length: number;
}

function faceMatrix(f: Face, along: number, y: number, out: number) {
  const r = new THREE.Vector3(...f.dir);
  const n = new THREE.Vector3(...f.normal);
  const m = new THREE.Matrix4().makeBasis(r, UP, n);
  m.setPosition(new THREE.Vector3(...f.origin).addScaledVector(r, along).addScaledVector(n, out).setY(y));
  return m;
}

function door(style: "shaker" | "slab", w: number, h: number): THREE.BufferGeometry {
  if (style === "slab") return box(w, h, 0.02);
  const f = 0.062;
  return merge([
    { geo: box(f, h, 0.022), pos: [-w / 2 + f / 2, 0, 0] },
    { geo: box(f, h, 0.022), pos: [w / 2 - f / 2, 0, 0] },
    { geo: box(w - 2 * f, f, 0.022), pos: [0, h / 2 - f / 2, 0] },
    { geo: box(w - 2 * f, f, 0.022), pos: [0, -h / 2 + f / 2, 0] },
    { geo: box(w - 2 * f, h - 2 * f, 0.012), pos: [0, 0, -0.005] },
  ]);
}

/** Door and drawer fronts + handles for a run of base or wall units. */
function fronts(f: Face, style: "shaker" | "slab", kind: "base" | "upper" | "tall", out: { doors: Placed[]; handles: Placed[] }) {
  const n = Math.max(1, Math.round(f.length / 0.6));
  const w = f.length / n;
  const gap = 0.004;
  for (let i = 0; i < n; i++) {
    const c = w * i + w / 2;
    if (kind === "base") {
      const dTop = BASE_TOP - 0.005;
      const drawerH = 0.19;
      const doorH = dTop - drawerH - gap - (Y0 + TOE);
      out.doors.push({ geo: door(style, w - gap * 2, drawerH), matrix: faceMatrix(f, c, dTop - drawerH / 2, 0.011) });
      out.doors.push({ geo: door(style, w - gap * 2, doorH), matrix: faceMatrix(f, c, Y0 + TOE + doorH / 2, 0.011) });
      out.handles.push({ geo: box(style === "shaker" ? 0.12 : 0.26, 0.012, 0.02), matrix: faceMatrix(f, c, dTop - drawerH / 2, 0.034) });
      out.handles.push({ geo: box(0.012, style === "shaker" ? 0.1 : 0.22, 0.02), matrix: faceMatrix(f, c + (i % 2 ? -1 : 1) * (w / 2 - 0.06), BASE_TOP - drawerH - 0.14, 0.034) });
    } else if (kind === "upper") {
      const h = K.upperY1 - K.upperY0;
      out.doors.push({ geo: door(style, w - gap * 2, h - gap * 2), matrix: faceMatrix(f, c, Y0 + K.upperY0 + h / 2, 0.011) });
      out.handles.push({ geo: box(0.012, style === "shaker" ? 0.1 : 0.2, 0.02), matrix: faceMatrix(f, c + (i % 2 ? -1 : 1) * (w / 2 - 0.06), Y0 + K.upperY0 + 0.12, 0.034) });
    } else {
      const h1 = 1.55;
      const h2 = K.upperY1 - TOE - h1 - gap;
      out.doors.push({ geo: door(style, w - gap * 2, h1), matrix: faceMatrix(f, c, Y0 + TOE + h1 / 2, 0.011) });
      out.doors.push({ geo: door(style, w - gap * 2, h2), matrix: faceMatrix(f, c, Y0 + TOE + h1 + gap + h2 / 2, 0.011) });
      out.handles.push({ geo: box(0.014, 0.5, 0.02), matrix: faceMatrix(f, c - w / 2 + 0.06, Y0 + TOE + h1 - 0.35, 0.034) });
    }
  }
}

// Runs
const EAST_X = K.ix1 - K.baseD; // face plane of the east run
const TALL_Z0 = -8.3;
const TALL_Z1 = -7.4;
const EAST_BASE: Face = { origin: [EAST_X, 0, K.iz0 + K.baseD], dir: [0, 0, 1], normal: [-1, 0, 0], length: TALL_Z0 - (K.iz0 + K.baseD) };
const EAST_TALL: Face = { origin: [EAST_X, 0, TALL_Z0], dir: [0, 0, 1], normal: [-1, 0, 0], length: TALL_Z1 - TALL_Z0 };
const UP_X = K.ix1 - K.upperD;
const EAST_UP_A: Face = { origin: [UP_X, 0, K.iz0 + K.baseD], dir: [0, 0, 1], normal: [-1, 0, 0], length: K.window.z0 - 0.12 - (K.iz0 + K.baseD) };
const EAST_UP_B: Face = { origin: [UP_X, 0, K.window.z1 + 0.12], dir: [0, 0, 1], normal: [-1, 0, 0], length: TALL_Z0 - (K.window.z1 + 0.12) };
const BACK_Z = K.iz0 + K.baseD;
const BACK_BASE: Face = { origin: [K.backX0, 0, BACK_Z], dir: [1, 0, 0], normal: [0, 0, 1], length: EAST_X - K.backX0 };
const HOOD_X0 = 3.0;
const HOOD_X1 = 3.9;
const BACK_UP_A: Face = { origin: [K.backX0, 0, K.iz0 + K.upperD], dir: [1, 0, 0], normal: [0, 0, 1], length: HOOD_X0 - 0.05 - K.backX0 };
const BACK_UP_B: Face = { origin: [HOOD_X1 + 0.05, 0, K.iz0 + K.upperD], dir: [1, 0, 0], normal: [0, 0, 1], length: UP_X - (HOOD_X1 + 0.05) };
const IS = K.island;
const IS_X0 = IS.cx - IS.w / 2;
const IS_X1 = IS.cx + IS.w / 2;
const ISLAND_FACE: Face = { origin: [IS_X1, 0, IS.z1], dir: [0, 0, -1], normal: [1, 0, 0], length: IS.z1 - IS.z0 };

function carcass(): Placed[] {
  const h = K.baseH - TOE;
  const p: Placed[] = [];
  const zA = K.iz0;
  const zB = TALL_Z0;
  // east base
  p.push({ geo: box(K.baseD - 0.02, h, zB - zA), pos: [EAST_X + (K.baseD + 0.02) / 2, Y0 + TOE + h / 2, (zA + zB) / 2] });
  // back base
  p.push({ geo: box(EAST_X - K.backX0, h, K.baseD - 0.02), pos: [(K.backX0 + EAST_X) / 2, Y0 + TOE + h / 2, K.iz0 + (K.baseD + 0.02) / 2] });
  // tall
  p.push({ geo: box(K.baseD - 0.02, K.upperY1 - TOE, TALL_Z1 - TALL_Z0), pos: [EAST_X + (K.baseD + 0.02) / 2, Y0 + TOE + (K.upperY1 - TOE) / 2, (TALL_Z0 + TALL_Z1) / 2] });
  // uppers
  const uh = K.upperY1 - K.upperY0;
  for (const f of [EAST_UP_A, EAST_UP_B]) p.push({ geo: box(K.upperD - 0.02, uh, f.length), pos: [UP_X + (K.upperD + 0.02) / 2, Y0 + K.upperY0 + uh / 2, f.origin[2] + f.length / 2] });
  for (const f of [BACK_UP_A, BACK_UP_B]) p.push({ geo: box(f.length, uh, K.upperD - 0.02), pos: [f.origin[0] + f.length / 2, Y0 + K.upperY0 + uh / 2, K.iz0 + (K.upperD + 0.02) / 2] });
  return p;
}

function toeKicks(): Placed[] {
  return [
    { geo: box(0.02, TOE, TALL_Z1 - K.iz0), pos: [EAST_X + 0.07, Y0 + TOE / 2, (K.iz0 + TALL_Z1) / 2] },
    { geo: box(EAST_X - K.backX0, TOE, 0.02), pos: [(K.backX0 + EAST_X) / 2, Y0 + TOE / 2, BACK_Z - 0.07] },
  ];
}

function counters(): Placed[] {
  const y = BASE_TOP + CT / 2;
  const sinkZ0 = K.window.z0 + 0.35;
  const sinkZ1 = K.window.z1 - 0.35;
  return [
    // east run, split around the sink opening
    { geo: box(K.baseD + 0.03, CT, sinkZ0 - K.iz0), pos: [K.ix1 - (K.baseD + 0.03) / 2, y, (K.iz0 + sinkZ0) / 2] },
    { geo: box(K.baseD + 0.03, CT, TALL_Z0 - sinkZ1), pos: [K.ix1 - (K.baseD + 0.03) / 2, y, (sinkZ1 + TALL_Z0) / 2] },
    { geo: box(0.12, CT, sinkZ1 - sinkZ0), pos: [EAST_X + 0.03, y, (sinkZ0 + sinkZ1) / 2] },
    { geo: box(0.1, CT, sinkZ1 - sinkZ0), pos: [K.ix1 - 0.05, y, (sinkZ0 + sinkZ1) / 2] },
    // back run
    { geo: box(EAST_X - K.backX0, CT, K.baseD + 0.03), pos: [(K.backX0 + EAST_X) / 2, y, K.iz0 + (K.baseD + 0.03) / 2] },
  ];
}

function backsplash(): Placed[] {
  const y0 = BASE_TOP + CT;
  const h = Y0 + K.upperY0 - y0;
  return [
    { geo: box(0.012, h, TALL_Z0 - K.iz0), pos: [K.ix1 - 0.006, y0 + h / 2, (K.iz0 + TALL_Z0) / 2] },
    { geo: box(EAST_X - K.backX0 + K.baseD, h, 0.012), pos: [(K.backX0 + K.ix1) / 2, y0 + h / 2, K.iz0 + 0.006] },
    // behind the hood, full height
    { geo: box(HOOD_X1 - HOOD_X0 + 0.1, K.upperY1 - K.upperY0, 0.012), pos: [(HOOD_X0 + HOOD_X1) / 2, Y0 + (K.upperY0 + K.upperY1) / 2, K.iz0 + 0.006] },
  ];
}

function steelParts(): Placed[] {
  const sinkZ0 = K.window.z0 + 0.35;
  const sinkZ1 = K.window.z1 - 0.35;
  const sx = (EAST_X + 0.09 + K.ix1 - 0.1) / 2;
  return [
    { geo: box(K.ix1 - 0.1 - (EAST_X + 0.09), 0.02, sinkZ1 - sinkZ0), pos: [sx, BASE_TOP - 0.16, (sinkZ0 + sinkZ1) / 2] },
    { geo: new THREE.CylinderGeometry(0.016, 0.02, 0.36, 12), pos: [K.ix1 - 0.12, BASE_TOP + 0.2, (sinkZ0 + sinkZ1) / 2] },
    { geo: box(0.22, 0.022, 0.03), pos: [K.ix1 - 0.22, BASE_TOP + 0.37, (sinkZ0 + sinkZ1) / 2] },
    // hood
    { geo: box(HOOD_X1 - HOOD_X0, 0.12, 0.5), pos: [(HOOD_X0 + HOOD_X1) / 2, Y0 + K.upperY0 + 0.12, K.iz0 + 0.25] },
    { geo: box(0.36, K.upperY1 - K.upperY0 - 0.24 + 0.6, 0.3), pos: [(HOOD_X0 + HOOD_X1) / 2, Y0 + K.upperY0 + 0.18 + (K.upperY1 - K.upperY0 + 0.36) / 2, K.iz0 + 0.15] },
  ];
}

function cooktop(): Placed[] {
  return [{ geo: box(0.76, 0.008, 0.5), pos: [(HOOD_X0 + HOOD_X1) / 2, BASE_TOP + CT + 0.004, K.iz0 + 0.31] }];
}

function island(kind: "island" | "waterfall") {
  const h = K.baseH - TOE;
  const over = kind === "waterfall" ? 0.32 : 0.05;
  const carc: Placed[] = [{ geo: box(IS.w - 0.04, h, IS.z1 - IS.z0 - 0.04), pos: [IS.cx, Y0 + TOE + h / 2, (IS.z0 + IS.z1) / 2] }];
  const top: Placed[] = [{ geo: box(IS.w + over + 0.04, CT, IS.z1 - IS.z0 + (kind === "waterfall" ? 0.08 : 0.06)), pos: [IS.cx - over / 2, BASE_TOP + CT / 2, (IS.z0 + IS.z1) / 2] }];
  if (kind === "waterfall") {
    for (const z of [IS.z0 - 0.02, IS.z1 + 0.02]) top.push({ geo: box(IS.w + over + 0.04, K.baseH, CT), pos: [IS.cx - over / 2, Y0 + K.baseH / 2, z] });
  }
  const toe: Placed[] = [{ geo: box(0.02, TOE, IS.z1 - IS.z0 - 0.1), pos: [IS_X1 - 0.08, Y0 + TOE / 2, (IS.z0 + IS.z1) / 2] }];
  return { carc, top, toe };
}

function stools(n: number): Placed[] {
  const out: Placed[] = [];
  const x = IS_X0 - 0.42;
  const zs = n === 3 ? [-11.55, -10.75, -9.95] : [-11.2, -10.3];
  for (const z of zs) {
    out.push({ geo: new THREE.CylinderGeometry(0.19, 0.19, 0.05, 20), pos: [x, Y0 + 0.66, z] });
    out.push({ geo: new THREE.CylinderGeometry(0.018, 0.018, 0.64, 8), pos: [x, Y0 + 0.33, z] });
    out.push({ geo: new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20), pos: [x, Y0 + 0.006, z] });
    out.push({ geo: new THREE.TorusGeometry(0.15, 0.008, 6, 24), pos: [x, Y0 + 0.25, z], rot: [Math.PI / 2, 0, 0] });
  }
  return out;
}

function pendants(): { body: Placed[]; glow: Placed[] } {
  const body: Placed[] = [];
  const glow: Placed[] = [];
  for (const z of [-11.5, -10.75, -10.0]) {
    const y = Y0 + 2.05;
    body.push({ geo: new THREE.CylinderGeometry(0.1, 0.16, 0.24, 24, 1, true), pos: [IS.cx, y, z] });
    body.push({ geo: new THREE.CylinderGeometry(0.004, 0.004, WING.eave - y, 6), pos: [IS.cx, y + (WING.eave - y) / 2, z] });
    glow.push({ geo: new THREE.CircleGeometry(0.15, 24), pos: [IS.cx, y - 0.1, z], rot: [Math.PI / 2, 0, 0] });
  }
  return { body, glow };
}

function dining(): { wood: Placed[]; fabric: Placed[]; rug: Placed[] } {
  const cx = 1.1;
  const cz = -6.1;
  const wood: Placed[] = [{ geo: box(0.95, 0.04, 1.9), pos: [cx, Y0 + 0.74, cz] }];
  for (const [dx, dz] of [
    [-0.4, -0.85],
    [0.4, -0.85],
    [-0.4, 0.85],
    [0.4, 0.85],
  ])
    wood.push({ geo: box(0.05, 0.72, 0.05), pos: [cx + dx, Y0 + 0.36, cz + dz] });
  const fabric: Placed[] = [];
  for (const side of [-1, 1]) {
    for (const dz of [-0.5, 0.5]) {
      const x = cx + side * 0.72;
      fabric.push({ geo: box(0.44, 0.06, 0.44), pos: [x, Y0 + 0.46, cz + dz] });
      fabric.push({ geo: box(0.06, 0.42, 0.42), pos: [x + side * 0.2, Y0 + 0.72, cz + dz] });
      for (const [lx, lz] of [
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ])
        wood.push({ geo: box(0.03, 0.43, 0.03), pos: [x + lx, Y0 + 0.215, cz + dz + lz] });
    }
  }
  return { wood, fabric, rug: [{ geo: box(2.6, 0.012, 3.0), pos: [cx, Y0 + 0.006, cz] }] };
}

export function Kitchen() {
  const cfg = useDemo((s) => s.remodeling);
  const compare = useDemo((s) => s.compare);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const group = useRef<THREE.Group>(null);
  const beforeOn = compare && industry === "remodeling" && phase === "explore";

  const geo = useMemo(() => {
    const shaker = { doors: [] as Placed[], handles: [] as Placed[] };
    const slab = { doors: [] as Placed[], handles: [] as Placed[] };
    for (const [f, kind] of [
      [EAST_BASE, "base"],
      [BACK_BASE, "base"],
      [EAST_TALL, "tall"],
      [EAST_UP_A, "upper"],
      [EAST_UP_B, "upper"],
      [BACK_UP_A, "upper"],
      [BACK_UP_B, "upper"],
    ] as const) {
      fronts(f, "shaker", kind, shaker);
      fronts(f, "slab", kind, slab);
    }
    const iShaker = { doors: [] as Placed[], handles: [] as Placed[] };
    const iSlab = { doors: [] as Placed[], handles: [] as Placed[] };
    fronts(ISLAND_FACE, "shaker", "base", iShaker);
    fronts(ISLAND_FACE, "slab", "base", iSlab);
    const isl = island("island");
    const wf = island("waterfall");
    const pend = pendants();
    const din = dining();
    const floor = new THREE.PlaneGeometry(K.ix1 - K.ix0, K.iz1 - K.iz0 + WALL_OVERLAP);
    floor.rotateX(-Math.PI / 2);
    // UVs in metres
    const uv = floor.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (K.ix1 - K.ix0), uv.getY(i) * (K.iz1 - K.iz0));
    return {
      carcass: merge(carcass()),
      toe: merge(toeKicks()),
      counters: merge(counters()),
      splash: merge(backsplash()),
      steel: merge(steelParts()),
      cooktop: merge(cooktop()),
      shaker: merge(shaker.doors),
      shakerH: merge(shaker.handles),
      slab: merge(slab.doors),
      slabH: merge(slab.handles),
      iShaker: merge(iShaker.doors),
      iShakerH: merge(iShaker.handles),
      iSlab: merge(iSlab.doors),
      iSlabH: merge(iSlab.handles),
      isCarc: merge(isl.carc),
      isTop: merge(isl.top),
      isToe: merge(isl.toe),
      wfCarc: merge(wf.carc),
      wfTop: merge(wf.top),
      stools2: merge(stools(2)),
      stools3: merge(stools(3)),
      pendant: merge(pend.body),
      glow: merge(pend.glow),
      wood: merge(din.wood),
      fabric: merge(din.fabric),
      rug: merge(din.rug),
      floor,
    };
  }, []);

  const lazy = useMemo(() => lazyCache<THREE.Material>(), []);
  const mats = useMemo(() => {
    const after = { cut: "solid" as const, wipe: { side: "after" as const, u: wipes.kitchen } };
    const before = { cut: "solid" as const, wipe: { side: "before" as const, u: wipes.kitchen } };
    const std = (p: THREE.MeshStandardMaterialParameters, o: Parameters<typeof patch>[1] = after) => patch(new THREE.MeshStandardMaterial(p), o);
    const L = (key: string, make: () => THREE.MeshStandardMaterial) => lazy.get(key, make) as THREE.MeshStandardMaterial;
    const oak = () => photo("oak_veneer_01");
    // Built on first use: only the selected finishes cost anything.
    const counter = (id: string) =>
      L(`c-${id}`, () => {
        switch (id) {
          case "black-granite":
            return std({ map: granite().map, roughness: 0.18 });
          case "butcher-block":
            return std({ map: oak(), roughness: 0.55, color: "#e3b98c" });
          case "concrete":
            return std({ map: polishedConcrete().map, roughness: 0.42 });
          default:
            return std({ map: marble().map, roughness: 0.14 });
        }
      });
    const floor = (id: string) =>
      L(`f-${id}`, () => {
        switch (id) {
          case "herringbone":
            return std({ map: photo("herringbone_parquet"), normalMap: photo("herringbone_parquet", "nor"), roughness: 0.45, color: "#f3e3cf" });
          case "porcelain": {
            const po = porcelain();
            return std({ map: po.map, normalMap: po.normalMap, roughness: 0.3 });
          }
          case "concrete":
            return std({ map: polishedConcrete().map, roughness: 0.28 });
          default:
            return std({ map: photo("wood_floor"), normalMap: photo("wood_floor", "nor"), roughness: 0.5, color: "#f2e2cf" });
        }
      });
    const b = (key: string, make: () => THREE.MeshStandardMaterial) => L(`b-${key}`, make);
    const beforeSet = () => ({
      oak: b("oak", () => std({ map: oak(), color: "#d9b485", roughness: 0.4 }, before)),
      lam: b("lam", () => std({ map: laminate().map, roughness: 0.6 }, before)),
      floor: b("floor", () => std({ map: photo("floor_tiles_06"), roughness: 0.55, color: "#e8e1cf" }, before)),
      splash: b("splash", () => std({ map: zellige().map, roughness: 0.3, color: "#efe3c7" }, before)),
      knob: b("knob", () => std({ color: "#c9a75e", metalness: 1, roughness: 0.3 }, before)),
      toe: b("toe", () => std({ color: "#3a3024", roughness: 0.8 }, before)),
      steel: b("steel", () => std({ color: "#aeb1b3", metalness: 1, roughness: 0.4 }, before)),
    });
    const zl = zellige();
    return {
      counter,
      floor,
      beforeSet,
      paint: std({ color: "#ebe5da", roughness: 0.55 }),
      walnut: L("walnut", () => std({ map: photo("american_walnut_veneer"), color: "#c79a78", roughness: 0.5 })),
      handleBrass: std({ color: "#b8925a", metalness: 1, roughness: 0.32 }),
      handleBlack: std({ color: "#1b1b1d", metalness: 0.6, roughness: 0.45 }),
      toe: std({ color: "#2a2a2c", roughness: 0.8 }),
      splash: std({ map: zl.map, normalMap: zl.normalMap, roughness: 0.18 }),
      steel: std({ color: "#b9bcbe", metalness: 1, roughness: 0.28 }),
      glassTop: std({ color: "#101113", metalness: 0.2, roughness: 0.08 }),
      stool: std({ color: "#1d1d1f", metalness: 0.5, roughness: 0.4 }),
      pendant: std({ color: "#1f1f21", metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
      glow: std({ color: "#ffe2b8", emissive: new THREE.Color("#ffcf96"), emissiveIntensity: 2.2 }),
      wood: patch(new THREE.MeshStandardMaterial({ map: oak(), color: "#cdbca6", roughness: 0.6 }), { cut: "solid" }),
      fabric: patch(new THREE.MeshStandardMaterial({ color: "#d9d2c5", roughness: 0.95 }), { cut: "solid" }),
      rug: patch(new THREE.MeshStandardMaterial({ color: "#cbbda6", roughness: 1 }), { cut: "solid" }),
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

  // cabinet finish
  const style: "shaker" | "slab" = cfg.cabinets.includes("shaker") ? "shaker" : "slab";
  const cabMat = cfg.cabinets === "walnut-slab" ? mats.walnut : mats.paint;
  useEffect(() => {
    mats.paint.color.set(cfg.cabinets === "sage-shaker" ? "#7c8a72" : cfg.cabinets === "charcoal-slab" ? "#2f3034" : "#ebe5da");
    mats.paint.roughness = cfg.cabinets === "charcoal-slab" ? 0.62 : 0.52;
  }, [cfg.cabinets, mats]);

  useFrame(() => {
    if (group.current) group.current.visible = channels.wingLift > 0.02 || channels.kitchen > 0.02;
  });

  const handles = style === "shaker" ? mats.handleBrass : mats.handleBlack;
  const counter = mats.counter(cfg.counter);
  const floorMat = mats.floor(cfg.floor);
  const B = beforeOn ? mats.beforeSet() : null;
  const sh = { castShadow: true, receiveShadow: true };

  return (
    <group ref={group} name="kitchen" visible={false}>
      {/* after */}
      <mesh geometry={geo.floor} material={floorMat} position={[(K.ix0 + K.ix1) / 2, Y0 + 0.004, (K.iz0 + K.iz1 + WALL_OVERLAP) / 2]} receiveShadow />
      <mesh geometry={geo.carcass} material={cabMat} {...sh} />
      <mesh geometry={style === "shaker" ? geo.shaker : geo.slab} material={cabMat} {...sh} />
      <mesh geometry={style === "shaker" ? geo.shakerH : geo.slabH} material={handles} castShadow />
      <mesh geometry={geo.toe} material={mats.toe} />
      <mesh geometry={geo.counters} material={counter} {...sh} />
      <mesh geometry={geo.splash} material={mats.splash} receiveShadow />
      <mesh geometry={geo.steel} material={mats.steel} {...sh} />
      <mesh geometry={geo.cooktop} material={mats.glassTop} />
      {cfg.island !== "none" && (
        <>
          <mesh geometry={cfg.island === "waterfall" ? geo.wfCarc : geo.isCarc} material={cabMat} {...sh} />
          <mesh geometry={style === "shaker" ? geo.iShaker : geo.iSlab} material={cabMat} {...sh} />
          <mesh geometry={style === "shaker" ? geo.iShakerH : geo.iSlabH} material={handles} castShadow />
          <mesh geometry={cfg.island === "waterfall" ? geo.wfTop : geo.isTop} material={counter} {...sh} />
          <mesh geometry={geo.isToe} material={mats.toe} />
          <mesh geometry={cfg.island === "waterfall" ? geo.stools3 : geo.stools2} material={mats.stool} {...sh} />
          <mesh geometry={geo.pendant} material={mats.pendant} castShadow />
          <mesh geometry={geo.glow} material={mats.glow} />
        </>
      )}
      <mesh geometry={geo.wood} material={mats.wood} {...sh} />
      <mesh geometry={geo.fabric} material={mats.fabric} {...sh} />
      <mesh geometry={geo.rug} material={mats.rug} receiveShadow />

      {/* before (only while comparing) */}
      {B && (
        <>
          <mesh geometry={geo.floor} material={B.floor} position={[(K.ix0 + K.ix1) / 2, Y0 + 0.005, (K.iz0 + K.iz1 + WALL_OVERLAP) / 2]} />
          <mesh geometry={geo.carcass} material={B.oak} />
          <mesh geometry={geo.shaker} material={B.oak} />
          <mesh geometry={geo.shakerH} material={B.knob} />
          <mesh geometry={geo.toe} material={B.toe} />
          <mesh geometry={geo.counters} material={B.lam} />
          <mesh geometry={geo.splash} material={B.splash} />
          <mesh geometry={geo.steel} material={B.steel} />
        </>
      )}
    </group>
  );
}

const WALL_OVERLAP = MAIN.z0 - WING.z1; // 0 — floor ends at the main house wall
