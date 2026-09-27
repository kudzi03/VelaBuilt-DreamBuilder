"use client";

import { PerformanceMonitor, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { track } from "@/lib/analytics";
import { TIERS } from "@/lib/quality";
import { useDemo, type Tier } from "@/lib/store";
import { Atmosphere } from "./Atmosphere";
import { CameraRig } from "./CameraRig";
import { Director, LampSync } from "./Director";
// Post-processing is a separate chunk: low-tier devices never download it.
const Effects = lazy(() => import("./Effects").then((m) => ({ default: m.Effects })));
import { House } from "./House";
import { setAnisotropy, setTextureBudget } from "./materials";
import { setMaxAnisotropy, setTextureScale } from "./proc";
import { Scenarios } from "./Scenarios";
import { Landscape } from "./Landscape";

const DOWN: Record<Tier, Tier> = { high: "medium", medium: "low", low: "low" };

/** Filmic curve for the no-post path; the post path uses the matching ToneMapping effect. */
const TONE = THREE.AgXToneMapping;

/** Marks the scene ready after a few real frames, then reports load time once. */
function Ready() {
  const frames = useRef(0);
  const done = useRef(false);
  const { gl } = useThree();
  useFrame(() => {
    // QA harness: count rendered frames (debug only)
    const w = window as unknown as { __frames?: number };
    if (w.__frames !== undefined) w.__frames++;
    if (done.current) return;
    frames.current++;
    if (frames.current < 4) return;
    done.current = true;
    const s = useDemo.getState();
    s.set({ sceneReady: true });
    if (s.phase === "loading") s.setPhase("intro");
    // performance.now() is measured from navigation start: this is time-to-first-3D-frame.
    track("demo_loaded", { tier: s.tier, ms: Math.round(performance.now()), dpr: Number(gl.getPixelRatio().toFixed(2)) });
  });
  return null;
}

/** Reports asset loading to the page's loader (the loader lives outside the 3D chunk). */
function LoadProgress() {
  useEffect(() => {
    // loaders start while components render: forward outside React's render, monotonic
    let best = 0;
    let raf = 0;
    const unsub = useProgress.subscribe((s) => {
      best = Math.max(best, s.total ? (s.loaded / s.total) * 100 : 0);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => useDemo.getState().set({ loadProgress: best }));
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, []);
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
  setTextureScale(T.textureSize === 512 ? 0.5 : 1);
  setTextureBudget(T.textureSize);

  return (
    <Canvas
      className="stage"
      shadows={T.shadows ? "soft" : false}
      dpr={T.dpr}
      gl={{ antialias: !T.post, powerPreference: "high-performance", stencil: false, alpha: false }}
      camera={{ fov: 36, near: 0.3, far: 2000, position: [22, 2, 26] }}
      onCreated={({ gl, scene, get }) => {
        gl.toneMapping = TONE;
        gl.toneMappingExposure = 1;
        scene.background = new THREE.Color("#1d2230");
        setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
        setAnisotropy(gl.capabilities.getMaxAnisotropy());
        if (location.search.includes("debug")) Object.assign(window as unknown as Record<string, unknown>, { __vb: { gl, scene, THREE, get }, __frames: 0 });
      }}
      aria-hidden
    >
      <Adaptive />
      <ContextGuard />
      <LoadProgress />
      <Director />
      <Atmosphere />
      <Suspense fallback={null}>
        <Landscape />
        <House />
        <Scenarios />
      </Suspense>
      <CameraRig />
      <LampSync />
      {T.post && (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      )}
      <Ready />
    </Canvas>
  );
}
