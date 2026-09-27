"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import CameraControlsImpl from "camera-controls";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { IndustryId } from "@/lib/industries";
import { useDemo, type Insets } from "@/lib/store";

type V3 = [number, number, number];

/**
 * A shot is a photograph: where the camera stands, what it looks at, the lens. Ground-level
 * shots keep the camera level (verticals stay vertical) and frame the subject with lens shift —
 * an off-axis projection, like a shift lens — which is also how the subject is moved clear of
 * the UI. The camera itself never moves to make room for a panel.
 */
export interface Shot {
  pos: V3;
  /** the subject: lands in the middle of the area the UI leaves free */
  target: V3;
  /** keep the camera level and use rise/fall instead of tilting (architectural views) */
  level?: boolean;
  /** vertical field of view on a landscape screen, degrees */
  fov: number;
  /** subject size (metres, at the target) that must stay in frame on any screen */
  fit: [number, number];
  /** how far the subject may reach under side/bottom UI (0 = never, 1 = ignore it) — hero copy sits over sky */
  overlap?: number;
  /** how far the visitor may swing round (radians) */
  orbit?: number;
  /** polar range around the shot [down, up] (radians) */
  tilt?: [number, number];
  /** dolly range as factors of the shot distance */
  zoom?: [number, number];
  /** portrait phones: an alternative stand-point (same target) */
  portrait?: { pos: V3; fov?: number; target?: V3 };
}

export const SHOTS: Record<IndustryId | "hero" | "flow" | "reveal", Shot> = {
  // twilight, across the pool to the pavilion and the house
  hero: { pos: [-15.2, 1.25, -16.8], target: [-2.9, 3.4, -4.9], level: true, fov: 42, fit: [17, 9], overlap: 0.5, orbit: 0.35, tilt: [0.12, 0.08], zoom: [0.8, 1.15], portrait: { pos: [-16.5, 1.35, -19.5], fov: 50, target: [-3.4, 3.9, -5.4] } },
  roofing: { pos: [15.5, 12.5, 21], target: [0.6, 5.2, 0.4], fov: 36, fit: [17, 12], orbit: 0.5, tilt: [0.3, 0.2], zoom: [0.75, 1.2] },
  solar: { pos: [9.5, 13.5, 20.5], target: [0.2, 6.2, 1.8], fov: 34, fit: [14, 9], orbit: 0.45, tilt: [0.3, 0.2], zoom: [0.75, 1.2] },
  // standing at the dining end, looking down the pavilion: island, gable wall, garden glass on the left
  remodeling: { pos: [0.3, 1.45, -4.55], target: [2.6, 1.85, -11.6], level: true, fov: 50, fit: [7, 3.4], orbit: 0.4, tilt: [0.12, 0.12], zoom: [0.8, 1.02] },
  landscaping: { pos: [-15.8, 3.1, -16.4], target: [-6.4, 0.9, -8.4], fov: 42, fit: [15, 8], orbit: 0.4, tilt: [0.25, 0.15], zoom: [0.75, 1.2] },
  hvac: { pos: [-15.5, 9.5, 14], target: [0.2, 3.2, -2.6], fov: 38, fit: [19, 11], orbit: 0.5, tilt: [0.3, 0.2], zoom: [0.8, 1.2] },
  steel: { pos: [17, 9.5, 15.5], target: [0.3, 4.0, -3.5], fov: 38, fit: [22, 12], orbit: 0.55, tilt: [0.3, 0.2], zoom: [0.8, 1.2] },
  flow: { pos: [-17.5, 1.6, -19.5], target: [-2.6, 3.6, -4.6], level: true, fov: 42, fit: [25, 12], orbit: 0.3 },
  reveal: { pos: [-19.5, 1.7, -22.5], target: [-2.4, 3.8, -4.2], level: true, fov: 40, fit: [27, 13], orbit: 0.3 },
};

/** Where to stand, the lens, and the shift that puts the subject in the middle of the free area. */
export function frame(shot: Shot, w: number, h: number, insets: Insets) {
  const alt = w / h < 0.8 ? shot.portrait : undefined;
  const subject = new THREE.Vector3(...(alt?.target ?? shot.target));
  const from = new THREE.Vector3(...(alt?.pos ?? shot.pos));
  const baseFov = alt?.fov ?? shot.fov;
  const level = !!shot.level;
  const aspect = w / h;
  const k = 1 - (shot.overlap ?? 0);
  const ins = { top: insets.top, right: insets.right * k, bottom: insets.bottom * k, left: insets.left * k };
  const availW = Math.max(120, w - ins.left - ins.right);
  const availH = Math.max(120, h - ins.top - ins.bottom);
  const fx = availW / w;
  const fy = availH / h;
  const dir = from.clone().sub(subject);
  if (level) dir.y = 0;
  const d0 = dir.length();
  dir.normalize();
  const need = (d: number) => Math.max(shot.fit[1] / (2 * d * fy), shot.fit[0] / (2 * d * fx * aspect));
  let t = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
  let dist = d0;
  if (need(d0) > t) {
    // step back first (a photographer would), then widen the lens
    dist = Math.min(d0 * 1.3, (d0 * need(d0)) / t);
    t = Math.max(t, need(dist));
  }
  const fov = Math.min(72, THREE.MathUtils.radToDeg(2 * Math.atan(t)));
  const tt = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const pos = subject.clone().addScaledVector(dir, dist);
  if (level) pos.y = from.y;
  // level shots pivot at eye height; the subject sits above (or below) the horizon
  const look = level ? new THREE.Vector3(subject.x, from.y, subject.z) : subject.clone();
  const yFull = level ? (subject.y - from.y) / dist / tt : 0;
  // centre of the free area in NDC
  const cx = ((ins.left + availW / 2) / w) * 2 - 1;
  const cy = 1 - ((ins.top + availH / 2) / h) * 2;
  return { pos, look, dist, fov, shift: [-cx, cy - yFull] as [number, number] };
}

/** Off-axis projection: shift in NDC units (x: +left, y: +up of the subject's full-frame position). */
function setShift(cam: THREE.PerspectiveCamera, w: number, h: number, sx: number, sy: number) {
  if (Math.abs(sx) < 1e-4 && Math.abs(sy) < 1e-4) {
    if (cam.view?.enabled) cam.clearViewOffset();
    return;
  }
  cam.setViewOffset(w, h, (sx * w) / 2, (sy * h) / 2, w, h);
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
  const idle = useRef({ t: 0, base: new THREE.Vector3(), right: new THREE.Vector3(), key: "" });
  // lens: focal length and shift ease together with the move
  const lens = useRef({ from: [36, 0, 0], to: [36, 0, 0], t: 1 });

  const shotKey: keyof typeof SHOTS =
    phase === "reveal" ? "reveal" : phase === "flow" ? (industry ?? "flow") : phase === "explore" || phase === "qualify" ? (industry ?? "hero") : "hero";

  const apply = useCallback(
    (transition: boolean) => {
      const c = cc.current;
      if (!c) return;
      const cam = camera as THREE.PerspectiveCamera;
      if (DEBUG_CAM) {
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
        setShift(cam, size.width, size.height, 0, 0);
        return;
      }
      const shot = SHOTS[shotKey];
      const f = frame(shot, size.width, size.height, insets);
      const smooth = transition && !reducedMotion;
      // lens changes ride along with the move rather than snapping
      const now = lens.current.t < 1 ? lens.current.to : [cam.fov, ...(lens.current.to.slice(1) as [number, number])];
      lens.current = { from: [...now], to: [f.fov, ...f.shift], t: smooth ? 0 : 1 };
      if (!smooth) {
        cam.fov = f.fov;
        setShift(cam, size.width, size.height, ...f.shift);
        cam.updateProjectionMatrix();
      }
      const off = f.pos.clone().sub(f.look);
      const sph = new THREE.Spherical().setFromVector3(off);
      // take the short way round
      const az = sph.theta + Math.round((c.azimuthAngle - sph.theta) / (Math.PI * 2)) * Math.PI * 2;
      const orbit = shot.orbit ?? 0.5;
      const tilt = shot.tilt ?? [0.2, 0.15];
      const zoom = shot.zoom ?? [0.8, 1.2];
      c.minAzimuthAngle = az - orbit;
      c.maxAzimuthAngle = az + orbit;
      // never below eye-level-ish ground clearance, whatever the visitor does
      const r = sph.radius;
      const ground = Math.acos(THREE.MathUtils.clamp((0.6 - f.look.y) / (r * zoom[1]), -1, 1));
      c.minPolarAngle = Math.max(0.2, sph.phi - tilt[1]);
      c.maxPolarAngle = Math.max(sph.phi, Math.min(Math.PI / 2 + 0.12, sph.phi + tilt[0], ground));
      c.minDistance = r * zoom[0];
      c.maxDistance = r * zoom[1];
      c.smoothTime = reducedMotion ? 0.05 : 1.15;
      c.setLookAt(f.pos.x, f.pos.y, f.pos.z, f.look.x, f.look.y, f.look.z, smooth);
      c.setFocalOffset(0, 0, 0, false);
      idle.current.key = "";
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
      if (fov) cam.fov = fov;
      setShift(cam, size.width, size.height, 0, 0);
      cam.updateProjectionMatrix();
      lens.current = { from: [cam.fov, 0, 0], to: [cam.fov, 0, 0], t: 1 };
      c.minDistance = 0;
      c.maxDistance = Infinity;
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.setFocalOffset(0, 0, 0, false);
      c.setLookAt(...p, ...t, false);
    };
  }, [camera, size.width, size.height]);

  // shot changes (industry / phase / layout)
  useEffect(() => {
    if (arrival.current.active && shotKey === "hero" && !DEBUG_CAM) return;
    arrival.current.active = false;
    apply(true);
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
    c.draggingSmoothTime = 0.18;
    c.azimuthRotateSpeed = 0.42;
    c.polarRotateSpeed = 0.32;
    c.dollySpeed = 0.4;
    c.dollyToCursor = false;
    const start = () => {
      interacting.current = true;
      arrival.current.active = false;
    };
    const end = () => {
      interacting.current = false;
      idle.current.key = "";
    };
    c.addEventListener("controlstart", start);
    c.addEventListener("controlend", end);
    return () => {
      c.removeEventListener("controlstart", start);
      c.removeEventListener("controlend", end);
    };
  }, []);

  const tmp = useRef({ p: new THREE.Vector3(), t: new THREE.Vector3() });

  useFrame((_, delta) => {
    const c = cc.current;
    if (!c) return;
    const dt = Math.min(delta, 1 / 20);
    const cam = camera as THREE.PerspectiveCamera;
    // lens: ease focal length and shift with the move
    const L = lens.current;
    if (L.t < 1) {
      L.t = Math.min(1, L.t + dt / 1.6);
      const k = ease(L.t);
      cam.fov = THREE.MathUtils.lerp(L.from[0], L.to[0], k);
      setShift(cam, size.width, size.height, THREE.MathUtils.lerp(L.from[1], L.to[1], k), THREE.MathUtils.lerp(L.from[2], L.to[2], k));
      cam.updateProjectionMatrix();
    }
    const a = arrival.current;
    if (DEBUG_CAM && a.active) {
      a.active = false;
      apply(false);
      return;
    }
    if (a.active) {
      const shot = SHOTS.hero;
      const f = frame(shot, size.width, size.height, insets);
      if (reducedMotion) {
        a.active = false;
        apply(false);
        return;
      }
      if (cam.fov !== f.fov || L.to[1] !== f.shift[0] || L.to[2] !== f.shift[1]) {
        cam.fov = f.fov;
        setShift(cam, size.width, size.height, ...f.shift);
        cam.updateProjectionMatrix();
        lens.current = { from: [f.fov, ...f.shift], to: [f.fov, ...f.shift], t: 1 };
      }
      const sceneReady = useDemo.getState().sceneReady;
      if (sceneReady) a.t = Math.min(1, a.t + dt / 7.5);
      const k = ease(a.t);
      // descend and settle into the shot, like a slow crane move
      const dir = f.pos.clone().sub(f.look).setY(0).normalize();
      const p = tmp.current.p.copy(f.pos).addScaledVector(dir, (1 - k) * 9).add(new THREE.Vector3(0, (1 - k) * 4.5, 0));
      const t = tmp.current.t.copy(f.look).add(new THREE.Vector3(0, (1 - k) * 1.2, 0));
      c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
      if (a.t >= 1) {
        a.active = false;
        apply(false);
      }
      return;
    }
    // idle: a slow lateral drift on the establishing shots — parallax, not a turntable
    const ph = useDemo.getState().phase;
    const I = idle.current;
    if (DEBUG_CAM || reducedMotion || interacting.current || !(ph === "intro" || ph === "reveal")) {
      I.key = "";
      return;
    }
    if (c.active) return; // still travelling
    if (I.key !== shotKey) {
      I.key = shotKey;
      I.t = 0;
      c.getPosition(I.base);
      const fwd = c.getTarget(new THREE.Vector3()).sub(I.base).normalize();
      I.right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    }
    I.t += dt;
    const s = Math.sin((I.t / 26) * Math.PI * 2) * 0.55;
    const p = tmp.current.p.copy(I.base).addScaledVector(I.right, s);
    c.setPosition(p.x, p.y, p.z, false);
  });

  return <CameraControls ref={cc} makeDefault />;
}
