"use client";

import { WALL, WING } from "@/lib/spec";
import { useDemo } from "@/lib/store";
import { markShadowsDirty } from "./Atmosphere";
import { setLampLevels, updateLampViewPositions } from "./lamps";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { channels, fades, U, wipes, type ChannelKey } from "./shared";

/** How fast each channel travels (units per second) — deliberate, not springy. */
const SPEED: Record<ChannelKey, number> = {
  dusk: 0.32,
  cut: 0.42,
  ghost: 0.9,
  wingLift: 0.75,
  glassWall: 1.4,
  steel: 0.8,
  solar: 1.2,
  hvac: 0.9,
  kitchen: 1,
  gardenFocus: 1,
  roof: 1,
};

function approach(cur: number, target: number, speed: number, dt: number) {
  const d = target - cur;
  if (Math.abs(d) < 1e-4) return target;
  // constant speed with a soft landing
  const step = Math.sign(d) * Math.min(Math.abs(d), speed * dt * (0.35 + Math.min(1, Math.abs(d) * 3)));
  return cur + step;
}

/** The kitchen is shown just after sunset: lamps carry the room, the garden goes blue. */
export const REMODEL_DUSK = 0.62;

/**
 * Time of day per moment (0 golden hour → 1 blue hour). The arrival and the reveal are
 * twilight shots — warm windows against a darkening sky — the showrooms sit in golden light.
 */
function duskFor(phase: string, ind: string | null, evening: boolean) {
  if (phase === "reveal") return 0.9;
  if (phase === "intro" || phase === "loading") return 0.84;
  if (ind === "landscaping") return evening ? 1 : 0.16;
  if (ind === "remodeling") return REMODEL_DUSK;
  if (ind === "hvac") return 0.3;
  return 0.12;
}

export function targetsFor(): Record<ChannelKey, number> {
  const s = useDemo.getState();
  const reveal = s.phase === "reveal";
  const ind = reveal ? null : s.industry;
  const intro = s.phase === "intro" || s.phase === "loading";
  return {
    dusk: duskFor(s.phase, ind, s.landscaping.evening),
    cut: ind === "steel" || ind === "hvac" ? 0 : 1,
    ghost: ind === "hvac" ? 1 : ind === "steel" && s.steel.ghost ? 0.4 : 0,
    // the camera walks into the kitchen now; the roof stays on
    wingLift: 0,
    glassWall: 1,
    steel: ind === "steel" ? 1 : 0,
    solar: ind === "solar" || (reveal && (s.engagement.solar?.actions ?? 0) > 0) ? 1 : 0,
    hvac: ind === "hvac" ? 1 : 0,
    kitchen: ind === "remodeling" ? 1 : 0,
    gardenFocus: ind === "landscaping" ? 1 : 0,
    roof: ind === "roofing" && !intro ? 1 : 0,
  };
}

/**
 * Lamp positions follow whichever camera is rendering the scene (the main view, or the
 * pool's mirrored view) — three calls scene.onBeforeRender at the start of every render.
 */
export function LampSync() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.onBeforeRender = (_r, _s, camera) => {
      camera.updateMatrixWorld();
      updateLampViewPositions(camera);
    };
    return () => {
      scene.onBeforeRender = () => {};
    };
  }, [scene]);
  return null;
}

export function Director() {
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = useDemo.getState();
    U.time.value += dt;

    const t = targetsFor();
    const fast = s.reducedMotion ? 6 : 1;
    // QA captures (?debug): jump straight to the end state instead of animating
    const settle = (window as unknown as { __settle?: boolean }).__settle === true;
    let moving = false;
    for (const k of Object.keys(t) as ChannelKey[]) {
      const before = channels[k];
      channels[k] = settle ? t[k] : approach(before, t[k], SPEED[k] * fast, dt);
      if (channels[k] !== before) moving = true;
    }
    if (moving) markShadowsDirty(2);

    // lamps: rooms come on as the light fades, facade lights after sunset
    const d = channels.dusk;
    const sm = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    setLampLevels({
      interior: 0.25 + 0.75 * sm(0.2, 0.6, d),
      exterior: sm(0.45, 0.75, d),
      kitchen: Math.max(channels.kitchen, sm(0.3, 0.7, d)),
      garden: sm(0.55, 0.9, d),
    });

    U.cutY.value = -0.4 + channels.cut * 10.2;
    U.cutGlow.value = Math.min(1, Math.abs(channels.cut - t.cut) * 6);
    U.ghost.value = channels.ghost;
    U.dusk.value = channels.dusk;
    // the pavilion's glass wall dissolves only while the camera passes through it
    const cam = state.camera.position;
    const inSpan = cam.z > -13.8 && cam.z < -4.2 && cam.y < WING.eave + 0.5;
    const through = inSpan ? Math.min(1, Math.max(0, (Math.abs(cam.x - (WING.x0 + WALL / 2)) - WALL / 2 - 0.1) / 0.6)) : 1;
    fades.glassWall.value = Math.min(channels.glassWall, through * through * (3 - 2 * through));
    const lift = channels.wingLift;
    fades.wingRoof.value = 1 - Math.min(1, Math.max(0, (lift - 0.45) / 0.45));
    U.airColor.value.set(s.hvac.mode === "heat" ? "#e3874a" : "#4f9fd6");

    const W = state.gl.domElement.width;
    const on = s.compare && s.phase === "explore";
    const split = s.split * W;
    wipes.roof.value = on && s.industry === "roofing" ? split : -1;
    wipes.kitchen.value = on && s.industry === "remodeling" ? split : -1;
    wipes.garden.value = on && s.industry === "landscaping" ? split : -1;
  }, -2);
  return null;
}
