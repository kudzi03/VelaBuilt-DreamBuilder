"use client";

import { useFrame } from "@react-three/fiber";
import { useDemo } from "@/lib/store";
import { markShadowsDirty } from "./Atmosphere";
import { channels, fades, U, wipes, type ChannelKey } from "./shared";

/** How fast each channel travels (units per second) — deliberate, not springy. */
const SPEED: Record<ChannelKey, number> = {
  dusk: 0.55,
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

export function targetsFor(): Record<ChannelKey, number> {
  const s = useDemo.getState();
  const reveal = s.phase === "reveal";
  const ind = reveal ? null : s.industry;
  const intro = s.phase === "intro" || s.phase === "loading";
  return {
    dusk: reveal || (ind === "landscaping" && s.landscaping.evening) ? 1 : 0,
    cut: ind === "steel" || ind === "hvac" ? 0 : 1,
    ghost: ind === "hvac" ? 1 : ind === "steel" && s.steel.ghost ? 0.4 : 0,
    wingLift: ind === "remodeling" ? 1 : 0,
    glassWall: ind === "remodeling" ? 0 : 1,
    steel: ind === "steel" ? 1 : 0,
    solar: ind === "solar" || (reveal && (s.engagement.solar?.actions ?? 0) > 0) ? 1 : 0,
    hvac: ind === "hvac" ? 1 : 0,
    kitchen: ind === "remodeling" ? 1 : 0,
    gardenFocus: ind === "landscaping" ? 1 : 0,
    roof: ind === "roofing" && !intro ? 1 : 0,
  };
}

export function Director() {
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = useDemo.getState();
    U.time.value += dt;

    const t = targetsFor();
    const fast = s.reducedMotion ? 6 : 1;
    let moving = false;
    for (const k of Object.keys(t) as ChannelKey[]) {
      const before = channels[k];
      channels[k] = approach(before, t[k], SPEED[k] * fast, dt);
      if (channels[k] !== before) moving = true;
    }
    if (moving) markShadowsDirty(2);

    U.cutY.value = -0.4 + channels.cut * 10.2;
    U.ghost.value = channels.ghost;
    U.dusk.value = channels.dusk;
    fades.glassWall.value = channels.glassWall;
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
