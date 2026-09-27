import * as THREE from "three";

/**
 * Small textures generated on the device (solar cells) and the seeded RNG the scene uses for
 * placement. Surface materials are CC0 photo sets now — see three/materials.ts.
 */

export let MAX_ANISO = 4;
export function setMaxAnisotropy(n: number) {
  MAX_ANISO = Math.max(1, Math.min(8, n));
}

export let TEX_SCALE = 1; // 0.5 on low tier
export function setTextureScale(s: number) {
  TEX_SCALE = s;
}

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

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
