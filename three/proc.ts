import * as THREE from "three";

/**
 * Procedural, tileable textures generated on the device.
 * Every texture records the real-world size it covers (userData.meters) so
 * geometry can carry UVs in metres and materials set repeat = 1 / meters.
 */

export let MAX_ANISO = 4;
export function setMaxAnisotropy(n: number) {
  MAX_ANISO = Math.max(1, Math.min(8, n));
}

export let TEX_SCALE = 1; // 0.5 on low tier
export function setTextureScale(s: number) {
  TEX_SCALE = s;
}

/* ------------------------------------------------------------------ noise */

function hash2(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnoise(x: number, y: number, px: number, py: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** tileable fbm. (x,y) in 0..1 texture space, base = lattice cells across the tile */
function fbm(x: number, y: number, base: number, oct: number, seed: number, baseY = base) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * base * f, y * baseY * f, base * f, baseY * f, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

/* --------------------------------------------------------------- helpers */

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

class Canvas {
  w: number;
  h: number;
  data: Uint8Array;
  height?: Float32Array;
  constructor(w: number, h = w, withHeight = false) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
    if (withHeight) this.height = new Float32Array(w * h);
  }
  set(i: number, c: RGB, a = 255) {
    const o = i * 4;
    this.data[o] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0];
    this.data[o + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1];
    this.data[o + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
    this.data[o + 3] = a;
  }
}

function toTexture(c: Canvas, srgb: boolean, meters: number, repeat = true): THREE.DataTexture {
  const t = new THREE.DataTexture(c.data, c.w, c.h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = MAX_ANISO;
  t.userData.meters = meters;
  if (repeat) t.repeat.set(1 / meters, 1 / meters);
  t.needsUpdate = true;
  return t;
}

function normalFromHeight(c: Canvas, strength: number, meters: number): THREE.DataTexture {
  const { w, h } = c;
  const hm = c.height!;
  const out = new Canvas(w, h);
  const s = strength * (w / 256);
  for (let y = 0; y < h; y++) {
    const yu = ((y + 1) % h) * w;
    const yd = ((y - 1 + h) % h) * w;
    for (let x = 0; x < w; x++) {
      const xr = (x + 1) % w;
      const xl = (x - 1 + w) % w;
      const dx = (hm[y * w + xr] - hm[y * w + xl]) * s;
      const dy = (hm[yu + x] - hm[yd + x]) * s;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      out.set(y * w + x, [(-dx * inv * 0.5 + 0.5) * 255, (-dy * inv * 0.5 + 0.5) * 255, (inv * 0.5 + 0.5) * 255]);
    }
  }
  return toTexture(out, false, meters);
}

const size = (n: number) => Math.max(128, Math.round((n * TEX_SCALE) / 128) * 128);

export interface TexSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  meters: number;
}

const cache = new Map<string, TexSet>();
function cached(key: string, make: () => TexSet): TexSet {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/* ------------------------------------------------------------------ roofs */

/** Architectural (laminated) asphalt shingles. Greyscale so material.color tints it. worn=true bakes in age. */
export function shingles(worn = false): TexSet {
  return cached(`shingles${worn}`, () => {
    const W = size(1024);
    const meters = 3.0;
    const courses = 21;
    const c = new Canvas(W, W, true);
    const r = rng(worn ? 91 : 17);
    const courseH = W / courses;
    // tab layout per course (in px), tileable horizontally
    const tabs: number[][] = [];
    const tones: number[][] = [];
    for (let k = 0; k < courses; k++) {
      const edges: number[] = [];
      let x = r() * W * 0.2;
      const start = x;
      while (x < start + W) {
        edges.push(x % W);
        x += (0.16 + r() * 0.22) * (W / meters);
      }
      edges.sort((a, b) => a - b);
      tabs.push(edges);
      tones.push(edges.map(() => (r() - 0.5) * 0.24));
    }
    const moss = hex("#5b6a3c");
    const algae = hex("#2a2b26");
    const under = hex("#2b2622");
    for (let y = 0; y < W; y++) {
      const k = Math.floor(y / courseH);
      const f = (y - k * courseH) / courseH; // 0 = bottom edge of course (y grows upward in texture space)
      const edges = tabs[k];
      for (let x = 0; x < W; x++) {
        // which tab
        let ti = edges.length - 1;
        for (let e = 0; e < edges.length; e++) if (x < edges[e]) {
          ti = e - 1;
          break;
        }
        if (ti < 0) ti = edges.length - 1;
        const edgeX = edges[(ti + 1) % edges.length];
        const distEdge = Math.min(Math.abs(x - edges[ti < 0 ? 0 : ti]), Math.abs(edgeX - x));
        const u = x / W;
        const v = y / W;
        const grain = hash2(x, y, 3) - 0.5;
        const mottled = fbm(u, v, 48, 2, 7) - 0.5;
        let val = 0.52 + tones[k][ti] + grain * 0.16 + mottled * 0.16;
        // dark shadow band along the lower part of each course (laminate)
        const band = f < 0.28 ? 0.7 + f : 1;
        val *= band;
        // slot between tabs
        const slot = distEdge < 2.2 && f < 0.62 ? 0.38 : 1;
        val *= slot;
        // butt edge shading
        val *= 0.78 + 0.22 * smooth(0, 0.08, f);
        let col: RGB = [val * 255, val * 255, val * 255];
        let height = 1 - f * 0.55 + grain * 0.05;
        if (slot < 1) height -= 0.3;
        if (worn) {
          const tint = hex("#6d6a63");
          col = [tint[0] * val * 1.35, tint[1] * val * 1.35, tint[2] * val * 1.35];
          const streak = smooth(0.52, 0.8, fbm(u, v * 0.15, 22, 3, 41)) * 0.85;
          col = mix(col, algae, streak * 0.75);
          const m = smooth(0.62, 0.76, fbm(u, v, 10, 4, 77)) * (f < 0.45 ? 1 : 0.35);
          col = mix(col, moss, m * 0.8);
          const fade = smooth(0.55, 0.9, fbm(u, v, 4, 3, 5));
          col = mix(col, [175, 170, 160], fade * 0.3);
          const missing = hash2(k, ti, 99) > 0.972 && f < 0.85;
          if (missing) {
            col = mix(under, [80, 70, 60], hash2(x, y, 1) * 0.3);
            height -= 0.6;
          }
        }
        const i = y * W + x;
        c.set(i, col);
        c.height![i] = height;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 2.2, meters), meters };
  });
}

/** Profiled concrete roof tile (S / barrel). Greyscale. */
export function roofTile(): TexSet {
  return cached("tile", () => {
    const W = size(1024);
    const meters = 2.4;
    const cols = 8;
    const courses = 7;
    const c = new Canvas(W, W, true);
    const tw = W / cols;
    const ch = W / courses;
    for (let y = 0; y < W; y++) {
      const k = Math.floor(y / ch);
      const f = (y - k * ch) / ch;
      for (let x = 0; x < W; x++) {
        const t = Math.floor(x / tw);
        const g = (x - t * tw) / tw;
        const wave = 0.5 + 0.5 * Math.sin(g * Math.PI * 2 - Math.PI / 2);
        const tone = (hash2(t, k, 5) - 0.5) * 0.1;
        const grain = (hash2(x, y, 9) - 0.5) * 0.07 + (fbm(x / W, y / W, 32, 2, 3) - 0.5) * 0.12;
        const ao = 0.62 + 0.38 * wave;
        const nose = 0.72 + 0.28 * smooth(0, 0.1, f);
        const v = (0.58 + tone + grain) * ao * nose;
        const i = y * W + x;
        c.set(i, [v * 255, v * 255, v * 255]);
        c.height![i] = wave * 0.9 + (1 - f) * 0.5;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 2.4, meters), meters };
  });
}

/** Natural slate, staggered courses, per-slate tone. Greyscale. */
export function slate(): TexSet {
  return cached("slate", () => {
    const W = size(1024);
    const meters = 2.4;
    const courses = 10;
    const perRow = 8;
    const c = new Canvas(W, W, true);
    const ch = W / courses;
    const sw = W / perRow;
    for (let y = 0; y < W; y++) {
      const k = Math.floor(y / ch);
      const f = (y - k * ch) / ch;
      const off = k % 2 ? sw / 2 : 0;
      for (let x = 0; x < W; x++) {
        const xs = (x + off) % W;
        const s = Math.floor(xs / sw);
        const g = (xs - s * sw) / sw;
        const tone = (hash2(s, k, 12) - 0.5) * 0.22;
        const cleft = fbm(x / W, y / W, 40, 3, 21 + s) - 0.5;
        const joint = g < 0.012 || g > 0.988 ? 0.35 : 1;
        const v = (0.5 + tone + cleft * 0.14) * joint * (0.7 + 0.3 * smooth(0, 0.07, f));
        const i = y * W + x;
        c.set(i, [v * 255, v * 255, v * 255]);
        c.height![i] = (1 - f) * 0.6 + cleft * 0.3 - (joint < 1 ? 0.2 : 0);
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 2.2, meters), meters };
  });
}

/** Subtle striation for standing-seam pans. */
export function metalPan(): TexSet {
  return cached("pan", () => {
    const W = size(512);
    const meters = 2.4;
    const c = new Canvas(W, W, true);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const stri = fbm(u, v, 96, 2, 3, 2) - 0.5;
        const can = fbm(u, v, 6, 2, 8) - 0.5;
        const val = 0.9 + stri * 0.08 + can * 0.08;
        const i = y * W + x;
        c.set(i, [val * 255, val * 255, val * 255]);
        c.height![i] = can * 0.6 + stri * 0.15;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 0.8, meters), meters };
  });
}

/* ----------------------------------------------------------------- ground */

export function lawn(): TexSet {
  return cached("lawn", () => {
    const W = size(1024);
    const meters = 12;
    const c = new Canvas(W, W, true);
    const base = hex("#6f8452");
    const dry = hex("#8d9259");
    const deep = hex("#56703f");
    const stripes = 12; // 1 m bands
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const band = Math.floor(u * stripes) % 2 ? 1 : 0;
        const low = fbm(u, v, 4, 3, 11);
        const mid = fbm(u, v, 24, 2, 13);
        const g = hash2(x, y, 2);
        let col = mix(base, dry, smooth(0.5, 0.85, low) * 0.5);
        col = mix(col, deep, smooth(0.45, 0.2, mid) * 0.35);
        const k = 0.96 + band * 0.055 + (g - 0.5) * 0.14;
        col = [col[0] * k, col[1] * k, col[2] * k];
        const i = y * W + x;
        c.set(i, col);
        c.height![i] = g * 0.6 + mid * 0.4;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 0.45, meters), meters };
  });
}

/** Neglected yard: patchy dry grass and bare soil. */
export function patchyYard(): TexSet {
  return cached("patchy", () => {
    const W = size(1024);
    const meters = 12;
    const c = new Canvas(W, W);
    const grass = hex("#7f8250");
    const straw = hex("#a39767");
    const soil = hex("#8a7258");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const n = fbm(u, v, 6, 4, 81);
        const n2 = fbm(u, v, 20, 2, 83);
        let col = mix(grass, straw, smooth(0.35, 0.6, n2));
        col = mix(col, soil, smooth(0.5, 0.62, n));
        const g = 0.9 + hash2(x, y, 4) * 0.2;
        c.set(y * W + x, [col[0] * g, col[1] * g, col[2] * g]);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

/** Paper-toned ground outside the lot: reads as a presentation model base. */
export function field(): TexSet {
  return cached("field", () => {
    const W = size(512);
    const meters = 24;
    const c = new Canvas(W, W);
    const a = hex("#e3dbcd");
    const b = hex("#d9cfbe");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const col = mix(a, b, fbm(u, v, 5, 3, 3) * 0.9);
        const g = 0.985 + hash2(x, y, 6) * 0.03;
        c.set(y * W + x, [col[0] * g, col[1] * g, col[2] * g]);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

export function concrete(joint = 0, tint = "#d5cfc4", meters = 4, seed = 1): TexSet {
  return cached(`concrete${joint}${tint}${meters}`, () => {
    const W = size(512);
    const c = new Canvas(W, W, true);
    const base = hex(tint);
    const per = joint ? meters / joint : 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const n = fbm(u, v, 8, 4, seed) - 0.5;
        const sp = hash2(x, y, seed + 3);
        let k = 1 + n * 0.08 + (sp > 0.985 ? -0.08 : 0) + (sp - 0.5) * 0.03;
        let h = n * 0.2;
        if (per) {
          const ju = (u * per) % 1;
          const jv = (v * per) % 1;
          const dj = Math.min(ju, 1 - ju, jv, 1 - jv) * (W / per);
          if (dj < 1.4) {
            k *= 0.72;
            h -= 0.6;
          }
        }
        const i = y * W + x;
        c.set(i, [base[0] * k, base[1] * k, base[2] * k]);
        c.height![i] = h;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 0.9, meters), meters };
  });
}

/* ------------------------------------------------------------------ walls */

export function plaster(): TexSet {
  return cached("plaster", () => {
    const W = size(512);
    const meters = 4;
    const c = new Canvas(W, W, true);
    const base = hex("#efebe4");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const n = fbm(u, v, 12, 4, 44) - 0.5;
        const g = hash2(x, y, 45) - 0.5;
        const k = 1 + n * 0.035 + g * 0.02;
        const i = y * W + x;
        c.set(i, [base[0] * k, base[1] * k, base[2] * k]);
        c.height![i] = n * 0.5 + g * 0.25;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 0.9, meters), meters };
  });
}

/** Vertical cedar boards with shadow gaps. */
export function cedar(): TexSet {
  return cached("cedar", () => {
    const W = size(1024);
    const meters = 2.4;
    const boards = 16;
    const c = new Canvas(W, W, true);
    const base = hex("#9b6a47");
    const light = hex("#b98459");
    const dark = hex("#6f4a31");
    const bw = W / boards;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const b = Math.floor(x / bw);
        const g = (x - b * bw) / bw;
        const u = x / W;
        const v = y / W;
        const tone = hash2(b, 0, 7);
        let col = mix(base, tone > 0.5 ? light : dark, Math.abs(tone - 0.5) * 0.9);
        const grain = fbm(u * 1.0, v, 180, 3, 30 + b, 6) - 0.5;
        const k = 1 + grain * 0.28;
        col = [col[0] * k, col[1] * k, col[2] * k];
        const gap = g < 0.07;
        if (gap) col = [col[0] * 0.28, col[1] * 0.26, col[2] * 0.25];
        const i = y * W + x;
        c.set(i, col);
        c.height![i] = gap ? -1 : grain * 0.25 + (g > 0.93 ? -0.3 : 0);
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 1.4, meters), meters };
  });
}

/* ---------------------------------------------------------------- interior */

export function marble(): TexSet {
  return cached("marble", () => {
    const W = size(1024);
    const meters = 1.6;
    const c = new Canvas(W, W);
    const base = hex("#f2efe9");
    const vein = hex("#8f8a82");
    const gold = hex("#b69a74");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const w1 = fbm(u, v, 3, 4, 5);
        const w2 = fbm(u + 0.3, v - 0.2, 3, 4, 9);
        const n = fbm(u + w1 * 0.45, v + w2 * 0.45, 2, 5, 13);
        const major = 1 - smooth(0.0, 0.018, Math.abs(n - 0.5));
        const n2 = fbm(u * 1 + w2 * 0.3, v + w1 * 0.3, 5, 4, 17);
        const minor = 1 - smooth(0.0, 0.01, Math.abs(n2 - 0.52));
        const cloud = fbm(u, v, 6, 3, 23) - 0.5;
        let col: RGB = [base[0] * (1 + cloud * 0.03), base[1] * (1 + cloud * 0.03), base[2] * (1 + cloud * 0.035)];
        col = mix(col, mix(vein, gold, smooth(0.4, 0.7, w1)), major * 0.75);
        col = mix(col, vein, minor * 0.35);
        c.set(y * W + x, col);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

export function granite(): TexSet {
  return cached("granite", () => {
    const W = size(512);
    const meters = 0.7;
    const c = new Canvas(W, W);
    const base = hex("#1b1b1c");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const s = hash2(x >> 1, y >> 1, 3);
        const m = fbm(x / W, y / W, 10, 3, 4) - 0.5;
        let col: RGB = [base[0] * (1 + m * 0.5), base[1] * (1 + m * 0.5), base[2] * (1 + m * 0.5)];
        if (s > 0.93) col = mix(col, [120, 118, 116], (s - 0.93) * 12);
        if (s > 0.992) col = [190, 186, 180];
        c.set(y * W + x, col);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

export function porcelain(): TexSet {
  return cached("porcelain", () => {
    const W = size(1024);
    const meters = 2.4;
    const c = new Canvas(W, W, true);
    const base = hex("#d8d3ca");
    const grout = hex("#aaa49a");
    const tiles = 2;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const tu = (u * tiles) % 1;
        const tv = (v * tiles) % 1;
        const d = Math.min(tu, 1 - tu, tv, 1 - tv) * (W / tiles);
        const tone = (hash2(Math.floor(u * tiles), Math.floor(v * tiles), 8) - 0.5) * 0.04;
        const cloud = fbm(u, v, 5, 4, 2) - 0.5;
        const k = 1 + tone + cloud * 0.05;
        const isG = d < 1.3;
        const col: RGB = isG ? grout : [base[0] * k, base[1] * k, base[2] * k];
        const i = y * W + x;
        c.set(i, col);
        c.height![i] = isG ? -1 : 0;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 0.8, meters), meters };
  });
}

export function polishedConcrete(): TexSet {
  return cached("pconcrete", () => {
    const W = size(1024);
    const meters = 3;
    const c = new Canvas(W, W);
    const base = hex("#a6a29b");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const m = fbm(u, v, 4, 5, 51) - 0.5;
        const s = hash2(x, y, 52);
        let k = 1 + m * 0.14;
        if (s > 0.994) k *= 1.18;
        else if (s < 0.004) k *= 0.8;
        c.set(y * W + x, [base[0] * k, base[1] * k, base[2] * k]);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

/** Handmade-looking white tile for the backsplash. */
export function zellige(): TexSet {
  return cached("zellige", () => {
    const W = size(512);
    const meters = 0.6;
    const c = new Canvas(W, W, true);
    const rows = 8;
    const cols = 4;
    const base = hex("#eeeae2");
    for (let y = 0; y < W; y++) {
      const r = Math.floor((y / W) * rows);
      const fy = ((y / W) * rows) % 1;
      for (let x = 0; x < W; x++) {
        const off = r % 2 ? 0.5 : 0;
        const xx = ((x / W) * cols + off) % cols;
        const cI = Math.floor(xx);
        const fx = xx - cI;
        const d = Math.min(fx * (W / cols), (1 - fx) * (W / cols), fy * (W / rows), (1 - fy) * (W / rows));
        const tone = (hash2(cI, r, 3) - 0.5) * 0.07;
        const wob = fbm(x / W, y / W, 16, 2, 5 + cI + r * 7) - 0.5;
        const grout = d < 1.6;
        const k = 1 + tone + wob * 0.05;
        const i = y * W + x;
        c.set(i, grout ? [196, 190, 181] : [base[0] * k, base[1] * k, base[2] * k]);
        c.height![i] = grout ? -1 : wob * 0.8;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 1.5, meters), meters };
  });
}

export function laminate(): TexSet {
  return cached("laminate", () => {
    const W = size(256);
    const meters = 0.8;
    const c = new Canvas(W, W);
    const base = hex("#cdb994");
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const s = hash2(x, y, 9);
        const k = 1 + (s - 0.5) * 0.1 + (s > 0.97 ? -0.15 : 0);
        c.set(y * W + x, [base[0] * k, base[1] * k, base[2] * k]);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

/* ------------------------------------------------------------------ solar */

export function solarCells(finish: "black" | "silver"): TexSet {
  return cached(`cells${finish}`, () => {
    const Wd = 256;
    const Ht = 384;
    const c = new Canvas(Wd, Ht);
    const cell: RGB = finish === "black" ? hex("#101522") : hex("#1a2a45");
    const gap: RGB = finish === "black" ? hex("#343a45") : hex("#c9cfd6");
    const bus: RGB = finish === "black" ? hex("#1e2530") : hex("#9aa3ad");
    const cx = 6;
    const cy = 10;
    for (let y = 0; y < Ht; y++) {
      for (let x = 0; x < Wd; x++) {
        const fx = (x / Wd) * cx;
        const fy = (y / Ht) * cy;
        const gx = fx % 1;
        const gy = fy % 1;
        const edge = gx < 0.03 || gx > 0.97 || gy < 0.025 || gy > 0.975;
        const busbar = Math.abs(gx - 0.25) < 0.012 || Math.abs(gx - 0.5) < 0.012 || Math.abs(gx - 0.75) < 0.012;
        const n = (hash2(x, y, 1) - 0.5) * 6;
        const col: RGB = edge ? gap : busbar ? bus : [cell[0] + n, cell[1] + n, cell[2] + n];
        c.set(y * Wd + x, col);
      }
    }
    const t = toTexture(c, true, 1, false);
    return { map: t, meters: 1 };
  });
}

/* ------------------------------------------------------------- utilities */

/** Soft radial gradient for fake light pools (additive). */
export function glowTexture(): THREE.DataTexture {
  const key = "glow";
  const hit = cache.get(key);
  if (hit) return hit.map as THREE.DataTexture;
  const W = 128;
  const c = new Canvas(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5) / W - 0.5;
      const dy = (y + 0.5) / W - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.pow(clamp(1 - d), 2.2);
      c.set(y * W + x, [255 * a, 255 * a, 255 * a], 255);
    }
  }
  const t = toTexture(c, false, 1, false);
  cache.set(key, { map: t, meters: 1 });
  return t;
}

/**
 * Baked soft contact shadow for the house footprint. rects are world XZ rectangles
 * inside the square [cx-half, cx+half] x [cz-half, cz+half].
 */
export function footprintShadow(rects: Array<[number, number, number, number]>, cx: number, cz: number, half: number): THREE.DataTexture {
  const W = 256;
  const a = new Float32Array(W * W);
  const toPx = (v: number, c0: number) => ((v - (c0 - half)) / (half * 2)) * W;
  for (const [x0, x1, z0, z1] of rects) {
    const px0 = Math.floor(toPx(x0, cx));
    const px1 = Math.ceil(toPx(x1, cx));
    const pz0 = Math.floor(toPx(z0, cz));
    const pz1 = Math.ceil(toPx(z1, cz));
    for (let y = Math.max(0, pz0); y < Math.min(W, pz1); y++) for (let x = Math.max(0, px0); x < Math.min(W, px1); x++) a[y * W + x] = 1;
  }
  const tmp = new Float32Array(W * W);
  const blur = (src: Float32Array, dst: Float32Array, r: number, horiz: boolean) => {
    for (let j = 0; j < W; j++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const kk = Math.min(W - 1, Math.max(0, k));
        acc += horiz ? src[j * W + kk] : src[kk * W + j];
      }
      for (let i = 0; i < W; i++) {
        const idx = horiz ? j * W + i : i * W + j;
        dst[idx] = acc / (2 * r + 1);
        const add = Math.min(W - 1, i + r + 1);
        const rem = Math.max(0, i - r);
        acc += (horiz ? src[j * W + add] : src[add * W + j]) - (horiz ? src[j * W + rem] : src[rem * W + j]);
      }
    }
  };
  for (let p = 0; p < 3; p++) {
    blur(a, tmp, 5, true);
    blur(tmp, a, 5, false);
  }
  const c = new Canvas(W, W);
  for (let i = 0; i < W * W; i++) c.set(i, [0, 0, 0], Math.min(255, a[i] * 255));
  const t = toTexture(c, false, 1, false);
  t.flipY = false;
  return t;
}

/** Tileable ripple normals for the pool surface (scrolled over time). */
export function waterNormals(): TexSet {
  return cached("water", () => {
    const W = 256;
    const meters = 3;
    const c = new Canvas(W, W, true);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / W;
        const h = fbm(u, v, 6, 4, 91) * 0.7 + fbm(u, v, 16, 2, 93) * 0.3;
        const i = y * W + x;
        c.set(i, [128, 128, 255]);
        c.height![i] = h;
      }
    }
    return { map: normalFromHeight(c, 1.6, meters), meters };
  });
}

/** Mosaic tile for the pool shell. */
export function poolTile(): TexSet {
  return cached("pooltile", () => {
    const W = 256;
    const meters = 1;
    const c = new Canvas(W, W);
    const base = hex("#5fc0d4");
    const n = 16;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const gx = ((x / W) * n) % 1;
        const gy = ((y / W) * n) % 1;
        const grout = gx < 0.08 || gy < 0.08;
        const tone = (hash2(Math.floor((x / W) * n), Math.floor((y / W) * n), 5) - 0.5) * 0.12;
        const k = 1 + tone;
        c.set(y * W + x, grout ? [214, 226, 228] : [base[0] * k, base[1] * k, base[2] * k]);
      }
    }
    return { map: toTexture(c, true, meters), meters };
  });
}

/** Large-format pale limestone pavers (0.9 × 0.6 m, stretcher bond). */
export function limestone(): TexSet {
  return cached("limestone", () => {
    const W = size(1024);
    const meters = 3.6;
    const c = new Canvas(W, W, true);
    const base = hex("#ddd5c4");
    const cols = 4; // 0.9 m
    const rows = 6; // 0.6 m
    for (let y = 0; y < W; y++) {
      const r = Math.floor((y / W) * rows);
      const fy = ((y / W) * rows) % 1;
      for (let x = 0; x < W; x++) {
        const off = r % 2 ? 0.5 : 0;
        const xx = ((x / W) * cols + off) % cols;
        const ci = Math.floor(xx);
        const fx = xx - ci;
        const d = Math.min(fx * (W / cols), (1 - fx) * (W / cols), fy * (W / rows), (1 - fy) * (W / rows));
        const joint = d < 1.6;
        const tone = (hash2(ci, r, 31) - 0.5) * 0.07;
        const cloud = fbm(x / W, y / W, 10, 4, 33 + ci + r * 5) - 0.5;
        const pit = hash2(x, y, 34) > 0.996 ? -0.12 : 0;
        const k = 1 + tone + cloud * 0.06 + pit;
        const i = y * W + x;
        c.set(i, joint ? [168, 160, 146] : [base[0] * k, base[1] * k, base[2] * k]);
        c.height![i] = joint ? -1 : cloud * 0.3;
      }
    }
    return { map: toTexture(c, true, meters), normalMap: normalFromHeight(c, 0.9, meters), meters };
  });
}
