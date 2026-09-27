import * as THREE from "three";
import { MAX_ANISO, TEX_SCALE } from "./proc";

/** CC0 photo textures (Poly Haven), real-world size in metres. See ASSET_SOURCES.md. */
export const PHOTO = {
  wood_floor: 1.7,
  herringbone_parquet: 3.4,
  wood_floor_deck: 1.8,
  american_walnut_veneer: 1.0,
  oak_veneer_01: 1.83,
  floor_tiles_06: 3.0,
} as const;

export type PhotoName = keyof typeof PHOTO;
const HAS_NORMAL: PhotoName[] = ["wood_floor", "herringbone_parquet", "wood_floor_deck"];

const cache = new Map<string, THREE.Texture>();
const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;

export function photo(name: PhotoName, map: "diff" | "nor" = "diff"): THREE.Texture | null {
  if (map === "nor" && !HAS_NORMAL.includes(name)) return null;
  const size = TEX_SCALE < 1 ? 512 : 1024;
  const key = `${name}_${map}_${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!loader) return null;
  const t = loader.load(`/textures/${name}_${map}_${size}.webp`);
  t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  const m = PHOTO[name];
  t.repeat.set(1 / m, 1 / m);
  t.userData.meters = m;
  cache.set(key, t);
  return t;
}

/** Warm the cache for a scenario before the visitor opens it. */
export function prefetch(names: PhotoName[]) {
  for (const n of names) {
    photo(n, "diff");
    photo(n, "nor");
  }
}
