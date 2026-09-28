import * as THREE from "three";

/**
 * Light that LED strips throw across a surface (a floor under a plinth, the back of a lit
 * shelf, a soffit beside a cove), drawn as an additive gradient instead of a lamp: brightest
 * along uv.y = 1, fading to nothing at uv.y = 0, soft at both ends.
 */
let glowTex: THREE.DataTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const W = 128;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    // DataTexture row 0 is v = 0; d is the distance from the lit edge (v = 1)
    const d = 1 - y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const e = Math.min(1, Math.min(u, 1 - u) / 0.07);
      const k = Math.exp(-d * 3.4) * (1 - d) * e * e * (3 - 2 * e);
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(255 * k);
      data[i + 3] = 255;
    }
  }
  glowTex = new THREE.DataTexture(data, W, H);
  glowTex.colorSpace = THREE.NoColorSpace;
  glowTex.magFilter = THREE.LinearFilter;
  glowTex.minFilter = THREE.LinearFilter;
  glowTex.needsUpdate = true;
  return glowTex;
}

export function glowMaterial(color: string, strength: number) {
  return new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: new THREE.Color(color).multiplyScalar(strength),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

