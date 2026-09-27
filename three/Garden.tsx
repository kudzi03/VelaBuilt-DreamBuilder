"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GARDEN as G, MAIN, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { markShadowsDirty } from "./Atmosphere";
import { blob, box, merge, type Placed } from "./geom";
import { concrete, glowTexture, lawn, limestone, patchyYard, plaster, poolTile, rng, waterNormals } from "./proc";
import { channels, lazyCache, patch, U, wipes } from "./shared";
import { buildTrees, type TreeSpec } from "./Site";
import { photo } from "./textures";

// The garden is not part of the building: it never takes the section cut.
const AFTER = { wipe: { side: "after" as const, u: wipes.garden } };
const BEFORE = { wipe: { side: "before" as const, u: wipes.garden } };
const P = G.patio;
const PG = G.pergola;
const PL = G.pool;
const POOL_DEPTH = 1.3;
const WATER_Y = -0.1;

function groundGeometry(withPool: boolean) {
  const s = new THREE.Shape();
  s.moveTo(G.x0, -G.z1);
  s.lineTo(G.x1, -G.z1);
  s.lineTo(G.x1, -G.z0);
  s.lineTo(G.x0, -G.z0);
  s.closePath();
  if (withPool) {
    const h = new THREE.Path();
    h.moveTo(PL.x0, -PL.z1);
    h.lineTo(PL.x0, -PL.z0);
    h.lineTo(PL.x1, -PL.z0);
    h.lineTo(PL.x1, -PL.z1);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function poolShell(): Placed[] {
  const w = PL.x1 - PL.x0;
  const l = PL.z1 - PL.z0;
  const cx = (PL.x0 + PL.x1) / 2;
  const cz = (PL.z0 + PL.z1) / 2;
  const t = 0.05;
  return [
    { geo: box(w, t, l), pos: [cx, -POOL_DEPTH, cz] },
    { geo: box(t, POOL_DEPTH, l), pos: [PL.x0 + t / 2, -POOL_DEPTH / 2, cz] },
    { geo: box(t, POOL_DEPTH, l), pos: [PL.x1 - t / 2, -POOL_DEPTH / 2, cz] },
    { geo: box(w, POOL_DEPTH, t), pos: [cx, -POOL_DEPTH / 2, PL.z0 + t / 2] },
    { geo: box(w, POOL_DEPTH, t), pos: [cx, -POOL_DEPTH / 2, PL.z1 - t / 2] },
  ];
}

function coping(): Placed[] {
  const w = PL.x1 - PL.x0;
  const l = PL.z1 - PL.z0;
  const cx = (PL.x0 + PL.x1) / 2;
  const cz = (PL.z0 + PL.z1) / 2;
  const c = 0.34;
  const h = 0.06;
  return [
    { geo: box(w + 2 * c, h, c), pos: [cx, h / 2, PL.z0 - c / 2] },
    { geo: box(w + 2 * c, h, c), pos: [cx, h / 2, PL.z1 + c / 2] },
    { geo: box(c, h, l), pos: [PL.x0 - c / 2, h / 2, cz] },
    { geo: box(c, h, l), pos: [PL.x1 + c / 2, h / 2, cz] },
  ];
}

function pergola(): { frame: Placed[]; bulbs: THREE.Vector3[] } {
  const frame: Placed[] = [];
  const s = 0.12;
  const h = PG.h;
  for (const x of [PG.x0, PG.x1]) for (const z of [PG.z0, PG.z1]) frame.push({ geo: box(s, h, s), pos: [x, h / 2, z] });
  for (const x of [PG.x0, PG.x1]) frame.push({ geo: box(0.1, 0.24, PG.z1 - PG.z0 + 0.5), pos: [x, h - 0.12, (PG.z0 + PG.z1) / 2] });
  for (const z of [PG.z0, PG.z1]) frame.push({ geo: box(PG.x1 - PG.x0 + 0.3, 0.2, 0.1), pos: [(PG.x0 + PG.x1) / 2, h - 0.1, z] });
  for (let z = PG.z0 + 0.25; z < PG.z1 - 0.1; z += 0.32) frame.push({ geo: box(PG.x1 - PG.x0 + 0.4, 0.16, 0.05), pos: [(PG.x0 + PG.x1) / 2, h + 0.06, z] });
  // festoon lights: three catenaries across
  const bulbs: THREE.Vector3[] = [];
  for (const z of [PG.z0 + 0.8, (PG.z0 + PG.z1) / 2, PG.z1 - 0.8]) {
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = PG.x0 + 0.1 + f * (PG.x1 - PG.x0 - 0.2);
      bulbs.push(new THREE.Vector3(x, h - 0.28 - Math.sin(f * Math.PI) * 0.32, z));
    }
  }
  return { frame, bulbs };
}

function furniture(): { fabric: Placed[]; dark: Placed[]; wood: Placed[] } {
  const cx = (PG.x0 + PG.x1) / 2;
  const cz = (PG.z0 + PG.z1) / 2;
  const fabric: Placed[] = [
    // L sofa
    { geo: box(2.4, 0.42, 0.85), pos: [cx - 0.2, 0.21 + 0.05, PG.z0 + 0.75] },
    { geo: box(2.4, 0.4, 0.2), pos: [cx - 0.2, 0.55, PG.z0 + 0.42] },
    { geo: box(0.85, 0.42, 1.6), pos: [PG.x0 + 0.75, 0.26, PG.z0 + 1.95] },
    { geo: box(0.2, 0.4, 1.6), pos: [PG.x0 + 0.42, 0.55, PG.z0 + 1.95] },
    // lounge chairs
    { geo: box(0.8, 0.4, 0.8), pos: [cx + 1.4, 0.25, cz + 1.2] },
    { geo: box(0.8, 0.4, 0.8), pos: [cx + 1.4, 0.25, cz + 0.2] },
  ];
  const dark: Placed[] = [{ geo: box(1.1, 0.36, 0.7), pos: [cx - 0.1, 0.18 + 0.05, cz + 0.4] }];
  // pool loungers
  const wood: Placed[] = [];
  for (const z of [PL.z0 + 2.4, PL.z0 + 4]) {
    wood.push({ geo: box(0.7, 0.28, 1.9), pos: [PL.x1 + 1.05, 0.14, z] });
    wood.push({ geo: box(0.7, 0.12, 0.7), pos: [PL.x1 + 1.05, 0.42, z - 0.7], rot: [-0.55, 0, 0] });
  }
  return { fabric, dark, wood };
}

interface Plant {
  x: number;
  z: number;
  r: number;
  kind: "shrub" | "grass" | "perennial";
  lush: boolean;
}

function plants(): Plant[] {
  const r = rng(12);
  const out: Plant[] = [];
  const bed = (x0: number, z0: number, x1: number, z1: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * f + (r() - 0.5) * 0.5;
      const z = z0 + (z1 - z0) * f + (r() - 0.5) * 0.5;
      const k = r();
      out.push({ x, z, r: 0.35 + r() * 0.35, kind: k < 0.45 ? "shrub" : k < 0.8 ? "grass" : "perennial", lush: i % 3 !== 0 });
    }
  };
  bed(G.x0 + 0.8, G.z0 + 0.9, G.x1 - 1.2, G.z0 + 0.9, 18); // back wall
  bed(G.x0 + 0.85, G.z0 + 2, G.x0 + 0.85, G.z1 - 1.8, 13); // west wall
  bed(P.x0 - 0.5, P.z0 - 0.4, P.x0 - 0.5, P.z0 - 0.4, 1);
  for (const [x, z] of [
    [PG.x0 - 0.45, PG.z1 + 0.5],
    [PG.x0 - 0.45, PG.z0 - 0.5],
    [P.x0 + 0.4, P.z1 - 0.5],
  ])
    out.push({ x, z, r: 0.5, kind: "shrub", lush: false });
  return out;
}

const SHRUB = ["#6f7f55", "#5f7249", "#7d8b5f", "#8a9468"].map((c) => new THREE.Color(c));
const PERENNIAL = ["#8e7aa0", "#b7a0c4", "#c9b27a", "#9aa874"].map((c) => new THREE.Color(c));
const GRASS = new THREE.Color("#b3aa7a");

function plantGeometry(list: Plant[]): THREE.BufferGeometry {
  const r = rng(5);
  const parts: THREE.BufferGeometry[] = [];
  list.forEach((p, i) => {
    let g: THREE.BufferGeometry;
    let col: THREE.Color;
    if (p.kind === "grass") {
      g = new THREE.ConeGeometry(p.r * 0.75, p.r * 2.1, 7, 1, true);
      g.translate(p.x, p.r * 1.05, p.z);
      col = GRASS.clone().multiplyScalar(0.9 + r() * 0.2);
    } else if (p.kind === "perennial") {
      g = blob(p.r * 0.8, i + 3, 2, 0.6, 0.12);
      g.translate(p.x, p.r * 0.45, p.z);
      col = PERENNIAL[i % PERENNIAL.length].clone();
    } else {
      g = blob(p.r, i + 11, 2, 0.8, 0.1);
      g.translate(p.x, p.r * 0.7, p.z);
      col = SHRUB[i % SHRUB.length].clone();
    }
    const nonIdx = g.index ? g.toNonIndexed() : g;
    const count = nonIdx.attributes.position.count;
    const c = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      const y = nonIdx.attributes.position.getY(k);
      const shade = 0.7 + 0.3 * Math.min(1, y / (p.r * 1.4));
      c[k * 3] = col.r * shade;
      c[k * 3 + 1] = col.g * shade;
      c[k * 3 + 2] = col.b * shade;
    }
    nonIdx.setAttribute("color", new THREE.BufferAttribute(c, 3));
    if (nonIdx.attributes.uv) nonIdx.deleteAttribute("uv");
    parts.push(nonIdx);
  });
  const P3: number[] = [];
  const N3: number[] = [];
  const C3: number[] = [];
  for (const g of parts) {
    P3.push(...(g.attributes.position.array as Float32Array));
    N3.push(...(g.attributes.normal.array as Float32Array));
    C3.push(...(g.attributes.color.array as Float32Array));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P3, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(N3, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(C3, 3));
  return out;
}

const CORE_TREES: TreeSpec[] = [
  { x: -12.8, z: -15.7, kind: "column", s: 1.05 },
  { x: -9.6, z: -15.8, kind: "column", s: 1.15 },
  { x: -6.4, z: -15.7, kind: "column", s: 1 },
];
const LUSH_TREES: TreeSpec[] = [
  { x: -3.2, z: -14.9, kind: "multi", s: 1.05 },
  { x: -13.3, z: -15.3, kind: "round", s: 0.8 },
];

const STONES: Array<[number, number]> = [
  [-7.2, -5.4],
  [-8.1, -5.3],
  [-9.0, -5.45],
  [-9.9, -5.35],
  [-10.8, -5.45],
  [-11.7, -5.35],
  [-12.6, -5.45],
];

export function Garden() {
  const c = useDemo((s) => s.landscaping);
  const compare = useDemo((s) => s.compare);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const tier = useDemo((s) => s.tier);
  const beforeOn = compare && industry === "landscaping" && phase === "explore";
  // the kitchen cutaway is viewed through where the pergola stands
  const showPergola = c.pergola && !(industry === "remodeling" && phase !== "reveal" && phase !== "intro");
  const lights = useRef<THREE.Group>(null);
  const pointLight = useRef<THREE.PointLight>(null);

  useEffect(() => markShadowsDirty(4), [c.surface, c.pergola, c.pool, c.planting, industry]);

  const geo = useMemo(() => {
    const pg = pergola();
    const fu = furniture();
    const pl = plants();
    const trees = buildTrees(CORE_TREES, 21);
    const lushTrees = buildTrees(LUSH_TREES, 23);
    const deck = box(P.x1 - P.x0, 0.18, P.z1 - P.z0);
    deck.translate((P.x0 + P.x1) / 2, 0.09, (P.z0 + P.z1) / 2);
    const stone = box(P.x1 - P.x0, 0.05, P.z1 - P.z0);
    stone.translate((P.x0 + P.x1) / 2, 0.025, (P.z0 + P.z1) / 2);
    const water = new THREE.PlaneGeometry(PL.x1 - PL.x0, PL.z1 - PL.z0);
    water.rotateX(-Math.PI / 2);
    water.translate((PL.x0 + PL.x1) / 2, WATER_Y, (PL.z0 + PL.z1) / 2);
    const wu = water.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < wu.count; i++) wu.setXY(i, wu.getX(i) * (PL.x1 - PL.x0), wu.getY(i) * (PL.z1 - PL.z0));
    const walls: Placed[] = [
      { geo: box(0.25, G.wallH, G.z1 - G.z0 + 0.25), pos: [G.x0 - 0.125, G.wallH / 2, (G.z0 + G.z1) / 2] },
      { geo: box(G.x1 - G.x0 + 7.25, G.wallH, 0.25), pos: [(G.x0 + G.x1 + 7) / 2, G.wallH / 2, G.z0 - 0.125] },
      { geo: box(0.32, 0.06, G.z1 - G.z0 + 0.3), pos: [G.x0 - 0.125, G.wallH + 0.03, (G.z0 + G.z1) / 2] },
      { geo: box(G.x1 - G.x0 + 7.3, 0.06, 0.32), pos: [(G.x0 + G.x1 + 7) / 2, G.wallH + 0.03, G.z0 - 0.125] },
    ];
    const bollards: Placed[] = [];
    const pools: THREE.Vector3[] = [];
    STONES.forEach(([x, z], i) => {
      if (i % 2 === 0) {
        bollards.push({ geo: new THREE.CylinderGeometry(0.045, 0.05, 0.55, 10), pos: [x, 0.275, z + 0.75] });
        pools.push(new THREE.Vector3(x, 0.02, z + 0.75));
      }
    });
    for (const t of CORE_TREES) pools.push(new THREE.Vector3(t.x, 0.02, t.z + 0.6));
    const bollardTops: Placed[] = bollards.map((b) => ({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), pos: [b.pos![0], 0.52, b.pos![2]] }));
    return {
      lawnPool: groundGeometry(true),
      lawnFull: groundGeometry(false),
      deck,
      stone,
      water,
      shell: merge(poolShell()),
      coping: merge(coping()),
      pergola: merge(pg.frame),
      bulbs: pg.bulbs,
      fabric: merge(fu.fabric),
      dark: merge(fu.dark),
      wood: merge(fu.wood),
      plantsCore: plantGeometry(pl.filter((p) => !p.lush)),
      plantsLush: plantGeometry(pl.filter((p) => p.lush)),
      trees,
      lushTrees,
      walls: merge(walls),
      stones: merge(STONES.map(([x, z]) => ({ geo: box(0.62, 0.05, 0.42), pos: [x, 0.025, z] }))),
      slab: (() => {
        const g = box(3.2, 0.1, 3.0);
        g.translate(-2.6, 0.05, -7.4);
        return g;
      })(),
      bollards: merge(bollards),
      bollardTops: merge(bollardTops),
      pools,
    };
  }, []);

  const lazy = useMemo(() => lazyCache<THREE.Material>(), []);
  const mats = useMemo(() => {
    const lw = lawn();
    const pl = plaster();
    const cc = concrete(0, "#d6d0c4", 2, 8);
    const wn = waterNormals();
    const pt = poolTile();
    const deckMap = photo("wood_floor_deck");
    const deckN = photo("wood_floor_deck", "nor");
    const ls = limestone();
    const s = (p: THREE.MeshStandardMaterialParameters, o: Parameters<typeof patch>[1] = AFTER) => patch(new THREE.MeshStandardMaterial(p), o);
    const glow = glowTexture();
    return {
      lawn: s({ map: lw.map, normalMap: lw.normalMap, roughness: 0.97 }),
      before: () => lazy.get("before", () => s({ map: patchyYard().map, roughness: 1 }, BEFORE)),
      beforeSlab: () =>
        lazy.get("beforeSlab", () => {
          const old = concrete(1.5, "#aaa398", 3, 9);
          return s({ map: old.map, normalMap: old.normalMap, roughness: 0.95 }, BEFORE);
        }),
      deck: s({ map: deckMap, normalMap: deckN, roughness: 0.62, color: "#c7b6a3" }),
      stone: s({ map: ls.map, normalMap: ls.normalMap, roughness: 0.82 }),
      water: patch(
        new THREE.MeshStandardMaterial({ color: "#1d86a8", roughness: 0.05, metalness: 0.05, normalMap: wn.map, normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: 0.72, envMapIntensity: 0.7, emissive: new THREE.Color("#2bb3d6"), emissiveIntensity: 0 }),
        AFTER,
      ),
      shell: s({ map: pt.map, roughness: 0.3, emissive: new THREE.Color("#5fd0e6"), emissiveIntensity: 0 }),
      coping: s({ map: cc.map, normalMap: cc.normalMap, roughness: 0.85 }),
      steel: s({ color: "#1e1f22", roughness: 0.5, metalness: 0.5 }),
      fabric: s({ color: "#e4ddcf", roughness: 0.95 }),
      dark: s({ color: "#3b3834", roughness: 0.7 }),
      wood: s({ color: "#efece5", roughness: 0.85 }),
      plants: s({ vertexColors: true, roughness: 0.95 }),
      canopy: s({ vertexColors: true, roughness: 0.96 }),
      trunk: s({ color: "#5d4c3f", roughness: 0.95 }),
      walls: new THREE.MeshStandardMaterial({ map: pl.map, normalMap: pl.normalMap, roughness: 0.92 }),
      stones: s({ map: cc.map, roughness: 0.9, color: "#e7e1d6" }),
      bollard: s({ color: "#232326", roughness: 0.5, metalness: 0.4 }),
      bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd89c").multiplyScalar(4), toneMapped: true }),
      pool: new THREE.MeshBasicMaterial({ map: glow, color: "#ffc98a", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
  }, []);
  useEffect(
    () => () => {
      lazy.dispose();
      Object.values(mats).forEach((m) => m instanceof THREE.Material && m.dispose());
    },
    [lazy, mats],
  );

  const bulbsRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const im = bulbsRef.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    geo.bulbs.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    im.instanceMatrix.needsUpdate = true;
  }, [geo]);

  useFrame((_, dt) => {
    const d = channels.dusk;
    const lit = c.evening ? d : 0;
    const water = mats.water.normalMap!;
    water.offset.x = (U.time.value * 0.02) % 1;
    water.offset.y = (U.time.value * 0.013) % 1;
    mats.water.emissiveIntensity = 0.05 + lit * 0.9;
    mats.shell.emissiveIntensity = lit * 0.9;
    mats.bollard.emissiveIntensity = 0;
    mats.pool.opacity += ((c.evening ? d * 0.75 : 0) - mats.pool.opacity) * Math.min(1, dt * 6);
    if (lights.current) lights.current.visible = lit > 0.01;
    if (pointLight.current) pointLight.current.intensity = c.pergola ? lit * 9 : 0;
  });

  const surfaceMesh = c.surface === "deck" ? geo.deck : c.surface === "stone" ? geo.stone : null;
  const lush = c.planting === "lush";
  const sh = { castShadow: true, receiveShadow: true };

  return (
    <group name="garden">
      <mesh geometry={c.pool ? geo.lawnPool : geo.lawnFull} material={mats.lawn} receiveShadow />
      <mesh geometry={geo.walls} material={mats.walls} {...sh} />
      {surfaceMesh && <mesh geometry={surfaceMesh} material={c.surface === "deck" ? mats.deck : mats.stone} {...sh} />}
      {c.pool && (
        <>
          <mesh geometry={geo.shell} material={mats.shell} receiveShadow />
          <mesh geometry={geo.water} material={mats.water} receiveShadow renderOrder={2} />
          <mesh geometry={geo.coping} material={mats.coping} {...sh} />
          <mesh geometry={geo.wood} material={mats.wood} {...sh} />
        </>
      )}
      {showPergola && (
        <>
          <mesh geometry={geo.pergola} material={mats.steel} {...sh} />
          <mesh geometry={geo.fabric} material={mats.fabric} {...sh} />
          <mesh geometry={geo.dark} material={mats.dark} {...sh} />
        </>
      )}
      <mesh geometry={geo.plantsCore} material={mats.plants} {...sh} />
      {lush && <mesh geometry={geo.plantsLush} material={mats.plants} {...sh} />}
      <mesh geometry={geo.trees.canopy} material={mats.canopy} {...sh} />
      <mesh geometry={geo.trees.trunks} material={mats.trunk} castShadow />
      {lush && (
        <>
          <mesh geometry={geo.lushTrees.canopy} material={mats.canopy} {...sh} />
          <mesh geometry={geo.lushTrees.trunks} material={mats.trunk} castShadow />
        </>
      )}
      <mesh geometry={geo.stones} material={mats.stones} receiveShadow />
      <mesh geometry={geo.bollards} material={mats.bollard} castShadow />

      {/* evening lighting design */}
      <group ref={lights} visible={false}>
        <mesh geometry={geo.bollardTops} material={mats.bulb} />
        {showPergola && <instancedMesh ref={bulbsRef} args={[undefined, mats.bulb, geo.bulbs.length]} frustumCulled={false}>
          <sphereGeometry args={[0.035, 8, 6]} />
        </instancedMesh>}
        {geo.pools.map((p, i) => (
          <mesh key={i} position={p} rotation-x={-Math.PI / 2} material={mats.pool} renderOrder={3}>
            <planeGeometry args={[2.6, 2.6]} />
          </mesh>
        ))}
      </group>
      {/* always mounted (intensity 0 by day) so toggling lights never changes the light count */}
      {tier !== "low" && <pointLight ref={pointLight} position={[(PG.x0 + PG.x1) / 2, PG.h - 0.5, (PG.z0 + PG.z1) / 2]} color="#ffc27a" distance={9} decay={1.6} intensity={0} />}

      {beforeOn && (
        <>
          <mesh geometry={geo.lawnFull} material={mats.before()} position-y={0.004} />
          <mesh geometry={geo.slab} material={mats.beforeSlab()} />
        </>
      )}
    </group>
  );
}

export const GARDEN_EXTENT = { x0: G.x0, x1: WING.x0, z0: G.z0, z1: MAIN.z0 };
