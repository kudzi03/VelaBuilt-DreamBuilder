"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TIERS } from "@/lib/quality";
import { useDemo } from "@/lib/store";
import { channels } from "./shared";

/** Direction from the scene toward the sun: low, from the garden side, warm. */
export const SUN_DIR = new THREE.Vector3(-0.83, 0.41, 0.39).normalize();
const SUN_TARGET = new THREE.Vector3(-1.5, 0, -4);

const DAY = {
  top: new THREE.Color("#8da9c4"),
  horizon: new THREE.Color("#f1d6b8"),
  sun: new THREE.Color("#ffe4c8"),
  sunI: 4.2,
  hemiSky: new THREE.Color("#aec4dc"),
  hemiGround: new THREE.Color("#a3876a"),
  hemiI: 0.42,
  env: 0.5,
};
const DUSK = {
  top: new THREE.Color("#18203a"),
  horizon: new THREE.Color("#a8674f"),
  sun: new THREE.Color("#ff8f5a"),
  sunI: 0.12,
  hemiSky: new THREE.Color("#3b4a70"),
  hemiGround: new THREE.Color("#241f1c"),
  hemiI: 0.42,
  env: 0.2,
};

let shadowDirtyFrames = 8;
/** Request the shadow map to re-render (it is otherwise frozen while nothing moves). */
export function markShadowsDirty(frames = 4) {
  shadowDirtyFrames = Math.max(shadowDirtyFrames, frames);
}

export function Atmosphere() {
  const tier = useDemo((s) => s.tier);
  const T = TIERS[tier];
  const { gl, scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const dome = useRef<THREE.Mesh>(null);

  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: DAY.top.clone() },
          uHorizon: { value: DAY.horizon.clone() },
          uSun: { value: SUN_DIR.clone() },
          uSunColor: { value: DAY.sun.clone() },
          uGlow: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uSun;
          uniform vec3 uSunColor;
          uniform float uGlow;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.38));
            float s = max(dot(d, uSun), 0.0);
            col += uSunColor * (pow(s, 5.0) * 0.18 + pow(s, 48.0) * 0.45) * uGlow;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  const fog = useMemo(() => new THREE.Fog(DAY.horizon.clone(), 60, 220), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    markShadowsDirty(10);
  }, [gl, tier]);

  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const d = channels.dusk;
    const s = sun.current;
    if (s) {
      s.color.copy(DAY.sun).lerp(DUSK.sun, d);
      s.intensity = THREE.MathUtils.lerp(DAY.sunI, DUSK.sunI, Math.pow(d, 0.7));
    }
    if (hemi.current) {
      hemi.current.color.copy(DAY.hemiSky).lerp(DUSK.hemiSky, d);
      hemi.current.groundColor.copy(DAY.hemiGround).lerp(DUSK.hemiGround, d);
      hemi.current.intensity = THREE.MathUtils.lerp(DAY.hemiI, DUSK.hemiI, d);
    }
    scene.environmentIntensity = THREE.MathUtils.lerp(DAY.env, DUSK.env, d);
    const u = skyMat.uniforms;
    u.uTop.value.copy(DAY.top).lerp(DUSK.top, d);
    u.uHorizon.value.copy(DAY.horizon).lerp(DUSK.horizon, d);
    u.uSunColor.value.copy(DAY.sun).lerp(DUSK.sun, d);
    u.uGlow.value = 1 - d * 0.55;
    fog.color.copy(tmp.copy(DAY.horizon).lerp(DUSK.horizon, d));
    // fog starts beyond the subject whatever the framing distance
    const dist = camera.position.length();
    fog.near = Math.max(40, dist * 0.9 + 12);
    fog.far = fog.near + 170;
    if (dome.current) dome.current.position.copy(camera.position);

    if (shadowDirtyFrames > 0) {
      gl.shadowMap.needsUpdate = true;
      shadowDirtyFrames--;
    }
  });

  // Image-based lighting from a hand-built light studio (no HDR download, no loaders in the bundle).
  useEffect(() => {
    const env = new THREE.Scene();
    const disposables: Array<{ dispose: () => void }> = [];
    const add = (geo: THREE.BufferGeometry, color: string, intensity: number, pos: [number, number, number], scale: [number, number, number], look = true, side: THREE.Side = THREE.DoubleSide) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.scale.set(...scale);
      if (look) m.lookAt(0, 0, 0);
      env.add(m);
      disposables.push(geo, mat);
    };
    add(new THREE.SphereGeometry(1, 32, 16), "#cfd7dc", 1, [0, 0, 0], [100, 100, 100], false, THREE.BackSide);
    add(new THREE.PlaneGeometry(1, 1), "#e9eef2", 1.4, [0, 30, 0], [80, 80, 1]);
    add(new THREE.PlaneGeometry(1, 1), "#f2e2c9", 0.9, [0, 4, 60], [160, 12, 1]);
    add(new THREE.PlaneGeometry(1, 1), "#e7d9c3", 0.6, [0, 4, -60], [160, 12, 1]);
    add(new THREE.PlaneGeometry(1, 1), "#b9a687", 0.55, [0, -20, 0], [80, 80, 1]);
    add(new THREE.CircleGeometry(1, 32), "#ffe2c2", 9, SUN_DIR.clone().multiplyScalar(45).toArray() as [number, number, number], [7, 7, 7]);
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(env, 0.02, 0.1, 200, { size: T.envRes });
    scene.environment = rt.texture;
    pmrem.dispose();
    disposables.forEach((d) => d.dispose());
    return () => {
      if (scene.environment === rt.texture) scene.environment = null;
      rt.dispose();
    };
  }, [gl, scene, T.envRes]);

  const sunPos = useMemo(() => SUN_TARGET.clone().addScaledVector(SUN_DIR, 50), []);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(SUN_TARGET);
    return o;
  }, []);

  return (
    <>
      <mesh ref={dome} material={skyMat} frustumCulled={false} renderOrder={-10} scale={400}>
        <sphereGeometry args={[1, 32, 16]} />
      </mesh>
      <primitive object={target} />
      <directionalLight
        ref={sun}
        position={sunPos}
        target={target}
        castShadow={T.shadows}
        shadow-mapSize={[T.shadowMap, T.shadowMap]}
        shadow-bias={-0.00025}
        shadow-radius={3}
        shadow-normalBias={0.035}
        shadow-camera-near={5}
        shadow-camera-far={100}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />
      <hemisphereLight ref={hemi} args={[DAY.hemiSky, DAY.hemiGround, DAY.hemiI]} />
    </>
  );
}
