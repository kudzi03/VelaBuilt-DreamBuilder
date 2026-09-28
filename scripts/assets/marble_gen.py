"""
Procedural bookmatch-style marble slabs (generated, no third-party source).

    python3 scripts/assets/marble_gen.py [preview.png]

Writes public/assets/tex/<id>/{color,normal,arm}_{1024,512}.webp for each slab below and
updates textures.json. The pattern tiles seamlessly (periodic noise, integer vein periods),
so worktops longer than one slab never show a seam. Needs numpy + Pillow only.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "tex")


def value_noise(w, h, cells_x, cells_y, rng):
    """Periodic value noise: a random lattice wrapped at the tile edge, smoothstep-interpolated."""
    g = rng.random((cells_y, cells_x))
    xs = np.linspace(0, cells_x, w, endpoint=False)
    ys = np.linspace(0, cells_y, h, endpoint=False)
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    fx = xs - x0
    fy = ys - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    x1 = (x0 + 1) % cells_x
    y1 = (y0 + 1) % cells_y
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]
    d = g[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(w, h, base_x, base_y, octaves, rng, gain=0.5):
    total = np.zeros((h, w))
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        total += amp * (value_noise(w, h, base_x * 2**o, base_y * 2**o, rng) - 0.5)
        norm += amp
        amp *= gain
    return total / norm


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def slab(spec, W, H, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    u = x / W  # 0..1 across the tile
    v = y / H
    # warps: large sweeping movement plus finer wander
    wa = fbm(W, H, 3, 2, 5, rng) * spec["warp"]
    wb = fbm(W, H, 6, 3, 5, rng) * spec["warp"] * 0.45
    veins = np.zeros((H, W))
    halo = np.zeros((H, W))
    for (nx, ny, width, strength) in spec["families"]:
        phase = 2 * np.pi * (nx * u + ny * v) + wa * 2 * np.pi + wb * 2 * np.pi * (nx != 0)
        s = np.abs(np.sin(phase))
        # vein width wanders along the vein; some stretches fade out entirely
        wmod = 0.45 + 0.9 * (fbm(W, H, 4, 2, 3, rng) + 0.5)
        fade = np.clip((fbm(W, H, 3, 2, 3, rng) + 0.5) * 1.8 - 0.35, 0, 1)
        core = np.exp(-((s / (width * wmod)) ** 2)) * fade
        veins = np.maximum(veins, core * strength)
        halo = np.maximum(halo, np.exp(-((s / (width * wmod * 6.5)) ** 2)) * fade * strength)
    # fine hairline veins: ridged noise
    r = 1 - np.abs(fbm(W, H, 10, 5, 4, rng) * 2)
    hair = np.clip((r - (1 - spec["hair_w"])) / spec["hair_w"], 0, 1) ** 3 * spec["hair"]
    clouds = fbm(W, H, 5, 3, 6, rng)

    base = srgb_to_lin(spec["base"])
    cloud = srgb_to_lin(spec["cloud"])
    vein = srgb_to_lin(spec["vein"])
    gold = srgb_to_lin(spec["halo"])
    col = base[None, None, :] + (cloud - base)[None, None, :] * np.clip(clouds * spec["cloud_amt"] + 0.5, 0, 1)[..., None] * 0.6
    col = col + (gold - col) * (halo * spec["halo_amt"])[..., None]
    col = col + (vein - col) * np.clip(veins, 0, 1)[..., None]
    col = col + (vein - col) * np.clip(hair, 0, 1)[..., None] * 0.55
    # sparkle-free grain
    grain = (rng.random((H, W)) - 0.5) * 0.012
    col = col * (1 + grain[..., None])
    rgb = (lin_to_srgb(col) * 255 + 0.5).astype(np.uint8)

    # polished stone: almost flat, veins a hair rougher
    height = veins * 0.6 + hair * 0.3
    gy, gx = np.gradient(height)
    nx = -gx * 0.8
    ny = gy * 0.8
    nz = np.ones_like(nx)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / n, ny / n, nz / n], -1) * 0.5 + 0.5
    rough = spec["rough"] + veins * 0.12 + hair * 0.05
    arm = np.stack([np.ones_like(rough) * 0.98, np.clip(rough, 0, 1), np.zeros_like(rough)], -1)
    return rgb, (normal * 255 + 0.5).astype(np.uint8), (arm * 255 + 0.5).astype(np.uint8)


SLABS = {
    # Calacatta: warm white with bold grey-umber veins and a gold halo (the island in the references)
    "calacatta_oro": {
        "meters": [3.2, 1.6],
        "base": (242, 238, 232),
        "cloud": (226, 220, 212),
        "cloud_amt": 0.9,
        "vein": (74, 62, 52),
        "halo": (201, 184, 160),
        "halo_amt": 0.75,
        "warp": 0.62,
        "families": [(1, 1, 0.04, 1.0), (1, 2, 0.02, 0.8), (2, -1, 0.01, 0.4)],
        "hair": 0.18,
        "hair_w": 0.035,
        "rough": 0.16,
        "seed": 7,
    },
}


def main():
    preview = sys.argv[1] if len(sys.argv) > 1 else None
    index_path = os.path.join(ROOT, "textures.json")
    index = json.load(open(index_path))
    for tid, spec in SLABS.items():
        W, H = 2048, 1024
        rgb, nor, arm = slab(spec, W, H, spec["seed"])
        out = os.path.join(ROOT, tid)
        os.makedirs(out, exist_ok=True)
        for size in (1024, 512):
            dims = (size, size // 2)
            Image.fromarray(rgb).resize(dims, Image.LANCZOS).save(os.path.join(out, f"color_{size}.webp"), quality=88, method=6)
            Image.fromarray(nor).resize(dims, Image.LANCZOS).save(os.path.join(out, f"normal_{size}.webp"), quality=90, method=6)
            Image.fromarray(arm).resize(dims, Image.LANCZOS).save(os.path.join(out, f"arm_{size}.webp"), quality=90, method=6)
        mean = [round(v, 4) for v in srgb_to_lin(rgb.reshape(-1, 3).mean(0)).tolist()]
        size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
        index[tid] = {"meters": spec["meters"], "maps": ["color", "normal", "arm"], "sizes": [1024, 512], "note": "generated: scripts/assets/marble_gen.py", "mean": mean, "bytes": size}
        if preview:
            Image.fromarray(rgb).resize((1024, 512), Image.LANCZOS).save(preview)
        print(tid, "written")
    index.pop("calacatta", None)  # the scan this replaces
    json.dump(index, open(index_path, "w"), indent=1)


if __name__ == "__main__":
    main()
