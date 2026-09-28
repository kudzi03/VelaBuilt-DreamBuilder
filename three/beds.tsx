"use client";

import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import COVER from "@/public/assets/trees/cover.json";
import { isPhone } from "@/lib/quality";
import { useDemo, type Tier } from "@/lib/store";
import { box, merge, type Placed } from "./geom";
import { lampLit } from "./lamps";
import { pbr, solid } from "./materials";
import { foliageMaterial } from "./plantfield";
import { rng } from "./proc";
import { patch, wipes } from "./shared";

/**
 * Planting beds: mulched soil a finger above the lawn inside a thin steel edge, filled with
 * photoscanned ferns and grass (Poly Haven clumps, instanced). The shrubs and trees in the same
 * beds come from the plant field; this is the layer under them that keeps the house and the
 * terrace from standing on bare lawn.
 */

type CoverId = keyof typeof COVER;

interface Fill {
  kind: CoverId;
  /** share of the bed's planting points */
  share: number;
  /** size multiplier range over the scan */
  scale: [number, number];
  /** tufts per planting point (grass is planted in small drifts) */
  tufts: number;
}
export interface Bed {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** metres between planting points */
  every: number;
  fill: Fill[];
  seed: number;
}

export const FERNS: Fill = { kind: "fern", share: 1, scale: [1.5, 2.1], tufts: 1 };
export const GRASS: Fill = { kind: "grass_tall", share: 1, scale: [1.4, 1.9], tufts: 5 };
export const CLUMP: Fill = { kind: "grass_clump", share: 1, scale: [1.6, 2.2], tufts: 2 };
export const mix = (f: Fill, share: number, scale?: [number, number]): Fill => ({ ...f, share, scale: scale ?? f.scale });

const MULCH_TOP = 0.022;
const EDGE = 0.006;
/** planting points kept per tier (the low tier draws the beds without ground cover) */
const DENSITY: Record<Tier, number> = { high: 1, medium: 0.55, low: 0 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Jittered grid over each bed; each point gets a species by share, grass as a small drift. */
function placeCover(beds: Bed[], density: number) {
  const out = new Map<string, THREE.Matrix4[]>();
  for (const b of beds) {
    const r = rng(b.seed);
    const total = b.fill.reduce((a, f) => a + f.share, 0);
    const nx = Math.max(1, Math.round((b.x1 - b.x0) / b.every));
    const nz = Math.max(1, Math.round((b.z1 - b.z0) / b.every));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (r() > density) continue;
        const x = b.x0 + ((i + 0.5 + (r() - 0.5) * 0.8) / nx) * (b.x1 - b.x0);
        const z = b.z0 + ((j + 0.5 + (r() - 0.5) * 0.8) / nz) * (b.z1 - b.z0);
        let pick = r() * total;
        const f = b.fill.find((q) => (pick -= q.share) < 0) ?? b.fill[0];
        const variants = COVER[f.kind].variants.length;
        for (let t = 0; t < f.tufts; t++) {
          const a = r() * Math.PI * 2;
          const d = f.tufts > 1 ? Math.sqrt(r()) * 0.16 * Math.sqrt(f.tufts) : 0;
          const px = THREE.MathUtils.clamp(x + Math.cos(a) * d, b.x0 + 0.08, b.x1 - 0.08);
          const pz = THREE.MathUtils.clamp(z + Math.sin(a) * d, b.z0 + 0.08, b.z1 - 0.08);
          const s = f.scale[0] + r() * (f.scale[1] - f.scale[0]);
          const v = Math.floor(r() * variants);
          _q.setFromAxisAngle(_up, r() * Math.PI * 2);
          const key = `${f.kind}:${v}`;
          if (!out.has(key)) out.set(key, []);
          out.get(key)!.push(new THREE.Matrix4().compose(_p.set(px, MULCH_TOP - 0.01, pz), _q, _s.set(s, s * (0.85 + r() * 0.3), s)));
        }
      }
    }
  }
  return out;
}

function bedGeometry(beds: Bed[]) {
  const soil: Placed[] = [];
  const edge: Placed[] = [];
  for (const b of beds) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    soil.push({ geo: box(w, 0.04, d), pos: [cx, MULCH_TOP - 0.02, cz] });
    // steel edging proud of the lawn by a couple of centimetres
    const h = 0.05;
    const y = MULCH_TOP + 0.012 - h / 2;
    edge.push({ geo: box(w + EDGE, h, EDGE), pos: [cx, y, b.z0] });
    edge.push({ geo: box(w + EDGE, h, EDGE), pos: [cx, y, b.z1] });
    edge.push({ geo: box(EDGE, h, d), pos: [b.x0, y, cz] });
    edge.push({ geo: box(EDGE, h, d), pos: [b.x1, y, cz] });
  }
  return { soil: merge(soil), edge: merge(edge) };
}

function CoverModels({ placed, shadows }: { placed: Map<string, THREE.Matrix4[]>; shadows: boolean }) {
  const kinds = useMemo(() => [...new Set([...placed.keys()].map((k) => k.split(":")[0] as CoverId))], [placed]);
  const gltfs = useGLTF(
    kinds.map((k) => `/assets/trees/${k}.glb`),
    false,
    true,
  );
  const meshes = useMemo(() => {
    const list: THREE.InstancedMesh[] = [];
    kinds.forEach((kind, k) => {
      const root = gltfs[k].scene;
      let src: THREE.MeshStandardMaterial | null = null;
      root.traverse((o) => {
        if (!src && (o as THREE.Mesh).isMesh) src = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      });
      const map = (src as THREE.MeshStandardMaterial | null)?.map;
      if (!map) return;
      map.anisotropy = 4;
      const mat = patch(foliageMaterial(map, false), { wipe: { side: "after", u: wipes.garden } });
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
      COVER[kind].variants.forEach((_, v) => {
        const mats = placed.get(`${kind}:${v}`);
        const node = root.getObjectByName(`v${v}`);
        if (!mats?.length || !node) return;
        const geos: THREE.BufferGeometry[] = [];
        node.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) geos.push((o as THREE.Mesh).geometry);
        });
        for (const geo of geos) {
          const im = new THREE.InstancedMesh(geo, mat, mats.length);
          mats.forEach((m, i) => im.setMatrixAt(i, m));
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          im.castShadow = shadows;
          im.receiveShadow = true;
          im.customDepthMaterial = depth;
          im.name = `cover:${kind}:${v}`;
          list.push(im);
        }
      });
    });
    return list;
  }, [gltfs, kinds, placed, shadows]);
  useEffect(
    () => () => {
      const seen = new Set<THREE.Material>();
      for (const m of meshes) {
        seen.add(m.material as THREE.Material);
        if (m.customDepthMaterial) seen.add(m.customDepthMaterial);
        m.dispose();
      }
      seen.forEach((m) => m.dispose());
    },
    [meshes],
  );
  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
}

export function Beds({ beds }: { beds: Bed[] }) {
  const tier = useDemo((s) => s.tier);
  const geo = useMemo(() => bedGeometry(beds), [beds]);
  const placed = useMemo(() => placeCover(beds, DENSITY[tier === "high" && isPhone() ? "medium" : tier]), [beds, tier]);
  const mats = useMemo(() => {
    const after = { wipe: { side: "after" as const, u: wipes.garden } };
    return {
      soil: patch(lampLit(pbr("mulch", { roughness: 1, envMapIntensity: 0.5 }), ["garden", "exterior"]), after),
      edge: patch(lampLit(solid("#2b2622", 0.5, 0.75), ["garden", "exterior"]), after),
    };
  }, []);
  useEffect(
    () => () => {
      geo.soil.dispose();
      geo.edge.dispose();
    },
    [geo],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return (
    <group name="beds">
      <mesh geometry={geo.soil} material={mats.soil} receiveShadow />
      <mesh geometry={geo.edge} material={mats.edge} receiveShadow />
      {placed.size > 0 && (
        <Suspense fallback={null}>
          <CoverModels placed={placed} shadows={tier === "high"} />
        </Suspense>
      )}
    </group>
  );
}
