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

// Blue-hour grade for the after-sunset photograph (a hazy lavender evening): richer colour,
// and the upper sky drawn toward the deep blue a twilight exposure records.
vec3 blueHour(vec3 c, float up) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 s = max(mix(vec3(l), c, 1.4), 0.0);
  // a warm band on the horizon under a deep blue sky: the twilight gradient of the references
  return s * mix(vec3(1.12, 0.93, 0.84), vec3(0.46, 0.7, 1.46), smoothstep(0.0, 0.42, up));
}

vec3 skyRadiance(vec3 d) {
  vec2 uv = skyUv(d);
  vec3 a = uGainA > 0.0005 ? texture2D(uSkyA, uv).rgb * uScaleA * uGainA : vec3(0.0);
  vec3 b = uGainB > 0.0005 ? blueHour(texture2D(uSkyB, uv).rgb * uScaleB * uGainB, d.y) : vec3(0.0);
  return a + b;
}
`;

/** CPU twin of the GLSL grade at the horizon (fog colour). */
function blueHourHorizon(c: THREE.Color) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const k = 1.4;
  c.setRGB(Math.max(0, l + (c.r - l) * k), Math.max(0, l + (c.g - l) * k), Math.max(0, l + (c.b - l) * k));
  // the GLSL grade at ~8° elevation, where the horizon bins are read
  return c.multiply(new THREE.Color().setRGB(0.98, 0.89, 0.97));
}

/**
 * Horizon colour of a sky photograph by bearing (64 bins, linear radiance / scale), read once
 * from the loaded image, so the fog in any view direction is the sky behind it.
 */
function horizonBins(img: CanvasImageSource & { width: number; height: number }) {
  const W = 256;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, W, H);
  // rows from ~4.5° to ~11° above the horizon: clear of the hills in the photograph
  const y0 = Math.floor(H / 2 - (11 / 180) * H);
  const y1 = Math.floor(H / 2 - (4.5 / 180) * H);
  const data = g.getImageData(0, y0, W, y1 - y0 + 1).data;
  const bins = new Float32Array(64 * 3);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const rows = y1 - y0 + 1;
  for (let x = 0; x < W; x++) {
    const bin = Math.floor((x / W) * 64);
    for (let r = 0; r < rows; r++) {
      const i = (r * W + x) * 4;
      bins[bin * 3] += lin(data[i]);
      bins[bin * 3 + 1] += lin(data[i + 1]);
      bins[bin * 3 + 2] += lin(data[i + 2]);
    }
  }
  const n = (W / 64) * rows;
  for (let i = 0; i < bins.length; i++) bins[i] /= n;
  return bins;
}

/** Average horizon colour over ±35° around a bearing (world azimuth, radians). */
function horizonAt(bins: Float32Array | null, azimuth: number, scale: number, out: THREE.Color) {
  out.setRGB(0, 0, 0);
  if (!bins) return out;
  let wsum = 0;
  for (let k = -6; k <= 6; k++) {
    const az = azimuth + (k / 6) * 0.61;
    const u = (((az - SKY_ROTATION) / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
    const b = Math.floor(u * 64) % 64;
    const w = 1 - Math.abs(k) / 7;
    out.r += bins[b * 3] * w;
    out.g += bins[b * 3 + 1] * w;
    out.b += bins[b * 3 + 2] * w;
    wsum += w;
  }
  return out.multiplyScalar(scale / wsum);
}

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
uniform vec3 uFog;
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
  // the photographs have their own hills on the horizon (flat-topped mesas): below ~4.5° the
  // sky is taken from just above them, so only our own hazed land layers sit on the horizon
  vec3 above = skyRadiance(normalize(vec3(d.x, 0.08, d.z)));
  vec3 horizon = above;
  vec3 col = mix(above, skyRadiance(d), smoothstep(3.2, 4.8, elev));
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

  // land is the horizon's own colour, darkened and cooled by distance (aerial perspective):
  // silhouettes stay readable without ever going black between the nearer trees
  vec3 lit = uLandDark * (1.0 + uLandLit * (1.0 - toSun) * 2.2);
  vec3 land = horizon * vec3(0.3, 0.34, 0.4) + lit * 0.4;
  if (elev < far) col = mix(land, horizon, 0.78 - 0.1 * toSun);
  if (elev < hills) col = mix(land, horizon, 0.6 - 0.12 * toSun);
  if (elev < trees) col = mix(land, horizon, 0.4 - 0.1 * toSun);
  // below the horizon the dome continues the ground plane, which is fully fogged at its edge
  if (elev < 0.0) col = mix(uFog, uGround, smoothstep(-2.0, -12.0, elev));

  // a town in the distance past the house (north-east): after sunset its lights come on across
  // the far hills and a few towers stand in the haze. Only in that sector, only at dusk.
  float town = smoothstep(3.22, 3.4, az) * (1.0 - smoothstep(4.45, 4.62, az)) * smoothstep(0.35, 0.8, uMix);
  if (town > 0.0) {
    // towers: flat-topped blocks with a scatter of lit windows
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float c = 3.55 + h1(fi * 7.1 + 3.0) * 0.72;
      float w = 0.0045 + h1(fi * 3.7 + 1.0) * 0.007;
      float top = 0.9 + pow(h1(fi * 5.3 + 2.0), 2.0) * 2.4;
      if (abs(az - c) < w && elev < top && elev > -0.3) {
        vec3 block = mix(land, horizon, 0.55) * 0.85;
        vec2 cell = vec2((az - c) * 1400.0, elev * 9.0);
        float lit = step(0.62, h1(floor(cell.x) * 13.1 + floor(cell.y) * 71.7 + fi * 5.0));
        float pane = step(0.25, fract(cell.x)) * step(0.3, fract(cell.y));
        block += vec3(1.0, 0.78, 0.5) * lit * pane * 0.9 * town;
        col = mix(col, block, town);
      }
    }
    // lights scattered over the hills: warm streets, a few cool ones
    if (elev < hills + 0.15 && elev > -0.5) {
      vec2 g = vec2(az * 760.0, elev * 13.0);
      vec2 cell = floor(g);
      float r = h1(cell.x * 12.9898 + cell.y * 78.233);
      float cluster = smoothstep(0.35, 0.75, noise1(az * 60.0) * 0.6 + noise1(az * 11.0 + 4.0) * 0.4);
      vec2 f = fract(g) - 0.5 - (vec2(h1(r * 91.0), h1(r * 57.0)) - 0.5) * 0.5;
      float dotv = smoothstep(0.26, 0.05, length(f * vec2(1.0, 0.55)));
      float on = step(1.0 - 0.45 * cluster, r);
      vec3 lc = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, h1(r * 33.0)));
      col += lc * dotv * on * (0.6 + 0.8 * h1(r * 7.0)) * town * 0.9;
    }
  }

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

const HORIZON: { a: Float32Array | null; b: Float32Array | null } = { a: null, b: null };

function loadSky(url: string, key?: "a" | "b") {
  const t = new THREE.TextureLoader().load(url, (tex) => {
    markShadowsDirty(1);
    if (key) HORIZON[key] = horizonBins(tex.image as HTMLImageElement);
  });
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
  const textures = useMemo(() => ({ a: loadSky(`/assets/env/sky_sunset_${skySize}.webp`, "a"), b: loadSky(`/assets/env/sky_dusk_${skySize}.webp`, "b") }), [skySize]);
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
          uFog: { value: new THREE.Color() },
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
    // fog = the sky just above the horizon in the direction we are looking (distant trees and
    // hills dissolve into the sky behind them); the compass average until the images are read
    camera.getWorldDirection(tmp.v);
    const az = Math.atan2(tmp.v.z, tmp.v.x);
    if (HORIZON.a && HORIZON.b) {
      horizonAt(HORIZON.a, az, SKY.sunset.scale * g.a, fog.color);
      fog.color.add(blueHourHorizon(horizonAt(HORIZON.b, az, SKY.dusk.scale * g.b, tmp.c2)));
      fog.color.multiplyScalar(0.92);
    } else {
      fog.color.copy(horizonA).multiplyScalar(g.a * 0.55).add(tmp.c2.copy(horizonB).multiplyScalar(g.b * 0.5));
    }
    u.uFog.value.copy(fog.color);
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
