"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOOR_Y, MAIN, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { box, merge } from "./geom";
import { channels, OUTPUT_TAIL, U } from "./shared";

type P3 = [number, number, number];

const AH: P3 = [-0.6, MAIN.eave + 0.34, 0.9];
const OU: P3 = [WING.x1 + 0.95, 0.5, -6.9];
const TRUNK_Y = MAIN.eave + 0.28;
const GF_Y = 2.6;

/** Duct runs as polylines. Supply first, then return, then the refrigerant line set. */
const SUPPLY: { pts: P3[]; r: number; zone: "upstairs" | "main" | "kitchen" }[] = [
  { pts: [[AH[0] + 0.7, TRUNK_Y, 0.9], [2.6, TRUNK_Y, 0.2], [4.8, TRUNK_Y, -0.3]], r: 0.17, zone: "upstairs" },
  { pts: [[AH[0] - 0.7, TRUNK_Y, 0.9], [-2.8, TRUNK_Y, 0.2], [-4.9, TRUNK_Y, -0.3]], r: 0.17, zone: "upstairs" },
  { pts: [[-4.2, TRUNK_Y, -0.2], [-4.2, TRUNK_Y + 0.05, 1.0], [-4.1, MAIN.eave + 0.02, 2.0]], r: 0.085, zone: "upstairs" },
  { pts: [[0.2, TRUNK_Y, 0.4], [0.2, TRUNK_Y + 0.05, 1.3], [0.2, MAIN.eave + 0.02, 2.2]], r: 0.085, zone: "upstairs" },
  { pts: [[4.1, TRUNK_Y, -0.2], [4.1, TRUNK_Y + 0.05, 1.0], [4.0, MAIN.eave + 0.02, 2.0]], r: 0.085, zone: "upstairs" },
  { pts: [[3.0, TRUNK_Y, -0.1], [3.0, TRUNK_Y, -1.2], [2.9, MAIN.eave + 0.02, -2.3]], r: 0.085, zone: "upstairs" },
  // riser to the main floor
  { pts: [[2.2, TRUNK_Y, 0.0], [2.2, TRUNK_Y - 0.2, -2.9], [2.2, GF_Y + 0.4, -3.2], [2.2, GF_Y, -3.2]], r: 0.14, zone: "main" },
  { pts: [[2.2, GF_Y, -3.2], [-1.0, GF_Y, -3.2], [-4.6, GF_Y, -3.2]], r: 0.15, zone: "main" },
  { pts: [[-4.2, GF_Y, -3.1], [-4.2, GF_Y + 0.08, -1.0], [-4.2, 2.74, 1.4]], r: 0.08, zone: "main" },
  { pts: [[-1.0, GF_Y, -3.1], [-1.0, GF_Y + 0.08, -0.4], [-1.0, 2.74, 2.0]], r: 0.08, zone: "main" },
  { pts: [[2.2, GF_Y, -3.1], [3.4, GF_Y + 0.08, -0.4], [3.6, 2.74, 2.0]], r: 0.08, zone: "main" },
  // into the kitchen wing
  { pts: [[2.2, GF_Y, -3.2], [3.3, GF_Y + 0.3, -4.4], [3.3, 3.05, -6.0], [3.3, 3.05, -12.6]], r: 0.12, zone: "kitchen" },
];

const RETURN: P3[][] = [
  [[-1.8, MAIN.eave + 0.02, -2.4], [-1.8, TRUNK_Y + 0.25, -1.4], [-1.4, TRUNK_Y + 0.3, 0.3], [AH[0] - 0.75, AH[1], AH[2]]],
  [[-3.1, FLOOR_Y + 0.45, -3.55], [-3.1, 2.4, -3.5], [-3.1, MAIN.level2 + 0.6, -3.45], [-2.6, TRUNK_Y + 0.35, -1.8], [AH[0] - 0.75, AH[1] - 0.1, AH[2] - 0.2]],
];

const LINESET: P3[] = [
  [OU[0] - 0.35, 0.75, OU[2]],
  [WING.x1 + 0.12, 0.75, OU[2]],
  [WING.x1 + 0.12, 0.75, MAIN.z0 - 0.3],
  [MAIN.x1 + 0.12, 0.8, MAIN.z0 + 0.4],
  [MAIN.x1 + 0.12, MAIN.eave + 0.1, MAIN.z0 + 0.4],
  [MAIN.x1 - 0.8, TRUNK_Y + 0.4, -1.2],
  [AH[0] + 0.5, AH[1] + 0.1, AH[2] - 0.3],
];

const REGISTERS: P3[] = [
  [-4.1, MAIN.eave - 0.01, 2.0],
  [0.2, MAIN.eave - 0.01, 2.2],
  [4.0, MAIN.eave - 0.01, 2.0],
  [2.9, MAIN.eave - 0.01, -2.3],
  [-4.2, 2.76, 1.4],
  [-1.0, 2.76, 2.0],
  [3.6, 2.76, 2.0],
  [3.3, 2.98, -7.2],
  [3.3, 2.98, -10.4],
  [3.3, 2.98, -12.4],
];

function tube(pts: P3[], r: number): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(...p)),
    false,
    "catmullrom",
    0.05,
  );
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 6)), r, 10, false);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len); // metres along the run
  return g;
}

function flowMaterial(color: THREE.Color | { value: THREE.Color }, speed: number, strength: number) {
  const uColor = "value" in color ? color : { value: color };
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uColor, uSpeed: { value: speed }, uGain: { value: strength }, uVis: { value: 0 } },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uSpeed;
      uniform float uGain;
      uniform float uVis;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = fract(vUv.x / 0.9 - uTime * uSpeed);
        float stripe = smoothstep(0.0, 0.18, f) * (1.0 - smoothstep(0.32, 0.5, f));
        float rim = 0.55 + 0.45 * abs(dot(normalize(vN), normalize(vV)));
        vec3 col = uColor * rim * (0.75 + stripe * uGain);
        gl_FragColor = vec4(col, uVis);
        ${OUTPUT_TAIL}
      }
    `,
  });
}

export function Hvac() {
  const issue = useDemo((s) => s.hvac.issue);
  const zone = useDemo((s) => s.hvac.zone);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const inside = useRef<THREE.Group>(null);

  const geo = useMemo(() => {
    const supply = merge(SUPPLY.map((d) => ({ geo: tube(d.pts, d.r) })));
    const upstairs = merge(SUPPLY.filter((d) => d.zone === "upstairs" && d.r < 0.1).map((d) => ({ geo: tube(d.pts, d.r + 0.012) })));
    const ret = merge(RETURN.map((pts) => ({ geo: tube(pts, 0.15) })));
    const lines = merge([{ geo: tube(LINESET, 0.028) }]);
    const regs = merge(REGISTERS.map((p) => ({ geo: box(0.36, 0.03, 0.26), pos: p })));
    const plume = new THREE.ConeGeometry(0.34, 0.9, 20, 1, true);
    plume.translate(0, -0.45, 0);
    const plumes = merge(REGISTERS.map((p) => ({ geo: plume, pos: [p[0], p[1] - 0.02, p[2]] as P3 })));
    return { supply, upstairs, ret, lines, regs, plumes };
  }, []);

  const mats = useMemo(() => {
    const plume = new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uColor: U.airColor, uVis: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying float vY;
        void main() {
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uVis;
        varying float vY;
        void main() {
          float t = clamp(-vY / 0.9, 0.0, 1.0);
          float wave = 0.5 + 0.5 * sin((t * 9.0 - uTime * 4.0));
          float a = (1.0 - t) * (1.0 - t) * (0.12 + 0.2 * wave) * uVis;
          gl_FragColor = vec4(uColor * 0.9, a);
          ${OUTPUT_TAIL}
        }
      `,
    });
    return {
      supply: flowMaterial(U.airColor, 0.9, 1.4),
      hot: flowMaterial(new THREE.Color("#ff7a3c"), 1.1, 1.6),
      ret: flowMaterial(new THREE.Color("#8d8fa6"), 0.45, 0.8),
      lines: new THREE.MeshStandardMaterial({ color: "#c27a4a", metalness: 0.9, roughness: 0.35, emissive: new THREE.Color("#ff8a3c"), emissiveIntensity: 0 }),
      regs: new THREE.MeshStandardMaterial({ color: "#f4f3f0", roughness: 0.5 }),
      unit: new THREE.MeshStandardMaterial({ color: "#d9d9d6", roughness: 0.45, metalness: 0.2, emissive: new THREE.Color("#ff9a3c"), emissiveIntensity: 0 }),
      grille: new THREE.MeshStandardMaterial({ color: "#2b2c2f", roughness: 0.6, metalness: 0.4 }),
      ah: new THREE.MeshStandardMaterial({ color: "#c9ccce", roughness: 0.4, metalness: 0.5, emissive: new THREE.Color("#ff9a3c"), emissiveIntensity: 0 }),
      filter: new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.8, emissive: new THREE.Color("#ffb45c"), emissiveIntensity: 0 }),
      pad: new THREE.MeshStandardMaterial({ color: "#c8c2b6", roughness: 0.95 }),
      zoneWarm: new THREE.MeshBasicMaterial({ color: "#ff8a4c", transparent: true, opacity: 0, depthWrite: false }),
      zoneNote: new THREE.MeshBasicMaterial({ color: "#e0c398", transparent: true, opacity: 0, depthWrite: false }),
      thermo: new THREE.MeshStandardMaterial({ color: "#f2f1ed", emissive: new THREE.Color("#7fd6ff"), emissiveIntensity: 0.8 }),
      plume,
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const active = industry === "hvac" && (phase === "explore" || phase === "qualify" || phase === "flow");
  const focusOU = active && (issue === "cooling" || issue === "maintenance" || issue === "replace");
  const focusAH = active && (issue === "noise" || issue === "replace" || issue === "maintenance");
  const warmUp = active && issue === "uneven";

  useFrame(() => {
    const v = channels.hvac;
    if (inside.current) inside.current.visible = v > 0.01;
    const vis = Math.min(1, v * 1.2);
    mats.supply.uniforms.uVis.value = vis;
    mats.ret.uniforms.uVis.value = vis * 0.9;
    mats.hot.uniforms.uVis.value = warmUp ? vis : 0;
    mats.plume.uniforms.uVis.value = vis;
    const pulse = 0.5 + 0.5 * Math.sin(U.time.value * 3.2);
    mats.unit.emissiveIntensity = focusOU ? 0.25 + pulse * 0.6 : 0;
    mats.lines.emissiveIntensity = focusOU && issue === "cooling" ? 0.3 + pulse * 0.7 : 0;
    mats.ah.emissiveIntensity = focusAH ? 0.25 + pulse * 0.6 : 0;
    mats.filter.emissiveIntensity = active && issue === "maintenance" ? 0.6 + pulse * 1.2 : 0;
    mats.zoneWarm.opacity = warmUp ? 0.1 + pulse * 0.06 : 0;
    mats.zoneNote.opacity = active && zone && !(warmUp && zone === "upstairs") ? 0.12 : 0;
  });

  const zoneBox = (z: "upstairs" | "main" | "kitchen"): { pos: P3; size: P3 } =>
    z === "upstairs"
      ? { pos: [0, (MAIN.level2 + MAIN.eave) / 2 + 0.05, 0], size: [11.3, MAIN.eave - MAIN.level2 - 0.2, 7.3] }
      : z === "main"
        ? { pos: [0, (FLOOR_Y + MAIN.level2) / 2 - 0.1, 0], size: [11.3, MAIN.level2 - FLOOR_Y - 0.4, 7.3] }
        : { pos: [(WING.x0 + WING.x1) / 2, (FLOOR_Y + WING.eave) / 2, (WING.z0 + WING.z1) / 2], size: [6.3, WING.eave - FLOOR_Y - 0.2, 9.3] };

  const label = (text: string, pos: P3, hot?: boolean) => (
    <Html position={pos} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className={`tag3d ${hot ? "tag3d--hot" : "tag3d--accent"}`}>{text}</div>
    </Html>
  );

  return (
    <group name="hvac">
      {/* outdoor unit — part of the property, always there */}
      <mesh material={mats.pad} position={[OU[0], 0.05, OU[2]]} receiveShadow>
        <boxGeometry args={[1.15, 0.1, 1.15]} />
      </mesh>
      <mesh material={mats.unit} position={[OU[0], 0.55, OU[2]]} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.86, 0.86]} />
      </mesh>
      <mesh material={mats.grille} position={[OU[0], 0.99, OU[2]]}>
        <cylinderGeometry args={[0.33, 0.33, 0.02, 24]} />
      </mesh>

      <group ref={inside} visible={false}>
        <mesh geometry={geo.supply} material={mats.supply} renderOrder={5} />
        <mesh geometry={geo.upstairs} material={mats.hot} renderOrder={6} />
        <mesh geometry={geo.ret} material={mats.ret} renderOrder={5} />
        <mesh geometry={geo.lines} material={mats.lines} />
        <mesh geometry={geo.regs} material={mats.regs} />
        <mesh geometry={geo.plumes} material={mats.plume} renderOrder={7} />
        <mesh material={mats.ah} position={AH} castShadow>
          <boxGeometry args={[1.5, 0.66, 0.76]} />
        </mesh>
        <mesh material={mats.filter} position={[AH[0] - 0.77, AH[1], AH[2]]}>
          <boxGeometry args={[0.04, 0.56, 0.66]} />
        </mesh>
        <mesh material={mats.thermo} position={[-1.95, FLOOR_Y + 1.45, MAIN.z0 + 0.3]}>
          <boxGeometry args={[0.12, 0.12, 0.025]} />
        </mesh>
        {(["upstairs", "main", "kitchen"] as const).map((z) => {
          const b = zoneBox(z);
          const warm = warmUp && z === "upstairs";
          const note = zone === z;
          if (!warm && !note) return null;
          return (
            <mesh key={z} position={b.pos} material={warm ? mats.zoneWarm : mats.zoneNote} renderOrder={4}>
              <boxGeometry args={b.size} />
            </mesh>
          );
        })}
        {active && phase === "explore" && (
          <>
            {warmUp && label("Upstairs · 4° over set point", [0, MAIN.eave + 1.4, 2.6], true)}
            {focusAH && label(issue === "maintenance" ? "Filter · air handler" : "Air handler", [AH[0] - 0.4, AH[1] + 1.0, AH[2]])}
            {issue === "cooling" && label("Refrigerant lines", [MAIN.x1 + 0.4, 3.6, MAIN.z0 + 0.4])}
          </>
        )}
      </group>
      {active && phase === "explore" && focusOU && label(issue === "maintenance" ? "Coil cleaning" : "Outdoor unit", [OU[0], 1.9, OU[2]])}
    </group>
  );
}
