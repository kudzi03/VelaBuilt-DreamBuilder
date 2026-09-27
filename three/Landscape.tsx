"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GARDEN, MAIN, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { SUN_DIR } from "./env";
import { box, merge, type Placed } from "./geom";
import { buildImpostors, IMPOSTOR_SUN, type PlantId, type PlantPlacement } from "./impostor";
import { pbr, tex } from "./materials";
import { rng } from "./proc";

/** The lot: mown lawn inside, meadow beyond, woodland beyond that. */
export const LOT = { x0: -15.5, x1: 13.5, z0: -17.5, z1: 16 };
const DRIVE = { x0: 7.3, x1: 12.1, z0: MAIN.z0 + 0.4, z1: 60 };
/** Where the pool sits (the ground disc has an opening here). */
export const POOL_HOLE = GARDEN.pool;

/** Tileable value noise for macro variation (baked once, tiny). */
function noiseTexture(size = 256) {
  const r = rng(11);
  const data = new Uint8Array(size * size * 4);
  const lat = (n: number) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const at = (a: number, b: number) => g[((b % n) + n) % n * n + (((a % n) + n) % n)];
      return at(xi, yi) * (1 - u) * (1 - v) + at(xi + 1, yi) * u * (1 - v) + at(xi, yi + 1) * (1 - u) * v + at(xi + 1, yi + 1) * u * v;
    };
  };
  const o = [lat(4), lat(8), lat(16), lat(32)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size, fy = y / size;
      const a = o[0](fx * 4, fy * 4) * 0.55 + o[1](fx * 8, fy * 8) * 0.3 + o[2](fx * 16, fy * 16) * 0.15;
      const b = o[2](fx * 16, fy * 16) * 0.6 + o[3](fx * 32, fy * 32) * 0.4;
      const i = (y * size + x) * 4;
      data[i] = a * 255;
      data[i + 1] = b * 255;
      data[i + 2] = o[1](fx * 8 + 3.3, fy * 8 + 1.7) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Ground: mown lawn on the lot fading through an irregular edge into longer meadow grass.
 * Two scales of the lawn scan are mixed by noise and a macro tint is applied, so the
 * texture never visibly repeats; faint mowing stripes run across the lawn.
 */
let groundSingleton: THREE.MeshStandardMaterial | null = null;
/** The ground material, shared so the garden can patch its own openings seamlessly. */
export function sharedGround() {
  if (!groundSingleton) groundSingleton = groundMaterial(noiseTexture());
  return groundSingleton;
}

function groundMaterial(noise: THREE.Texture) {
  const lawn = tex("lawn", "color")!;
  const lawnN = tex("lawn", "normal");
  const meadow = tex("meadow", "color")!;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, normalMap: lawnN, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.7 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLawn = { value: lawn };
    s.uniforms.uMeadow = { value: meadow };
    s.uniforms.uNoise = { value: noise };
    s.uniforms.uLot = { value: new THREE.Vector4(LOT.x0, LOT.z0, LOT.x1, LOT.z1) };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGW;
        uniform sampler2D uLawn;
        uniform sampler2D uMeadow;
        uniform sampler2D uNoise;
        uniform vec4 uLot;
        float lotDist(vec2 p) {
          vec2 c = (uLot.xy + uLot.zw) * 0.5;
          vec2 h = (uLot.zw - uLot.xy) * 0.5;
          vec2 q = abs(p - c) - h + 2.0;
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 2.0;
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 wp = vGW.xz;
        vec4 nz = texture2D(uNoise, wp / 41.0);
        vec4 nz2 = texture2D(uNoise, wp / 7.3 + 0.37);
        mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
        vec3 la = texture2D(uLawn, wp / 1.4).rgb;
        vec3 lb = texture2D(uLawn, (R * wp) / 3.7).rgb;
        vec3 lawnC = mix(la, lb, smoothstep(0.3, 0.7, nz.b));
        vec3 ma = texture2D(uMeadow, wp / 1.5).rgb;
        vec3 mb = texture2D(uMeadow, (R * wp) / 4.3).rgb;
        vec3 meadowC = mix(ma, mb, smoothstep(0.35, 0.65, nz.g)) * vec3(1.05, 1.0, 0.86);
        float d = lotDist(wp) + (nz2.r - 0.5) * 3.0;
        float mw = smoothstep(-0.5, 2.5, d);
        vec3 gc = mix(lawnC, meadowC, mw);
        gc *= 0.84 + 0.3 * nz.r;
        gc = mix(gc, gc * vec3(1.08, 1.03, 0.82), smoothstep(0.55, 0.8, nz.g) * 0.5);
        float stripe = step(0.0, sin(wp.x * 3.14159 / 1.3));
        gc *= 1.0 + (stripe - 0.5) * 0.06 * (1.0 - mw);
        diffuseColor.rgb *= gc;`,
      );
  };
  m.customProgramCacheKey = () => "vb-ground";
  return m;
}

/* ------------------------------------------------------------------ planting plan */

function placeTrees(): Record<string, PlantPlacement[]> {
  const r = rng(29);
  const J = (a: number) => (r() - 0.5) * a;
  const out: Record<string, PlantPlacement[]> = { jacaranda: [], fir_a: [], fir_b: [], fir_c: [], island: [], searsia_a: [], searsia_b: [], searsia_c: [], searsia_d: [], shrub_a: [], shrub_d: [] };
  // specimen broadleaf trees framing the house
  // (kept off the drone sightlines: roofing, solar and steel look in from the street-side corner)
  out.jacaranda.push({ x: -21, z: 16, height: 10.5 }, { x: 25, z: 1.5, height: 12 }, { x: -21, z: -5, height: 11.5 }, { x: 4.2, z: -24.5, height: 12.5 }, { x: -2.5, z: 22.5, height: 9.5 });
  // woodland edge behind the garden and along the east side
  const edge: Array<[number, number]> = [];
  for (let i = 0; i < 26; i++) edge.push([-30 + i * 2.6 + J(1.8), -27 - Math.abs(Math.sin(i * 1.7)) * 5 + J(3)]);
  for (let i = 0; i < 14; i++) edge.push([22 + J(3) + Math.sin(i) * 2, -22 + i * 3.1 + J(1.5)]);
  for (let i = 0; i < 12; i++) edge.push([-31 + J(3), -20 + i * 3.3 + J(1.5)]);
  edge.forEach(([x, z], i) => {
    const k = i % 3;
    const h = 11 + r() * 8;
    (k === 0 ? out.fir_a : k === 1 ? out.fir_b : out.fir_c).push({ x, z, height: h, tone: J(0.25) });
  });
  // mid-size trees and shrub masses along the lot boundary
  out.island.push({ x: -16.5, z: 3.5, height: 4.2 }, { x: 15.2, z: -10.5, height: 4.6 }, { x: 20, z: 11, height: 4.0 }, { x: -19.5, z: -10, height: 4.4 }, { x: 5.5, z: 19.5, height: 3.6 });
  const shrubs: Array<[number, number, number]> = [];
  for (let i = 0; i < 18; i++) {
    const s: [number, number, number] = [LOT.x0 - 0.3 + J(0.6), LOT.z0 + 2 + i * 1.75, 1.4 + r() * 0.8];
    // the south-west corner stays open: the arrival and garden views are taken from there
    if (i >= 5) shrubs.push(s);
  }
  for (let i = 0; i < 12; i++) shrubs.push([LOT.x1 + 0.4 + J(0.6), -14 + i * 1.8, 1.2 + r() * 0.9]);
  for (let i = 0; i < 10; i++) shrubs.push([-13.5 + i * 1.6 + J(0.5), LOT.z1 - 0.2 + J(0.5), 1.1 + r() * 0.6]);
  shrubs.forEach(([x, z, h], i) => {
    const bucket = ["searsia_a", "searsia_b", "searsia_c", "searsia_d"][i % 4];
    out[bucket].push({ x, z, height: h, tone: J(0.3) });
  });
  // soft foundation planting against the front of the house
  for (let i = 0; i < 6; i++) out.searsia_d.push({ x: -5.3 + i * 0.72 + J(0.15), z: MAIN.z1 + 0.95 + J(0.15), height: 0.75 + r() * 0.25, tone: J(0.2) });
  for (let i = 0; i < 5; i++) out.searsia_c.push({ x: 2.2 + i * 0.72 + J(0.15), z: MAIN.z1 + 0.95 + J(0.15), height: 0.7 + r() * 0.25, tone: J(0.2) });
  return out;
}

/** Distant woodland: a thinned ring of firs well beyond the lot, for parallax against the sky. */
function placeForest(count: number) {
  const r = rng(71);
  const list: Record<string, PlantPlacement[]> = { fir_a: [], fir_b: [], fir_c: [] };
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = 55 + Math.pow(r(), 0.7) * 110;
    // keep the long view over the garden toward the sunset partly open
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const k = i % 3;
    (k === 0 ? list.fir_a : k === 1 ? list.fir_b : list.fir_c).push({ x, z, height: 13 + r() * 10, tone: (r() - 0.5) * 0.3 });
  }
  return list;
}

export function Landscape() {
  const tier = useDemo((s) => s.tier);
  const hi = tier !== "low";

  const mats = useMemo(() => {
    const drive = pbr("gravel", { roughness: 1, color: "#e4dccd", envMapIntensity: 0.6, scale: 0.8 });
    const paver = pbr("paver_stone", { roughness: 1, envMapIntensity: 0.7 });
    const gravel = pbr("gravel", { roughness: 1, color: "#d8d2c6", envMapIntensity: 0.6 });
    const edge = new THREE.MeshStandardMaterial({ color: "#3a3631", roughness: 0.55, metalness: 0.6 });
    return { ground: sharedGround(), drive, paver, gravel, edge };
  }, []);
  useEffect(
    () => () => {
      mats.drive.dispose();
      mats.paver.dispose();
      mats.gravel.dispose();
      mats.edge.dispose();
    },
    [mats],
  );

  const geo = useMemo(() => {
    // ground disc with the pool cut out (the garden fills it back when there is no pool)
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 700, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    const P = GARDEN.pool;
    hole.moveTo(P.x0, -P.z0);
    hole.lineTo(P.x0, -P.z1);
    hole.lineTo(P.x1, -P.z1);
    hole.lineTo(P.x1, -P.z0);
    hole.closePath();
    shape.holes.push(hole);
    const ground = new THREE.ShapeGeometry(shape, 64);
    ground.rotateX(-Math.PI / 2);
    // shape UVs are already world x / -z in metres

    const drive = box(DRIVE.x1 - DRIVE.x0, 0.06, DRIVE.z1 - DRIVE.z0);
    drive.translate((DRIVE.x0 + DRIVE.x1) / 2, 0.03, (DRIVE.z0 + DRIVE.z1) / 2);
    // stepping pavers up to the door, each 1.2 x 0.6 with lawn between
    const pavers: Placed[] = [];
    for (let z = MAIN.z1 + 1.4; z < LOT.z1 + 6; z += 0.95) pavers.push({ geo: box(1.5, 0.05, 0.62), pos: [0, 0.025, z] });
    pavers.push({ geo: box(2.6, 0.06, 1.4), pos: [0, 0.03, MAIN.z1 + 0.7] });
    // service path along the kitchen wing
    for (let z = WING.z0 + 0.6; z < MAIN.z0 - 0.2; z += 0.95) pavers.push({ geo: box(1.1, 0.05, 0.62), pos: [WING.x1 + 1.3, 0.025, z] });
    // gravel margin round the house with a steel edge
    const m = 0.45;
    const gravel: Placed[] = [
      { geo: box(MAIN.x1 - MAIN.x0 + m * 2, 0.03, m), pos: [(MAIN.x0 + MAIN.x1) / 2, 0.015, MAIN.z1 + m / 2] },
      { geo: box(m, 0.03, MAIN.z1 - MAIN.z0), pos: [MAIN.x1 + m / 2, 0.015, (MAIN.z0 + MAIN.z1) / 2] },
      { geo: box(m, 0.03, MAIN.z1 - MAIN.z0 + m), pos: [MAIN.x0 - m / 2, 0.015, (MAIN.z0 + MAIN.z1) / 2 + m / 2] },
      { geo: box(m, 0.03, WING.z1 - WING.z0 + m), pos: [WING.x1 + m / 2, 0.015, (WING.z0 + WING.z1) / 2 - m / 2] },
      { geo: box(WING.x1 - WING.x0 + m, 0.03, m), pos: [(WING.x0 + WING.x1) / 2 + m / 2, 0.015, WING.z0 - m / 2] },
    ];
    const edges: Placed[] = [
      { geo: box(MAIN.x1 - MAIN.x0 + m * 2, 0.06, 0.008), pos: [(MAIN.x0 + MAIN.x1) / 2, 0.02, MAIN.z1 + m] },
      { geo: box(0.008, 0.06, DRIVE.z1 - DRIVE.z0), pos: [DRIVE.x0, 0.02, (DRIVE.z0 + DRIVE.z1) / 2] },
      { geo: box(0.008, 0.06, DRIVE.z1 - DRIVE.z0), pos: [DRIVE.x1, 0.02, (DRIVE.z0 + DRIVE.z1) / 2] },
    ];
    return { ground, drive, pavers: merge(pavers), gravel: merge(gravel), edges: merge(edges) };
  }, []);

  const plants = useMemo(() => {
    const near = placeTrees();
    const far = placeForest(hi ? 150 : 70);
    const meshes: THREE.InstancedMesh[] = [];
    for (const [id, list] of Object.entries(near)) if (list.length) meshes.push(buildImpostors(id as PlantId, list, hi));
    for (const [id, list] of Object.entries(far)) {
      if (!list.length) continue;
      const mesh = buildImpostors(id as PlantId, list, false);
      mesh.castShadow = false; // far outside the shadow camera
      meshes.push(mesh);
    }
    return meshes;
  }, [hi]);
  useEffect(
    () => () =>
      plants.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.customDepthMaterial?.dispose();
      }),
    [plants],
  );

  useFrame(() => {
    IMPOSTOR_SUN.value.copy(SUN_DIR);
  });

  return (
    <group name="landscape">
      <mesh geometry={geo.ground} material={mats.ground} receiveShadow position-y={-0.005} />
      <mesh geometry={geo.drive} material={mats.drive} receiveShadow />
      <mesh geometry={geo.pavers} material={mats.paver} receiveShadow castShadow />
      <mesh geometry={geo.gravel} material={mats.gravel} receiveShadow />
      <mesh geometry={geo.edges} material={mats.edge} />
      {plants.map((m) => (
        <primitive key={m.name + m.count} object={m} />
      ))}
    </group>
  );
}

export const GARDEN_BOUNDS = GARDEN;
