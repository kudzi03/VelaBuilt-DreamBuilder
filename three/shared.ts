import * as THREE from "three";

/**
 * Uniforms shared by every patched material. Mutated once per frame by the
 * Director; materials never re-render React to animate.
 */
export const U = {
  time: { value: 0 },
  /** world Y above which the solid house is removed (section sweep) */
  cutY: { value: 100 },
  dusk: { value: 0 },
  ghost: { value: 0 },
  airColor: { value: new THREE.Color("#4f9fd6") },
};

/** Animated scalars (0..1) the scene layers read each frame. */
export const channels = {
  /** starts at the arrival's twilight so the first frame is already the hero light */
  dusk: 0.84,
  cut: 1,
  ghost: 0,
  wingLift: 0,
  glassWall: 1,
  steel: 0,
  solar: 0,
  hvac: 0,
  kitchen: 0,
  gardenFocus: 0,
  roof: 0,
};

export type ChannelKey = keyof typeof channels;

/** Before/after split per scenario, in drawing-buffer pixels. -1 = compare off. */
export const wipes = {
  roof: { value: -1 },
  kitchen: { value: -1 },
  garden: { value: -1 },
};

/** Per-layer dither-fade uniforms. */
export const fades = {
  wingRoof: { value: 1 },
  glassWall: { value: 1 },
  steelGhost: { value: 0 },
};

export interface PatchOpts {
  cut?: "solid" | "ghost";
  wipe?: { side: "before" | "after"; u: { value: number } };
  fade?: { value: number };
}

const HEAD = /* glsl */ `
uniform float uCutY;
uniform float uWipe;
uniform float uFade;
float vbBayer(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return (m[i] + 0.5) / 16.0;
}
`;

/**
 * Adds section-cut, before/after wipe and dither-fade to any built-in material
 * without replacing it. Works for depth materials too, so shadows follow the cut.
 */
export function patch<T extends THREE.Material>(mat: T, opts: PatchOpts): T {
  const key = `vb|${opts.cut ?? "-"}|${opts.wipe?.side ?? "-"}|${opts.fade ? "f" : "-"}`;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uCutY = U.cutY;
    shader.uniforms.uWipe = opts.wipe?.u ?? { value: -1 };
    shader.uniforms.uFade = opts.fade ?? { value: 1 };
    if (opts.cut) {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vVbWorld;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
#ifdef USE_INSTANCING
  vVbWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vVbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
        );
    }
    let body = "";
    if (opts.fade) body += "if (uFade < 0.999 && vbBayer(gl_FragCoord.xy) > uFade) discard;\n";
    if (opts.cut === "solid") body += "if (vVbWorld.y > uCutY) discard;\n";
    if (opts.cut === "ghost") body += "if (vVbWorld.y < uCutY) discard;\n";
    if (opts.wipe?.side === "after") body += "if (gl_FragCoord.x < uWipe) discard;\n";
    if (opts.wipe?.side === "before") body += "if (gl_FragCoord.x >= uWipe) discard;\n";
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEAD}${opts.cut ? "varying vec3 vVbWorld;\n" : ""}`)
      .replace("void main() {", `void main() {\n${body}`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}${key}`;
  return mat;
}

const depthCache = new Map<string, THREE.MeshDepthMaterial>();
/** Depth material for shadow casting that respects the same cut/fade. */
export function depthFor(opts: PatchOpts & { fadeKey?: string }): THREE.MeshDepthMaterial {
  const key = `${opts.cut ?? "-"}|${opts.fadeKey ?? "-"}`;
  let m = depthCache.get(key);
  if (!m) {
    m = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { cut: opts.cut, fade: opts.fade });
    depthCache.set(key, m);
  }
  return m;
}

/** Transparent x-ray shell used for the HVAC cutaway and the steel context outline. */
export function ghostMaterial(color = "#8fa3b8", strength = 1) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: U.ghost,
      uStrength: { value: strength },
      uCutY: U.cutY,
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uStrength;
      uniform float uCutY;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        if (vW.y < uCutY - 0.02) discard;
        vec3 v = normalize(cameraPosition - vW);
        float f = pow(1.0 - abs(dot(normalize(vN), v)), 2.2);
        float a = uOpacity * uStrength * (0.07 + 0.42 * f);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Build-once-on-first-use cache for materials/textures that only some choices need. */
export function lazyCache<T extends { dispose?: () => void }>() {
  const map = new Map<string, T>();
  const get = (key: string, make: () => T): T => {
    let v = map.get(key);
    if (!v) {
      v = make();
      map.set(key, v);
    }
    return v;
  };
  const dispose = () => {
    map.forEach((v) => v.dispose?.());
    map.clear();
  };
  return { get, dispose };
}

/** Fragment tail so custom shaders tone-map correctly with or without post-processing. */
export const OUTPUT_TAIL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
