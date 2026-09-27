"use client";

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { track } from "@/lib/analytics";
import { TRUSSES } from "@/lib/options";
import { ERECTION_STEPS, SECTIONS, buildFrame, type Member, type SectionId } from "@/lib/steel";
import { useDemo } from "@/lib/store";
import { detectUnits } from "@/lib/units";
import { markShadowsDirty } from "./Atmosphere";
import { Callout } from "./Callout";
import { pbr, solid } from "./materials";
import { channels } from "./shared";

/**
 * The same house as a steel frame: rolled sections at catalogue size, erected in sequence
 * (plates, columns, floor beams, eaves, trusses, portals, purlins, bracing), with the
 * connections a fabricator would draw — end plates and bolts, cap plates, gussets, anchor
 * bolts on concrete pads. Members and their connections fly in together; the frame can be
 * exploded and any member picked for its section, length and mass.
 */

const CENTER = new THREE.Vector3(0.5, 0, -4.5);
const GROUP_GAP = 0.42;
const MEMBER_DUR = 0.7;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

function profileGeometry(id: SectionId): THREE.BufferGeometry {
  const s = SECTIONS[id];
  const vis = (v: number) => Math.max(v, 0.008); // keep thin plates visible at distance
  let g: THREE.BufferGeometry;
  if (s.profile === "I") {
    const b = s.b;
    const d = s.d;
    const tf = vis(s.tf);
    const tw = vis(s.tw);
    const r = Math.min(0.012, (b - tw) / 4); // root radius
    const sh = new THREE.Shape();
    sh.moveTo(-b / 2, -d / 2);
    sh.lineTo(b / 2, -d / 2);
    sh.lineTo(b / 2, -d / 2 + tf);
    sh.lineTo(tw / 2 + r, -d / 2 + tf);
    sh.quadraticCurveTo(tw / 2, -d / 2 + tf, tw / 2, -d / 2 + tf + r);
    sh.lineTo(tw / 2, d / 2 - tf - r);
    sh.quadraticCurveTo(tw / 2, d / 2 - tf, tw / 2 + r, d / 2 - tf);
    sh.lineTo(b / 2, d / 2 - tf);
    sh.lineTo(b / 2, d / 2);
    sh.lineTo(-b / 2, d / 2);
    sh.lineTo(-b / 2, d / 2 - tf);
    sh.lineTo(-tw / 2 - r, d / 2 - tf);
    sh.quadraticCurveTo(-tw / 2, d / 2 - tf, -tw / 2, d / 2 - tf - r);
    sh.lineTo(-tw / 2, -d / 2 + tf + r);
    sh.quadraticCurveTo(-tw / 2, -d / 2 + tf, -tw / 2 - r, -d / 2 + tf);
    sh.lineTo(-b / 2, -d / 2 + tf);
    sh.closePath();
    g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, -0.5);
  } else if (s.profile === "C") {
    const b = s.b;
    const d = s.d;
    const t = 0.004;
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
    // hollow square with a corner radius
    const b = s.b;
    const t = Math.max(s.tf, 0.004);
    const outer = new THREE.Shape();
    const r = t * 1.5;
    const rr = (sh: THREE.Shape | THREE.Path, h: number, rad: number) => {
      sh.moveTo(-h + rad, -h);
      sh.lineTo(h - rad, -h);
      sh.quadraticCurveTo(h, -h, h, -h + rad);
      sh.lineTo(h, h - rad);
      sh.quadraticCurveTo(h, h, h - rad, h);
      sh.lineTo(-h + rad, h);
      sh.quadraticCurveTo(-h, h, -h, h - rad);
      sh.lineTo(-h, -h + rad);
      sh.quadraticCurveTo(-h, -h, -h + rad, -h);
    };
    rr(outer, b / 2, r);
    const hole = new THREE.Path();
    rr(hole, b / 2 - t, r * 0.5);
    outer.holes.push(hole);
    g = new THREE.ExtrudeGeometry(outer, { depth: 1, bevelEnabled: false, curveSegments: 2 });
    g.translate(0, 0, -0.5);
  } else if (s.profile === "ROD") {
    g = new THREE.CylinderGeometry(0.009, 0.009, 1, 8);
    g.rotateX(Math.PI / 2);
  } else {
    g = new THREE.BoxGeometry(s.b, s.d, s.b);
  }
  g.computeVertexNormals();
  return g;
}

interface Placement {
  base: THREE.Matrix4;
  /** position + orientation without the length scale: connection details hang off this */
  frame: THREE.Matrix4;
  explode: THREE.Vector3;
  from: THREE.Vector3;
  start: number;
  mid: THREE.Vector3;
  len: number;
}

function place(m: Member, indexInGroup: number): Placement {
  const a = new THREE.Vector3(...m.a);
  const b = new THREE.Vector3(...m.b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  let base: THREE.Matrix4;
  let frame: THREE.Matrix4;
  if (m.kind === "plate") {
    base = new THREE.Matrix4().makeTranslation(a.x, a.y + 0.01, a.z);
    frame = base.clone();
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
    frame = new THREE.Matrix4().makeBasis(x, y, z).setPosition(mid);
    base = frame.clone().multiply(new THREE.Matrix4().makeScale(1, 1, len));
  }
  const h = new THREE.Vector3(mid.x - CENTER.x, 0, mid.z - CENTER.z);
  if (h.lengthSq() < 0.01) h.set(1, 0, 0);
  h.normalize();
  const explode = h.clone().multiplyScalar(1.4 + m.group * 0.35).add(new THREE.Vector3(0, m.group * 0.7, 0));
  const from = h.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 3.5 + m.group * 0.4, 0));
  return { base, frame, explode, from, start: m.group * GROUP_GAP + indexInGroup * 0.01, mid, len };
}

/* ------------------------------------------------------------ connections */

type DetailKind = "plate" | "bolt" | "anchor";
interface Detail {
  member: number; // index into `members`
  kind: DetailKind;
  local: THREE.Matrix4;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const L = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));

/** Connection hardware per member, in the member's frame (x = flange width, y = depth, z = along). */
function detailsFor(m: Member, i: number, len: number): Detail[] {
  const out: Detail[] = [];
  const s = SECTIONS[m.section];
  const add = (kind: DetailKind, local: THREE.Matrix4) => out.push({ member: i, kind, local });
  if (m.kind === "plate") {
    // four anchor bolts with nuts and washers through the base plate
    for (const [x, z] of [
      [-0.11, -0.11],
      [0.11, -0.11],
      [-0.11, 0.11],
      [0.11, 0.11],
    ]) {
      add("anchor", L(x, 0.04, z));
      add("bolt", L(x, 0.02, z, 1.15, 1, 1.15));
      add("plate", L(x, 0.012, z, 0.05, 0.004, 0.05));
    }
    return out;
  }
  const bolt = (x: number, y: number, z: number) => add("bolt", L(x, y, z, 1, 1, 1, Math.PI / 2));
  if (m.kind === "column" && s.profile === "I") {
    add("plate", L(0, 0, len / 2 + 0.0075, s.b + 0.04, s.d + 0.04, 0.015));
  }
  if ((m.kind === "beam" || m.kind === "rafter") && s.profile === "I") {
    for (const e of [-1, 1]) {
      const z = e * (len / 2 - 0.0075);
      add("plate", L(0, 0, z, s.b + 0.02, s.d + 0.07, 0.015));
      for (const bx of [-1, 1]) for (const by of [-1, 1]) bolt(bx * Math.min(0.05, s.b / 2 - 0.02), by * (s.d / 2 - 0.02), z - e * 0.015);
    }
  }
  if (m.kind === "web") {
    // gussets where the web meets the chords, in the truss plane
    for (const e of [-1, 1]) add("plate", L(0, 0, e * (len / 2), 0.01, 0.16, 0.2));
  }
  return out;
}

const PLATE_GEO = new THREE.BoxGeometry(1, 1, 1);
const BOLT_GEO = new THREE.CylinderGeometry(0.017, 0.017, 0.014, 6);
const ANCHOR_GEO = new THREE.CylinderGeometry(0.01, 0.01, 0.06, 8);
const DETAIL_GEO: Record<DetailKind, THREE.BufferGeometry> = { plate: PLATE_GEO, bolt: BOLT_GEO, anchor: ANCHOR_GEO };

/* ----------------------------------------------------------------- scene */

export function Steel() {
  const truss = useDemo((s) => s.steel.truss);
  const coating = useDemo((s) => s.steel.coating);
  const explode = useDemo((s) => s.steel.explode);
  const selected = useDemo((s) => s.steel.selected);
  const replay = useDemo((s) => s.steel.replay);
  const layout = useDemo((s) => s.layout);
  const industry = useDemo((s) => s.industry);
  const phase = useDemo((s) => s.phase);
  const patch = useDemo((s) => s.patch);
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<Partial<Record<SectionId, THREE.InstancedMesh | null>>>({});
  const detailMeshes = useRef<Partial<Record<DetailKind, THREE.InstancedMesh | null>>>({});
  const clock = useRef({ t: 99, explode: 0 });
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const labelRef = useRef<string | null>(null);

  const members = useMemo(() => buildFrame(truss), [truss]);
  const placements = useMemo(() => {
    const counters = new Map<number, number>();
    return members.map((m) => {
      const k = counters.get(m.group) ?? 0;
      counters.set(m.group, k + 1);
      return place(m, k);
    });
  }, [members]);
  const bySection = useMemo(() => {
    const map = new Map<SectionId, number[]>();
    members.forEach((m, i) => {
      const list = map.get(m.section) ?? [];
      list.push(i);
      map.set(m.section, list);
    });
    return map;
  }, [members]);
  const details = useMemo(() => {
    const byKind: Record<DetailKind, Detail[]> = { plate: [], bolt: [], anchor: [] };
    members.forEach((m, i) => detailsFor(m, i, placements[i].len).forEach((d) => byKind[d.kind].push(d)));
    return byKind;
  }, [members, placements]);
  const pads = useMemo(() => members.filter((m) => m.kind === "plate").map((m) => new THREE.Vector3(m.a[0], -0.24, m.a[2])), [members]);
  const endTime = useMemo(() => Math.max(...members.map((m) => m.group)) * GROUP_GAP + 1.6, [members]);

  const geos = useMemo(() => Object.fromEntries((Object.keys(SECTIONS) as SectionId[]).map((id) => [id, profileGeometry(id)])) as Record<SectionId, THREE.BufferGeometry>, []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  // coatings: hot-dip galvanised (spangled, metallic), red-oxide primer (matte), charcoal paint
  const mats = useMemo(
    () => ({
      galvanised: pbr("brushed_steel", { color: "#d3d7da", metalness: 0.92, roughness: 1.1, normalScale: 0.35, envMapIntensity: 1.1 }),
      "red-oxide": solid("#7a3222", 0.8, 0, { envMapIntensity: 0.55 }),
      charcoal: solid("#2c2e31", 0.52, 0.35, { envMapIntensity: 0.8 }),
      concrete: pbr("concrete", { color: "#cfcac1", roughness: 1, envMapIntensity: 0.5 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const mat = mats[coating];

  // replay the erection sequence when entering steel or on request
  useEffect(() => {
    if (industry === "steel") clock.current.t = -0.9;
  }, [replay, industry, truss]);

  // instance colours for selection
  useEffect(() => {
    const white = new THREE.Color("#ffffff");
    const hi = new THREE.Color("#ffb066");
    for (const [id, list] of bySection) {
      const im = meshes.current[id];
      if (!im) continue;
      list.forEach((mi, i) => im.setColorAt(i, members[mi].id === selected ? hi : white));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }, [selected, bySection, members]);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), t: new THREE.Matrix4(), v: new THREE.Vector3(), zero: new THREE.Matrix4().makeScale(0, 0, 0) }), []);
  const state = useMemo(() => ({ off: members.map(() => new THREE.Vector3()), k: new Float32Array(members.length) }), [members]);

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
    const done = !running && !exMoving;
    // callouts appear once the frame has landed and is not exploded
    const calm = done && ex < 0.05 && c.t >= endTime;
    if (calm !== settled) setSettled(calm);
    if (done && vis >= 1 && !labelRef.current && group.current?.userData.fresh === false) return;
    if (group.current) group.current.userData.fresh = false;

    // per member: progress and offset
    let label: string | null = null;
    members.forEach((m, i) => {
      const p = placements[i];
      const local = (c.t - p.start) / MEMBER_DUR;
      const k = local <= 0 ? 0 : local >= 1 ? 1 : ease(local);
      if (local > 0 && local < 1 && c.t < endTime) label = ERECTION_STEPS[m.group];
      state.k[i] = k;
      state.off[i].copy(p.explode).multiplyScalar(ex * 2.2).addScaledVector(p.from, 1 - k);
    });
    for (const [id, list] of bySection) {
      const im = meshes.current[id];
      if (!im) continue;
      list.forEach((mi, i) => {
        if (state.k[mi] <= 0) return im.setMatrixAt(i, tmp.zero);
        tmp.m.copy(placements[mi].base);
        tmp.m.elements[12] += state.off[mi].x;
        tmp.m.elements[13] += state.off[mi].y;
        tmp.m.elements[14] += state.off[mi].z;
        im.setMatrixAt(i, tmp.m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    for (const kind of Object.keys(details) as DetailKind[]) {
      const im = detailMeshes.current[kind];
      if (!im) continue;
      details[kind].forEach((d, i) => {
        if (state.k[d.member] <= 0) return im.setMatrixAt(i, tmp.zero);
        tmp.m.multiplyMatrices(placements[d.member].frame, d.local);
        tmp.m.elements[12] += state.off[d.member].x;
        tmp.m.elements[13] += state.off[d.member].y;
        tmp.m.elements[14] += state.off[d.member].z;
        im.setMatrixAt(i, tmp.m);
      });
      im.instanceMatrix.needsUpdate = true;
    }
    markShadowsDirty(1);
    if (label !== labelRef.current) {
      labelRef.current = label;
      setStepLabel(label);
    }
  });
  // members changed (truss type): force one full update
  useEffect(() => {
    if (group.current) group.current.userData.fresh = true;
  }, [members, details]);

  const onPick = (id: SectionId) => (e: ThreeEvent<MouseEvent>) => {
    if (industry !== "steel" || phase !== "explore" || e.delta > 8 || e.instanceId == null) return;
    e.stopPropagation();
    const mi = bySection.get(id)?.[e.instanceId];
    const m = mi != null ? members[mi] : null;
    if (!m) return;
    patch("steel", { selected: m.id === selected ? null : m.id });
    track("option_changed", { industry: "steel", option: "member_inspected" });
  };

  const sel = selected ? members.find((m) => m.id === selected) : null;
  const selMid = sel ? new THREE.Vector3(...sel.a).add(new THREE.Vector3(...sel.b)).multiplyScalar(0.5) : null;
  const units = detectUnits();
  const sec = (id: SectionId) => (units === "imperial" ? SECTIONS[id].us.name : SECTIONS[id].metric.name);
  const callouts = useMemo(() => calloutsFor(members, truss), [members, truss]);
  const showCallouts = settled && !sel && industry === "steel" && phase === "explore";

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
          material={mat}
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
      {(Object.keys(details) as DetailKind[]).map((kind) => (
        <instancedMesh
          key={`${truss}-d-${kind}`}
          ref={(im) => {
            detailMeshes.current[kind] = im;
          }}
          args={[DETAIL_GEO[kind], mat, details[kind].length]}
          material={mat}
          castShadow
          receiveShadow
          frustumCulled={false}
          raycast={() => null}
        />
      ))}
      <Pads points={pads} material={mats.concrete} />
      {stepLabel && (
        <Html position={[0.5, 10.4, -4]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="tag3d tag3d--accent">Erecting · {stepLabel}</div>
        </Html>
      )}
      {sel && selMid && industry === "steel" && (
        <Html position={selMid} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <Callout k={sel.id} v={sec(sel.section)} />
        </Html>
      )}
      {showCallouts &&
        // a phone's view has room for two labels: the frame's two headline members
        callouts.filter((c) => layout !== "mobile" || c.key === "truss" || c.key === "col").map((c) => (
          <Html key={c.key} position={c.at} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <Callout k={c.k} v={c.section ? `${sec(c.section)}${c.suffix ?? ""}` : c.v ?? ""} />
          </Html>
        ))}
    </group>
  );
}

function Pads({ points, material }: { points: THREE.Vector3[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(0.7, 0.5, 0.7), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => {
    const im = ref.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    points.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.004, p.z)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [points]);
  return <instancedMesh ref={ref} args={[geo, material, points.length]} receiveShadow castShadow raycast={() => null} />;
}

interface CalloutSpec {
  key: string;
  at: [number, number, number];
  k: string;
  section?: SectionId;
  v?: string;
  suffix?: string;
}

/** Four labels that explain the frame at a glance, anchored on representative members. */
function calloutsFor(members: Member[], truss: string): CalloutSpec[] {
  const mid = (m: Member, f = 0.5): [number, number, number] => [m.a[0] + (m.b[0] - m.a[0]) * f, m.a[1] + (m.b[1] - m.a[1]) * f, m.a[2] + (m.b[2] - m.a[2]) * f];
  const out: CalloutSpec[] = [];
  const col = members.find((m) => m.kind === "column" && m.a[0] === 6 && m.a[2] === 4);
  if (col) out.push({ key: "col", at: mid(col, 0.72), k: "Columns", section: col.section });
  const chords = members.filter((m) => m.kind === "chord" && m.label.startsWith("Truss T5") && m.label.endsWith("top chord"));
  const tc = chords.find((m) => m.a[2] > 0) ?? chords[0];
  const name = TRUSSES.find((t) => t.id === truss)?.label ?? "Truss";
  if (tc) out.push({ key: "truss", at: mid(tc, 0.45), k: `${name} trusses`, section: tc.section, suffix: " chords" });
  const rafter = members.find((m) => m.kind === "rafter" && m.a[2] < -9 && m.a[2] > -11 && m.a[0] > 3);
  if (rafter) out.push({ key: "portal", at: mid(rafter, 0.5), k: "Portal frames", section: rafter.section });
  const plate = members.find((m) => m.kind === "plate" && m.a[0] === 6 && m.a[2] === 4);
  if (plate) out.push({ key: "base", at: [plate.a[0], 0.03, plate.a[2]], k: "Base plates", section: "PL300", suffix: " · 4 anchors" });
  return out;
}
