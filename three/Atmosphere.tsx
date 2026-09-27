"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TIERS } from "@/lib/quality";
import { useDemo } from "@/lib/store";
import { LIGHT, SKY, SKY_ROTATION, SUN_DIR, sunDirection } from "./env";
import { channels, OUTPUT_TAIL } from "./shared";

export { SUN_DIR };

let shadowDirtyFrames = 8;
/** Request the shadow map to re-render (it is otherwise frozen while nothing moves). */
export function markShadowsDirty(frames = 4) {
  shadowDirtyFrames = Math.max(shadowDirtyFrames, frames);
}

/** Where the sun's shadow camera looks — the middle of the property. */
const SHADOW_FOCUS = new THREE.Vector3(-2, 0, -4);

/** Visible sky, IBL and sun all read these, so reflections always match the sky you see. */
export const SKY_UNIFORMS = {
  uSkyA: { value: null as THREE.Texture | null },
  uSkyB: { value: null as THREE.Texture | null },
  uScaleA: { value: SKY.sunset.scale },
  uScaleB: { value: SKY.dusk.scale },
  uMix: { value: 0 },
  uGainA: { value: 1 },
  uGainB: { value: 1 },
  uRot: { value: SKY_ROTATION },
};

/**
 * Brightness of each sky relative to the photographs. Blue hour is far darker than golden
 * hour in reality; keeping it at ~40% lets the (constant) interior lights read as glowing.
 */
function skyGains(dusk: number) {
  // the golden sky gives way quickly once the sun is down
  const a = (1 - dusk) * (1 - dusk);
  // exposed like a twilight photograph: the sky stays a deep blue, interiors carry the frame
  const exposure = dusk < 0.62 ? THREE.MathUtils.lerp(0.95, 0.8, dusk / 0.62) : THREE.MathUtils.lerp(0.8, 1.05, (dusk - 0.62) / 0.38);
  return { a, b: dusk * THREE.MathUtils.lerp(1, 0.24, dusk), exposure };
}

export const SKY_GLSL = /* glsl */ `
uniform sampler2D uSkyA;
uniform sampler2D uSkyB;
uniform float uScaleA;
uniform float uScaleB;
uniform float uMix;
uniform float uGainA;
uniform float uGainB;
uniform float uRot;

vec2 skyUv(vec3 d) {
  float u = (atan(d.z, d.x) - uRot) * 0.15915494 + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5;
  return vec2(fract(u), v);
}

vec3 skyRadiance(vec3 d) {
  vec2 uv = skyUv(d);
  vec3 a = uGainA > 0.0005 ? texture2D(uSkyA, uv).rgb * uScaleA * uGainA : vec3(0.0);
  vec3 b = uGainB > 0.0005 ? texture2D(uSkyB, uv).rgb * uScaleB * uGainB : vec3(0.0);
  return a + b;
}
`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

/**
 * The visible sky: the photographed sky above, three hazed layers of distant landform at the
 * horizon (far range, near hills, treeline), and a sun disk while it is above the horizon.
 * Haze colour is the sky's own horizon colour at that bearing, so land glows toward the sun.
 */
const DOME_FRAG = /* glsl */ `
${SKY_GLSL}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisk;
uniform vec3 uGround;
uniform vec3 uLandDark;
uniform float uLandLit;
varying vec3 vDir;

float h1(float n) { return fract(sin(n) * 43758.5453123); }
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(h1(i), h1(i + 1.0), u);
}
// ridge line: periodic in azimuth so it tiles all the way round
float ridge(float az, float freq, float seed, int oct) {
  float s = 0.0;
  float a = 0.5;
  float f = freq;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    float p = az * f;
    float period = f * 6.2831853;
    // blend the wrap seam
    float w = smoothstep(period - 1.0, period, p);
    float v = mix(noise1(p + seed * 17.0 + float(i) * 31.0), noise1(p - period + seed * 17.0 + float(i) * 31.0), w);
    s += v * a;
    n += a;
    a *= 0.5;
    f *= 2.13;
  }
  return s / n;
}

void main() {
  vec3 d = normalize(vDir);
  float elev = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float az = atan(d.z, d.x) + 3.14159265;
  vec3 horizon = skyRadiance(normalize(vec3(d.x, 0.012, d.z)));
  vec3 col = skyRadiance(d);
  // deepen the zenith after sunset, as a camera exposing for the lit house would see it
  col *= 1.0 - uMix * 0.5 * pow(clamp(d.y, 0.0, 1.0), 0.55);

  // sun disk + tight aureole (the photograph's disk was removed; the light re-adds it)
  float cosSun = dot(d, uSunDir);
  float disk = smoothstep(0.99994, 0.99997, cosSun);
  float aureole = pow(max(cosSun, 0.0), 900.0) * 3.0 + pow(max(cosSun, 0.0), 90.0) * 0.35;
  col += uSunColor * (disk * 60.0 + aureole) * uSunDisk;

  float toSun = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);

  // far range (very hazy), hills, treeline — each nearer layer less hazy and darker
  float far = 0.35 + 3.1 * pow(ridge(az, 2.2, 1.0, 5), 1.6);
  float hills = 0.2 + 1.55 * pow(ridge(az, 4.7, 2.0, 5), 1.3);
  float trees = 0.05 + 0.34 * ridge(az, 23.0, 3.0, 3) + 0.22 * ridge(az, 190.0, 4.0, 2);

  vec3 lit = uLandDark * (1.0 + uLandLit * (1.0 - toSun) * 2.2);
  if (elev < far) col = mix(horizon, mix(lit, horizon, 0.55), 0.62 + 0.25 * toSun);
  if (elev < hills) col = mix(horizon, mix(lit, horizon, 0.3), 0.72 + 0.2 * toSun);
  if (elev < trees) col = mix(horizon, uLandDark * 0.55, 0.78 + 0.12 * toSun);
  if (elev < 0.0) col = uGround;

  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_TAIL}
}
`;

const BLEND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Renders the blended, rotated sky into an equirect target for PMREM (image-based lighting). */
const BLEND_FRAG = /* glsl */ `
${SKY_GLSL}
uniform vec3 uGround;
varying vec2 vUv;
void main() {
  float phi = (vUv.x - 0.5) * 6.2831853;
  float theta = (vUv.y - 0.5) * 3.14159265;
  vec3 d = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));
  vec3 col = skyRadiance(d);
  // below the horizon: the lawn/landscape bounce, not the photograph's dry hilltop
  float g = smoothstep(0.02, -0.12, d.y);
  col = mix(col, uGround, g);
  gl_FragColor = vec4(col, 1.0);
}
`;

function loadSky(url: string) {
  const t = new THREE.TextureLoader().load(url, () => markShadowsDirty(1));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  // magnified everywhere; no mips avoids a seam where longitude wraps
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function Atmosphere() {
  const tier = useDemo((s) => s.tier);
  const T = TIERS[tier];
  const { gl, scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const dome = useRef<THREE.Mesh>(null);

  const skySize = tier === "high" ? 2048 : tier === "medium" ? 2048 : 1024;
  const textures = useMemo(() => ({ a: loadSky(`/assets/env/sky_sunset_${skySize}.webp`), b: loadSky(`/assets/env/sky_dusk_${skySize}.webp`) }), [skySize]);
  useEffect(() => {
    SKY_UNIFORMS.uSkyA.value = textures.a;
    SKY_UNIFORMS.uSkyB.value = textures.b;
    return () => {
      textures.a.dispose();
      textures.b.dispose();
    };
  }, [textures]);

  const ground = useMemo(() => new THREE.Color("#2a2a1f"), []);
  const domeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          ...SKY_UNIFORMS,
          uSunDir: { value: new THREE.Vector3() },
          uSunColor: { value: new THREE.Color() },
          uSunDisk: { value: 1 },
          uGround: { value: new THREE.Color() },
          uLandDark: { value: new THREE.Color("#0f1418") },
          uLandLit: { value: 1 },
        },
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
      }),
    [],
  );

  // image-based lighting: blend pass → PMREM, re-baked only when the time of day moves
  const ibl = useMemo(() => {
    const w = T.envRes * 4;
    const target = new THREE.WebGLRenderTarget(w, w / 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace });
    target.texture.mapping = THREE.EquirectangularReflectionMapping;
    const mat = new THREE.ShaderMaterial({ uniforms: { ...SKY_UNIFORMS, uGround: { value: new THREE.Color() } }, vertexShader: BLEND_VERT, fragmentShader: BLEND_FRAG, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const s = new THREE.Scene();
    s.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pmrem = new THREE.PMREMGenerator(gl);
    return { target, mat, quad, scene: s, cam, pmrem, env: null as THREE.WebGLRenderTarget | null, last: -1, pending: true };
  }, [gl, T.envRes]);
  useEffect(
    () => () => {
      ibl.target.dispose();
      ibl.mat.dispose();
      ibl.quad.geometry.dispose();
      ibl.pmrem.dispose();
      if (ibl.env && scene.environment === ibl.env.texture) scene.environment = null;
      ibl.env?.dispose();
    },
    [ibl, scene],
  );

  const fog = useMemo(() => new THREE.FogExp2(new THREE.Color("#8a8b93"), 0.0042), []);
  useEffect(() => {
    scene.fog = fog;
    scene.background = null;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    markShadowsDirty(10);
  }, [gl, tier]);

  const tmp = useMemo(() => ({ c: new THREE.Color(), c2: new THREE.Color(), v: new THREE.Vector3() }), []);
  const horizonA = useMemo(() => new THREE.Color().fromArray(SKY.sunset.horizon), []);
  const horizonB = useMemo(() => new THREE.Color().fromArray(SKY.dusk.horizon), []);

  useFrame(() => {
    const d = channels.dusk;
    const g = skyGains(d);
    SKY_UNIFORMS.uMix.value = d;
    SKY_UNIFORMS.uGainA.value = g.a;
    SKY_UNIFORMS.uGainB.value = g.b;
    gl.toneMappingExposure = g.exposure * ((window as unknown as { __exposure?: number }).__exposure ?? 1);

    // the sun sinks as the evening comes on and is gone by blue hour
    const elev = THREE.MathUtils.lerp(9.5, -2, THREE.MathUtils.smoothstep(d, 0, 0.8));
    const dir = sunDirection(elev, tmp.v);
    const up = THREE.MathUtils.smoothstep(elev, -1.5, 3);
    const s = sun.current;
    if (s) {
      s.color.copy(LIGHT.sunColor).lerp(LIGHT.duskSunColor, THREE.MathUtils.smoothstep(d, 0, 0.6));
      s.intensity = LIGHT.sunIrradiance * up * (1 - d * 0.5);
      s.position.copy(SHADOW_FOCUS).addScaledVector(dir, 90);
      s.visible = s.intensity > 0.001;
    }
    const u = domeMat.uniforms;
    u.uSunDir.value.copy(sunDirection(Math.min(elev, 6), tmp.v));
    u.uSunColor.value.copy(LIGHT.sunColor).multiplyScalar(g.a * 3.0);
    u.uSunDisk.value = up;
    u.uLandLit.value = (1 - d) * 0.9;
    // ground bounce / below-horizon colour: the landscape under this light
    const bounce = tmp.c.copy(horizonA).multiplyScalar(g.a * 0.05).add(tmp.c2.copy(horizonB).multiplyScalar(g.b * 0.045));
    bounce.multiply(ground.clone().multiplyScalar(6));
    u.uGround.value.copy(bounce);
    ibl.mat.uniforms.uGround.value.copy(bounce);
    // fog = horizon haze averaged round the compass
    fog.color.copy(horizonA).multiplyScalar(g.a * 0.55).add(tmp.c2.copy(horizonB).multiplyScalar(g.b * 0.5));
    if (dome.current) dome.current.position.copy(camera.position);

    // re-bake the environment when the light has changed enough to see
    const step = tier === "low" ? 0.06 : 0.02;
    const ready = SKY_UNIFORMS.uSkyA.value?.image && SKY_UNIFORMS.uSkyB.value?.image;
    if (ready && (ibl.pending || Math.abs(d - ibl.last) > step || (d !== ibl.last && (d === 0 || d === 1)))) {
      ibl.pending = false;
      ibl.last = d;
      const prevTarget = gl.getRenderTarget();
      gl.setRenderTarget(ibl.target);
      gl.render(ibl.scene, ibl.cam);
      gl.setRenderTarget(prevTarget);
      ibl.env = ibl.pmrem.fromEquirectangular(ibl.target.texture, ibl.env);
      scene.environment = ibl.env.texture;
      markShadowsDirty(1);
    }

    if (shadowDirtyFrames > 0) {
      gl.shadowMap.needsUpdate = true;
      shadowDirtyFrames--;
    }
  });

  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(SHADOW_FOCUS);
    return o;
  }, []);

  return (
    <>
      <mesh ref={dome} material={domeMat} frustumCulled={false} renderOrder={-10} scale={900}>
        <sphereGeometry args={[1, 48, 24]} />
      </mesh>
      <primitive object={target} />
      <directionalLight
        ref={sun}
        target={target}
        castShadow={T.shadows}
        shadow-mapSize={[T.shadowMap, T.shadowMap]}
        shadow-bias={-0.0004}
        shadow-radius={tier === "high" ? 3.5 : 2.5}
        shadow-normalBias={0.04}
        shadow-camera-near={20}
        shadow-camera-far={170}
        shadow-camera-left={-27}
        shadow-camera-right={27}
        shadow-camera-top={20}
        shadow-camera-bottom={-16}
      />
    </>
  );
}
