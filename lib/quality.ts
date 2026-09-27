"use client";

import type { Tier } from "./store";

export interface TierSettings {
  dpr: [number, number];
  shadows: boolean;
  shadowMap: number;
  ao: boolean;
  aoHalfRes: boolean;
  bloom: boolean;
  msaa: number;
  post: boolean;
  plantDensity: number;
  textureSize: 512 | 1024;
  envRes: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { dpr: [1, 2], shadows: true, shadowMap: 2048, ao: true, aoHalfRes: false, bloom: true, msaa: 4, post: true, plantDensity: 1, textureSize: 1024, envRes: 256 },
  medium: { dpr: [1, 1.6], shadows: true, shadowMap: 1024, ao: true, aoHalfRes: true, bloom: true, msaa: 0, post: true, plantDensity: 0.75, textureSize: 1024, envRes: 128 },
  low: { dpr: [1, 1.25], shadows: false, shadowMap: 512, ao: false, aoHalfRes: true, bloom: false, msaa: 0, post: false, plantDensity: 0.45, textureSize: 512, envRes: 64 },
};

export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
}

/**
 * Phones get the 512 px texture and plant-atlas variants on every tier: as sharp as the screen
 * can show, and about a third of the download over a mobile connection.
 */
export function textureSizeFor(tier: Tier): 512 | 1024 {
  if (typeof window === "undefined") return TIERS[tier].textureSize;
  const phone = isTouchDevice() && Math.min(window.screen.width, window.screen.height) < 600;
  return phone ? 512 : TIERS[tier].textureSize;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

function gpuString(): string {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return String(s || "");
  } catch {
    return "";
  }
}

/** `?quality=` accepts the tier names used in the docs (ultra / standard / mobile) and the internal ones. */
const ALIAS: Record<string, Tier> = { ultra: "high", high: "high", standard: "medium", medium: "medium", mobile: "low", low: "low" };

/**
 * First guess at a tier. The runtime PerformanceMonitor then steps it down (or up)
 * based on measured frame rate, so a wrong guess corrects itself within seconds.
 */
export function detectTier(): Tier {
  if (typeof window === "undefined") return "medium";
  const q = ALIAS[new URLSearchParams(location.search).get("quality") ?? ""];
  if (q) return q;

  const gpu = gpuString().toLowerCase();
  const touch = isTouchDevice();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;

  if (/swiftshader|llvmpipe|software|microsoft basic/.test(gpu)) return "low";
  if (mem <= 2 || cores <= 4) return touch ? "low" : "medium";

  if (touch) {
    // Android GPUs: old Adreno / Mali / PowerVR → low. Apple GPUs and modern Adreno/Mali → medium.
    const adreno = gpu.match(/adreno[^\d]*(\d{3})/);
    if (adreno) {
      const n = parseInt(adreno[1], 10);
      if (n < 610) return "low";
      if (n >= 730) return "high";
      return "medium";
    }
    if (/mali-(g5|t)|powervr|sgx|videocore/.test(gpu)) return "low";
    if (/mali-g(7|6)|immortalis/.test(gpu)) return "medium";
    if (/apple/.test(gpu)) return window.screen.width * (window.devicePixelRatio || 1) >= 1170 ? "high" : "medium";
    return "medium";
  }

  if (/intel/.test(gpu) && !/iris xe|arc/.test(gpu)) return "medium";
  return "high";
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(location.search).get("motion") === "reduced") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
