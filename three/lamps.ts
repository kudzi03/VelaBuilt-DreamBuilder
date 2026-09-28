import * as THREE from "three";

/**
 * Lamps without scene lights. Interiors seen through the glazing, facade wall-washers, soffit
 * downlights, the kitchen and the garden are lit by these; only materials passed through
 * `lampLit()` evaluate them, and each material only the categories it cares about. Positions
 * (and cone directions) are transformed to view space once per frame on the CPU. Diffuse + GGX
 * specular with smooth range falloff, using three's own BRDF functions. A lamp with a `cone` is
 * a spot: a recessed downlight throws the scallop of light architectural photographs are made of.
 */

export const MAX_LAMPS = 48;
export type LampGroup = "interior" | "exterior" | "kitchen" | "garden";
const BIT: Record<LampGroup, number> = { interior: 1, exterior: 2, kitchen: 4, garden: 8 };

export interface Lamp {
  pos: [number, number, number];
  color: THREE.ColorRepresentation;
  /** peak irradiance near the lamp */
  power: number;
  /** metres to zero */
  range: number;
  group: LampGroup;
  /** spot: aim (world) and half-angle in degrees of the full-intensity core and the soft edge */
  cone?: { dir: [number, number, number]; inner: number; outer: number };
}

/**
 * Three vec4 arrays (48 lamps = 144 uniform vectors, well inside WebGL2's guaranteed 224 per
 * fragment shader together with the standard material's own):
 *   uLampPos  xyz view-space position, w cos(inner half-angle) (-1 without a cone)
 *   uLampCol  rgb radiance, w group bits * 100 + range in metres
 *   uLampDir  xyz view-space aim, w cos(outer half-angle) (-2 without a cone)
 */
export const LAMP_UNIFORMS = {
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
  uLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
  uLampDir: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, 0, 0, -2)) },
  uLampCount: { value: 0 },
};

const lamps: Lamp[] = [];
const level: Record<LampGroup, number> = { interior: 1, exterior: 1, kitchen: 1, garden: 0 };

export function registerLamps(list: Lamp[]) {
  for (const l of list) if (lamps.length < MAX_LAMPS && !lamps.includes(l)) lamps.push(l);
  syncColors();
}
export function unregisterLamps(list: Lamp[]) {
  for (const l of list) {
    const i = lamps.indexOf(l);
    if (i >= 0) lamps.splice(i, 1);
  }
  syncColors();
}
/** Current level of a group (fixtures that glow read it). */
export function lampLevel(group: LampGroup) {
  return level[group];
}

/** Re-read every lamp's colour and power (after changing a registered lamp's `power` in place). */
export function refreshLamps() {
  syncColors();
}

/** 0..1 per group. */
export function setLampLevels(next: Partial<Record<LampGroup, number>>) {
  Object.assign(level, next);
  syncColors();
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const DEG = Math.PI / 180;
function syncColors() {
  LAMP_UNIFORMS.uLampCount.value = lamps.length;
  lamps.forEach((l, i) => {
    _c.set(l.color);
    const k = l.power * level[l.group];
    LAMP_UNIFORMS.uLampCol.value[i].set(_c.r * k, _c.g * k, _c.b * k, BIT[l.group] * 100 + Math.min(l.range, 99));
    LAMP_UNIFORMS.uLampPos.value[i].w = l.cone ? Math.cos(l.cone.inner * DEG) : -1;
    LAMP_UNIFORMS.uLampDir.value[i].w = l.cone ? Math.cos(l.cone.outer * DEG) : -2;
  });
}

/** Call once per frame (before rendering) with the active camera. */
export function updateLampViewPositions(camera: THREE.Camera) {
  lamps.forEach((l, i) => {
    _v.set(...l.pos).applyMatrix4(camera.matrixWorldInverse);
    const p = LAMP_UNIFORMS.uLampPos.value[i];
    p.set(_v.x, _v.y, _v.z, p.w);
    if (l.cone) {
      _v.set(...l.cone.dir).normalize().transformDirection(camera.matrixWorldInverse);
      const d = LAMP_UNIFORMS.uLampDir.value[i];
      d.set(_v.x, _v.y, _v.z, d.w);
    }
  });
}

const HEAD = /* glsl */ `
#define VB_MAX_LAMPS ${MAX_LAMPS}
uniform vec4 uLampPos[VB_MAX_LAMPS];
uniform vec4 uLampCol[VB_MAX_LAMPS];
uniform vec4 uLampDir[VB_MAX_LAMPS];
uniform int uLampCount;
uniform int uLampMask;
`;

const BODY = /* glsl */ `
for (int i = 0; i < VB_MAX_LAMPS; i++) {
  if (i >= uLampCount) break;
  float bitsF = floor(uLampCol[i].w / 100.0);
  if ((int(bitsF + 0.5) & uLampMask) == 0) continue;
  vec3 lv = uLampPos[i].xyz - geometryPosition;
  float ld = length(lv);
  float range = uLampCol[i].w - bitsF * 100.0;
  if (ld > range) continue;
  vec3 L = lv / ld;
  float fall = pow2(saturate(1.0 - pow4(ld / range))) / (1.0 + ld * ld * 0.6);
  vec4 cone = uLampDir[i];
  if (cone.w > -1.5) fall *= smoothstep(cone.w, uLampPos[i].w, dot(-L, cone.xyz));
  vec3 radiance = uLampCol[i].rgb * fall;
  float nl = saturate(dot(geometryNormal, L));
  reflectedLight.directDiffuse += radiance * (nl * 0.85 + 0.15 * float(uLampMask != 2)) * BRDF_Lambert(material.diffuseColor);
  reflectedLight.directSpecular += radiance * nl * BRDF_GGX(L, geometryViewDir, geometryNormal, material);
}
`;

/** Make a standard/physical material respond to lamps of the given groups. Chains with other patches. */
export function lampLit<T extends THREE.MeshStandardMaterial>(mat: T, groups: LampGroup[] = ["interior"]): T {
  const mask = groups.reduce((m, g) => m | BIT[g], 0);
  // interior probes find the materials they light by this tag
  mat.userData.lampGroups = groups;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    prev?.call(mat, s, r);
    Object.assign(s.uniforms, LAMP_UNIFORMS, { uLampMask: { value: mask } });
    s.fragmentShader = s.fragmentShader.replace("#include <common>", `#include <common>\n${HEAD}`).replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${BODY}`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|lamps`;
  return mat;
}

/** Back-compat: interior rooms. */
export function interior<T extends THREE.MeshStandardMaterial>(mat: T): T {
  return lampLit(mat, ["interior"]);
}
