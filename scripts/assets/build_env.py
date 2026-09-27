"""Environment maps: CC0 HDRIs (Poly Haven) -> compact sky textures + calibration data.

    <bvenv>/bin/python scripts/assets/build_env.py

For each HDRI:
  * the sun disk is measured (direction, colour, irradiance) and then removed, because the
    scene's shadow-casting directional light re-adds it — no double counting;
  * the remaining radiance is stored as linear/K in an sRGB WebP (8-bit is plenty once the
    sun is gone), K written to env.json. The browser decodes it natively; the shader
    multiplies by K. One file feeds both the sky dome and image-based lighting.
Directions are reported in three.js world space (+Y up, equirect u=0.5 -> +X, u=0.75 -> +Z).
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import hdrio  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, ".cache", "assets-src", "hdri")
OUT = os.path.join(ROOT, "public", "assets", "env")

SKIES = {
    "sunset": "qwantani_sunset",  # golden hour, sun 6 degrees up
    "dusk": "qwantani_dusk_2",  # blue hour, afterglow at the same azimuth
}
SIZES = [2048, 1024, 512]


def direction(u, v):
    """Equirect (u,v in 0..1, v=0 top) -> three.js unit vector."""
    phi = (u - 0.5) * 2 * math.pi
    theta = (0.5 - v) * math.pi  # elevation
    return [math.cos(theta) * math.cos(phi), math.sin(theta), math.cos(theta) * math.sin(phi)]


def srgb_encode(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def process(key, name):
    rgb = hdrio.load(os.path.join(SRC, f"{name}_2k.hdr"))
    H, W, _ = rgb.shape
    L = hdrio.luminance(rgb)
    rows = (np.arange(H) + 0.5) / H
    elev = (0.5 - rows) * math.pi
    d_omega = (2 * math.pi / W) * (math.pi / H) * np.cos(elev)[:, None]  # solid angle per pixel

    info = {"source": name}
    y, x = np.unravel_index(np.argmax(L), L.shape)
    peak = float(L[y, x])
    if peak > 200:  # a real sun disk
        # everything much brighter than the surrounding sky within ~4 degrees is "sun"
        yy, xx = np.mgrid[0:H, 0:W]
        dx = np.minimum(np.abs(xx - x), W - np.abs(xx - x)) * (360 / W) * math.cos(elev[y])
        dy = (yy - y) * (180 / H)
        dist = np.sqrt(dx * dx + dy * dy)
        near = dist < 4.0
        ring = (dist > 4.0) & (dist < 7.0)
        sky_level = float(np.median(L[ring]))
        sun_mask = near & (L > sky_level * 1.5)
        excess = np.clip(rgb - sky_level * 1.2, 0, None) * sun_mask[..., None]
        E = (excess * d_omega[..., None]).sum(axis=(0, 1))  # irradiance per channel (normal incidence)
        wsum = (L * sun_mask * d_omega).sum()
        cy = float((yy * L * sun_mask * d_omega).sum() / wsum)
        cx = float((xx * L * sun_mask * d_omega).sum() / wsum)
        sun_dir = direction((cx + 0.5) / W, (cy + 0.5) / H)
        lum_E = float(E[0] * 0.2126 + E[1] * 0.7152 + E[2] * 0.0722)
        info["sun"] = {
            "dir": [round(c, 4) for c in sun_dir],
            "elevationDeg": round(math.degrees(math.asin(sun_dir[1])), 2),
            "irradiance": round(lum_E, 3),
            "color": [round(float(c / max(E)), 4) for c in E],
        }
        # replace the disk with the surrounding sky, feathered
        fill = np.clip(rgb, 0, sky_level * 2.5)
        k = np.clip((dist - 1.0) / 3.0, 0, 1)[..., None]
        blend = near[..., None]
        rgb = np.where(blend, fill * (1 - k) + np.minimum(rgb, fill) * k, rgb)
        L = hdrio.luminance(rgb)
    else:
        info["sun"] = None

    # glow direction (brightest horizon azimuth) — useful for fog tint and camera planning
    band = L[H // 2 - H // 24 : H // 2 - 2]
    col_lum = band.mean(axis=0)
    gx = int(np.argmax(np.convolve(col_lum, np.ones(31) / 31, mode="same")))
    info["glowDir"] = [round(c, 4) for c in direction((gx + 0.5) / W, 0.5)]

    sky = rgb[: H // 2]
    info["zenith"] = [round(float(c), 4) for c in rgb[: H // 16].reshape(-1, 3).mean(axis=0)]
    info["horizon"] = [round(float(c), 4) for c in rgb[H // 2 - H // 36 : H // 2].reshape(-1, 3).mean(axis=0)]
    info["skyMean"] = round(float(hdrio.luminance(sky).mean()), 4)
    info["groundMean"] = [round(float(c), 4) for c in rgb[H // 2 + H // 12 :].reshape(-1, 3).mean(axis=0)]

    K = float(np.percentile(L, 99.95)) * 1.05
    info["scale"] = round(K, 4)
    enc = srgb_encode(rgb / K)
    os.makedirs(OUT, exist_ok=True)
    img = Image.fromarray((enc * 255 + 0.5).astype(np.uint8), "RGB")
    for w in SIZES:
        im = img if w == W else img.resize((w, w // 2), Image.LANCZOS)
        path = os.path.join(OUT, f"sky_{key}_{w}.webp")
        im.save(path, "WEBP", quality=92 if w >= 1024 else 90, method=6)
        info.setdefault("files", {})[str(w)] = {"bytes": os.path.getsize(path)}
    return info


def main():
    meta = {k: process(k, n) for k, n in SKIES.items()}
    with open(os.path.join(OUT, "env.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
