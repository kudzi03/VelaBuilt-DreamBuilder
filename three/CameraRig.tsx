"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import CameraControlsImpl from "camera-controls";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { IndustryId } from "@/lib/industries";
import { useDemo, type Insets } from "@/lib/store";

type V3 = [number, number, number];
export interface Shot {
  target: V3;
  azimuth: number;
  polar: number;
  /** radius of the subject that must stay in frame */
  radius: number;
  orbit?: number;
}

export const SHOTS: Record<IndustryId | "hero" | "flow" | "reveal", Shot> = {
  hero: { target: [0.6, 3.2, -4.2], azimuth: 0.66, polar: 1.3, radius: 10.9, orbit: 0.9 },
  roofing: { target: [0.2, 6.3, -2.8], azimuth: 0.4, polar: 1.02, radius: 10.2 },
  solar: { target: [0.4, 6.3, 1.4], azimuth: 0.36, polar: 1.0, radius: 8.4 },
  remodeling: { target: [2.7, 1.05, -10.2], azimuth: -1.4, polar: 0.84, radius: 5.4 },
  landscaping: { target: [-6.6, 0.3, -9.8], azimuth: -1.72, polar: 0.8, radius: 9.2 },
  hvac: { target: [0.4, 3.7, -4.3], azimuth: 0.74, polar: 1.1, radius: 11.4 },
  steel: { target: [0.6, 4.3, -4.6], azimuth: -0.4, polar: 1.0, radius: 11.2 },
  flow: { target: [0.3, 3.4, -4.6], azimuth: 0.95, polar: 1.18, radius: 13.5, orbit: 1.2 },
  reveal: { target: [-0.8, 3.0, -4.8], azimuth: 0.52, polar: 1.3, radius: 13.2, orbit: 1.2 },
};

export function fovFor(w: number, h: number) {
  return w / h < 0.8 ? 44 : 36;
}

/** Distance + focal offset that keep a sphere of `radius` centred in the unobstructed area. */
export function frame(shot: Shot, w: number, h: number, insets: Insets, fov: number) {
  const availW = Math.max(120, w - insets.left - insets.right);
  const availH = Math.max(120, h - insets.top - insets.bottom);
  const t = Math.tan((fov * Math.PI) / 360);
  const aspect = w / h;
  const fx = availW / w;
  const fy = availH / h;
  const dist = Math.max(shot.radius / (t * fy), shot.radius / (t * aspect * fx)) * 1.02;
  const cx = ((insets.left + availW / 2) / w) * 2 - 1;
  const cy = 1 - ((insets.top + availH / 2) / h) * 2;
  // camera-controls applies focalOffset.y inverted (camera moves down for +y), so y keeps the sign of cy
  return { dist, offX: -cx * dist * t * aspect, offY: cy * dist * t };
}

function spherical(shot: Shot, az: number, polar: number, dist: number): V3 {
  const [tx, ty, tz] = shot.target;
  return [tx + dist * Math.sin(polar) * Math.sin(az), ty + dist * Math.cos(polar), tz + dist * Math.sin(polar) * Math.cos(az)];
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export let resetView: () => void = () => {};

/** QA: `?cam=x,y,z&look=x,y,z&fov=n` pins the camera (composition work, screenshots). */
const DEBUG_CAM = (() => {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const cam = q.get("cam")?.split(",").map(Number);
  const look = q.get("look")?.split(",").map(Number);
  if (!cam || !look || cam.length !== 3 || look.length !== 3) return null;
  return { cam: cam as V3, look: look as V3, fov: Number(q.get("fov")) || 0 };
})();

export function CameraRig() {
  const cc = useRef<CameraControlsImpl>(null);
  const { size, camera } = useThree();
  const phase = useDemo((s) => s.phase);
  const industry = useDemo((s) => s.industry);
  const insets = useDemo((s) => s.insets);
  const reducedMotion = useDemo((s) => s.reducedMotion);
  const arrival = useRef({ active: true, t: 0 });
  const interacting = useRef(false);
  const lastShotKey = useRef("");

  const shotKey: keyof typeof SHOTS =
    phase === "reveal" ? "reveal" : phase === "flow" ? (industry ?? "flow") : phase === "explore" || phase === "qualify" ? (industry ?? "hero") : "hero";

  const apply = useCallback(
    (transition: boolean) => {
      const c = cc.current;
      if (!c) return;
      if (DEBUG_CAM) {
        const cam = camera as THREE.PerspectiveCamera;
        if (DEBUG_CAM.fov) {
          cam.fov = DEBUG_CAM.fov;
          cam.updateProjectionMatrix();
        }
        c.minDistance = 0;
        c.maxDistance = Infinity;
        c.minPolarAngle = 0;
        c.maxPolarAngle = Math.PI;
        c.minAzimuthAngle = -Infinity;
        c.maxAzimuthAngle = Infinity;
        c.setLookAt(...DEBUG_CAM.cam, ...DEBUG_CAM.look, false);
        c.setFocalOffset(0, 0, 0, false);
        return;
      }
      const shot = SHOTS[shotKey];
      const cam = camera as THREE.PerspectiveCamera;
      const fov = fovFor(size.width, size.height);
      if (cam.fov !== fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      const f = frame(shot, size.width, size.height, insets, fov);
      // pick the azimuth equivalent closest to where we are, so moves take the short way round
      const cur = c.azimuthAngle;
      const az = shot.azimuth + Math.round((cur - shot.azimuth) / (Math.PI * 2)) * Math.PI * 2;
      const range = shot.orbit ?? 0.7;
      c.minAzimuthAngle = az - range;
      c.maxAzimuthAngle = az + range;
      c.minPolarAngle = Math.max(0.35, shot.polar - 0.45);
      c.maxPolarAngle = Math.min(1.48, shot.polar + 0.22);
      c.minDistance = f.dist * 0.62;
      c.maxDistance = f.dist * 1.45;
      c.smoothTime = reducedMotion ? 0.08 : 0.85;
      const p = spherical(shot, az, shot.polar, f.dist);
      c.setLookAt(p[0], p[1], p[2], ...shot.target, transition && !reducedMotion);
      c.setFocalOffset(f.offX, f.offY, 0, transition && !reducedMotion);
    },
    [shotKey, size.width, size.height, insets, reducedMotion, camera],
  );

  useEffect(() => {
    resetView = () => apply(true);
  }, [apply]);

  // QA: pin the camera from the console / screenshot harness (debug builds only)
  useEffect(() => {
    if (!location.search.includes("debug")) return;
    (window as unknown as { __setCam: unknown }).__setCam = (p: V3, t: V3, fov?: number) => {
      const c = cc.current;
      if (!c) return;
      arrival.current.active = false;
      const cam = camera as THREE.PerspectiveCamera;
      if (fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      c.minDistance = 0;
      c.maxDistance = Infinity;
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.setFocalOffset(0, 0, 0, false);
      c.setLookAt(...p, ...t, false);
    };
  }, [camera]);

  // shot changes (industry / phase / layout)
  useEffect(() => {
    if (arrival.current.active && shotKey === "hero") return;
    arrival.current.active = false;
    const key = `${shotKey}`;
    const changedShot = key !== lastShotKey.current;
    lastShotKey.current = key;
    apply(changedShot || true);
  }, [shotKey, apply]);

  // controls feel
  useEffect(() => {
    const c = cc.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.ROTATE;
    c.mouseButtons.right = A.NONE;
    c.mouseButtons.middle = A.DOLLY;
    c.mouseButtons.wheel = A.DOLLY;
    c.touches.one = A.TOUCH_ROTATE;
    c.touches.two = A.TOUCH_DOLLY;
    c.touches.three = A.NONE;
    c.draggingSmoothTime = 0.14;
    c.azimuthRotateSpeed = 0.55;
    c.polarRotateSpeed = 0.45;
    c.dollySpeed = 0.5;
    c.dollyToCursor = false;
    const start = () => {
      interacting.current = true;
      arrival.current.active = false;
    };
    const end = () => {
      interacting.current = false;
    };
    c.addEventListener("controlstart", start);
    c.addEventListener("controlend", end);
    return () => {
      c.removeEventListener("controlstart", start);
      c.removeEventListener("controlend", end);
    };
  }, []);

  useFrame((_, delta) => {
    const c = cc.current;
    if (!c) return;
    const dt = Math.min(delta, 1 / 20);
    const a = arrival.current;
    if (DEBUG_CAM && a.active) {
      a.active = false;
      apply(false);
      return;
    }
    if (a.active) {
      const shot = SHOTS.hero;
      const fov = fovFor(size.width, size.height);
      const f = frame(shot, size.width, size.height, insets, fov);
      if (reducedMotion) {
        a.active = false;
        apply(false);
        return;
      }
      const sceneReady = useDemo.getState().sceneReady;
      if (sceneReady) a.t = Math.min(1, a.t + dt / 6.5);
      const k = ease(a.t);
      // arriving up the front path: low at the door, then rise and pull back to the hero
      const az = THREE.MathUtils.lerp(0.12, shot.azimuth, k);
      const pol = THREE.MathUtils.lerp(1.44, shot.polar, k);
      const dist = THREE.MathUtils.lerp(f.dist * 0.5, f.dist, k);
      const ty = THREE.MathUtils.lerp(2.4, shot.target[1], k);
      const tgt: V3 = [THREE.MathUtils.lerp(0, shot.target[0], k), ty, THREE.MathUtils.lerp(1.5, shot.target[2], k)];
      const p = spherical({ ...shot, target: tgt }, az, pol, dist);
      c.setLookAt(p[0], p[1], p[2], tgt[0], tgt[1], tgt[2], false);
      // offset scales with distance so the house stays clear of the headline for the whole move
      const g = dist / f.dist;
      c.setFocalOffset(f.offX * g, f.offY * g, 0, false);
      if (a.t >= 1) {
        a.active = false;
        apply(false);
      }
      return;
    }
    // slow turntable drift on the establishing shots
    const ph = useDemo.getState().phase;
    if (!DEBUG_CAM && !reducedMotion && !interacting.current && (ph === "intro" || ph === "reveal")) c.rotate(dt * 0.018, 0, true);
  });

  return <CameraControls ref={cc} makeDefault />;
}
