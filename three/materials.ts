import * as THREE from "three";
import TEX from "@/public/assets/tex/textures.json";

/**
 * PBR material library over the CC0 texture sets built by scripts/assets/build_textures.py.
 * UVs throughout the scene are in metres; each texture knows the real size of its tile,
 * so repeat = 1 / metres and every surface is at true scale.
 */

export type TexId = keyof typeof TEX;
type MapKind = "color" | "normal" | "arm";
interface TexRec {
  meters: number[];
  maps: string[];
  sizes: number[];
  mean?: number[];
}

let budget = 1024;
let anisotropy = 8;
/** Largest texture edge to request (tier setting). */
export function setTextureBudget(px: number) {
  budget = px;
}
export function setAnisotropy(n: number) {
  anisotropy = Math.max(1, Math.min(16, n));
}

const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;
const cache = new Map<string, THREE.Texture>();

function rec(id: TexId): TexRec {
  return TEX[id] as TexRec;
}

function sizeFor(id: TexId, cap: number) {
  const sizes = [...rec(id).sizes].sort((a, b) => b - a);
  return sizes.find((s) => s <= cap) ?? sizes[sizes.length - 1];
}

/** A texture at real-world scale. `scale` > 1 makes the pattern larger. */
export function tex(id: TexId, kind: MapKind, opts: { cap?: number; scale?: number } = {}): THREE.Texture | null {
  const r = rec(id);
  if (!r.maps.includes(kind) || !loader) return null;
  const size = sizeFor(id, Math.min(budget, opts.cap ?? 4096));
  const scale = opts.scale ?? 1;
  const key = `${id}/${kind}_${size}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = cache.get(`${id}/${kind}_${size}@1`);
  let t: THREE.Texture;
  if (base && scale !== 1) {
    t = base.clone(); // shares the image and the GPU upload
  } else {
    t = loader.load(`/assets/tex/${id}/${kind}_${size}.webp`);
    t.colorSpace = kind === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
  }
  t.repeat.set(1 / (r.meters[0] * scale), 1 / (r.meters[1] * scale));
  cache.set(key, t);
  return t;
}

/** Colour multiplier that makes a greyscale (tintable) texture average to `hex`. */
export function tintFor(id: TexId, hex: THREE.ColorRepresentation, target = new THREE.Color()) {
  const mean = rec(id).mean ?? [0.5, 0.5, 0.5];
  target.set(hex); // linear, three.js colour management
  return target.setRGB(target.r / Math.max(mean[0], 1e-3), target.g / Math.max(mean[1], 1e-3), target.b / Math.max(mean[2], 1e-3));
}

export interface PbrOptions {
  color?: THREE.ColorRepresentation;
  /** tint a greyscale texture to this swatch */
  tint?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  /** use the arm blue channel as a metalness map */
  metalMap?: boolean;
  normalScale?: number;
  aoIntensity?: number;
  envMapIntensity?: number;
  scale?: number;
  cap?: number;
  side?: THREE.Side;
  noNormal?: boolean;
  noArm?: boolean;
}

export function pbr(id: TexId, o: PbrOptions = {}): THREE.MeshStandardMaterial {
  const t = { cap: o.cap, scale: o.scale };
  const arm = o.noArm ? null : tex(id, "arm", t);
  const m = new THREE.MeshStandardMaterial({
    map: tex(id, "color", t),
    normalMap: o.noNormal ? null : tex(id, "normal", t),
    roughnessMap: arm,
    metalnessMap: o.metalMap ? arm : null,
    aoMap: arm,
    aoMapIntensity: o.aoIntensity ?? 1,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    envMapIntensity: o.envMapIntensity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.tint !== undefined) tintFor(id, o.tint, m.color);
  else if (o.color !== undefined) m.color.set(o.color);
  if (o.normalScale !== undefined) m.normalScale.set(o.normalScale, o.normalScale);
  m.name = id;
  return m;
}

/** A plain (untextured) physically-based material with a whisper of surface variation. */
export function solid(color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/**
 * Architectural glazing. Diffuse is black; the shader keeps the specular reflection (env +
 * sun, Fresnel-weighted) and outputs transmittance in alpha, blended as
 *   result = reflection + behind × (1 − F) × T
 * so the room behind shows through at the right strength and reflections are never dimmed.
 */
export function glass(opts: { transmittance?: number; roughness?: number; tint?: THREE.ColorRepresentation; envMapIntensity?: number } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: opts.roughness ?? 0.03,
    metalness: 0,
    envMapIntensity: opts.envMapIntensity ?? 1.15,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
  });
  const T = opts.transmittance ?? 0.8;
  const tint = new THREE.Color(opts.tint ?? "#dfe9e6");
  m.onBeforeCompile = (s) => {
    s.uniforms.uGlassT = { value: T };
    s.uniforms.uGlassTint = { value: tint };
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlassT;\nuniform vec3 uGlassTint;")
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        float glassNV = saturate(abs(dot(geometryNormal, geometryViewDir)));
        float glassF = 0.04 + 0.96 * pow(1.0 - glassNV, 5.0);
        gl_FragColor = vec4(outgoingLight * uGlassTint, (1.0 - glassF) * uGlassT);`,
      );
  };
  m.customProgramCacheKey = () => "vb-glass";
  return m;
}

/** Warm, self-lit surface for interiors glimpsed through glazing (rooms we never enter). */
export function roomGlow(color: THREE.ColorRepresentation, intensity: number) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 1 });
}

export function disposeTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
