"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import TREES from "@/public/assets/trees/trees.json";
import { isPhone, TIERS, textureSizeFor } from "@/lib/quality";
import { useDemo, type Tier } from "@/lib/store";
import { markShadowsDirty } from "./Atmosphere";
import { buildImpostors, FOLIAGE_LIGHT, plant, setCoverage, type PlantId, type PlantPlacement } from "./impostor";
import { lampLit } from "./lamps";

/**
 * Plants with three levels of detail, chosen per plant every frame:
 *   LOD0  real 3D tree near the camera — scanned trunk and limbs, one textured card per leaf
 *   LOD1  the same tree with a quarter of the cards, for the middle distance
 *   LOD2  the baked impostor, for the far distance and for species without a 3D model
 * Plants outside the view (and not near enough to throw a shadow into it) are skipped.
 * The 3D models are built by scripts/assets/build_trees.{py,mjs}; they share the impostors'
 * origin (footprint centre, ground at 0), so one placement list drives every LOD.
 */

type CardId = keyof typeof TREES;
const hasCards = (id: string): id is CardId => id in TREES;
const SHRUBS = /^searsia/;

/**
 * Metres to the crown centre: [LOD0, LOD1], and how many plants of a species may use each.
 * Phones use their own budget on every tier but the lowest: a small screen shows less and a
 * phone GPU affords less. The lowest tier never draws the full-detail model.
 */
type Budget = "high" | "medium" | "phone" | "low";
const RANGES: Record<Budget, { tree: [number, number]; shrub: [number, number]; cap: [number, number] }> = {
  high: { tree: [55, 150], shrub: [26, 50], cap: [16, 70] },
  medium: { tree: [40, 100], shrub: [18, 34], cap: [8, 36] },
  phone: { tree: [34, 80], shrub: [14, 26], cap: [5, 24] },
  low: { tree: [0, 60], shrub: [0, 20], cap: [0, 12] },
};
const budgetFor = (tier: Tier): Budget => (tier === "low" ? "low" : isPhone() ? "phone" : tier);
/** plants this close stay in, even out of view: their shadows fall into it */
const SHADOW_KEEP = 32;

/** Wind time: a slow sway and a faster flutter, strongest at the crown's edge. */
export const WIND = { value: 0 };

/** Leaf material: cut-out, two-sided, wind, wrap and back lighting. `vertexColors`: crown AO from the card expansion. */
export function foliageMaterial(map: THREE.Texture, vertexColors = true) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors, roughness: 0.75, metalness: 0 });
  m.envMapIntensity = 0.6;
  m.onBeforeCompile = (s) => {
    s.uniforms.uWind = WIND;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uWind;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float wSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      #else
        float wSeed = 0.0;
      #endif
      float wEdge = clamp(length(position.xz) * 0.12 + position.y * 0.03, 0.0, 1.0);
      transformed.x += (sin(uWind * 0.9 + wSeed) * 0.05 + sin(uWind * 3.1 + position.y * 1.7 + wSeed) * 0.012) * wEdge;
      transformed.z += (cos(uWind * 0.7 + wSeed) * 0.04 + sin(uWind * 2.7 + position.x * 1.9) * 0.012) * wEdge;`,
    );
    s.fragmentShader = s.fragmentShader
      // leaves are lit from their bent normal on both faces
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;")
      // keep the foliage's coverage in the smaller mips (averaged alpha falls under the cut-out)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          vec2 lTexel = vMapUv * vec2(textureSize(map, 0));
          vec2 ldx = dFdx(lTexel), ldy = dFdy(lTexel);
          float lMip = 0.5 * log2(max(max(dot(ldx, ldx), dot(ldy, ldy)), 1e-6));
          diffuseColor.a *= 1.0 + max(0.0, lMip) * 0.28;
        #endif`,
      )
      .replace("#include <lights_physical_pars_fragment>", FOLIAGE_LIGHT)
      // leaves right at the lens dissolve (dithered) instead of filling the frame with blur
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        {
          vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
          float bayer = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
          if (bayer > smoothstep(1.2, 4.0, length(vViewPosition))) discard;
        }`,
      );
  };
  m.customProgramCacheKey = () => `vb-cardleaf${vertexColors ? "" : "-nc"}`;
  // garden uplights reach into the crowns after dark
  return lampLit(m, ["garden"]);
}

function leafDepth(map: THREE.Texture) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
}

interface CardsMeta {
  materials: Array<{ name: string; texture: string }>;
  lod0: Array<[number, number]>;
  lod1: Array<[number, number]>;
  box: [number[], number[]];
  axis: number;
  uv: [number[], number[]];
  crown: { center: number[]; half: number[]; ao: number };
}

/**
 * Leaf cards arrive compact (build_trees.py): per card a quantised centre, two half-axes and a
 * UV rectangle, 26 bytes. Here they become geometry: four corners, the leaf picture's UVs,
 * normals bent toward the outside of the crown, and a vertex shade that darkens its inside.
 */
function expandCards(buf: ArrayBuffer, meta: CardsMeta) {
  const [lo, hi] = meta.box;
  const [ulo, uhi] = meta.uv;
  const { center, half, ao: aoK } = meta.crown;
  const out: Record<"lod0" | "lod1", Array<{ slot: number; geo: THREE.BufferGeometry }>> = { lod0: [], lod1: [] };
  let off = 0;
  const n = new THREE.Vector3();
  const r = new THREE.Vector3();
  const SX = [-1, 1, 1, -1];
  const SY = [-1, -1, 1, 1];
  const q = (v: number, a: number, b: number) => a + (v / 65535) * (b - a);
  const k = meta.axis / 32767;
  for (const lod of ["lod0", "lod1"] as const) {
    for (const [slot, m] of meta[lod]) {
      const C = new Uint16Array(buf, off, m * 3);
      off += m * 6;
      const A = new Int16Array(buf, off, m * 6);
      off += m * 12;
      const U = new Uint16Array(buf, off, m * 4);
      off += m * 8;
      const pos = new Float32Array(m * 12);
      const nor = new Float32Array(m * 12);
      const col = new Float32Array(m * 12);
      const uv = new Float32Array(m * 8);
      const idx = new Uint32Array(m * 6);
      for (let i = 0; i < m; i++) {
        const cx = q(C[i * 3], lo[0], hi[0]);
        const cy = q(C[i * 3 + 1], lo[1], hi[1]);
        const cz = q(C[i * 3 + 2], lo[2], hi[2]);
        const ux = A[i * 6] * k;
        const uy = A[i * 6 + 1] * k;
        const uz = A[i * 6 + 2] * k;
        const vx = A[i * 6 + 3] * k;
        const vy = A[i * 6 + 4] * k;
        const vz = A[i * 6 + 5] * k;
        const cu = [q(U[i * 4], ulo[0], uhi[0]), q(U[i * 4 + 2], ulo[0], uhi[0])];
        const cv = [q(U[i * 4 + 1], ulo[1], uhi[1]), q(U[i * 4 + 3], ulo[1], uhi[1])];
        // card normal, turned to face out of the crown
        n.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize();
        r.set((cx - center[0]) / half[0], (cy - center[1]) / half[1], (cz - center[2]) / half[2]).normalize();
        if (n.dot(r) < 0) n.negate();
        for (let c = 0; c < 4; c++) {
          const px = cx + ux * SX[c] + vx * SY[c];
          const py = cy + uy * SX[c] + vy * SY[c];
          const pz = cz + uz * SX[c] + vz * SY[c];
          const o = (i * 4 + c) * 3;
          pos[o] = px;
          pos[o + 1] = py;
          pos[o + 2] = pz;
          const ex = (px - center[0]) / half[0];
          const ey = (py - center[1]) / half[1];
          const ez = (pz - center[2]) / half[2];
          const depth = Math.hypot(ex, ey, ez);
          r.set(ex, ey, ez).normalize();
          const bx = 0.35 * n.x + 0.65 * r.x;
          const by = 0.35 * n.y + 0.65 * r.y;
          const bz = 0.35 * n.z + 0.65 * r.z;
          const bl = Math.hypot(bx, by, bz) || 1;
          nor[o] = bx / bl;
          nor[o + 1] = by / bl;
          nor[o + 2] = bz / bl;
          const shade = 1 - aoK * (1 - Math.min(1, Math.max(0, (depth - 0.25) / 0.75)));
          col[o] = col[o + 1] = col[o + 2] = shade;
          uv[(i * 4 + c) * 2] = cu[SX[c] < 0 ? 0 : 1];
          uv[(i * 4 + c) * 2 + 1] = cv[SY[c] < 0 ? 0 : 1];
        }
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      out[lod].push({ slot, geo });
    }
  }
  return out;
}

interface Part {
  mesh: THREE.InstancedMesh;
  leaf: boolean;
}
interface Species {
  id: string;
  list: PlantPlacement[];
  mats: THREE.Matrix4[];
  centers: THREE.Vector3[];
  radius: number[];
  tone: THREE.Color[];
  imp: THREE.InstancedMesh;
  lod: [Part[], Part[]] | null;
  shrub: boolean;
  sig: string;
}

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function makeSpecies(id: string, list: PlantPlacement[], sharp: boolean, shadows: boolean): Species {
  const rec = plant(id as PlantId);
  const mats: THREE.Matrix4[] = [];
  const centers: THREE.Vector3[] = [];
  const radius: number[] = [];
  const tone: THREE.Color[] = [];
  list.forEach((pl, i) => {
    const s = pl.height / rec.height;
    _q.setFromAxisAngle(_up, pl.yaw ?? (i * 2.399) % (Math.PI * 2));
    mats.push(new THREE.Matrix4().compose(_p.set(pl.x, pl.y ?? 0, pl.z), _q, _s.set(s, s, s)));
    centers.push(new THREE.Vector3(pl.x, (pl.y ?? 0) + rec.center[1] * s, pl.z));
    radius.push(rec.radius * s);
    const t = pl.tone ?? 0;
    tone.push(new THREE.Color().setRGB(1 + t * 0.6, 1 + t * 0.3, 1 - t * 0.2));
  });
  const imp = buildImpostors(id as PlantId, list, sharp);
  imp.frustumCulled = false;
  // every plant of the species, whatever its current LOD: the flight planner avoids their crowns
  imp.userData.placements = mats;
  imp.castShadow = shadows;
  return { id, list, mats, centers, radius, tone, imp, lod: null, shrub: SHRUBS.test(id), sig: "" };
}

/** The 3D models for the species in this field; registers instanced parts once loaded. */
function CardModels({ field, shadows, px }: { field: Species[]; shadows: boolean; px: 512 | 1024 }) {
  const ids = field.filter((f) => hasCards(f.id)).map((f) => f.id as CardId);
  const metas = ids.map((id) => (TREES[id] as unknown as { cards?: CardsMeta | null }).cards ?? null);
  const gltfs = useGLTF(
    ids.map((id) => `/assets/trees/${id}.glb`),
    false,
    true,
  );
  const bins = useLoader(
    THREE.FileLoader,
    ids.map((id) => `/assets/trees/${id}.cards.bin`),
    (l) => void (l as THREE.FileLoader).setResponseType("arraybuffer"),
  ) as unknown as ArrayBuffer[];
  const texUrls = metas.flatMap((m) => (m ? m.materials.map((t) => `/assets/trees/${t.texture}_${px}.webp`) : []));
  const leafMaps = useLoader(THREE.TextureLoader, texUrls);
  const built = useMemo(() => {
    const out: Array<{ sp: Species; lod: [Part[], Part[]] }> = [];
    let t = 0;
    ids.forEach((id, k) => {
      const sp = field.find((f) => f.id === id)!;
      const meta = metas[k];
      const leafMats = (meta?.materials ?? []).map(() => {
        const map = leafMaps[t++];
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false; // glTF UV convention, like the scans
        map.anisotropy = 4;
        map.needsUpdate = true;
        return { mat: foliageMaterial(map), depth: leafDepth(map) };
      });
      const cards = meta ? expandCards(bins[k], meta) : null;
      const lod: [Part[], Part[]] = [[], []];
      (["lod0", "lod1"] as const).forEach((name, level) => {
        const add = (geometry: THREE.BufferGeometry, material: THREE.Material, leaf: boolean, depth?: THREE.Material) => {
          const mesh = new THREE.InstancedMesh(geometry, material, sp.list.length);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = shadows;
          mesh.receiveShadow = true;
          if (depth) mesh.customDepthMaterial = depth;
          if (leaf) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
          mesh.name = `trees:${id}:${name}:${lod[level].length}`;
          lod[level].push({ mesh, leaf });
        };
        gltfs[k].scene.getObjectByName(name)?.traverse((o) => {
          const src = o as THREE.Mesh;
          if (src.isMesh) add(src.geometry, src.material as THREE.Material, false);
        });
        for (const { slot, geo } of cards?.[name] ?? []) add(geo, leafMats[slot].mat, true, leafMats[slot].depth);
      });
      out.push({ sp, lod });
    });
    return out;
  }, [gltfs, bins, leafMaps, field]); // eslint-disable-line react-hooks/exhaustive-deps -- ids and metas derive from field

  useEffect(() => {
    for (const { sp, lod } of built) {
      sp.lod = lod;
      sp.sig = ""; // re-assign next frame
    }
    return () => {
      for (const { sp, lod } of built) {
        if (sp.lod === lod) sp.lod = null;
        for (const p of [...lod[0], ...lod[1]]) {
          if (p.leaf) {
            p.mesh.geometry.dispose();
            (p.mesh.material as THREE.Material).dispose();
            p.mesh.customDepthMaterial?.dispose();
          }
          p.mesh.dispose();
        }
      }
    };
  }, [built]);

  return (
    <>
      {built.flatMap(({ lod }) => [...lod[0], ...lod[1]].map((p) => <primitive key={p.mesh.uuid} object={p.mesh} />))}
    </>
  );
}

const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

/**
 * One planting plan, drawn at the right level of detail for where the camera is.
 * `cards: false` keeps the field on impostors only (the distant woodland).
 */
export function PlantField({ plants, shadows = true, cards = true }: { plants: Record<string, PlantPlacement[]>; shadows?: boolean; cards?: boolean }) {
  const tier = useDemo((s) => s.tier);
  // phones reveal on the impostors and swap the 3D models in once the property is on screen
  const revealed = useDemo((s) => s.sceneReady && s.phase !== "loading");
  const eager = useMemo(() => !isPhone(), []);
  const sharp = textureSizeFor(tier) === 1024;
  const msaa = TIERS[tier].msaa > 0;
  const { camera } = useThree();
  const field = useMemo(
    () =>
      Object.entries(plants)
        .filter(([, l]) => l.length)
        .map(([id, l]) => makeSpecies(id, l, sharp, shadows)),
    [plants, sharp, shadows],
  );
  useEffect(() => setCoverage(field.map((f) => f.imp), msaa), [field, msaa]);
  useEffect(
    () => () =>
      field.forEach((f) => {
        f.imp.geometry.dispose();
        (f.imp.material as THREE.Material).dispose();
        f.imp.customDepthMaterial?.dispose();
      }),
    [field],
  );

  const buf = useRef({ a: [] as number[], b: [] as number[], c: [] as number[], near: [] as number[], dist: [] as number[] });
  useFrame((_, dt) => {
    if (!useDemo.getState().reducedMotion) WIND.value += Math.min(dt, 0.1);
    const R = RANGES[budgetFor(tier)];
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cp = camera.position;
    let changed = false;
    for (const sp of field) {
      const [n0, n1] = sp.shrub ? R.shrub : R.tree;
      const { a, b, c, near, dist } = buf.current;
      a.length = b.length = c.length = near.length = 0;
      const models = cards && sp.lod;
      for (let i = 0; i < sp.list.length; i++) {
        const d = cp.distanceTo(sp.centers[i]);
        _sphere.set(sp.centers[i], sp.radius[i] * 1.2);
        if (d > SHADOW_KEEP && !_frustum.intersectsSphere(_sphere)) continue;
        dist[i] = d;
        near.push(i);
      }
      // nearest first, so the detail budget goes to the plants that fill the frame
      if (models) near.sort((i, j) => dist[i] - dist[j]);
      for (const i of near) {
        const d = dist[i];
        if (models && d < n0 && a.length < R.cap[0]) a.push(i);
        else if (models && d < n1 && b.length < R.cap[1]) b.push(i);
        else c.push(i);
      }
      const sig = `${a.join(",")}|${b.join(",")}|${c.join(",")}`;
      if (sig === sp.sig) continue;
      sp.sig = sig;
      changed = true;
      const write = (mesh: THREE.InstancedMesh, idx: number[], colours: boolean) => {
        idx.forEach((i, j) => {
          mesh.setMatrixAt(j, sp.mats[i]);
          if (colours) mesh.setColorAt(j, sp.tone[i]);
        });
        mesh.count = idx.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (colours && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };
      if (models && sp.lod) {
        for (const p of sp.lod[0]) write(p.mesh, a, p.leaf);
        for (const p of sp.lod[1]) write(p.mesh, b, p.leaf);
      }
      write(sp.imp, c, true);
    }
    if (changed) markShadowsDirty(2);
  });

  return (
    <group>
      {field.map((f) => (
        <primitive key={f.imp.uuid} object={f.imp} />
      ))}
      {cards && (eager || revealed) && field.some((f) => hasCards(f.id)) && (
        <Suspense fallback={null}>
          <CardModels field={field} shadows={shadows} px={sharp ? 1024 : 512} />
        </Suspense>
      )}
    </group>
  );
}
