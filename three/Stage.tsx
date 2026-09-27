"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { track } from "@/lib/analytics";
import { TIERS } from "@/lib/quality";
import { useDemo, type Tier } from "@/lib/store";
import { Atmosphere } from "./Atmosphere";
import { CameraRig } from "./CameraRig";
import { Director } from "./Director";
// Post-processing is a separate chunk: low-tier devices never download it.
const Effects = lazy(() => import("./Effects").then((m) => ({ default: m.Effects })));
import { House } from "./House";
import { setMaxAnisotropy, setTextureScale } from "./proc";
import { Scenarios } from "./Scenarios";
import { Site } from "./Site";

const DOWN: Record<Tier, Tier> = { high: "medium", medium: "low", low: "low" };

/** Marks the scene ready after a few real frames, then reports load time once. */
function Ready({ t0 }: { t0: number }) {
  const frames = useRef(0);
  const done = useRef(false);
  const { gl } = useThree();
  useFrame(() => {
    if (done.current) return;
    frames.current++;
    if (frames.current < 4) return;
    done.current = true;
    const s = useDemo.getState();
    s.set({ sceneReady: true });
    if (s.phase === "loading") s.setPhase("intro");
    track("demo_loaded", { tier: s.tier, ms: Math.round(performance.now() - t0), dpr: Number(gl.getPixelRatio().toFixed(2)) });
  });
  return null;
}

function ContextGuard() {
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      useDemo.getState().set({ webgl: false });
    };
    el.addEventListener("webglcontextlost", lost);
    return () => el.removeEventListener("webglcontextlost", lost);
  }, [gl]);
  return null;
}

function Adaptive() {
  const last = useRef(0);
  const { setDpr } = useThree();
  const tier = useDemo((s) => s.tier);
  const dprIdx = useRef(0);
  const decline = () => {
    const now = performance.now();
    if (now - last.current < 3500) return;
    last.current = now;
    const s = useDemo.getState();
    const T = TIERS[s.tier];
    // 1) shed resolution, 2) shed AO, 3) drop a tier
    if (dprIdx.current === 0 && T.dpr[1] > 1.25) {
      dprIdx.current = 1;
      setDpr(Math.max(1, T.dpr[1] - 0.5));
      return;
    }
    if (T.ao && !s.aoOff) {
      s.set({ aoOff: true });
      return;
    }
    if (s.tier !== "low") {
      dprIdx.current = 0;
      s.set({ tier: DOWN[s.tier] });
    }
  };
  useEffect(() => {
    dprIdx.current = 0;
  }, [tier]);
  return <PerformanceMonitor ms={400} iterations={6} threshold={0.7} bounds={() => [40, 58]} onDecline={decline} flipflops={4} onFallback={() => useDemo.getState().set({ tier: "low" })} />;
}

export default function Stage() {
  const tier = useDemo((s) => s.tier);
  const T = TIERS[tier];
  const t0 = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  setTextureScale(T.textureSize === 512 ? 0.5 : 1);

  return (
    <Canvas
      className="stage"
      shadows={T.shadows ? "soft" : false}
      dpr={T.dpr}
      gl={{ antialias: !T.post, powerPreference: "high-performance", stencil: false, alpha: false }}
      camera={{ fov: 36, near: 0.4, far: 1400, position: [22, 2, 26] }}
      onCreated={({ gl, scene, get }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1;
        scene.background = new THREE.Color("#efdcc4");
        setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
        if (location.search.includes("debug")) (window as unknown as { __vb: unknown }).__vb = { gl, scene, THREE, get };
      }}
      aria-hidden
    >
      <Adaptive />
      <ContextGuard />
      <Director />
      <Atmosphere />
      <Suspense fallback={null}>
        <Site />
        <House />
        <Scenarios />
      </Suspense>
      <CameraRig />
      {T.post && (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      )}
      <Ready t0={t0.current} />
    </Canvas>
  );
}
