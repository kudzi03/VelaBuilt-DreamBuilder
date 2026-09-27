"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GARDEN, MAIN, WING } from "@/lib/spec";
import { blob, box, merge, type Placed } from "./geom";
import { concrete, field, footprintShadow, lawn, rng } from "./proc";

export const LOT = { x0: -15.5, x1: 13.5, z0: -17.5, z1: 16 };

export interface TreeSpec {
  x: number;
  z: number;
  kind: "round" | "column" | "multi";
  s: number;
  tone?: number;
}

const SITE_TREES: TreeSpec[] = [
  { x: -10.8, z: 8.6, kind: "round", s: 1.35 },
  { x: -6.2, z: 12.4, kind: "multi", s: 0.9 },
  { x: 16.8, z: 4.5, kind: "round", s: 1.1 },
  { x: 12.9, z: -7.5, kind: "column", s: 1 },
  { x: 12.9, z: -11.2, kind: "column", s: 1.1 },
  { x: 12.9, z: -14.8, kind: "column", s: 0.95 },
  { x: -20.5, z: -21, kind: "round", s: 1.5 },
  { x: 4.5, z: -21.2, kind: "round", s: 1.35 },
  { x: 10, z: -20.5, kind: "column", s: 1.3 },
  { x: -19.5, z: 1.5, kind: "round", s: 1.25 },
  { x: -19, z: 5.5, kind: "column", s: 1.2 },
  { x: -20.5, z: 12.5, kind: "round", s: 1.1 },
  // distant context, paler
  { x: -34, z: 24, kind: "round", s: 1.8, tone: 0.55 },
  { x: 31, z: -26, kind: "round", s: 2, tone: 0.55 },
  { x: 34, z: 12, kind: "column", s: 1.8, tone: 0.55 },
  { x: -31, z: -30, kind: "round", s: 2, tone: 0.55 },
  { x: 9, z: -40, kind: "round", s: 2.2, tone: 0.6 },
  { x: -12, z: 38, kind: "round", s: 1.8, tone: 0.6 },
  { x: 26, z: 30, kind: "round", s: 1.6, tone: 0.6 },
];

const CANOPY = ["#8c9672", "#7f8b69", "#98a07c", "#86906c", "#929a77"].map((c) => new THREE.Color(c));
const FAR_TONE = new THREE.Color("#d2cdbb");

/** Architectural-model trees: merged canopies with baked colour variation (1 draw call) + trunks. */
export function buildTrees(trees: TreeSpec[], seed = 3): { canopy: THREE.BufferGeometry; trunks: THREE.BufferGeometry } {
  const canopies: THREE.BufferGeometry[] = [];
  const trunks: Placed[] = [];
  const r = rng(seed);
  trees.forEach((t, i) => {
    const base = CANOPY[i % CANOPY.length].clone();
    if (t.tone) base.lerp(FAR_TONE, t.tone);
    const parts: Array<[number, number, number, number, number]> = [];
    if (t.kind === "round") {
      parts.push([0, 3.7, 0, 1.8, 0.95], [0.75, 3.2, 0.35, 1.2, 0.9], [-0.7, 3.35, -0.3, 1.25, 0.9]);
      trunks.push({ geo: new THREE.CylinderGeometry(0.1 * t.s, 0.16 * t.s, 2.6 * t.s, 7), pos: [t.x, 1.3 * t.s, t.z] });
    } else if (t.kind === "column") {
      parts.push([0, 3.4, 0, 1.0, 2.5]);
      trunks.push({ geo: new THREE.CylinderGeometry(0.08 * t.s, 0.12 * t.s, 1.4 * t.s, 7), pos: [t.x, 0.7 * t.s, t.z] });
    } else {
      parts.push([0, 2.9, 0, 1.3, 0.7], [0.65, 2.7, 0.35, 0.85, 0.75], [-0.55, 2.8, -0.3, 0.9, 0.75]);
      trunks.push({ geo: new THREE.CylinderGeometry(0.06 * t.s, 0.1 * t.s, 2.4 * t.s, 7), pos: [t.x, 1.2 * t.s, t.z] });
    }
    for (const [dx, dy, dz, rad, squash] of parts) {
      const g = blob(rad * t.s, i * 7 + dx * 3 + 1, 3, squash, 0.09);
      g.translate(t.x + dx * t.s, dy * t.s, t.z + dz * t.s);
      const count = g.attributes.position.count;
      const col = new Float32Array(count * 3);
      const pos = g.attributes.position;
      for (let k = 0; k < count; k++) {
        // darker underside + slight per-vertex variation reads like a foam model with AO
        const yN = (pos.getY(k) - (dy - rad * squash) * t.s) / (2 * rad * squash * t.s);
        const shade = 0.72 + 0.34 * Math.min(1, Math.max(0, yN)) + (r() - 0.5) * 0.05;
        col[k * 3] = base.r * shade;
        col[k * 3 + 1] = base.g * shade;
        col[k * 3 + 2] = base.b * shade;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      canopies.push(g);
    }
  });
  const merged = new THREE.BufferGeometry();
  // manual merge keeping colors
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  let off = 0;
  for (const g of canopies) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const c = g.attributes.color.array;
    for (let k = 0; k < p.length; k++) P.push(p[k]);
    for (let k = 0; k < n.length; k++) N.push(n[k]);
    for (let k = 0; k < c.length; k++) C.push(c[k]);
    const idx = g.index!.array;
    for (let k = 0; k < idx.length; k++) I.push(idx[k] + off);
    off += g.attributes.position.count;
    g.dispose();
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  merged.setIndex(I);
  return { canopy: merged, trunks: merge(trunks) };
}

export function Site() {
  const geo = useMemo(() => {
    // lot lawn with the garden cut out (the garden owns its own ground)
    const shape = new THREE.Shape();
    shape.moveTo(LOT.x0, -LOT.z0);
    shape.lineTo(LOT.x1, -LOT.z0);
    shape.lineTo(LOT.x1, -LOT.z1);
    shape.lineTo(LOT.x0, -LOT.z1);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(GARDEN.x0, -GARDEN.z0);
    hole.lineTo(GARDEN.x0, -GARDEN.z1);
    hole.lineTo(GARDEN.x1, -GARDEN.z1);
    hole.lineTo(GARDEN.x1, -GARDEN.z0);
    hole.closePath();
    shape.holes.push(hole);
    const lawnGeo = new THREE.ShapeGeometry(shape);
    lawnGeo.rotateX(-Math.PI / 2);
    // ShapeGeometry UVs = shape coords (metres) — good for tiling.

    const kerbW = 0.22;
    const kerb: Placed[] = [
      { geo: box(LOT.x1 - LOT.x0 + kerbW, 0.1, kerbW), pos: [(LOT.x0 + LOT.x1) / 2, 0.03, LOT.z1] },
      { geo: box(LOT.x1 - LOT.x0 + kerbW, 0.1, kerbW), pos: [(LOT.x0 + LOT.x1) / 2, 0.03, LOT.z0] },
      { geo: box(kerbW, 0.1, LOT.z1 - LOT.z0), pos: [LOT.x0, 0.03, (LOT.z0 + LOT.z1) / 2] },
      { geo: box(kerbW, 0.1, LOT.z1 - LOT.z0), pos: [LOT.x1, 0.03, (LOT.z0 + LOT.z1) / 2] },
    ];
    const path = box(1.9, 0.04, LOT.z1 - (MAIN.z1 + 1.4));
    path.translate(0, 0.02, (LOT.z1 + MAIN.z1 + 1.4) / 2);
    const drive = box(5, 0.04, LOT.z1 - (MAIN.z0 + 0.5));
    drive.translate(9.7, 0.021, (LOT.z1 + MAIN.z0 + 0.5) / 2);
    const sidePath = box(1.3, 0.035, WING.z1 - WING.z0 - 1.5);
    sidePath.translate(WING.x1 + 1.05, 0.018, (WING.z0 + WING.z1) / 2 - 0.6);

    const hedges: Placed[] = [
      { geo: box(12.6, 0.75, 0.8), pos: [-8.6, 0.375, LOT.z1 - 0.7] },
      { geo: box(4.6, 0.75, 0.8), pos: [3.9, 0.375, LOT.z1 - 0.7] },
      { geo: box(0.8, 0.9, 13), pos: [LOT.x0 + 0.7, 0.45, 7.5] },
    ];

    const house: Array<[number, number, number, number]> = [
      [MAIN.x0 - 0.35, MAIN.x1 + 0.35, MAIN.z0 - 0.35, MAIN.z1 + 0.35],
      [WING.x0 - 0.35, WING.x1 + 0.35, WING.z0 - 0.35, WING.z1],
    ];
    // texture rows run toward -z on screen; mirror z so the shadow lands under the house
    const cz = -5;
    const flipped = house.map(([x0, x1, z0, z1]) => [x0, x1, 2 * cz - z1, 2 * cz - z0] as [number, number, number, number]);
    const aoTex = footprintShadow(flipped, 0, cz, 13);

    // presentation base: a disc with the lot cut out (the lot has its own ground, incl. the pool opening)
    const fieldShape = new THREE.Shape();
    fieldShape.absarc(0, 0, 340, 0, Math.PI * 2, false);
    const lotHole = new THREE.Path();
    lotHole.moveTo(LOT.x0 + 0.05, -LOT.z0 - 0.05);
    lotHole.lineTo(LOT.x0 + 0.05, -LOT.z1 + 0.05);
    lotHole.lineTo(LOT.x1 - 0.05, -LOT.z1 + 0.05);
    lotHole.lineTo(LOT.x1 - 0.05, -LOT.z0 - 0.05);
    lotHole.closePath();
    fieldShape.holes.push(lotHole);
    const fieldGeo = new THREE.ShapeGeometry(fieldShape, 48);
    fieldGeo.rotateX(-Math.PI / 2);

    return {
      field: fieldGeo,
      lawn: lawnGeo,
      kerb: merge(kerb),
      path,
      drive,
      sidePath,
      hedges: merge(hedges),
      aoTex,
      trees: buildTrees(SITE_TREES),
    };
  }, []);

  const mats = useMemo(() => {
    const lw = lawn();
    const fd = field();
    const pv = concrete(1.0, "#d9d3c8", 4, 2);
    const dr = concrete(3.0, "#d4cec3", 6, 5);
    const hedgeTex = lawn();
    return {
      lawn: new THREE.MeshStandardMaterial({ map: lw.map, normalMap: lw.normalMap, roughness: 0.97, color: "#ffffff" }),
      field: new THREE.MeshStandardMaterial({ map: fd.map, roughness: 1, color: "#ffffff" }),
      pavers: new THREE.MeshStandardMaterial({ map: pv.map, normalMap: pv.normalMap, roughness: 0.9 }),
      drive: new THREE.MeshStandardMaterial({ map: dr.map, normalMap: dr.normalMap, roughness: 0.92 }),
      kerb: new THREE.MeshStandardMaterial({ color: "#cbc5ba", roughness: 0.9 }),
      hedge: new THREE.MeshStandardMaterial({ map: hedgeTex.map, color: "#b9c29f", roughness: 1 }),
      canopy: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }),
      trunk: new THREE.MeshStandardMaterial({ color: "#5d4c3f", roughness: 0.95 }),
      ao: new THREE.MeshBasicMaterial({ map: geo.aoTex, transparent: true, opacity: 0.5, depthWrite: false }),
    };
  }, [geo]);

  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group name="site">
      <mesh geometry={geo.field} position-y={-0.02} material={mats.field} receiveShadow />
      <mesh geometry={geo.lawn} material={mats.lawn} receiveShadow />
      <mesh geometry={geo.kerb} material={mats.kerb} receiveShadow castShadow />
      <mesh geometry={geo.path} material={mats.pavers} receiveShadow />
      <mesh geometry={geo.drive} material={mats.drive} receiveShadow />
      <mesh geometry={geo.sidePath} material={mats.pavers} receiveShadow />
      <mesh geometry={geo.hedges} material={mats.hedge} receiveShadow castShadow />
      <mesh geometry={geo.trees.canopy} material={mats.canopy} castShadow receiveShadow />
      <mesh geometry={geo.trees.trunks} material={mats.trunk} castShadow />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, -5]} material={mats.ao} renderOrder={1}>
        <planeGeometry args={[26, 26]} />
      </mesh>
    </group>
  );
}
