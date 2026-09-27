"use client";

import { Html, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOOR_Y, MAIN, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { Callout } from "./Callout";
import { box, merge } from "./geom";
import { solid } from "./materials";
import { rng } from "./proc";
import { channels, OUTPUT_TAIL, U } from "./shared";

/**
 * The house's air system as an engineering drawing come to life: the building turns to glass,
 * the ducts are sheet metal seen in x-ray, and the air itself moves through them — cool blue
 * or warm amber, restrained — out of every register. The outdoor unit (a CC0 scan) and the
 * attic air handler are solid equipment. The customer's problem decides what is highlighted.
 */

type P3 = [number, number, number];

const AH: P3 = [-0.6, MAIN.eave + 0.34, 0.9];
const OU: P3 = [WING.x1 + 0.95, 0.5, -6.9];
const TRUNK_Y = MAIN.eave + 0.28;
const GF_Y = 2.6;

/** Duct runs as polylines, in the direction the air moves. */
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

/** Ceiling registers: [position, zone] */
const REGISTERS: [P3, "upstairs" | "main" | "kitchen"][] = [
  [[-4.1, MAIN.eave - 0.01, 2.0], "upstairs"],
  [[0.2, MAIN.eave - 0.01, 2.2], "upstairs"],
  [[4.0, MAIN.eave - 0.01, 2.0], "upstairs"],
  [[2.9, MAIN.eave - 0.01, -2.3], "upstairs"],
  [[-4.2, 2.76, 1.4], "main"],
  [[-1.0, 2.76, 2.0], "main"],
  [[3.6, 2.76, 2.0], "main"],
  [[3.3, 2.98, -7.2], "kitchen"],
  [[3.3, 2.98, -10.4], "kitchen"],
  [[3.3, 2.98, -12.4], "kitchen"],
];

function curveOf(pts: P3[]) {
  return new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(...p)),
    false,
    "catmullrom",
    0.05,
  );
}

function tube(pts: P3[], r: number): THREE.TubeGeometry {
  const curve = curveOf(pts);
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 6)), r, 16, false);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len); // metres along the run
  return g;
}

/** Sheet metal in x-ray: faint body, stronger rims and joints every 1.5 m, a tight highlight. */
function xrayMaterial(tint: string, strength: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color(tint) }, uVis: { value: 0 }, uStrength: { value: strength } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      uniform float uVis;
      uniform float uStrength;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float nv = abs(dot(N, V));
        float rim = pow(1.0 - nv, 2.2);
        float joint = 1.0 - smoothstep(0.0, 0.035, abs(fract(vUv.x / 1.5) - 0.5) * 1.5 - 0.7);
        vec3 H = normalize(normalize(vec3(-0.35, 1.0, 0.45)) + V);
        float spec = pow(max(dot(N, H), 0.0), 70.0);
        vec3 col = uTint * (0.5 + 0.6 * rim) + spec * 0.5;
        float a = uVis * uStrength * (0.1 + 0.6 * rim + 0.35 * joint + spec * 0.4);
        gl_FragColor = vec4(col, a);
        ${OUTPUT_TAIL}
      }
    `,
  });
}

/* ------------------------------------------------------------- the air */

type StreamKind = "supply" | "return" | "out";
interface Stream {
  lut: Float32Array; // equal-arc-length samples
  n: number;
  len: number;
  kind: StreamKind;
  zone: "upstairs" | "main" | "kitchen" | null;
  branch: boolean;
}

function stream(pts: P3[], kind: StreamKind, zone: Stream["zone"], branch = false): Stream {
  const curve = curveOf(pts);
  const len = curve.getLength();
  const n = Math.max(8, Math.round(len * 12));
  const lut = new Float32Array((n + 1) * 3);
  curve.getSpacedPoints(n).forEach((p, i) => p.toArray(lut, i * 3));
  return { lut, n, len, kind, zone, branch };
}

const AIR_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
uniform float uVis;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = aAlpha * uVis;
}
`;
const AIR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.0) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
  ${OUTPUT_TAIL}
}
`;

const COOL = new THREE.Color("#5fb6ff");
const WARM = new THREE.Color("#ff9656");
const DEAD = new THREE.Color("#aeb6bc");
const RET = new THREE.Color("#b9b3cc");

function Air({ mode, issue }: { mode: "cool" | "heat"; issue: string }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const streams = useMemo(() => {
    const out: Stream[] = [];
    for (const d of SUPPLY) out.push(stream(d.pts, "supply", d.zone, d.r < 0.1));
    for (const pts of RETURN) out.push(stream(pts, "return", null));
    for (const [p, zone] of REGISTERS) out.push(stream([p, [p[0], p[1] - 0.45, p[2]], [p[0], p[1] - 0.9, p[2]]], "out", zone));
    return out;
  }, []);
  // particles: which stream, where along it, how fast
  const parts = useMemo(() => {
    const list: { s: number; phase: number; speed: number }[] = [];
    const jitter = rng(7);
    streams.forEach((st, si) => {
      const spacing = st.kind === "out" ? 0.11 : st.kind === "return" ? 0.42 : 0.3;
      const count = Math.max(2, Math.round(st.len / spacing));
      for (let i = 0; i < count; i++) list.push({ s: si, phase: (i + jitter() * 0.4) / count, speed: st.kind === "return" ? 0.7 : st.kind === "out" ? 0.55 : 1.3 });
    });
    return list;
  }, [streams]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(parts.length * 3), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(parts.length * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(parts.length), 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(parts.length), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, -4), 14);
    return g;
  }, [parts]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 1 }, uVis: { value: 0 } },
        vertexShader: AIR_VERT,
        fragmentShader: AIR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  // colours and sizes follow the mode and the problem
  useEffect(() => {
    const col = geo.attributes.aColor as THREE.BufferAttribute;
    const sz = geo.attributes.aSize as THREE.BufferAttribute;
    const supply = issue === "cooling" ? DEAD : mode === "heat" ? WARM : COOL;
    parts.forEach((p, i) => {
      const st = streams[p.s];
      const c = st.kind === "return" ? RET : supply;
      col.setXYZ(i, c.r, c.g, c.b);
      sz.setX(i, st.kind === "out" ? 0.13 : st.kind === "return" ? 0.11 : st.branch ? 0.1 : 0.14);
    });
    col.needsUpdate = true;
    sz.needsUpdate = true;
  }, [mode, issue, parts, streams, geo]);

  useFrame(() => {
    const vis = Math.min(1, channels.hvac * 1.2);
    mat.uniforms.uVis.value = vis;
    if (vis <= 0.01) return;
    mat.uniforms.uScale.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const t = U.time.value;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;
    const weak = issue === "uneven";
    const faint = issue === "cooling";
    parts.forEach((p, i) => {
      const st = streams[p.s];
      // upstairs branches starve when the system is out of balance
      const starved = weak && st.zone === "upstairs" && st.kind !== "return";
      const speed = p.speed * (starved ? 0.35 : faint && st.kind !== "return" ? 0.5 : 1);
      const u = (((p.phase + (t * speed) / st.len) % 1) + 1) % 1;
      const f = u * st.n;
      const k = Math.min(st.n - 1, Math.floor(f));
      const w = f - k;
      const a = k * 3;
      const b = a + 3;
      pos.setXYZ(i, st.lut[a] + (st.lut[b] - st.lut[a]) * w, st.lut[a + 1] + (st.lut[b + 1] - st.lut[a + 1]) * w, st.lut[a + 2] + (st.lut[b + 2] - st.lut[a + 2]) * w);
      // soft in and out at the ends of each run; air leaving a register fades as it spreads
      const edge = Math.min(1, u * 8, (1 - u) * 8);
      const base = st.kind === "out" ? (1 - u) * 0.95 : st.kind === "return" ? 0.55 : 1;
      alpha.setX(i, base * edge * (starved ? 0.45 : 1) * (faint && st.kind !== "return" ? 0.55 : 1));
    });
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  });

  return <points geometry={geo} material={mat} renderOrder={8} frustumCulled={false} />;
}

/* ---------------------------------------------------------- equipment */

const MODEL = "/assets/models/aircon.glb";

/** The outdoor unit: a CC0 scan; the weathered twin stands in when it is due for replacement. */
function OutdoorUnit({ old, glow }: { old: boolean; glow: boolean }) {
  const gltf = useGLTF(MODEL, false, true);
  const units = useMemo(() => {
    const pick = (name: string) => {
      const src = gltf.scene.getObjectByName(name);
      const o = (src ?? new THREE.Group()).clone(true);
      o.position.set(0, 0, 0);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          (m.material as THREE.MeshStandardMaterial).envMapIntensity = 0.8;
        }
      });
      return o;
    };
    return { fresh: pick("exterior_aircon_unit"), rusted: pick("exterior_aircon_unit_rusted") };
  }, [gltf]);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ring.current) return;
    const m = ring.current.material as THREE.MeshBasicMaterial;
    const want = glow ? 0.35 + 0.25 * Math.sin(U.time.value * 3) : 0;
    m.opacity += (want - m.opacity) * 0.1;
    ring.current.visible = m.opacity > 0.01;
  });
  return (
    <group position={[OU[0], 0.1 + 0.32, OU[2]]} rotation={[0, Math.PI / 2, 0]} scale={1.12}>
      <primitive object={old ? units.rusted : units.fresh} />
      <mesh ref={ring} position={[0, -0.41, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.62, 0.68, 64]} />
        <meshBasicMaterial color="#f0a36a" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Hvac() {
  const issue = useDemo((s) => s.hvac.issue);
  const mode = useDemo((s) => s.hvac.mode);
  const zone = useDemo((s) => s.hvac.zone);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const inside = useRef<THREE.Group>(null);

  const geo = useMemo(() => {
    const trunks = merge(SUPPLY.filter((d) => d.r >= 0.1).map((d) => ({ geo: tube(d.pts, d.r) })));
    const branches = merge(SUPPLY.filter((d) => d.r < 0.1).map((d) => ({ geo: tube(d.pts, d.r) })));
    const ret = merge(RETURN.map((pts) => ({ geo: tube(pts, 0.15) })));
    const lines = merge([{ geo: tube(LINESET, 0.02) }]);
    const regs = merge(
      REGISTERS.flatMap(([p]) => [
        { geo: box(0.36, 0.022, 0.26), pos: p },
        // louvres
        ...[-0.09, -0.03, 0.03, 0.09].map((dz) => ({ geo: box(0.3, 0.012, 0.012), pos: [p[0], p[1] - 0.016, p[2] + dz] as P3 })),
      ]),
    );
    // attic air handler: cabinet, access panels, return plenum, filter rack
    const ah: THREE.BufferGeometry = merge([
      { geo: box(1.5, 0.66, 0.76), pos: AH },
      { geo: box(0.3, 0.6, 0.7), pos: [AH[0] - 0.9, AH[1] - 0.02, AH[2]] },
      { geo: box(0.7, 0.18, 0.5), pos: [AH[0] + 0.25, AH[1] + 0.42, AH[2]] },
    ]);
    const panels = merge([
      { geo: box(0.64, 0.54, 0.012), pos: [AH[0] - 0.33, AH[1], AH[2] + 0.386] },
      { geo: box(0.64, 0.54, 0.012), pos: [AH[0] + 0.39, AH[1], AH[2] + 0.386] },
    ]);
    const pad = merge([{ geo: box(1.35, 0.1, 1.2), pos: [OU[0], 0.05, OU[2]] }]);
    return { trunks, branches, ret, lines, regs, ah, panels, pad };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  const mats = useMemo(
    () => ({
      trunk: xrayMaterial("#c9d3dc", 1),
      branch: xrayMaterial("#c9d3dc", 0.85),
      ret: xrayMaterial("#9a97a8", 0.8),
      lines: solid("#b87a4b", 0.35, 0.9, { envMapIntensity: 0.8 }),
      regs: solid("#f2f1ed", 0.45, 0, { envMapIntensity: 0.5 }),
      ah: solid("#d4d6d3", 0.5, 0.35, { envMapIntensity: 0.7, emissive: new THREE.Color("#f0a36a"), emissiveIntensity: 0 }),
      panel: solid("#c5c8c6", 0.45, 0.4, { envMapIntensity: 0.7 }),
      filter: solid("#efe9dc", 0.85, 0, { emissive: new THREE.Color("#f0a36a"), emissiveIntensity: 0 }),
      pad: solid("#c8c2b6", 0.95, 0, { envMapIntensity: 0.4 }),
      zoneWarm: new THREE.MeshBasicMaterial({ color: "#ff9a5c", transparent: true, opacity: 0, depthWrite: false }),
      zoneNote: new THREE.MeshBasicMaterial({ color: "#e0c398", transparent: true, opacity: 0, depthWrite: false }),
      thermo: solid("#f2f1ed", 0.4, 0, { emissive: new THREE.Color("#8fd0ff"), emissiveIntensity: 0.6 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const active = industry === "hvac" && (phase === "explore" || phase === "qualify" || phase === "flow");
  const focusOU = active && (issue === "cooling" || issue === "maintenance" || issue === "replace");
  const focusAH = active && (issue === "noise" || issue === "replace" || issue === "maintenance");
  const warmUp = active && issue === "uneven";

  useFrame(() => {
    const v = channels.hvac;
    if (inside.current) inside.current.visible = v > 0.01;
    const vis = Math.min(1, v * 1.2);
    mats.trunk.uniforms.uVis.value = vis;
    mats.branch.uniforms.uVis.value = vis;
    mats.ret.uniforms.uVis.value = vis;
    const pulse = 0.5 + 0.5 * Math.sin(U.time.value * 3.2);
    mats.ah.emissiveIntensity = focusAH ? 0.04 + pulse * 0.12 : 0;
    mats.filter.emissiveIntensity = active && issue === "maintenance" ? 0.3 + pulse * 0.6 : 0;
    mats.lines.emissive.set("#8fd0ff");
    mats.lines.emissiveIntensity = active && issue === "cooling" ? 0.15 + pulse * 0.35 : 0;
    mats.zoneWarm.opacity = warmUp ? 0.07 + pulse * 0.04 : 0;
    mats.zoneNote.opacity = active && zone && !(warmUp && zone === "upstairs") ? 0.08 : 0;
  });

  const zoneBox = (z: "upstairs" | "main" | "kitchen"): { pos: P3; size: P3 } =>
    z === "upstairs"
      ? { pos: [0, (MAIN.level2 + MAIN.eave) / 2 + 0.05, 0], size: [11.3, MAIN.eave - MAIN.level2 - 0.2, 7.3] }
      : z === "main"
        ? { pos: [0, (FLOOR_Y + MAIN.level2) / 2 - 0.1, 0], size: [11.3, MAIN.level2 - FLOOR_Y - 0.4, 7.3] }
        : { pos: [(WING.x0 + WING.x1) / 2, (FLOOR_Y + WING.eave) / 2, (WING.z0 + WING.z1) / 2], size: [6.3, WING.eave - FLOOR_Y - 0.2, 9.3] };

  const callout = (key: string, at: P3, k: string, v: string, tone?: "warm" | "cool") => (
    <Html key={key} position={at} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <Callout k={k} v={v} tone={tone} />
    </Html>
  );
  const heat = mode === "heat";
  const show = active && phase === "explore";

  return (
    <group name="hvac">
      {/* outdoor unit — part of the property, always there */}
      <mesh geometry={geo.pad} material={mats.pad} receiveShadow />
      <Suspense fallback={null}>
        <OutdoorUnit old={active && issue === "replace"} glow={focusOU} />
      </Suspense>

      <group ref={inside} visible={false}>
        <mesh geometry={geo.lines} material={mats.lines} />
        <mesh geometry={geo.trunks} material={mats.trunk} renderOrder={5} />
        <mesh geometry={geo.branches} material={mats.branch} renderOrder={5} />
        <mesh geometry={geo.ret} material={mats.ret} renderOrder={5} />
        <mesh geometry={geo.regs} material={mats.regs} />
        <mesh geometry={geo.ah} material={mats.ah} castShadow />
        <mesh geometry={geo.panels} material={mats.panel} />
        <mesh material={mats.filter} position={[AH[0] - 1.06, AH[1] - 0.02, AH[2]]}>
          <boxGeometry args={[0.03, 0.56, 0.66]} />
        </mesh>
        <mesh material={mats.thermo} position={[-1.95, FLOOR_Y + 1.45, MAIN.z0 + 0.3]}>
          <boxGeometry args={[0.12, 0.12, 0.025]} />
        </mesh>
        <Air mode={mode} issue={issue} />
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
        {show && warmUp && callout("zone", [0.2, MAIN.eave - 0.3, 2.4], "Upstairs · 4° over set point", "Weak supply to the bedrooms", "warm")}
        {show && focusAH && callout("ah", [AH[0] + 0.2, AH[1] + 0.5, AH[2]], "Air handler · attic", issue === "maintenance" ? "Filter and coil due" : issue === "noise" ? "Blower and mounts" : "Replace with the outdoor unit", issue === "noise" ? "warm" : undefined)}
        {show && issue === "cooling" && callout("lines", [MAIN.x1 + 0.12, 3.6, MAIN.z0 + 0.4], "Refrigerant lines", "Charge and insulation", "cool")}
        {show && !focusOU && !warmUp && !focusAH && callout("air", [-4.1, MAIN.eave - 0.5, 2.0], heat ? "Supply air · heating" : "Supply air · cooling", heat ? "Warm air to every room" : "Cool air to every room", heat ? "warm" : "cool")}
      </group>
      {show && focusOU && callout("ou", [OU[0], 1.25, OU[2]], "Outdoor unit", issue === "replace" ? "Due for replacement" : issue === "maintenance" ? "Coil cleaning" : "Coil, capacitor, contactor", issue === "replace" ? "warm" : "cool")}
    </group>
  );
}

if (typeof window !== "undefined") {
  const idle = (cb: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 8000 }) : setTimeout(cb, 4000));
  idle(() => useGLTF.preload(MODEL, false, true));
}
