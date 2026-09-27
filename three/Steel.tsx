"use client";

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { track } from "@/lib/analytics";
import { COATINGS } from "@/lib/options";
import { ERECTION_STEPS, SECTIONS, buildFrame, type Member, type SectionId } from "@/lib/steel";
import { useDemo } from "@/lib/store";
import { detectUnits } from "@/lib/units";
import { markShadowsDirty } from "./Atmosphere";
import { channels } from "./shared";

const CENTER = new THREE.Vector3(0.5, 0, -4.5);
const GROUP_GAP = 0.42;
const MEMBER_DUR = 0.7;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

function profileGeometry(id: SectionId): THREE.BufferGeometry {
  const s = SECTIONS[id];
  const vis = (v: number) => Math.max(v, 0.012); // keep thin plates visible at distance
  let g: THREE.BufferGeometry;
  if (s.profile === "I") {
    const b = s.b;
    const d = s.d;
    const tf = vis(s.tf);
    const tw = vis(s.tw);
    const sh = new THREE.Shape();
    sh.moveTo(-b / 2, -d / 2);
    sh.lineTo(b / 2, -d / 2);
    sh.lineTo(b / 2, -d / 2 + tf);
    sh.lineTo(tw / 2, -d / 2 + tf);
    sh.lineTo(tw / 2, d / 2 - tf);
    sh.lineTo(b / 2, d / 2 - tf);
    sh.lineTo(b / 2, d / 2);
    sh.lineTo(-b / 2, d / 2);
    sh.lineTo(-b / 2, d / 2 - tf);
    sh.lineTo(-tw / 2, d / 2 - tf);
    sh.lineTo(-tw / 2, -d / 2 + tf);
    sh.lineTo(-b / 2, -d / 2 + tf);
    sh.closePath();
    g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
  } else if (s.profile === "C") {
    const b = s.b;
    const d = s.d;
    const t = 0.006;
    const lip = 0.02;
    const sh = new THREE.Shape();
    sh.moveTo(0, -d / 2);
    sh.lineTo(b, -d / 2);
    sh.lineTo(b, -d / 2 + lip);
    sh.lineTo(b - t, -d / 2 + lip);
    sh.lineTo(b - t, -d / 2 + t);
    sh.lineTo(t, -d / 2 + t);
    sh.lineTo(t, d / 2 - t);
    sh.lineTo(b - t, d / 2 - t);
    sh.lineTo(b - t, d / 2 - lip);
    sh.lineTo(b, d / 2 - lip);
    sh.lineTo(b, d / 2);
    sh.lineTo(0, d / 2);
    sh.closePath();
    g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    g.translate(-b / 2, 0, -0.5);
    g.rotateZ(Math.PI / 2);
  } else if (s.profile === "SHS") {
    g = new THREE.BoxGeometry(s.b, s.d, 1);
  } else if (s.profile === "ROD") {
    g = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
    g.rotateX(Math.PI / 2);
  } else {
    g = new THREE.BoxGeometry(s.b, s.d, s.b);
  }
  g.computeVertexNormals();
  return g;
}

interface Placement {
  base: THREE.Matrix4;
  explode: THREE.Vector3;
  from: THREE.Vector3;
  start: number;
  mid: THREE.Vector3;
}

function place(m: Member, indexInGroup: number): Placement {
  const a = new THREE.Vector3(...m.a);
  const b = new THREE.Vector3(...m.b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  let base: THREE.Matrix4;
  if (m.kind === "plate") {
    base = new THREE.Matrix4().makeTranslation(a.x, a.y + 0.01, a.z);
  } else {
    const z = b.clone().sub(a).normalize();
    const ref = Math.abs(z.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    let x: THREE.Vector3;
    let y: THREE.Vector3;
    if (Math.abs(z.y) > 0.98) {
      x = ref.clone();
      y = new THREE.Vector3().crossVectors(z, x).normalize();
    } else {
      x = new THREE.Vector3().crossVectors(ref, z).normalize();
      y = new THREE.Vector3().crossVectors(z, x).normalize();
    }
    if (m.roll) {
      const q = new THREE.Quaternion().setFromAxisAngle(z, m.roll);
      x.applyQuaternion(q);
      y.applyQuaternion(q);
    }
    base = new THREE.Matrix4().makeBasis(x, y, z).multiply(new THREE.Matrix4().makeScale(1, 1, len));
    base.setPosition(mid);
  }
  const h = new THREE.Vector3(mid.x - CENTER.x, 0, mid.z - CENTER.z);
  if (h.lengthSq() < 0.01) h.set(1, 0, 0);
  h.normalize();
  const explode = h.clone().multiplyScalar(1.4 + m.group * 0.35).add(new THREE.Vector3(0, m.group * 0.7, 0));
  const from = h.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 3.5 + m.group * 0.4, 0));
  return { base, explode, from, start: m.group * GROUP_GAP + indexInGroup * 0.01, mid };
}

export function Steel() {
  const truss = useDemo((s) => s.steel.truss);
  const coating = useDemo((s) => s.steel.coating);
  const explode = useDemo((s) => s.steel.explode);
  const selected = useDemo((s) => s.steel.selected);
  const replay = useDemo((s) => s.steel.replay);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const patch = useDemo((s) => s.patch);
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<Partial<Record<SectionId, THREE.InstancedMesh | null>>>({});
  const clock = useRef({ t: 99, explode: 0 });
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const labelRef = useRef<string | null>(null);

  const members = useMemo(() => buildFrame(truss), [truss]);
  const bySection = useMemo(() => {
    const map = new Map<SectionId, { m: Member; p: Placement }[]>();
    const counters = new Map<number, number>();
    for (const m of members) {
      const k = counters.get(m.group) ?? 0;
      counters.set(m.group, k + 1);
      const list = map.get(m.section) ?? [];
      list.push({ m, p: place(m, k) });
      map.set(m.section, list);
    }
    return map;
  }, [members]);
  const endTime = useMemo(() => Math.max(...members.map((m) => m.group)) * GROUP_GAP + 1.6, [members]);

  const geos = useMemo(() => Object.fromEntries((Object.keys(SECTIONS) as SectionId[]).map((id) => [id, profileGeometry(id)])) as Record<SectionId, THREE.BufferGeometry>, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b9bdc0", metalness: 0.85, roughness: 0.38 }), []);
  useEffect(() => () => mat.dispose(), [mat]);

  useEffect(() => {
    const c = COATINGS.find((x) => x.id === coating)!;
    mat.color.set(c.hex);
    mat.metalness = coating === "galvanised" ? 0.85 : coating === "charcoal" ? 0.45 : 0.1;
    mat.roughness = coating === "galvanised" ? 0.36 : coating === "charcoal" ? 0.48 : 0.72;
  }, [coating, mat]);

  // replay the erection sequence when entering steel or on request
  useEffect(() => {
    if (industry === "steel") clock.current.t = -0.9;
  }, [replay, industry, truss]);

  // instance colours for selection
  useEffect(() => {
    const white = new THREE.Color("#ffffff");
    const hi = new THREE.Color("#ff9a3c");
    for (const [id, list] of bySection) {
      const im = meshes.current[id];
      if (!im) continue;
      list.forEach(({ m }, i) => im.setColorAt(i, m.id === selected ? hi : white));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }, [selected, bySection]);

  const tmp = useMemo(() => new THREE.Matrix4(), []);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const vis = channels.steel;
    if (group.current) group.current.visible = vis > 0.01;
    if (vis <= 0.01) return;
    const c = clock.current;
    const reduced = useDemo.getState().reducedMotion;
    const running = c.t < endTime;
    if (running) c.t = reduced ? endTime : c.t + dt;
    const ex = c.explode + (explode - c.explode) * (1 - Math.exp(-dt * 7));
    const exMoving = Math.abs(ex - c.explode) > 1e-4;
    c.explode = ex;
    if (!running && !exMoving && vis >= 1 && !labelRef.current) return;

    let label: string | null = null;
    for (const [id, list] of bySection) {
      const im = meshes.current[id];
      if (!im) continue;
      list.forEach(({ m, p }, i) => {
        const local = (c.t - p.start) / MEMBER_DUR;
        const k = local <= 0 ? 0 : local >= 1 ? 1 : ease(local);
        if (local > 0 && local < 1 && c.t < endTime) label = ERECTION_STEPS[m.group];
        tmp.copy(p.base);
        v.copy(p.explode).multiplyScalar(ex * 2.2).addScaledVector(p.from, 1 - k);
        tmp.elements[12] += v.x;
        tmp.elements[13] += v.y;
        tmp.elements[14] += v.z;
        if (k <= 0) tmp.makeScale(0.0001, 0.0001, 0.0001);
        im.setMatrixAt(i, tmp);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    markShadowsDirty(1);
    if (label !== labelRef.current) {
      labelRef.current = label;
      setStepLabel(label);
    }
  });

  const onPick = (id: SectionId) => (e: ThreeEvent<MouseEvent>) => {
    if (industry !== "steel" || phase !== "explore" || e.delta > 8 || e.instanceId == null) return;
    e.stopPropagation();
    const m = bySection.get(id)?.[e.instanceId]?.m;
    if (!m) return;
    patch("steel", { selected: m.id === selected ? null : m.id });
    track("option_changed", { industry: "steel", option: "member_inspected" });
  };

  const sel = selected ? members.find((m) => m.id === selected) : null;
  const selMid = sel ? new THREE.Vector3(...sel.a).add(new THREE.Vector3(...sel.b)).multiplyScalar(0.5) : null;

  return (
    <group ref={group} name="steel" visible={false}>
      {[...bySection.entries()].map(([id, list]) => (
        <instancedMesh
          key={`${truss}-${id}`}
          ref={(im) => {
            meshes.current[id] = im;
            if (im && !im.instanceColor) {
              const white = new THREE.Color("#ffffff");
              for (let i = 0; i < list.length; i++) im.setColorAt(i, white);
            }
          }}
          args={[geos[id], mat, list.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
          onClick={onPick(id)}
          onPointerOver={(e) => {
            if (industry === "steel") {
              e.stopPropagation();
              document.body.style.cursor = "pointer";
            }
          }}
          onPointerOut={() => (document.body.style.cursor = "")}
        />
      ))}
      {stepLabel && (
        <Html position={[0.5, 10.4, -4]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="tag3d tag3d--accent">Erecting · {stepLabel}</div>
        </Html>
      )}
      {sel && selMid && industry === "steel" && (
        <Html position={selMid} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="tag3d">
            {sel.id} · {detectUnits() === "imperial" ? SECTIONS[sel.section].us.name : SECTIONS[sel.section].metric.name}
          </div>
        </Html>
      )}
    </group>
  );
}
