import * as THREE from "three";
import PLANTS from "@/public/assets/plants/impostors.json";

/**
 * Hemi-octahedral impostors of photoscanned CC0 plants (Poly Haven), baked by
 * scripts/assets/bake_impostors.py. Each plant is a camera-facing quad that blends the
 * three nearest of N×N pre-rendered views, reprojecting each view onto the quad, and is
 * lit in real time from its baked normals (wrap + backlit translucency), so it holds up
 * from eye level to drone height and follows the sun, sky and shadows.
 *
 * Frame directions and bases must match bake_impostors.py.
 */

export type PlantId = keyof typeof PLANTS;
interface PlantRec {
  N: number;
  radius: number;
  height: number;
  center: number[];
  px: number[];
}

export function plant(id: PlantId): PlantRec {
  return PLANTS[id] as PlantRec;
}

const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;
const texCache = new Map<string, THREE.Texture>();
function atlas(id: PlantId, kind: "color" | "normal", px: number) {
  const key = `${id}_${kind}_${px}`;
  let t = texCache.get(key);
  if (!t && loader) {
    t = loader.load(`/assets/plants/${key}.webp`);
    t.colorSpace = kind === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t!;
}

/** World-space direction toward the sun, shared by every impostor (set each frame). */
export const IMPOSTOR_SUN = { value: new THREE.Vector3(0.6, 0.3, 0.6).normalize() };

const COMMON = /* glsl */ `
uniform float uImpN;
uniform float uImpR;
uniform float uImpCY;
vec2 hemiOctEncode(vec3 d) {
  d.y = max(d.y, 0.0);
  vec2 p = d.xz / (abs(d.x) + abs(d.y) + abs(d.z));
  return vec2(p.x + p.y, p.x - p.y);
}
vec3 hemiOctDecode(vec2 q) {
  vec2 p = vec2(q.x + q.y, q.x - q.y) * 0.5;
  return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}
void frameBasis(vec3 d, out vec3 x, out vec3 y) {
  y = d.y > 0.999 ? vec3(0.0, 0.0, -1.0) : normalize(vec3(0.0, 1.0, 0.0) - d * d.y);
  x = cross(y, d);
}
vec2 frameUv(vec2 cell, vec3 p) {
  vec2 q = -1.0 + 2.0 * cell / (uImpN - 1.0);
  vec3 d = hemiOctDecode(q);
  vec3 x, y;
  frameBasis(d, x, y);
  return vec2(dot(p, x), dot(p, y)) / (2.0 * uImpR) + 0.5;
}
mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
`;

/**
 * Vertex logic shared by the colour and depth passes. Expects `position` in [-0.5, 0.5]
 * (a unit quad) and instanceMatrix = translate · rotateY(yaw) · scale.
 * `viewFrom` is the world-space point or direction the quad should face.
 */
const VERT = /* glsl */ `
  vec3 iT = instanceMatrix[3].xyz;
  float iS = length(instanceMatrix[0].xyz);
  float iYaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
  vec3 iCenter = (modelMatrix * vec4(iT + vec3(0.0, uImpCY * iS, 0.0), 1.0)).xyz;
  vec3 toView = IMP_VIEW_DIR;
  vec3 dLocal = rotY(-iYaw) * toView;
  dLocal.y = max(dLocal.y, 0.0);
  dLocal = normalize(dLocal + vec3(0.0, 1e-4, 0.0));
  vec3 fw = normalize(toView);
  vec3 rt = abs(fw.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 upv = cross(fw, rt);
  vec3 impWorld = iCenter + (rt * position.x + upv * position.y) * (2.0 * uImpR * iS);
  vec3 p = rotY(-iYaw) * (impWorld - iCenter) / iS;
  vec2 g = (hemiOctEncode(dLocal) * 0.5 + 0.5) * (uImpN - 1.0);
  vec2 b = clamp(floor(g), vec2(0.0), vec2(uImpN - 2.0));
  vec2 f = g - b;
  vec2 c0, c1, c2;
  if (f.x + f.y < 1.0) {
    c0 = b; c1 = b + vec2(1.0, 0.0); c2 = b + vec2(0.0, 1.0);
    vImpW = vec3(1.0 - f.x - f.y, f.x, f.y);
  } else {
    c0 = b + vec2(1.0, 1.0); c1 = b + vec2(0.0, 1.0); c2 = b + vec2(1.0, 0.0);
    vImpW = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y);
  }
  vImpUv0 = frameUv(c0, p); vImpCell0 = c0;
  vImpUv1 = frameUv(c1, p); vImpCell1 = c1;
  vImpUv2 = frameUv(c2, p); vImpCell2 = c2;
  vImpYaw = iYaw;
`;

const VARYINGS = /* glsl */ `
varying vec3 vImpW;
varying vec2 vImpUv0; varying vec2 vImpUv1; varying vec2 vImpUv2;
varying vec2 vImpCell0; varying vec2 vImpCell1; varying vec2 vImpCell2;
varying float vImpYaw;
`;

const SAMPLE = /* glsl */ `
vec4 impTap(sampler2D t, vec2 uv, vec2 cell) {
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);
  return texture2D(t, (cell + uv) / uImpN);
}
vec4 impSample(sampler2D t) {
  return impTap(t, vImpUv0, vImpCell0) * vImpW.x + impTap(t, vImpUv1, vImpCell1) * vImpW.y + impTap(t, vImpUv2, vImpCell2) * vImpW.z;
}
`;

function uniformsFor(id: PlantId) {
  const r = plant(id);
  return { uImpN: { value: r.N }, uImpR: { value: r.radius }, uImpCY: { value: r.center[1] } };
}

/** Lit colour material (MeshStandardMaterial underneath: sun, IBL, shadows, fog all apply). */
export function impostorMaterial(id: PlantId, hiRes: boolean) {
  const r = plant(id);
  const px = hiRes ? r.px[0] : r.px[1];
  const color = atlas(id, "color", px);
  const normal = atlas(id, "normal", px);
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  const u = uniformsFor(id);
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, { uImpColor: { value: color }, uImpNormal: { value: normal }, uImpSun: IMPOSTOR_SUN });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${VARYINGS}\nuniform vec3 uImpSun;`)
      .replace("#include <project_vertex>", `${VERT.replace("IMP_VIEW_DIR", "cameraPosition - iCenter")}
        vec4 mvPosition = viewMatrix * vec4(impWorld, 1.0);
        gl_Position = projectionMatrix * mvPosition;`)
      // receive shadows as if sampled on the sunward side of the crown: no self-shadowing
      .replace("#include <worldpos_vertex>", "vec4 worldPosition = vec4(impWorld + normalize(uImpSun) * uImpR * iS * 0.7, 1.0);")
      .replace("#include <defaultnormal_vertex>", "vec3 transformedNormal = vec3(0.0, 0.0, 1.0); // view space: faces the camera");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${VARYINGS}\n${SAMPLE}\nuniform sampler2D uImpColor;\nuniform sampler2D uImpNormal;`)
      .replace(
        "#include <map_fragment>",
        `vec4 impC = impSample(uImpColor);
        vec4 impN = impSample(uImpNormal);
        float impA = impC.a;
        // atlases store straight (not premultiplied) colour, dilated past the silhouette
        diffuseColor.rgb *= impC.rgb / max(vImpW.x + vImpW.y + vImpW.z, 1e-3);
        diffuseColor.a = impA;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `vec3 impNL = impN.xyz * 2.0 - 1.0;
        vec3 impNW = rotY(vImpYaw) * normalize(impNL);
        normal = normalize((viewMatrix * vec4(impNW, 0.0)).xyz);
        float impShade = clamp(impN.a, 0.0, 1.0);`,
      )
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>
        void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          float nl = dot(geometryNormal, directLight.direction);
          float wrap = saturate((nl + 0.45) / 1.45);
          float back = pow(saturate(dot(geometryViewDir, -directLight.direction)), 3.0) * 0.55;
          reflectedLight.directDiffuse += (wrap + back) * directLight.color * BRDF_Lambert(material.diffuseColor);
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Foliage`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.35, 1.0, impShade);
        reflectedLight.directDiffuse *= mix(0.6, 1.0, impShade);
        reflectedLight.indirectSpecular *= impShade * 0.5;`,
      );
  };
  m.customProgramCacheKey = () => `vb-impostor`;
  return m;
}

/** Shadow caster: the same plant seen from the sun, so its shadow has the right silhouette. */
export function impostorDepthMaterial(id: PlantId, hiRes: boolean) {
  const r = plant(id);
  const color = atlas(id, "color", hiRes ? r.px[0] : r.px[1]);
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const u = uniformsFor(id);
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, { uImpColor: { value: color }, uImpSun: IMPOSTOR_SUN });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${VARYINGS}\nuniform vec3 uImpSun;`)
      .replace("#include <project_vertex>", `${VERT.replace("IMP_VIEW_DIR", "uImpSun")}
        vec4 mvPosition = viewMatrix * vec4(impWorld, 1.0);
        gl_Position = projectionMatrix * mvPosition;`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}\n${VARYINGS}\n${SAMPLE}\nuniform sampler2D uImpColor;`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (impSample(uImpColor).a < 0.5) discard;");
  };
  m.customProgramCacheKey = () => `vb-impostor-depth`;
  return m;
}

export interface PlantPlacement {
  x: number;
  z: number;
  /** metres tall */
  height: number;
  yaw?: number;
  y?: number;
  tone?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Instanced impostors for one species. Heights are real metres; the bake records the source height. */
export function buildImpostors(id: PlantId, list: PlantPlacement[], hiRes: boolean) {
  const r = plant(id);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, r.center[1], 0), r.radius * 1.05);
  const mat = impostorMaterial(id, hiRes);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.customDepthMaterial = impostorDepthMaterial(id, hiRes);
  const col = new THREE.Color();
  list.forEach((pl, i) => {
    const s = pl.height / r.height;
    _q.setFromAxisAngle(_up, pl.yaw ?? (i * 2.399) % (Math.PI * 2));
    _m.compose(_p.set(pl.x, pl.y ?? 0, pl.z), _q, _s.set(s, s, s));
    mesh.setMatrixAt(i, _m);
    const t = pl.tone ?? 0;
    col.setRGB(1 + t * 0.6, 1 + t * 0.3, 1 - t * 0.2);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `plants:${id}`;
  return mesh;
}
