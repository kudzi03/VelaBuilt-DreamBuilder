"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOOR_Y, MAIN, MAIN_RIDGE_Y, MAIN_RIDGE_Z, ROOF_PLANES, WALL, WING, WING_RIDGE_X, WING_RIDGE_Y } from "@/lib/spec";
import { box, emptyGlazing, glazing, merge, roofSurface, wallGeometry, type Placed, type WallDef } from "./geom";
import { cedar, concrete, plaster } from "./proc";
import { channels, depthFor, fades, ghostMaterial, patch, U } from "./shared";
import { Roof, ROOF_T } from "./Roof";

export const MAIN_WALLS: WallDef[] = [
  {
    face: "z+",
    at: MAIN.z1,
    from: MAIN.x0,
    to: MAIN.x1,
    height: MAIN.eave,
    thickness: WALL,
    openings: [
      { a: -5.0, b: -2.2, y0: 0.62, y1: 2.62 },
      { a: -0.55, b: 0.55, y0: 0, y1: 2.5, kind: "door" },
      { a: 2.2, b: 5.0, y0: 0.62, y1: 2.62 },
      { a: -4.7, b: -3.1, y0: 3.62, y1: 5.3 },
      { a: -0.8, b: 0.8, y0: 3.62, y1: 5.3 },
      { a: 3.1, b: 4.7, y0: 3.62, y1: 5.3 },
    ],
  },
  {
    face: "z-",
    at: MAIN.z0,
    from: MAIN.x0,
    to: MAIN.x1,
    height: MAIN.eave,
    thickness: WALL,
    openings: [
      { a: -5.3, b: -1.75, y0: 0, y1: 2.6, kind: "slider" },
      { a: 1.6, b: 2.7, y0: 0, y1: 2.4, kind: "void" },
      { a: -4.8, b: -3.2, y0: 3.62, y1: 5.3 },
      { a: -2.6, b: -1.7, y0: 3.62, y1: 5.3 },
    ],
  },
  {
    face: "x-",
    at: MAIN.x0,
    from: MAIN.z0,
    to: MAIN.z1,
    height: MAIN.eave,
    gable: { peakAt: MAIN_RIDGE_Z, peakY: MAIN_RIDGE_Y },
    thickness: WALL,
    openings: [
      { a: -1.3, b: 1.3, y0: 0.62, y1: 2.62 },
      { a: -0.7, b: 0.7, y0: 3.62, y1: 5.3 },
      { a: -0.35, b: 0.35, y0: 6.6, y1: 7.55 },
    ],
  },
  {
    face: "x+",
    at: MAIN.x1,
    from: MAIN.z0,
    to: MAIN.z1,
    height: MAIN.eave,
    gable: { peakAt: MAIN_RIDGE_Z, peakY: MAIN_RIDGE_Y },
    thickness: WALL,
    openings: [
      { a: -0.45, b: 0.45, y0: 0.9, y1: 5.3 },
      { a: 1.4, b: 3.2, y0: 0.62, y1: 2.62 },
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
    thickness: WALL,
    openings: [
      { a: -11.9, b: -9.9, y0: 1.2, y1: 2.4 },
      { a: -7.3, b: -5.3, y0: 0.7, y1: 2.55 },
    ],
  },
  {
    face: "z-",
    at: WING.z0,
    from: WING.x0,
    to: WING.x1,
    height: WING.eave,
    gable: { peakAt: WING_RIDGE_X, peakY: WING_RIDGE_Y },
    thickness: WALL,
    openings: [{ a: 1.7, b: 3.3, y0: 3.45, y1: 4.45 }],
  },
];

export const WING_GLASS_WALL: WallDef = {
  face: "x-",
  at: WING.x0,
  from: WING.z0,
  to: MAIN.z0,
  height: WING.eave,
  thickness: WALL,
  openings: [{ a: -13.3, b: -4.7, y0: 0, y1: 3.05, kind: "slider" }],
};

function std(params: THREE.MeshStandardMaterialParameters, opts: Parameters<typeof patch>[1] = { cut: "solid" }) {
  return patch(new THREE.MeshStandardMaterial(params), opts);
}

function buildGeometry() {
  const mainWalls = MAIN_WALLS.map(wallGeometry);
  const wingWalls = WING_WALLS.map(wallGeometry);
  const glassWall = wallGeometry(WING_GLASS_WALL);

  const g = emptyGlazing();
  MAIN_WALLS.forEach((w) => glazing(w, g));
  WING_WALLS.forEach((w) => glazing(w, g, { daylight: true }));
  const gw = emptyGlazing();
  glazing(WING_GLASS_WALL, gw);

  const mergeWalls = (list: THREE.BufferGeometry[]) => {
    // keep the 3 groups: concatenate per group
    const P: number[][] = [[], [], []];
    const N: number[][] = [[], [], []];
    const T: number[][] = [[], [], []];
    for (const geo of list) {
      const pos = geo.attributes.position.array;
      const nor = geo.attributes.normal.array;
      const uv = geo.attributes.uv.array;
      for (const grp of geo.groups) {
        const gi = grp.materialIndex ?? 0;
        for (let i = grp.start; i < grp.start + grp.count; i++) {
          P[gi].push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          N[gi].push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
          T[gi].push(uv[i * 2], uv[i * 2 + 1]);
        }
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(P.flat(), 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(N.flat(), 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(T.flat(), 2));
    let start = 0;
    for (let gi = 0; gi < 3; gi++) {
      out.addGroup(start, P[gi].length / 3, gi);
      start += P[gi].length / 3;
    }
    list.forEach((l) => l.dispose());
    return out;
  };

  // plinth + slabs
  const plinth: Placed[] = [
    { geo: box(MAIN.x1 - MAIN.x0 + 0.08, 0.27, MAIN.z1 - MAIN.z0 + 0.08), pos: [(MAIN.x0 + MAIN.x1) / 2, FLOOR_Y - 0.135, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(WING.x1 - WING.x0 + 0.08, 0.27, WING.z1 - WING.z0 + 0.04), pos: [(WING.x0 + WING.x1) / 2, FLOOR_Y - 0.135, (WING.z0 + WING.z1) / 2 - 0.02] },
  ];
  const slabs: Placed[] = [
    { geo: box(MAIN.x1 - MAIN.x0 - WALL * 2, 0.26, MAIN.z1 - MAIN.z0 - WALL * 2), pos: [(MAIN.x0 + MAIN.x1) / 2, MAIN.level2 - 0.13, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(MAIN.x1 - MAIN.x0 - WALL * 2, 0.04, MAIN.z1 - MAIN.z0 - WALL * 2), pos: [(MAIN.x0 + MAIN.x1) / 2, FLOOR_Y + 0.02, (MAIN.z0 + MAIN.z1) / 2] },
    { geo: box(MAIN.x1 - MAIN.x0 - WALL * 2, 0.12, MAIN.z1 - MAIN.z0 - WALL * 2), pos: [(MAIN.x0 + MAIN.x1) / 2, MAIN.eave - 0.06, (MAIN.z0 + MAIN.z1) / 2] },
  ];
  // front door canopy + step
  const canopy: Placed[] = [{ geo: box(2.2, 0.08, 1.1), pos: [0, 2.78, MAIN.z1 + 0.55] }];
  const steps: Placed[] = [
    { geo: box(2.6, 0.16, 1.4), pos: [0, 0.08, MAIN.z1 + 0.7] },
    { geo: box(3.8, 0.1, 1.6), pos: [-3.5, 0.05, MAIN.z0 - 0.8] },
  ];

  return {
    mainWalls: mergeWalls(mainWalls),
    wingWalls: mergeWalls(wingWalls),
    glassWall: mergeWalls([glassWall]),
    frames: merge([...g.frames, ...g.sills]),
    glass: merge(g.glass),
    inner: merge(g.inner),
    doors: merge(g.doors),
    gwFrames: merge(gw.frames),
    gwGlass: merge(gw.glass),
    plinth: merge([...plinth, ...steps]),
    slabs: merge(slabs),
    canopy: merge(canopy),
  };
}

export type HouseGeometry = ReturnType<typeof buildGeometry>;
let geometryCache: HouseGeometry | null = null;
export function houseGeometry() {
  if (!geometryCache) geometryCache = buildGeometry();
  return geometryCache;
}

export function House() {
  const geo = useMemo(houseGeometry, []);
  const mats = useMemo(() => {
    const pl = plaster();
    const cd = cedar();
    const cc = concrete(0, "#6d6862", 3, 4);
    const wall = std({ map: pl.map, normalMap: pl.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.93, color: "#ffffff" });
    const drywall = std({ color: "#f3f1ec", roughness: 0.95 });
    const wood = std({ map: cd.map, normalMap: cd.normalMap, roughness: 0.78, color: "#ffffff" });
    const trim = std({ color: "#222326", roughness: 0.52, metalness: 0.35 });
    const glass = std({ color: "#7d909d", roughness: 0.05, metalness: 0.92, envMapIntensity: 1.25, emissive: new THREE.Color("#ffab5e"), emissiveIntensity: 0 });
    const daylight = std({ color: "#dfe7ea", roughness: 1, emissive: new THREE.Color("#eef3f2"), emissiveIntensity: 0.55 });
    const plinthMat = std({ map: cc.map, roughness: 0.9, color: "#ffffff" });
    const slab = std({ color: "#cfcac1", roughness: 0.9 });
    const fadeWall = std({ map: cd.map, normalMap: cd.normalMap, roughness: 0.78 }, { cut: "solid", fade: fades.glassWall });
    const fadeDry = std({ color: "#f3f1ec", roughness: 0.95 }, { cut: "solid", fade: fades.glassWall });
    const fadeTrim = std({ color: "#222326", roughness: 0.52, metalness: 0.35 }, { cut: "solid", fade: fades.glassWall });
    const fadeGlass = std({ color: "#7d909d", roughness: 0.05, metalness: 0.92, envMapIntensity: 1.25, emissive: new THREE.Color("#ffab5e"), emissiveIntensity: 0 }, { cut: "solid", fade: fades.glassWall });
    const ghost = ghostMaterial("#7d93aa", 1);
    const edges = patch(new THREE.LineBasicMaterial({ color: "#3b4654", transparent: true, opacity: 0, depthWrite: false }), { cut: "ghost" });
    return { wall, drywall, wood, trim, glass, daylight, plinthMat, slab, fadeWall, fadeDry, fadeTrim, fadeGlass, ghost, edges };
  }, []);

  const ghostRoof = useMemo(() => merge(ROOF_PLANES.map((p) => ({ geo: roofSurface(p, ROOF_T) }))), []);
  const ghostEdges = useMemo(() => {
    const src = [geo.mainWalls, geo.wingWalls, geo.glassWall, ghostRoof];
    const lines = src.map((g) => new THREE.EdgesGeometry(g, 28));
    return merge(lines.map((l) => ({ geo: l }))) as THREE.BufferGeometry;
  }, [geo, ghostRoof]);

  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const depthSolid = useMemo(() => depthFor({ cut: "solid" }), []);
  const depthFade = useMemo(() => depthFor({ cut: "solid", fade: fades.glassWall, fadeKey: "glassWall" }), []);

  const ghostGroup = useRef<THREE.Group>(null);
  const glassGroup = useRef<THREE.Group>(null);

  useFrame(() => {
    const dusk = channels.dusk;
    mats.glass.emissiveIntensity = dusk * 1.6;
    mats.fadeGlass.emissiveIntensity = dusk * 1.6;
    mats.daylight.emissiveIntensity = 0.55 * (1 - dusk) + 0.05;
    mats.edges.opacity = channels.ghost * 0.55;
    if (ghostGroup.current) ghostGroup.current.visible = channels.ghost > 0.01;
    if (glassGroup.current) glassGroup.current.visible = channels.glassWall > 0.01;
  });

  const solid = { castShadow: true, receiveShadow: true, customDepthMaterial: depthSolid };

  return (
    <group name="house">
      <mesh geometry={geo.mainWalls} material={[mats.wall, mats.drywall, mats.wall]} {...solid} />
      <mesh geometry={geo.wingWalls} material={[mats.wood, mats.drywall, mats.wood]} {...solid} />
      <mesh geometry={geo.frames} material={mats.trim} {...solid} />
      <mesh geometry={geo.glass} material={mats.glass} receiveShadow />
      <mesh geometry={geo.inner} material={mats.daylight} />
      <mesh geometry={geo.doors} material={mats.wood} {...solid} />
      <mesh geometry={geo.plinth} material={mats.plinthMat} {...solid} />
      <mesh geometry={geo.slabs} material={mats.slab} {...solid} />
      <mesh geometry={geo.canopy} material={mats.trim} {...solid} />
      <group ref={glassGroup}>
        <mesh geometry={geo.glassWall} material={[mats.fadeWall, mats.fadeDry, mats.fadeWall]} castShadow receiveShadow customDepthMaterial={depthFade} />
        <mesh geometry={geo.gwFrames} material={mats.fadeTrim} castShadow customDepthMaterial={depthFade} />
        <mesh geometry={geo.gwGlass} material={mats.fadeGlass} />
      </group>
      <Roof />
      <group ref={ghostGroup} visible={false}>
        <mesh geometry={geo.mainWalls} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.wingWalls} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.glassWall} material={mats.ghost} renderOrder={2} />
        <mesh geometry={geo.slabs} material={mats.ghost} renderOrder={2} />
        <mesh geometry={ghostRoof} material={mats.ghost} renderOrder={2} />
        <lineSegments geometry={ghostEdges} material={mats.edges} renderOrder={3} />
      </group>
    </group>
  );
}

export { U };
