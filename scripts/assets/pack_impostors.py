"""Pack baked impostor frames into atlases for the web.

    <bvenv>/bin/python scripts/assets/pack_impostors.py [id ...]

Per plant, two WebP atlases (N x N cells, cell (i, j) at column i, row j counted from the
bottom so it matches GL texture v):
  <id>_color_<px>.webp   sRGB albedo + alpha
  <id>_normal_<px>.webp  world normal (three.js axes, n*0.5+0.5) + ambient shade in alpha
and impostors.json with the per-plant radius/height/grid used by three/impostor.ts.
"""
import json
import os
import sys

import bpy
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, ".cache", "impostors")
OUT = os.path.join(ROOT, "public", "assets", "plants")


def load_exr(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1].copy()  # row 0 = top


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def dilate(rgb, mask, iters=3):
    """Bleed colours outward into transparent pixels so filtering never pulls in black."""
    rgb = rgb.copy()
    m = mask.astype(np.float32)
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(m.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            acc += np.roll(np.roll(rgb * m[..., None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(m, dy, 0), dx, 1)
        grow = (m == 0) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        m = np.where(grow, 1.0, m)
    # whatever is still empty: the average colour
    if (m == 0).any():
        avg = (rgb * mask[..., None]).sum(axis=(0, 1)) / max(mask.sum(), 1)
        rgb[m == 0] = avg
    return rgb


def pack(pid):
    d = os.path.join(RAW, pid)
    meta = json.load(open(os.path.join(d, "meta.json")))
    N, S = meta["N"], meta["size"]
    color = np.zeros((N * S, N * S, 4), dtype=np.float32)
    normal = np.zeros((N * S, N * S, 4), dtype=np.float32)
    k = 0
    for j in range(N):
        for i in range(N):
            img = load_exr(os.path.join(d, f"image_{k:04d}.exr"))
            alb = load_exr(os.path.join(d, f"albedo_{k:04d}.exr"))
            nor = load_exr(os.path.join(d, f"normal_{k:04d}.exr"))
            a = np.clip(img[..., 3], 0, 1)
            cov = np.maximum(a, 1e-4)[..., None]
            albedo = alb[..., :3] / cov
            lum_img = (img[..., :3] / cov) @ np.array([0.2126, 0.7152, 0.0722])
            lum_alb = albedo @ np.array([0.2126, 0.7152, 0.0722])
            shade = np.clip(lum_img / np.maximum(lum_alb, 1e-3), 0, 1)
            nb = nor[..., :3]
            n3 = np.stack([nb[..., 0], nb[..., 2], -nb[..., 1]], axis=-1)
            n3 /= np.maximum(np.linalg.norm(n3, axis=-1, keepdims=True), 1e-5)
            n3 = np.nan_to_num(n3, nan=0.0)
            n3[~np.isfinite(n3).all(-1)] = 0
            mask = a > 0.02
            albedo = dilate(albedo, mask)
            n3 = dilate(n3, mask)
            shade = dilate(shade[..., None], mask)[..., 0]
            r0 = (N - 1 - j) * S
            c0 = i * S
            color[r0 : r0 + S, c0 : c0 + S, :3] = srgb(albedo)
            color[r0 : r0 + S, c0 : c0 + S, 3] = a
            normal[r0 : r0 + S, c0 : c0 + S, :3] = n3 * 0.5 + 0.5
            normal[r0 : r0 + S, c0 : c0 + S, 3] = shade
            k += 1
    os.makedirs(OUT, exist_ok=True)
    full = N * S
    files = {}
    for px in (full, full // 2, full // 4):
        for kind, arr in (("color", color), ("normal", normal)):
            im = Image.fromarray((np.clip(np.nan_to_num(arr), 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
            if px != full:
                im = im.resize((px, px), Image.LANCZOS)
            path = os.path.join(OUT, f"{pid}_{kind}_{px}.webp")
            im.save(path, "WEBP", quality=84 if kind == "color" else 80, alpha_quality=90, method=6)
            files.setdefault(str(px), {})[kind] = os.path.getsize(path)
    return {"N": N, "radius": round(meta["radius"], 4), "height": round(meta["height"], 4), "center": [round(c, 4) for c in meta["center"]], "px": [full, full // 2, full // 4], "bytes": files}


def main():
    ids = sys.argv[1:] or sorted(p for p in os.listdir(RAW) if os.path.exists(os.path.join(RAW, p, "meta.json")))
    index_path = os.path.join(OUT, "impostors.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    for pid in ids:
        index[pid] = pack(pid)
        print(pid, index[pid], flush=True)
    with open(index_path, "w") as f:
        json.dump(dict(sorted(index.items())), f, indent=2)


if __name__ == "__main__":
    main()
