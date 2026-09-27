import * as THREE from "three";
import { box, wallMatrix, type Opening, type Placed, type WallDef } from "./geom";

/**
 * Architectural geometry: walls built in horizontal bands (stone base, timber above) with
 * real openings, and window/door assemblies with depth — frames set back in lined reveals,
 * glass, mullions, sills. All UVs in metres.
 *
 * Wall groups: 0 exterior face (and exposed wall ends), 1 interior face, 2 opening reveals.
 */

const toLocal = (face: WallDef["face"], w: number) => (face === "z+" || face === "x-" ? w : -w);

export interface Band {
  y0: number;
  y1: number;
  /** include the gable triangle above y1 */
  gable?: boolean;
  /** shorten the wall at each end (to butt between perpendicular walls without overlap) */
  trim?: [number, number];
}

/** One horizontal band of a wall, with the openings that fall inside it. */
export function wallBand(def: WallDef, band: Band): THREE.BufferGeometry | null {
  const lo = Math.min(toLocal(def.face, def.from), toLocal(def.face, def.to)) + (band.trim?.[0] ?? 0);
  const hi = Math.max(toLocal(def.face, def.from), toLocal(def.face, def.to)) - (band.trim?.[1] ?? 0);
  const top = Math.min(band.y1, def.height);
  const shape = new THREE.Shape();
  shape.moveTo(lo, band.y0);
  shape.lineTo(hi, band.y0);
  if (band.gable && def.gable) {
    shape.lineTo(hi, def.height);
    shape.lineTo(toLocal(def.face, def.gable.peakAt), def.gable.peakY);
    shape.lineTo(lo, def.height);
  } else {
    shape.lineTo(hi, top);
    shape.lineTo(lo, top);
  }
  shape.closePath();
  const bandTop = band.gable && def.gable ? def.gable.peakY : top;
  for (const o of def.openings) {
    if (o.kind === "void") continue;
    const y0 = Math.max(o.y0, band.y0);
    const y1 = Math.min(o.y1, bandTop);
    if (y1 - y0 < 0.01) continue;
    const a = Math.max(lo + 0.02, Math.min(toLocal(def.face, o.a), toLocal(def.face, o.b)));
    const b = Math.min(hi - 0.02, Math.max(toLocal(def.face, o.a), toLocal(def.face, o.b)));
    const yy0 = y0 <= band.y0 + 0.001 ? band.y0 + 0.015 : y0;
    const yy1 = y1 >= bandTop - 0.001 ? bandTop - 0.015 : y1;
    const hole = new THREE.Path();
    hole.moveTo(a, yy0);
    hole.lineTo(a, yy1);
    hole.lineTo(b, yy1);
    hole.lineTo(b, yy0);
    hole.closePath();
    shape.holes.push(hole);
  }
  if (bandTop - band.y0 < 0.01) return null;
  const raw = new THREE.ExtrudeGeometry(shape, { depth: def.thickness, bevelEnabled: false, steps: 1, curveSegments: 1 });
  const g = raw.index ? raw.toNonIndexed() : raw;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const buckets: number[][] = [[], [], []];
  for (let t = 0; t < pos.count / 3; t++) {
    const i = t * 3;
    const nz = nor.getZ(i);
    if (nz > 0.5) buckets[0].push(t);
    else if (nz < -0.5) buckets[1].push(t);
    else {
      // side faces: wall ends and top/bottom read as exterior; faces inside openings are reveals
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const isEnd = Math.abs(nx) > 0.5 && Math.abs(ny) < 0.3 && (Math.abs(cx - lo) < 0.005 || Math.abs(cx - hi) < 0.005);
      const isTopBottom = Math.abs(ny) > 0.5 && (Math.abs(cy - band.y0) < 0.005 || Math.abs(cy - top) < 0.005);
      const isGableEdge = !!band.gable && cy > def.height - 0.005 && Math.abs(ny) > 0.3;
      buckets[isEnd || isTopBottom || isGableEdge ? 0 : 2].push(t);
    }
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
        // exterior/interior faces: (along wall, height). Reveals: depth runs along u.
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

/** Concatenate grouped geometries keeping groups 0..n-1. */
export function mergeGrouped(list: THREE.BufferGeometry[], groups = 3): THREE.BufferGeometry {
  const P: number[][] = Array.from({ length: groups }, () => []);
  const N: number[][] = Array.from({ length: groups }, () => []);
  const T: number[][] = Array.from({ length: groups }, () => []);
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
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P.flat(), 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(N.flat(), 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(T.flat(), 2));
  let start = 0;
  for (let gi = 0; gi < groups; gi++) {
    out.addGroup(start, P[gi].length / 3, gi);
    start += P[gi].length / 3;
  }
  return out;
}

export interface WindowParts {
  frames: Placed[];
  glass: Placed[];
  sills: Placed[];
  doors: Placed[];
  handles: Placed[];
}

export function emptyWindows(): WindowParts {
  return { frames: [], glass: [], sills: [], doors: [], handles: [] };
}

/**
 * Frames sit 90 mm behind the facade in a lined reveal; slim 60 mm aluminium sections,
 * a 1.5 m module for mullions, sliders get a heavier interlock. Doors: solid oak pivot
 * leaf with a full-height pull.
 */
export function windows(def: WallDef, into: WindowParts, opts: { skipSill?: boolean; bandLines?: number[] } = {}) {
  const M = wallMatrix(def.face, def.at, def.thickness);
  const t = def.thickness;
  const fw = 0.06; // frame face width
  const fd = 0.11; // frame depth
  const zf = t - 0.09 - fd / 2; // frame centre, measured from the interior face
  const put = (list: Placed[], geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    list.push({ geo, matrix: M.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)) });
  };
  for (const o of def.openings as Opening[]) {
    if (o.kind === "void") continue;
    const a = Math.min(toLocal(def.face, o.a), toLocal(def.face, o.b));
    const b = Math.max(toLocal(def.face, o.a), toLocal(def.face, o.b));
    const w = b - a;
    const h = o.y1 - o.y0;
    const cx = (a + b) / 2;
    const cy = (o.y0 + o.y1) / 2;
    if (o.kind === "door") {
      // pivot door: oak leaf with shallow vertical grooves (from the texture) and a long pull
      put(into.doors, box(w - 0.03, h - 0.02, 0.07), cx, cy, zf);
      put(into.handles, box(0.03, Math.min(1.6, h * 0.62), 0.03), cx + w / 2 - 0.16, 1.15, zf + 0.08);
      put(into.handles, box(0.03, 0.03, 0.05), cx + w / 2 - 0.16, 1.15 + Math.min(1.6, h * 0.62) / 2 - 0.1, zf + 0.055);
      put(into.handles, box(0.03, 0.03, 0.05), cx + w / 2 - 0.16, 1.15 - Math.min(1.6, h * 0.62) / 2 + 0.1, zf + 0.055);
      put(into.frames, box(w + fw * 2, fw, fd), cx, o.y1 + fw / 2 - 0.012, zf);
      put(into.frames, box(fw, h + fw, fd), a - fw / 2 + 0.012, cy + fw / 2, zf);
      put(into.frames, box(fw, h + fw, fd), b + fw / 2 - 0.012, cy + fw / 2, zf);
      continue;
    }
    // perimeter
    put(into.frames, box(w, fw, fd), cx, o.y1 - fw / 2, zf);
    put(into.frames, box(w, fw * 1.2, fd), cx, o.y0 + (fw * 1.2) / 2, zf);
    put(into.frames, box(fw, h, fd), a + fw / 2, cy, zf);
    put(into.frames, box(fw, h, fd), b - fw / 2, cy, zf);
    const slider = o.kind === "slider";
    const panes = slider ? Math.max(2, Math.round(w / 1.45)) : w > 1.8 ? Math.round(w / 1.5) : 1;
    for (let i = 1; i < panes; i++) {
      const x = a + (w * i) / panes;
      put(into.frames, box(slider ? fw * 1.6 : fw * 0.9, h, slider ? fd * 1.25 : fd), x, cy, zf);
    }
    // tall single lights get a transom at door head height, and one wherever they cross a floor
    const lines = (opts.bandLines ?? []).filter((y) => y > o.y0 + 0.2 && y < o.y1 - 0.2);
    for (const y of lines) put(into.frames, box(w, fw * 1.4, fd), cx, y, zf);
    if (!slider && !lines.length && h > 2.1 && w < 1.3) put(into.frames, box(w, fw * 0.9, fd), cx, o.y0 + 2.1, zf);
    put(into.glass, box(w - 0.03, h - 0.03, 0.008), cx, cy, zf);
    if (!opts.skipSill && o.y0 > 0.2) {
      // pressed-metal sill, projecting 40 mm past the facade with a drip
      put(into.sills, box(w + 0.04, 0.025, fd * 0 + 0.09 + 0.05), cx, o.y0 - 0.0125, t - 0.02);
      put(into.sills, box(w + 0.04, 0.05, 0.012), cx, o.y0 - 0.035, t + 0.044);
    }
  }
}
