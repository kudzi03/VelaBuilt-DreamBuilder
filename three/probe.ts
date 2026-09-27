"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { LampGroup } from "./lamps";
import { wipes } from "./shared";

/**
 * Interior reflection probe. Rooms lit by the open-sky environment look flat and take the
 * sky's colour; a real room is lit by itself. This captures the room once (a cube render from
 * inside, lamps on, windows showing the evening), prefilters it, and hands it to every
 * interior material as its environment: diffuse bounce from the lit room, reflections of the
 * pendants and the windows in the stone and the glass. Re-captured when the room changes.
 */

type V3 = [number, number, number];
const GROUPS: LampGroup[] = ["kitchen", "interior"];

function interiorMaterials(scene: THREE.Scene) {
  const out = new Set<THREE.MeshStandardMaterial>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const groups = mat.userData.lampGroups as LampGroup[] | undefined;
      if (groups && groups.some((g) => GROUPS.includes(g))) out.add(mat as THREE.MeshStandardMaterial);
    }
  });
  return out;
}

export function useInteriorProbe(opts: { position: V3; active: boolean; version: string; ready: () => boolean; size: number; intensity?: number }) {
  const { gl, scene } = useThree();
  const { position, active, version, ready, size } = opts;
  const intensity = opts.intensity ?? 1;
  const probe = useMemo(() => {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.05, 80, rt);
    const pmrem = new THREE.PMREMGenerator(gl);
    return { rt, cam, pmrem, env: null as THREE.WebGLRenderTarget | null, due: [] as number[], applied: new Set<THREE.MeshStandardMaterial>() };
  }, [gl, size]);
  useEffect(
    () => () => {
      probe.applied.forEach((m) => restore(m));
      probe.rt.dispose();
      probe.pmrem.dispose();
      probe.env?.dispose();
    },
    [probe],
  );

  // (re)capture shortly after the room changes, and again once new textures have arrived
  useEffect(() => {
    if (!active) return;
    const now = performance.now();
    probe.due = [now + 700, now + 2600];
  }, [active, version, probe]);

  useFrame(() => {
    if (!active) {
      if (probe.applied.size) {
        probe.applied.forEach((m) => restore(m));
        probe.applied.clear();
      }
      return;
    }
    // materials mounted after the capture (a new finish) pick up the probe too
    if (probe.env && probe.due.length === 0) {
      for (const m of interiorMaterials(scene)) if (!probe.applied.has(m)) use(m, probe.env.texture, intensity, probe.applied);
    }
    if (!probe.due.length || performance.now() < probe.due[0] || !ready()) return;
    probe.due.shift();
    const mats = interiorMaterials(scene);
    // first bounce from the sky: the room as the environment lights it, lamps on
    mats.forEach((m) => restore(m));
    probe.applied.clear();
    const wipe = wipes.kitchen.value;
    wipes.kitchen.value = -1; // capture the new kitchen, not the before/after split
    probe.cam.position.set(...position);
    probe.cam.update(gl, scene);
    wipes.kitchen.value = wipe;
    probe.env = probe.pmrem.fromCubemap(probe.rt.texture, probe.env);
    mats.forEach((m) => use(m, probe.env!.texture, intensity, probe.applied));
  });
}

function use(m: THREE.MeshStandardMaterial, env: THREE.Texture, k: number, applied: Set<THREE.MeshStandardMaterial>) {
  if (m.userData.envI === undefined) m.userData.envI = m.envMapIntensity;
  m.envMap = env;
  // the probe is the room's real radiance: it replaces the sky, at a physical weight
  m.envMapIntensity = (m.userData.probeI as number | undefined) ?? k;
  applied.add(m);
}

function restore(m: THREE.MeshStandardMaterial) {
  m.envMap = null;
  if (m.userData.envI !== undefined) m.envMapIntensity = m.userData.envI;
}
