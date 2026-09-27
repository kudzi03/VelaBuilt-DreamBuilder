import * as THREE from "three";
import ENV from "@/public/assets/env/env.json";

/**
 * Time-of-day model. One property, one sun direction, two real skies:
 *   dusk = 0  golden hour — qwantani_sunset (Poly Haven, CC0), sun ~9° up
 *   dusk = 1  blue hour   — qwantani_dusk_2 (same location, after sunset)
 * Scenarios pick a value in between; the IBL, sky, sun and fog all follow it.
 * Sky textures store linear radiance / scale as sRGB WebP (scripts/assets/build_env.py).
 */

/** Where the sun sits, as a bearing in world space (0 = +X, 90 = +Z): west-north-west, so the
 * garden, the pavilion glazing and the front roof take the evening sun, and the arrival shot
 * looks away from the afterglow into a deep blue sky. */
export const SUN_AZIMUTH_DEG = 150;
/** Golden-hour sun height. Higher than the photo's 6° so shadows stay readable. */
export const SUN_ELEVATION_DEG = 9.5;

const hdriSun = ENV.sunset.sun!;
const hdriAzimuth = Math.atan2(hdriSun.dir[2], hdriSun.dir[0]);
/** Radians added to equirect longitude so the photographed sun lines up with our sun. */
export const SKY_ROTATION = (SUN_AZIMUTH_DEG * Math.PI) / 180 - hdriAzimuth;

export function sunDirection(elevationDeg = SUN_ELEVATION_DEG, target = new THREE.Vector3()) {
  const az = (SUN_AZIMUTH_DEG * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return target.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

/** Direction from the scene toward the sun at golden hour. */
export const SUN_DIR = sunDirection();

export const SKY = {
  sunset: { scale: ENV.sunset.scale, horizon: ENV.sunset.horizon, zenith: ENV.sunset.zenith },
  dusk: { scale: ENV.dusk.scale, horizon: ENV.dusk.horizon, zenith: ENV.dusk.zenith },
};

/**
 * Photometric calibration relative to the sky photographs (their radiance units).
 * The measured sun (irradiance ≈ 3.4 at 6°) is lifted a little because our sun is
 * higher; its colour is warmed rather than the measured deep red, which reads as
 * "sunset haze" on white render instead of golden light.
 */
export const LIGHT = {
  sunIrradiance: hdriSun.irradiance * 1.35,
  sunColor: new THREE.Color().setRGB(1, 0.66, 0.4),
  duskSunColor: new THREE.Color().setRGB(1, 0.42, 0.28),
};

export type SkyKey = keyof typeof SKY;
