"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MAIN, PANEL, PANEL_SLOTS, ROOF_PLANE_BY_ID, planePoint } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { markShadowsDirty } from "./Atmosphere";
import { box, merge, planeMatrix } from "./geom";
import { solarCells } from "./proc";
import { ROOF_T } from "./Roof";
import { channels } from "./shared";

const N = PANEL_SLOTS.length;
const LIFT = ROOF_T + 0.11;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

function panelFrame(): THREE.BufferGeometry {
  const w = PANEL.w;
  const h = PANEL.h;
  const t = 0.035;
  const d = 0.04;
  return merge([
    { geo: box(w, d, t), pos: [0, 0, h / 2 - t / 2] },
    { geo: box(w, d, t), pos: [0, 0, -h / 2 + t / 2] },
    { geo: box(t, d, h - 2 * t), pos: [w / 2 - t / 2, 0, 0] },
    { geo: box(t, d, h - 2 * t), pos: [-w / 2 + t / 2, 0, 0] },
  ]);
}

function panelCells(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(PANEL.w - 0.06, PANEL.h - 0.06);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.012, 0);
  return g;
}

export function Solar() {
  const count = useDemo((s) => s.solar.panels);
  const finish = useDemo((s) => s.solar.finish);
  const battery = useDemo((s) => s.solar.battery);
  const group = useRef<THREE.Group>(null);
  const frames = useRef<THREE.InstancedMesh>(null);
  const cells = useRef<THREE.InstancedMesh>(null);
  const batteries = useRef<THREE.Group>(null);
  const state = useRef({ p: new Float32Array(N), delay: new Float32Array(N), target: new Uint8Array(N), dirty: true });

  const geo = useMemo(() => ({ frame: panelFrame(), cells: panelCells() }), []);
  const base = useMemo(() => PANEL_SLOTS.map((s) => planeMatrix(ROOF_PLANE_BY_ID[s.plane], s.u, s.v, LIFT)), []);
  const normal = useMemo(() => new THREE.Vector3(...ROOF_PLANE_BY_ID["main-front"].normal), []);

  const mats = useMemo(
    () => ({
      frame: new THREE.MeshStandardMaterial({ color: "#1a1b1e", metalness: 0.7, roughness: 0.35 }),
      cells: new THREE.MeshStandardMaterial({ map: solarCells("black").map, metalness: 0.5, roughness: 0.1, envMapIntensity: 2.1 }),
      battery: new THREE.MeshStandardMaterial({ color: "#efeeea", roughness: 0.55 }),
      led: new THREE.MeshStandardMaterial({ color: "#6ee7c2", emissive: new THREE.Color("#4fe0b0"), emissiveIntensity: 2.4 }),
      conduit: new THREE.MeshStandardMaterial({ color: "#9a9da0", metalness: 0.6, roughness: 0.5 }),
      outline: new THREE.LineDashedMaterial({ color: "#e3892a", dashSize: 0.28, gapSize: 0.18, transparent: true, opacity: 0.9 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useEffect(() => {
    mats.cells.map = solarCells(finish).map;
    mats.frame.color.set(finish === "black" ? "#2a2c31" : "#c9ccd0");
    mats.frame.metalness = finish === "black" ? 0.6 : 0.9;
    mats.cells.needsUpdate = true;
    markShadowsDirty(3);
  }, [finish, mats]);

  const outline = useMemo(() => {
    const p = ROOF_PLANE_BY_ID["main-front"];
    const [u0, u1, v0, v1] = p.usable;
    const pts = [planePoint(p, u0, v0, LIFT - 0.06), planePoint(p, u1, v0, LIFT - 0.06), planePoint(p, u1, v1, LIFT - 0.06), planePoint(p, u0, v1, LIFT - 0.06), planePoint(p, u0, v0, LIFT - 0.06)];
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((x) => new THREE.Vector3(...x)));
    const line = new THREE.Line(g, mats.outline);
    line.computeLineDistances();
    return line;
  }, [mats]);

  const tmp = useMemo(() => new THREE.Matrix4(), []);
  const off = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const vis = channels.solar;
    if (group.current) group.current.visible = vis > 0.001 || state.current.p.some((x) => x > 0);
    const want = vis > 0.5 ? count : 0;
    const st = state.current;
    let order = 0;
    for (let i = 0; i < N; i++) {
      const t = i < want ? 1 : 0;
      if (st.target[i] !== t) {
        st.target[i] = t;
        st.delay[i] = t ? order++ * 0.065 : (N - i) * 0.01;
      }
    }
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (st.delay[i] > 0) {
        st.delay[i] -= dt;
        continue;
      }
      const t = st.target[i];
      const p = st.p[i];
      if (p === t) continue;
      st.p[i] = t ? Math.min(1, p + dt / 0.5) : Math.max(0, p - dt / 0.25);
      changed = true;
    }
    if (changed || st.dirty) {
      st.dirty = false;
      for (let i = 0; i < N; i++) {
        const k = ease(st.p[i]);
        const s = st.p[i] <= 0 ? 0.0001 : 0.92 + 0.08 * k;
        tmp.copy(base[i]);
        off.copy(normal).multiplyScalar((1 - k) * 1.6);
        tmp.elements[12] += off.x;
        tmp.elements[13] += off.y;
        tmp.elements[14] += off.z;
        tmp.scale(scl.set(s, s, s));
        frames.current?.setMatrixAt(i, tmp);
        cells.current?.setMatrixAt(i, tmp);
      }
      if (frames.current) frames.current.instanceMatrix.needsUpdate = true;
      if (cells.current) cells.current.instanceMatrix.needsUpdate = true;
      markShadowsDirty(2);
    }
    mats.outline.opacity = 0.9 * vis;
    if (batteries.current) batteries.current.visible = vis > 0.3;
  });

  // Battery wall on the shaded gable, with a conduit up to the roof.
  const bx = MAIN.x1 + 0.11;
  return (
    <group ref={group} name="solar" visible={false}>
      <instancedMesh ref={frames} args={[geo.frame, mats.frame, N]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={cells} args={[geo.cells, mats.cells, N]} receiveShadow frustumCulled={false} />
      <primitive object={outline} />
      <group ref={batteries}>
        {[0, 1].map((i) => (
          <group key={i} visible={battery > i} position={[bx, 1.12, -2.55 + i * 0.72]}>
            <mesh material={mats.battery} castShadow>
              <boxGeometry args={[0.2, 1.1, 0.62]} />
            </mesh>
            <mesh material={mats.led} position={[0.101, 0.35, 0]}>
              <boxGeometry args={[0.004, 0.012, 0.3]} />
            </mesh>
          </group>
        ))}
        <mesh material={mats.battery} position={[bx, 1.45, -3.35]} castShadow>
          <boxGeometry args={[0.16, 0.56, 0.42]} />
        </mesh>
        <mesh material={mats.conduit} position={[bx - 0.05, (1.75 + MAIN.eave) / 2, -3.35]}>
          <boxGeometry args={[0.05, MAIN.eave - 1.75, 0.05]} />
        </mesh>
      </group>
    </group>
  );
}
