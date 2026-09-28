"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GARDEN as G, MAIN, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { markShadowsDirty, SKY_GLSL, SKY_UNIFORMS } from "./Atmosphere";
import { box, merge, rbox, type Placed } from "./geom";
import { type PlantPlacement } from "./impostor";
import { PlantField } from "./plantfield";
import { lampLit, registerLamps, unregisterLamps, updateLampViewPositions, type Lamp } from "./lamps";
import { sharedGround } from "./Landscape";
import { pbr, solid } from "./materials";
import { rng } from "./proc";
import { channels, lazyCache, patch, U, wipes } from "./shared";

/**
 * The garden behind the kitchen wing: limestone terrace off the glass wall, a steel and
 * cedar pergola with outdoor seating, a 4 × 8 m pool with travertine coping, planted beds
 * of photoscanned shrubs and a feature tree — and after dark, lit: pool, path, uplights.
 * "Before" is a tired lawn and a cracked slab, shown with the before/after wipe.
 */

const AFTER = { wipe: { side: "after" as const, u: wipes.garden } };
const BEFORE = { wipe: { side: "before" as const, u: wipes.garden } };
const P = G.patio;
const PG = G.pergola;
const PL = G.pool;
const POOL_DEPTH = 1.35;
const WATER_Y = -0.12;
const COPE = 0.4;

const GARDEN_LAMPS: Lamp[] = [
  // pool light, low in the water at the house end
  { pos: [(PL.x0 + PL.x1) / 2, -0.9, (PL.z0 + PL.z1) / 2 + 1.5], color: "#a6ecf7", power: 5.5, range: 7, group: "garden" },
  // pergola: warm downlight over the seating
  { pos: [(PG.x0 + PG.x1) / 2, PG.h - 0.35, (PG.z0 + PG.z1) / 2], color: "#ffbd78", power: 10, range: 6, group: "garden" },
  // path bollards
  { pos: [-7.2, 0.45, -5.4], color: "#ffc27f", power: 3, range: 2.4, group: "garden" },
  { pos: [-10.3, 0.45, -5.4], color: "#ffc27f", power: 3, range: 2.4, group: "garden" },
  // uplights at the feet of the planting: warm cones up into the crowns
  { pos: [-13.6, 0.25, -5.2], color: "#ffc98a", power: 12, range: 5.5, group: "garden", cone: { dir: [0.1, 1, 0], inner: 20, outer: 48 } },
  { pos: [-2.9, 0.25, -17.5], color: "#ffcc90", power: 30, range: 7.5, group: "garden", cone: { dir: [0.05, 1, -0.08], inner: 18, outer: 42 } },
];

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
    // entry steps at the house end
    { geo: box(w - 0.1, 0.3, 0.45), pos: [cx, -0.3, PL.z1 - 0.28] },
    { geo: box(w - 0.1, 0.3, 0.45), pos: [cx, -0.6, PL.z1 - 0.73] },
  ];
}

function coping(): Placed[] {
  const w = PL.x1 - PL.x0;
  const l = PL.z1 - PL.z0;
  const cx = (PL.x0 + PL.x1) / 2;
  const cz = (PL.z0 + PL.z1) / 2;
  const h = 0.05;
  return [
    { geo: box(w + 2 * COPE, h, COPE), pos: [cx, h / 2, PL.z0 - COPE / 2] },
    { geo: box(w + 2 * COPE, h, COPE), pos: [cx, h / 2, PL.z1 + COPE / 2] },
    { geo: box(COPE, h, l), pos: [PL.x0 - COPE / 2, h / 2, cz] },
    { geo: box(COPE, h, l), pos: [PL.x1 + COPE / 2, h / 2, cz] },
  ];
}

function pergola(): { steel: Placed[]; timber: Placed[] } {
  const steel: Placed[] = [];
  const timber: Placed[] = [];
  const s = 0.1;
  const h = PG.h;
  for (const x of [PG.x0, PG.x1]) for (const z of [PG.z0, PG.z1]) steel.push({ geo: box(s, h, s), pos: [x, h / 2, z] });
  for (const z of [PG.z0, PG.z1]) steel.push({ geo: box(PG.x1 - PG.x0 + s, 0.22, s), pos: [(PG.x0 + PG.x1) / 2, h - 0.11, z] });
  for (const x of [PG.x0, PG.x1]) steel.push({ geo: box(s, 0.22, PG.z1 - PG.z0 + s), pos: [x, h - 0.11, (PG.z0 + PG.z1) / 2] });
  // cedar louvres across the top
  for (let x = PG.x0 + 0.12; x < PG.x1 - 0.05; x += 0.2) timber.push({ geo: box(0.05, 0.16, PG.z1 - PG.z0 - 0.02), pos: [x, h - 0.02, (PG.z0 + PG.z1) / 2] });
  return { steel, timber };
}

/** Teak lounge set under the pergola (modular cushions, throw pillows) and two slatted chaises by the pool. */
function outdoorFurniture() {
  const teak: Placed[] = [];
  const cushion: Placed[] = [];
  const accent: Placed[] = [];
  const stone: Placed[] = [];
  const cx = (PG.x0 + PG.x1) / 2;
  const cz = (PG.z0 + PG.z1) / 2;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const put = (m: THREE.Matrix4, g: THREE.BufferGeometry, px: number, py: number, pz: number, into: Placed[], rx = 0, ry = 0, rz = 0) =>
    into.push({ geo: g, matrix: m.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q.setFromEuler(e.set(rx, ry, rz)), one)) });

  const sofa = (x: number, z: number, len: number, rotY: number) => {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
    const inner = len - 0.14;
    put(m, rbox(len, 0.08, 0.9, 0.012), 0, 0.2, 0, teak); // seat deck
    for (const sx of [-1, 1]) put(m, rbox(0.07, 0.46, 0.9, 0.02), sx * (len / 2 - 0.035), 0.37, 0, teak); // arms
    put(m, rbox(inner, 0.4, 0.06, 0.015), 0, 0.44, 0.42, teak); // back
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(m, rbox(0.06, 0.16, 0.06, 0.008), sx * (len / 2 - 0.05), 0.08, sz * 0.39, teak);
    const n = Math.max(1, Math.round(inner / 0.78));
    const w = inner / n;
    for (let i = 0; i < n; i++) {
      const px = -inner / 2 + w * (i + 0.5);
      put(m, rbox(w - 0.012, 0.15, 0.76, 0.05, 3), px, 0.315, -0.04, cushion); // seat
      put(m, rbox(w - 0.012, 0.44, 0.17, 0.06, 3), px, 0.62, 0.3, cushion, -0.14); // back, leaning
    }
    put(m, rbox(0.42, 0.42, 0.13, 0.06, 3), -len / 2 + 0.36, 0.56, 0.16, accent, -0.28, 0.35, 0.06);
    put(m, rbox(0.42, 0.42, 0.13, 0.06, 3), len / 2 - 0.36, 0.56, 0.16, accent, -0.28, -0.35, -0.06);
  };
  sofa(cx - 0.1, PG.z0 + 0.72, 2.6, 0);
  sofa(PG.x0 + 0.62, cz + 0.4, 1.7, Math.PI / 2);
  // coffee table: honed stone on a teak plinth
  stone.push({ geo: rbox(1.1, 0.05, 0.7, 0.008, 2), pos: [cx - 0.05, 0.365, cz + 0.2] });
  teak.push({ geo: rbox(0.92, 0.32, 0.52, 0.01), pos: [cx - 0.05, 0.18, cz + 0.2] });

  // chaises by the pool: slatted teak frame, reclined back, thick cushion
  for (const z of [PL.z0 + 2.2, PL.z0 + 3.7]) {
    const m = new THREE.Matrix4().makeTranslation(PL.x1 + COPE + 0.75, 0, z);
    for (const sx of [-1, 1]) put(m, rbox(0.045, 0.07, 1.96, 0.01), sx * 0.33, 0.29, 0.02, teak); // rails
    for (let i = 0; i < 13; i++) put(m, rbox(0.62, 0.018, 0.066, 0.004), 0, 0.32, 0.95 - i * 0.1, teak); // slats
    put(m, rbox(0.62, 0.03, 0.7, 0.008), 0, 0.5, -0.64, teak, 0.62); // back frame
    for (const sx of [-1, 1]) for (const sz of [-0.85, 0.85]) put(m, rbox(0.05, 0.28, 0.05, 0.006), sx * 0.31, 0.14, sz, teak);
    put(m, rbox(0.62, 0.065, 1.28, 0.03, 3), 0, 0.365, 0.3, cushion);
    put(m, rbox(0.62, 0.055, 0.66, 0.026, 3), 0, 0.55, -0.62, cushion, 0.62);
    put(m, rbox(0.44, 0.13, 0.28, 0.06, 3), 0, 0.72, -0.84, accent, 0.62); // head pillow
  }
  return { teak, cushion, accent, stone };
}

interface GardenPlants {
  core: Record<string, PlantPlacement[]>;
  lush: Record<string, PlantPlacement[]>;
}

function planting(): GardenPlants {
  const r = rng(41);
  const J = (a: number) => (r() - 0.5) * a;
  const core: Record<string, PlantPlacement[]> = { searsia_a: [], searsia_b: [], searsia_c: [], searsia_d: [], island: [] };
  const lush: Record<string, PlantPlacement[]> = { searsia_a: [], searsia_b: [], searsia_c: [], searsia_d: [], shrub_a: [], shrub_d: [], jacaranda: [] };
  const kinds = ["searsia_a", "searsia_b", "searsia_c", "searsia_d"];
  // back boundary bed behind the pavilion's garden corner; the south-west stays open (the arrival view)
  for (let i = 0; i < 6; i++) {
    const x = -6.2 + i * 0.95 + J(0.4);
    const z = G.z0 + 0.9 + J(0.6);
    (i % 2 ? core : lush)[kinds[i % 4]].push({ x, z, height: 0.9 + r() * 0.6, tone: J(0.3) });
  }
  // north-west bed along the garden's edge by the house
  for (let i = 0; i < 6; i++) {
    const x = G.x0 + 0.7 + J(0.5);
    const z = -4.8 - i * 1.05 + J(0.4);
    (i % 2 ? core : lush)[kinds[(i + 1) % 4]].push({ x, z, height: 1.2 + r() * 1.0, tone: J(0.3) });
  }
  // feature tree at the pavilion's far corner; a larger tree framing the north-west
  core.island.push({ x: -2.4, z: -18.3, height: 4.4, yaw: 0.8 });
  lush.jacaranda.push({ x: -23, z: 3, height: 9 });
  // low planting along the pool's far side and the terrace edge
  for (let i = 3; i < 7; i++) lush.shrub_a.push({ x: PL.x0 - 1.1 + J(0.2), z: PL.z0 + 0.6 + i * 1.15 + J(0.3), height: 0.7 + r() * 0.3 });
  for (let i = 0; i < 5; i++) lush.searsia_d.push({ x: P.x0 - 0.55 + J(0.2), z: P.z0 + 0.8 + i * 1.6 + J(0.3), height: 0.7 + r() * 0.25, tone: J(0.2) });
  return { core, lush };
}

const STONES: Array<[number, number]> = [
  [-7.4, -5.2],
  [-8.3, -5.1],
  [-9.2, -5.25],
  [-10.1, -5.15],
  [-11.0, -5.25],
  [-11.9, -5.15],
];

export function Garden() {
  const c = useDemo((s) => s.landscaping);
  const compare = useDemo((s) => s.compare);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const tier = useDemo((s) => s.tier);
  const hi = tier !== "low";
  const beforeOn = compare && industry === "landscaping" && phase === "explore";
  const lights = useRef<THREE.Group>(null);

  useEffect(() => markShadowsDirty(4), [c.surface, c.pergola, c.pool, c.planting, industry]);
  useEffect(() => {
    registerLamps(GARDEN_LAMPS);
    return () => unregisterLamps(GARDEN_LAMPS);
  }, []);

  const geo = useMemo(() => {
    const pg = pergola();
    const fu = outdoorFurniture();
    const deck = box(P.x1 - P.x0, 0.16, P.z1 - P.z0);
    deck.translate((P.x0 + P.x1) / 2, 0.08, (P.z0 + P.z1) / 2);
    const stone = box(P.x1 - P.x0, 0.06, P.z1 - P.z0);
    stone.translate((P.x0 + P.x1) / 2, 0.03, (P.z0 + P.z1) / 2);
    const water = new THREE.PlaneGeometry(PL.x1 - PL.x0, PL.z1 - PL.z0, 1, 1);
    water.rotateX(-Math.PI / 2);
    water.translate((PL.x0 + PL.x1) / 2, WATER_Y, (PL.z0 + PL.z1) / 2);
    const wu = water.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < wu.count; i++) wu.setXY(i, wu.getX(i) * (PL.x1 - PL.x0), wu.getY(i) * (PL.z1 - PL.z0));
    // lawn plug for the pool opening in the ground (no pool / before)
    const plug = new THREE.PlaneGeometry(PL.x1 - PL.x0, PL.z1 - PL.z0);
    plug.rotateX(-Math.PI / 2);
    plug.translate((PL.x0 + PL.x1) / 2, -0.005, (PL.z0 + PL.z1) / 2);
    const bollards: Placed[] = [];
    const bollardTops: Placed[] = [];
    STONES.forEach(([x, z], i) => {
      if (i % 3 === 0) {
        bollards.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 16), pos: [x, 0.25, z + 0.75] });
        bollardTops.push({ geo: new THREE.CylinderGeometry(0.047, 0.047, 0.05, 16), pos: [x, 0.47, z + 0.75] });
      }
    });
    const beforeGround = new THREE.PlaneGeometry(G.x1 - G.x0, G.z1 - G.z0);
    beforeGround.rotateX(-Math.PI / 2);
    beforeGround.translate((G.x0 + G.x1) / 2, 0.006, (G.z0 + G.z1) / 2);
    const bu = beforeGround.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < bu.count; i++) bu.setXY(i, bu.getX(i) * (G.x1 - G.x0), bu.getY(i) * (G.z1 - G.z0));
    return {
      deck,
      stone,
      water,
      plug,
      shell: merge(poolShell()),
      coping: merge(coping()),
      steel: merge(pg.steel),
      timber: merge(pg.timber),
      teak: merge(fu.teak),
      cushion: merge(fu.cushion),
      accent: merge(fu.accent),
      tableTop: merge(fu.stone),
      stones: merge(STONES.map(([x, z]) => ({ geo: box(0.7, 0.05, 0.45), pos: [x, 0.025, z] }))),
      bollards: merge(bollards),
      bollardTops: merge(bollardTops),
      beforeGround,
      slab: (() => {
        const g = box(4.6, 0.1, 4.2);
        g.translate(-3.4, 0.05, -6.6);
        return g;
      })(),
    };
  }, []);

  const plants = useMemo(() => planting(), []);

  const lazy = useMemo(() => lazyCache<THREE.Material>(), []);
  const mats = useMemo(() => {
    const s = <T extends THREE.Material>(m: T, o: Parameters<typeof patch>[1] = AFTER) => patch(m, o);
    const lit = <T extends THREE.MeshStandardMaterial>(m: T) => lampLit(m, ["garden", "exterior"]);
    return {
      deck: s(lit(pbr("deck", { color: "#d2bda6", roughness: 1 }))),
      stone: s(lit(pbr("paver_stone", { roughness: 1, envMapIntensity: 0.8 }))),
      coping: s(lit(pbr("paver_stone", { roughness: 1, envMapIntensity: 0.8 }))),
      // the shell is only ever seen through water, so it carries the water's absorption colour
      // the shell is seen through the water: absorption, caustics and the lit haze are applied to it
      shell: s(underwater(lampLit(pbr("pool_tile", { color: "#bfe3e6", roughness: 0.35, envMapIntensity: 0.4 }), ["garden"]), POOL_U)),
      water: s(waterMaterial()),
      steel: s(lit(solid("#2a2724", 0.45, 0.7))),
      timber: s(lit(pbr("cedar", { color: "#e8d6c2", roughness: 1 }))),
      teak: s(lit(pbr("oak_veneer", { color: "#a07b58", roughness: 0.85 }))),
      cushion: s(lit(pbr("linen", { color: "#e6e0d5", roughness: 1 }))),
      accent: s(lit(pbr("linen", { color: "#b5714f", roughness: 1 }))),
      tableTop: s(lit(pbr("concrete", { color: "#b9b2a8", roughness: 0.9 }))),
      stones: s(lit(pbr("paver_stone", { roughness: 1 }))),
      bollard: s(solid("#262422", 0.45, 0.6)),
      bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9a8").multiplyScalar(5) }),
      plug: sharedGround(),
      before: () =>
        lazy.get("before", () => {
          const m = pbr("meadow", { color: "#b9ad84", roughness: 1 });
          return s(m, BEFORE);
        }) as THREE.MeshStandardMaterial,
      beforeSlab: () => lazy.get("beforeSlab", () => s(pbr("concrete", { color: "#a39c91", roughness: 1 }), BEFORE)) as THREE.MeshStandardMaterial,
    };
  }, [lazy]);
  useEffect(
    () => () => {
      lazy.dispose();
      Object.entries(mats).forEach(([k, m]) => k !== "plug" && m instanceof THREE.Material && m.dispose());
    },
    [lazy, mats],
  );

  useFrame(() => {
    const d = channels.dusk;
    const lit = THREE.MathUtils.smoothstep(d, 0.55, 0.9);
    for (const w of [mats.water, mirror?.material as THREE.ShaderMaterial | undefined]) {
      if (!w) continue;
      w.uniforms.uTime.value = U.time.value;
      w.uniforms.uGlow.value = lit;
    }
    POOL_U.uTime.value = U.time.value;
    POOL_U.uGlow.value = lit;
    POOL_U.uCaustic.value = 1 - THREE.MathUtils.smoothstep(d, 0.25, 0.6);
    mats.bulb.color.setRGB(1, 0.85, 0.66).multiplyScalar(0.4 + lit * 6);
    if (lights.current) lights.current.visible = lit > 0.01;
  });

  // Planar reflection on desktop tiers: the lit house mirrored in the pool at dusk.
  const { size } = useThree();
  const mirror = useMemo(() => {
    if (!hi) return null;
    const r = new Reflector(new THREE.PlaneGeometry(PL.x1 - PL.x0, PL.z1 - PL.z0), {
      textureWidth: 1024,
      textureHeight: 1024,
      multisample: 0,
      clipBias: 0.002,
      shader: REFLECTIVE_WATER,
    });
    r.rotation.x = -Math.PI / 2;
    r.position.set((PL.x0 + PL.x1) / 2, WATER_Y, (PL.z0 + PL.z1) / 2);
    r.renderOrder = 2;
    const m = r.material as THREE.ShaderMaterial;
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.SrcAlphaFactor;
    // live, shared sky uniforms (the reflector clones its shader's uniforms)
    Object.assign(m.uniforms, SKY_UNIFORMS);
    const inner = r.onBeforeRender.bind(r);
    r.onBeforeRender = (renderer, scene, cam, g, mat, grp) => {
      inner(renderer, scene, cam, g, mat, grp);
      updateLampViewPositions(cam); // the mirrored render moved the lamps; put them back
    };
    patch(m, AFTER);
    return r;
  }, [hi]);
  useEffect(() => () => mirror?.dispose(), [mirror]);
  useEffect(() => {
    if (!mirror) return;
    const s = Math.min(1024, Math.round(Math.max(size.width, size.height) * 0.6));
    mirror.getRenderTarget().setSize(s, Math.round(s * 0.75));
  }, [mirror, size.width, size.height]);

  const surfaceMesh = c.surface === "deck" ? geo.deck : c.surface === "stone" ? geo.stone : null;
  const lush = c.planting === "lush";
  const sh = { castShadow: true, receiveShadow: true };

  return (
    <group name="garden">
      {surfaceMesh && <mesh geometry={surfaceMesh} material={c.surface === "deck" ? mats.deck : mats.stone} {...sh} />}
      {c.pool ? (
        <>
          <mesh geometry={geo.shell} material={mats.shell} receiveShadow />
          {mirror ? <primitive object={mirror} /> : <mesh geometry={geo.water} material={mats.water} renderOrder={2} />}
          <mesh geometry={geo.coping} material={mats.coping} {...sh} />
          <mesh geometry={geo.teak} material={mats.teak} {...sh} />
          <mesh geometry={geo.cushion} material={mats.cushion} {...sh} />
          <mesh geometry={geo.accent} material={mats.accent} {...sh} />
        </>
      ) : (
        <mesh geometry={geo.plug} material={mats.plug} receiveShadow />
      )}
      {c.pergola && (
        <>
          <mesh geometry={geo.steel} material={mats.steel} {...sh} />
          <mesh geometry={geo.timber} material={mats.timber} {...sh} />
          <mesh geometry={geo.tableTop} material={mats.tableTop} {...sh} />
        </>
      )}
      <PlantField plants={plants.core} />
      <group visible={lush}>
        <PlantField plants={plants.lush} />
      </group>
      <mesh geometry={geo.stones} material={mats.stones} receiveShadow />
      <mesh geometry={geo.bollards} material={mats.bollard} castShadow />
      <group ref={lights} visible={false}>
        <mesh geometry={geo.bollardTops} material={mats.bulb} />
      </group>

      {beforeOn && (
        <>
          <mesh geometry={geo.beforeGround} material={mats.before()} />
          <mesh geometry={geo.slab} material={mats.beforeSlab()} />
        </>
      )}
    </group>
  );
}

/** Wind-ruffled surface: three drifting octaves of value noise (no visible pattern repeat). */
const WATER_WAVES = /* glsl */ `
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float h(vec2 p) {
  return wNoise(p * 1.1 + vec2(uTime * 0.32, uTime * 0.18)) * 0.62 + wNoise(p * 2.7 - vec2(uTime * 0.45, -uTime * 0.28)) * 0.28 + wNoise(p * 6.3 + vec2(uTime * 0.8, uTime * 0.55)) * 0.1;
}
vec3 waterNormal(vec3 w) {
  vec2 e = vec2(0.04, 0.0);
  vec2 p = w.xz * 1.4;
  return normalize(vec3(h(p - e.xy) - h(p + e.xy), 0.34, h(p - e.yx) - h(p + e.yx)));
}
`;

/**
 * The pool shell as seen through the water: light loses red first on its way down and back up
 * (clear water: ~0.4 /m red, ~0.07 green, ~0.05 blue), so the deep end turns blue and the steps
 * stay turquoise; the sun draws moving caustics on the floor by day; the pool light fills the
 * water with a turquoise haze after dark.
 */
function underwater<T extends THREE.MeshStandardMaterial>(m: T, u: { uTime: { value: number }; uCaustic: { value: number }; uGlow: { value: number } }) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPoolW;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPoolW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vPoolW;
        uniform float uTime;
        uniform float uCaustic;
        uniform float uGlow;
        float causticAt(vec2 p, float t) {
          vec2 q = p * 1.9;
          vec2 i = q;
          float c = 1.0;
          for (int n = 0; n < 4; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / 0.005), q.y / (cos(i.y + tt) / 0.005)));
          }
          c /= 4.0;
          c = 1.17 - pow(c, 1.4);
          return pow(abs(c), 8.0);
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float pd = max(${WATER_Y.toFixed(3)} - vPoolW.y, 0.0);
        vec3 pv = normalize(cameraPosition - vPoolW);
        float pl = pd * (1.0 / max(pv.y, 0.14) + 1.1);
        vec3 pt = exp(-vec3(0.42, 0.075, 0.05) * pl);
        outgoingLight += diffuseColor.rgb * causticAt(vPoolW.xz, uTime * 0.55) * uCaustic * 1.6 * smoothstep(0.02, 0.2, pd);
        vec3 pscatter = vec3(0.01, 0.055, 0.07) * (0.25 + 0.75 * uCaustic) + vec3(0.0, 0.09, 0.11) * uGlow;
        outgoingLight = outgoingLight * pt + pscatter * (1.0 - pt);
        #include <opaque_fragment>`,
      );
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|underwater`;
  return m;
}

const POOL_U = { uTime: { value: 0 }, uCaustic: { value: 0 }, uGlow: { value: 0 } };

/** Pool water over a planar reflection (three's Reflector renders the mirrored view). */
const REFLECTIVE_WATER = {
  name: "ReflectiveWater",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uGlow: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvR;
    varying vec3 vW;
    void main() {
      vUvR = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    #include <common>
    ${"${SKY}"}
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGlow;
    varying vec4 vUvR;
    varying vec3 vW;
    ${"${WAVES}"}
    void main() {
      vec3 n = waterNormal(vW);
      vec3 V = normalize(cameraPosition - vW);
      float f = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      vec4 uvr = vUvR;
      uvr.xy += n.xz * 0.06 * uvr.w;
      vec3 refl = texture2DProj(tDiffuse, uvr).rgb;
      // reflection on top; the lit, tinted shell shows through (premultiplied: src + dst * a)
      float fr = clamp(f * 1.15 + 0.06, 0.0, 1.0);
      gl_FragColor = vec4(refl * fr + vec3(0.004, 0.02, 0.024), (1.0 - fr) * 0.86);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};
REFLECTIVE_WATER.fragmentShader = REFLECTIVE_WATER.fragmentShader.replace("${SKY}", SKY_GLSL).replace("${WAVES}", WATER_WAVES);

/**
 * Pool water without the mirror pass (lower tiers): reflects the analytic sky with Fresnel over
 * the same wind-ruffled surface; the shell shows through, tinted by its own underwater patch.
 */
function waterMaterial() {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
    uniforms: { ...SKY_UNIFORMS, uTime: { value: 0 }, uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      ${SKY_GLSL}
      uniform float uTime;
      uniform float uGlow;
      varying vec3 vW;
      varying vec2 vUv;
      ${WATER_WAVES}
      void main() {
        vec3 n = waterNormal(vW);
        vec3 V = normalize(cameraPosition - vW);
        float f = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n);
        // the real sky, as seen in the dome at this time of day
        vec3 sky = skyRadiance(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
        // reflection on top; the lit, tinted shell shows through (premultiplied: src + dst * a)
        gl_FragColor = vec4(sky * f + vec3(0.004, 0.02, 0.024), (1.0 - f) * 0.86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  return m;
}
