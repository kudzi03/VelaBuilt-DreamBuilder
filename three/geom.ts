import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RoofPlane, Vec3 } from "@/lib/spec";

/** Box with UVs in metres on every face. */
export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

export interface Placed {
  geo: THREE.BufferGeometry;
  pos?: Vec3;
  rot?: Vec3;
  matrix?: THREE.Matrix4;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

export function placeMatrix(pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0]) {
  return new THREE.Matrix4().compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s);
}

/** Merge many placed parts into one geometry (one draw call). */
export function merge(parts: Placed[]): THREE.BufferGeometry {
  const geos = parts.map((p) => {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()) as THREE.BufferGeometry;
    if (p.matrix) g.applyMatrix4(p.matrix);
    else if (p.pos || p.rot) g.applyMatrix4(_m.compose(_p.set(...(p.pos ?? [0, 0, 0])), _q.setFromEuler(_e.set(...(p.rot ?? [0, 0, 0]))), _s));
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    g.clearGroups();
    return g;
  });
  const out = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return out ?? new THREE.BufferGeometry();
}

/* ------------------------------------------------------------------- walls */

export type Face = "z+" | "z-" | "x+" | "x-";

export interface Opening {
  a: number;
  b: number;
  y0: number;
  y1: number;
  kind?: "window" | "door" | "slider" | "void";
}

export interface WallDef {
  face: Face;
  at: number;
  from: number;
  to: number;
  height: number;
  gable?: { peakAt: number; peakY: number };
  openings: Opening[];
  thickness: number;
}

const toLocal = (face: Face, w: number) => (face === "z+" || face === "x-" ? w : -w);

/** Matrix taking wall-local space (x along wall, y up, z outward; exterior face at z = t) to world. */
export function wallMatrix(face: Face, at: number, t: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  switch (face) {
    case "z+":
      return m.makeTranslation(0, 0, at - t);
    case "z-":
      return m.makeRotationY(Math.PI).setPosition(0, 0, at + t);
    case "x-":
      return m.makeRotationY(-Math.PI / 2).setPosition(at + t, 0, 0);
    case "x+":
      return m.makeRotationY(Math.PI / 2).setPosition(at - t, 0, 0);
  }
}

/**
 * Extruded wall with real openings. Groups: 0 exterior face, 1 interior face,
 * 2 reveals/edges. Returned in world space.
 */
export function wallGeometry(def: WallDef): THREE.BufferGeometry {
  const l0 = Math.min(toLocal(def.face, def.from), toLocal(def.face, def.to));
  const l1 = Math.max(toLocal(def.face, def.from), toLocal(def.face, def.to));
  const shape = new THREE.Shape();
  shape.moveTo(l0, 0);
  shape.lineTo(l1, 0);
  shape.lineTo(l1, def.height);
  if (def.gable) shape.lineTo(toLocal(def.face, def.gable.peakAt), def.gable.peakY);
  shape.lineTo(l0, def.height);
  shape.closePath();
  for (const o of def.openings) {
    const a = Math.min(toLocal(def.face, o.a), toLocal(def.face, o.b));
    const b = Math.max(toLocal(def.face, o.a), toLocal(def.face, o.b));
    const hole = new THREE.Path();
    if (o.y0 <= 0.001) {
      // door reaching the floor: keep a sliver of wall so the hole stays inside the shape
      hole.moveTo(a, 0.02);
      hole.lineTo(a, o.y1);
      hole.lineTo(b, o.y1);
      hole.lineTo(b, 0.02);
    } else {
      hole.moveTo(a, o.y0);
      hole.lineTo(a, o.y1);
      hole.lineTo(b, o.y1);
      hole.lineTo(b, o.y0);
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  const raw = new THREE.ExtrudeGeometry(shape, { depth: def.thickness, bevelEnabled: false, steps: 1, curveSegments: 1 });
  const g = raw.index ? raw.toNonIndexed() : raw;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const buckets: number[][] = [[], [], []];
  for (let t = 0; t < pos.count / 3; t++) {
    const nz = nor.getZ(t * 3);
    buckets[nz > 0.5 ? 0 : nz < -0.5 ? 1 : 2].push(t);
  }
  const P: number[] = [];
  const N: number[] = [];
  const UV: number[] = [];
  const out = new THREE.BufferGeometry();
  let start = 0;
  buckets.forEach((tris, gi) => {
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        UV.push(uv.getX(i), uv.getY(i));
      }
    }
    out.addGroup(start, tris.length * 3, gi);
    start += tris.length * 3;
  });
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  out.applyMatrix4(wallMatrix(def.face, def.at, def.thickness));
  raw.dispose();
  if (g !== raw) g.dispose();
  return out;
}

export interface GlazingParts {
  frames: Placed[];
  glass: Placed[];
  doors: Placed[];
  sills: Placed[];
  inner: Placed[];
}

/** Frames, glass, sills (and door leaves) for a wall's openings, in world space. */
export function glazing(def: WallDef, into: GlazingParts, opts: { daylight?: boolean } = {}) {
  const M = wallMatrix(def.face, def.at, def.thickness);
  const t = def.thickness;
  const fw = 0.06; // frame bar width
  const fd = 0.09; // frame depth
  const zf = t - 0.1; // frame centre (near exterior face)
  const place = (list: Placed[], geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    list.push({ geo, matrix: M.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)) });
  };
  for (const o of def.openings) {
    if (o.kind === "void") continue;
    const a = Math.min(toLocal(def.face, o.a), toLocal(def.face, o.b));
    const b = Math.max(toLocal(def.face, o.a), toLocal(def.face, o.b));
    const w = b - a;
    const h = o.y1 - o.y0;
    const cx = (a + b) / 2;
    const cy = (o.y0 + o.y1) / 2;
    if (o.kind === "door") {
      place(into.doors, box(w - 0.02, h - 0.01, 0.06), cx, cy, zf - 0.02);
      place(into.frames, box(0.03, h * 0.62, 0.05), cx + w * 0.34, cy + 0.05, zf + 0.04);
      place(into.frames, box(w + fw * 2, fw, fd), cx, o.y1 + fw / 2 - 0.01, zf);
      place(into.frames, box(fw, h + fw, fd), a - fw / 2 + 0.01, cy + fw / 2, zf);
      place(into.frames, box(fw, h + fw, fd), b + fw / 2 - 0.01, cy + fw / 2, zf);
      continue;
    }
    // outer frame
    place(into.frames, box(w, fw, fd), cx, o.y1 - fw / 2, zf);
    place(into.frames, box(w, fw, fd), cx, o.y0 + fw / 2, zf);
    place(into.frames, box(fw, h, fd), a + fw / 2, cy, zf);
    place(into.frames, box(fw, h, fd), b - fw / 2, cy, zf);
    // mullions
    const panes = o.kind === "slider" ? Math.max(2, Math.round(w / 1.25)) : w > 1.9 ? Math.round(w / 1.4) : 1;
    for (let i = 1; i < panes; i++) place(into.frames, box(fw * 0.8, h, fd * 0.9), a + (w * i) / panes, cy, zf);
    if (o.kind !== "slider" && h > 1.8 && w < 1.2) place(into.frames, box(w, fw * 0.8, fd * 0.9), cx, o.y0 + h * 0.62, zf);
    place(into.glass, box(w - 0.02, h - 0.02, 0.012), cx, cy, zf - 0.005);
    if (opts.daylight) place(into.inner, box(w - 0.04, h - 0.04, 0.005), cx, cy, zf - 0.06);
    if (o.kind !== "slider") place(into.sills, box(w + 0.08, 0.04, 0.12), cx, o.y0 - 0.02, t + 0.02);
  }
}

export function emptyGlazing(): GlazingParts {
  return { frames: [], glass: [], doors: [], sills: [], inner: [] };
}

/* -------------------------------------------------------------------- roof */

/** Top surface quad of a roof plane (UV in metres: u along eave, v up-slope), lifted by `lift`. */
export function roofSurface(p: RoofPlane, lift: number): THREE.BufferGeometry {
  const q = (u: number, v: number) => [
    p.origin[0] + p.u[0] * u + p.v[0] * v + p.normal[0] * lift,
    p.origin[1] + p.u[1] * u + p.v[1] * v + p.normal[1] * lift,
    p.origin[2] + p.u[2] * u + p.v[2] * v + p.normal[2] * lift,
  ];
  const a = q(0, 0);
  const b = q(p.width, 0);
  const c = q(p.width, p.length);
  const d = q(0, p.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  const n = p.normal;
  g.setAttribute("normal", new THREE.Float32BufferAttribute([...n, ...n, ...n, ...n, ...n, ...n], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, p.width, 0, p.width, p.length, 0, 0, p.width, p.length, 0, p.length], 2));
  return g;
}

/** Basis matrix aligning a box to a roof plane: x = u, y = normal, z = u × normal. */
export function planeMatrix(p: RoofPlane, u: number, v: number, lift: number, rotAboutNormal = 0): THREE.Matrix4 {
  const U3 = new THREE.Vector3(...p.u);
  const N3 = new THREE.Vector3(...p.normal);
  const Z3 = new THREE.Vector3().crossVectors(U3, N3);
  const m = new THREE.Matrix4().makeBasis(U3, N3, Z3);
  if (rotAboutNormal) m.multiply(new THREE.Matrix4().makeRotationY(rotAboutNormal));
  const o = new THREE.Vector3(...p.origin)
    .addScaledVector(U3, u)
    .addScaledVector(new THREE.Vector3(...p.v), v)
    .addScaledVector(N3, lift);
  m.setPosition(o);
  return m;
}

/** Roof slab body (fascia/soffit) under the top surface — kept 2 cm below it so the two never z-fight. */
export function roofBody(p: RoofPlane, thickness: number): THREE.BufferGeometry {
  const h = thickness - 0.02;
  const g = box(p.width, h, p.length);
  g.applyMatrix4(planeMatrix(p, p.width / 2, p.length / 2, h / 2));
  return g;
}

/* -------------------------------------------------------------- organic */

/** Noisy sphere for architectural-model trees and shrubs. */
export function blob(radius: number, seed: number, detail = 3, squash = 1, rough = 0.18): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(radius, detail);
  ico.deleteAttribute("uv");
  ico.deleteAttribute("normal");
  const g = mergeVertices(ico, 1e-4);
  ico.dispose();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const s1 = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 2.1 + s1) * Math.cos(v.y * 1.7 + s1 * 0.5) * 0.5 +
      Math.sin(v.z * 2.7 + s1 * 1.3 + v.x) * 0.35 +
      Math.sin(v.x * 5.3 + v.z * 4.1 + s1) * 0.15;
    v.multiplyScalar(1 + n * rough);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(pos.count * 2);
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}
