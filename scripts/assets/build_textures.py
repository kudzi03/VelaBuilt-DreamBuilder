"""Build web textures from the CC0 sources in .cache/assets-src/tex.

    python3 scripts/assets/build_textures.py [id ...]

Writes public/assets/tex/<id>/<map>_<px>.webp (map: color | normal | arm) and
public/assets/tex/textures.json: real-world tile size in metres, sizes, mean colour
(linear) so tintable greyscale maps can be coloured exactly to a swatch.
  arm = R ambient occlusion, G roughness, B metalness (three.js channel convention).
Some materials are composed here rather than used raw: limestone cladding and pavers laid
panel by panel from the travertine scan, a standing-seam panel normal map, and a greyscale
single-ply roof membrane (tinted to the customer's swatch).
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, ".cache", "assets-src", "tex")
OUT = os.path.join(ROOT, "public", "assets", "tex")
RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- helpers

def load(tid, m, size=None, gray=False):
    p = os.path.join(SRC, tid, f"{m}.jpg")
    if not os.path.exists(p):
        return None
    im = Image.open(p).convert("L" if gray else "RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    return a


def to_lin(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def arm_of(tid, shape):
    """Existing Poly Haven arm, or pack ambientCG AO/rough/metal."""
    arm = load(tid, "arm", (shape[1], shape[0]))
    if arm is not None:
        return arm
    h, w = shape
    rough = load(tid, "rough", (w, h), gray=True)
    ao = load(tid, "ao", (w, h), gray=True)
    metal = load(tid, "metal", (w, h), gray=True)
    out = np.zeros((h, w, 3), np.float32)
    out[..., 0] = ao if ao is not None else 1.0
    out[..., 1] = rough if rough is not None else 0.6
    out[..., 2] = metal if metal is not None else 0.0
    return out


def height_to_normal(hmap, strength):
    """Tileable height (metres-ish scaled) to an OpenGL normal map."""
    dx = (np.roll(hmap, -1, 1) - np.roll(hmap, 1, 1)) * strength
    dy = (np.roll(hmap, 1, 0) - np.roll(hmap, -1, 0)) * strength  # image rows go down; GL +Y up
    n = np.stack([-dx, -dy, np.ones_like(hmap)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def blend_normals(a, b):
    """Whiteout blend of two encoded normal maps."""
    na = a * 2 - 1
    nb = b * 2 - 1
    n = np.stack([na[..., 0] + nb[..., 0], na[..., 1] + nb[..., 1], na[..., 2] * nb[..., 2]], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def box_blur(a, r):
    if r <= 0:
        return a
    out = a.copy()
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for k in range(-r, r + 1):
            acc += np.roll(out, k, axis)
        out = acc / (2 * r + 1)
    return out


def fbm(h, w, cells, octaves=5, seed=0):
    """Tileable value-noise fBm in [0,1]."""
    rng = np.random.default_rng(seed)
    total = np.zeros((h, w), np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        g = rng.random((c, c)).astype(np.float32)
        # periodic: wrap-pad the lattice, resample, crop the middle
        pad = 2
        gp = np.pad(g, pad, mode="wrap")
        W2 = int(round(w * (c + 2 * pad) / c))
        H2 = int(round(h * (c + 2 * pad) / c))
        up = np.asarray(Image.fromarray(gp, "F").resize((W2, H2), Image.BICUBIC), np.float32)
        ox = int(round(w * pad / c))
        oy = int(round(h * pad / c))
        up = up[oy : oy + h, ox : ox + w]
        total += np.clip(up, 0, 1) * amp
        norm += amp
        amp *= 0.5
    return total / norm


def save_set(tid, color=None, normal=None, arm=None, meters=(1.0, 1.0), sizes=(1024, 512), note="", srgb_color=True):
    os.makedirs(os.path.join(OUT, tid), exist_ok=True)
    rec = {"meters": [round(meters[0], 4), round(meters[1], 4)], "maps": [], "sizes": list(sizes), "note": note}
    # normals at 84: indistinguishable in the render, a third smaller than at 92
    for name, arr, q in (("color", color, 86), ("normal", normal, 84), ("arm", arm, 88)):
        if arr is None:
            continue
        rec["maps"].append(name)
        img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
        h, w = arr.shape[:2]
        for s in sizes:
            # keep the aspect ratio of the tile (textures are not always square)
            if w >= h:
                size = (s, max(1, round(s * h / w)))
            else:
                size = (max(1, round(s * w / h)), s)
            im = img if size == (w, h) else img.resize(size, Image.LANCZOS)
            im.save(os.path.join(OUT, tid, f"{name}_{s}.webp"), "WEBP", quality=q, method=6)
    if color is not None:
        lin = to_lin(color) if srgb_color else color
        rec["mean"] = [round(float(c), 4) for c in lin.reshape(-1, 3).mean(0)]
    rec["bytes"] = sum(os.path.getsize(os.path.join(OUT, tid, f)) for f in os.listdir(os.path.join(OUT, tid)))
    return rec


def grade(c, saturation=1.0, gain=1.0, warmth=0.0):
    """Colour-grade an sRGB albedo in linear space: saturation, exposure, warm/cool shift."""
    lin = to_lin(c)
    lum = (lin @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    lin = lum + (lin - lum) * saturation
    lin = lin * gain * np.array([1 + warmth, 1, 1 - warmth], np.float32)
    return to_srgb(lin)


def plain(tid, src, meters, sizes=(1024, 512), note="", **g):
    c = load(src, "diff")
    if g:
        c = grade(c, **g)
    h, w = c.shape[:2]
    n = load(src, "nor", (w, h))
    a = arm_of(src, (h, w))
    return save_set(tid, c, n, a, meters, sizes, note)


# ---------------------------------------------------------------- composed materials

def stone_panels(tid, src, tile_m, panel_m, joint_m, px_per_m, bond="running", tone=0.05, rough_boost=0.0, note="", src_m=1.2, grout=(0.42, 0.40, 0.37), depth=0.004, grade_args=None):
    """Lay out cut panels from a tileable stone scan, each from a different part of the scan."""
    W = int(round(tile_m[0] * px_per_m))
    H = int(round(tile_m[1] * px_per_m))
    src_c = load(src, "diff")
    if grade_args:
        src_c = grade(src_c, **grade_args)
    src_n = load(src, "nor")
    src_a = arm_of(src, src_c.shape[:2])
    SH, SW = src_c.shape[:2]
    scale = (SW / src_m) / px_per_m  # source px per output px
    color = np.zeros((H, W, 3), np.float32)
    normal = np.zeros((H, W, 3), np.float32)
    arm = np.zeros((H, W, 3), np.float32)
    pw = int(round(panel_m[0] * px_per_m))
    ph = int(round(panel_m[1] * px_per_m))
    rows = H // ph
    cols = W // pw
    yy, xx = np.mgrid[0:ph, 0:pw]
    for r in range(rows):
        off = (pw // 2) if (bond == "running" and r % 2) else 0
        for c in range(cols + 1):
            x0 = c * pw - off
            ox = RNG.random() * SW
            oy = RNG.random() * SH
            flip = RNG.random() < 0.5
            sx = ((xx * scale + ox) % SW).astype(np.int32)
            sy = ((yy * scale + oy) % SH).astype(np.int32)
            if flip:
                sx = (SW - 1 - sx)
            pc = src_c[sy, sx]
            pn = src_n[sy, sx].copy()
            if flip:
                pn[..., 0] = 1 - pn[..., 0]
            pa = src_a[sy, sx]
            k = 1 + (RNG.random() - 0.5) * 2 * tone
            warm = (RNG.random() - 0.5) * tone * 0.5
            pc = np.clip(pc * k + np.array([warm, 0, -warm]), 0, 1)
            cols_idx = (np.arange(pw) + x0) % W
            color[r * ph : (r + 1) * ph][:, cols_idx] = pc
            normal[r * ph : (r + 1) * ph][:, cols_idx] = pn
            arm[r * ph : (r + 1) * ph][:, cols_idx] = pa
    # joints: height groove + AO + darker, slightly rougher mortar
    j = max(1, int(round(joint_m * px_per_m)))
    groove = np.zeros((H, W), np.float32)
    for r in range(rows):
        y = r * ph
        for t in range(-(j // 2), j - j // 2):
            groove[(y + t) % H, :] = 1
        off = (pw // 2) if (bond == "running" and r % 2) else 0
        for c in range(cols + 1):
            x = (c * pw - off) % W
            for t in range(-(j // 2), j - j // 2):
                groove[r * ph : (r + 1) * ph, (x + t) % W] = 1
    soft = box_blur(groove, 1)
    hmap = -soft * depth * px_per_m
    normal = blend_normals(normal, height_to_normal(hmap, 1.0))
    mortar = np.array(grout, np.float32)
    color = color * (1 - groove[..., None]) + mortar * groove[..., None]
    ao = np.clip(1 - box_blur(groove, 2) * 0.55, 0, 1)
    arm[..., 0] = np.minimum(arm[..., 0], ao)
    arm[..., 1] = np.clip(arm[..., 1] + rough_boost + groove * 0.2, 0, 1)
    return save_set(tid, color, normal, arm, tile_m, (1024, 512), note)


def seam_panels(tid, width=0.46, length=1.84, px=512):
    """Standing-seam metal between the seams: flat pans with faint oil-canning. Ribs are geometry."""
    W = px
    H = int(round(px * length / width))
    x = np.arange(W) / W
    y = np.arange(H) / H
    X, Y = np.meshgrid(x, y)
    wave = np.sin(X * math.pi) * (0.6 * np.sin(Y * 2 * math.pi * 2 + 1.3) + 0.4 * np.sin(Y * 2 * math.pi * 5 + 0.2))
    edge = np.exp(-((X - 0.5) ** 2) / 0.02)  # slight crown mid-pan
    hmap = (wave * 0.0009 + edge * 0.0006) * (W / width)
    fine = fbm(H, W, 16, 4, 3) - 0.5
    normal = height_to_normal(hmap + fine * 0.15, 1.0)
    color = np.full((H, W, 3), to_srgb(np.float32(0.35)), np.float32)
    arm = np.zeros((H, W, 3), np.float32)
    arm[..., 0] = 1
    arm[..., 1] = np.clip(0.5 + fine * 0.12, 0, 1)
    arm[..., 2] = 1
    return save_set(tid, color, normal, arm, (width, length), (512, 256), "standing seam pan; colour/roughness/metal set per finish")


def dark_granite(tid, src, meters, sizes=(1024, 512), lo=0.012, hi=0.2, note=""):
    """A pale salt-and-pepper granite turned into a black one: crystals keep their structure,
    the ground mass goes near-black (Nero Impala / black pearl family)."""
    c = load(src, "diff")
    h, w = c.shape[:2]
    lum = to_lin(c) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lum = (lum - lum.min()) / max(1e-6, float(lum.max() - lum.min()))
    inv = (1 - lum) ** 2.2  # dark ground, sparse bright crystals
    lin = lo + inv * (hi - lo)
    rgb = np.stack([lin * 0.98, lin, lin * 1.03], -1)  # a breath of cool
    n = load(src, "nor", (w, h))
    a = arm_of(src, (h, w))
    return save_set(tid, to_srgb(rgb), n, a, meters, sizes, note)


def marble(tid, src, meters, sizes=(1024, 512), contrast=1.0, note="", **g):
    """Polished marble: grade the ground colour, then deepen the veining around the mean."""
    c = grade(load(src, "diff"), **g) if g else load(src, "diff")
    lin = to_lin(c)
    mean = lin.reshape(-1, 3).mean(0)
    lin = np.clip(mean + (lin - mean) * contrast, 0, 1)
    h, w = c.shape[:2]
    n = load(src, "nor", (w, h))
    a = arm_of(src, (h, w))
    return save_set(tid, to_srgb(lin), n, a, meters, sizes, note)


def membrane(tid, meters=3.0, px=1024):
    """Single-ply roof membrane, greyscale (tinted to the swatch): 1.5 m sheets with welded
    overlaps, faint mottling and drainage streaks. Seams run along the tile's v axis."""
    h = w = px
    ppm = px / meters
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    lum = 0.62 + (fbm(h, w, 4, 5, seed=21) - 0.5) * 0.05 + (fbm(h, w, 16, 3, seed=22) - 0.5) * 0.025
    # streaks where water ran toward the drains
    streak = fbm(h, w, 3, 4, seed=23)
    lum -= np.clip(streak - 0.62, 0, 1) * 0.12
    height = (fbm(h, w, 24, 3, seed=24) - 0.5) * 0.3
    for k in range(2):
        sx = (k + 0.5) * w / 2
        d = np.abs(((x - sx + w / 2) % w) - w / 2) / ppm  # metres from the seam line
        weld = np.clip(1 - d / 0.045, 0, 1)
        height += weld * 1.0
        lum += weld * 0.025 - np.clip(1 - np.abs(d - 0.05) / 0.01, 0, 1) * 0.05
    lum = np.clip(lum, 0, 1)
    g = np.repeat(to_srgb(lum * 0.35 / lum.mean())[..., None], 3, -1)
    n = height_to_normal(box_blur(height, 1), 1.2)
    arm = np.zeros((h, w, 3), np.float32)
    arm[..., 0] = 1.0
    arm[..., 1] = 0.5 + (fbm(h, w, 8, 3, seed=25) - 0.5) * 0.1
    return save_set(tid, g, n, arm, (meters, meters), (1024, 512), "single-ply membrane, greyscale: tint with material.color")


# ---------------------------------------------------------------- catalogue

BUILD = {
    # exterior
    "limestone": lambda: stone_panels("limestone", "Travertine009", (2.4, 1.2), (1.2, 0.6), 0.006, 853, "running", 0.06, 0.08, "limestone cladding, 1200x600 panels"),
    "membrane": lambda: membrane("membrane"),
    "paver_stone": lambda: stone_panels("paver_stone", "Travertine009", (1.8, 1.2), (0.9, 0.6), 0.004, 853, "stack", 0.05, 0.15, "limestone pavers 900x600, stack bond"),
    "cedar": lambda: plain("cedar", "japanese_cedar_planks", (1.13, 1.13), saturation=0.55, gain=0.92, warmth=-0.02),
    "seam": lambda: seam_panels("seam"),
    "lawn": lambda: plain("lawn", "Grass001", (1.4, 1.4)),
    "meadow": lambda: plain("meadow", "Grass004", (1.4, 1.4)),
    "gravel": lambda: plain("gravel", "Gravel022", (1.5, 1.5)),
    "mulch": lambda: plain("mulch", "mud_forest", (2.35, 2.35), (512, 256), note="mulched bed soil"),
    "deck": lambda: plain("deck", "wood_floor_deck", (1.8, 1.8)),
    "concrete": lambda: plain("concrete", "concrete_floor_02", (2.0, 2.0)),
    "pool_tile": lambda: plain("pool_tile", "Tiles107", (1.0, 1.0)),
    # interior
    "oak_floor": lambda: plain("oak_floor", "wood_floor", (1.7, 1.7), (1024, 512)),
    "herringbone": lambda: plain("herringbone", "herringbone_parquet", (3.4, 3.4), (1024, 512)),
    "porcelain": lambda: stone_panels("porcelain", "Marble025", (2.4, 1.2), (1.2, 0.6), 0.002, 853, "stack", 0.015, -0.1, "large-format porcelain 1200x600, stack bond", src_m=1.6, grout=(0.62, 0.6, 0.57), depth=0.0015, grade_args={"saturation": 0.6, "gain": 0.92, "warmth": 0.03}),
    "concrete_polished": lambda: plain("concrete_polished", "Concrete034", (1.1, 0.55), (1024, 512)),
    # the Calacatta worktop is generated (scripts/assets/marble_gen.py -> calacatta_oro)
    "black_granite": lambda: dark_granite("black_granite", "Granite002A", (1.2, 1.2), note="honed black granite (from a pale granite scan)"),
    "walnut": lambda: plain("walnut", "american_walnut_veneer", (1.0, 1.0), (1024, 512)),
    "white_oak": lambda: plain("white_oak", "white_oak_veneer", (0.5, 0.5)),
    "oak_veneer": lambda: plain("oak_veneer", "oak_veneer_01", (1.83, 1.83)),
    "old_tiles": lambda: plain("old_tiles", "floor_tiles_06", (3.0, 3.0)),
    "plaster": lambda: plain("plaster", "Plaster001", (2.0, 2.0)),
    "linen": lambda: plain("linen", "rough_linen", (0.27, 0.27), (512, 256), saturation=0.0, gain=1.9),
    "boucle": lambda: plain("boucle", "Fabric061", (0.4, 0.4), (512, 256), saturation=0.25),
    "brushed_steel": lambda: plain("brushed_steel", "Metal032", (1.0, 1.0), (512, 256)),
}


def main():
    ids = sys.argv[1:] or list(BUILD)
    man_path = os.path.join(OUT, "textures.json")
    os.makedirs(OUT, exist_ok=True)
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for tid in ids:
        man[tid] = BUILD[tid]()
        print(f"{tid:18s} {man[tid]['meters']} {man[tid]['bytes'] / 1024:.0f} KB", flush=True)
    with open(man_path, "w") as f:
        json.dump(dict(sorted(man.items())), f, indent=1)


if __name__ == "__main__":
    main()
