"""Build web textures from the CC0 sources in .cache/assets-src/tex.

    python3 scripts/assets/build_textures.py [id ...]

Writes public/assets/tex/<id>/<map>_<px>.webp (map: color | normal | arm) and
public/assets/tex/textures.json: real-world tile size in metres, sizes, mean colour
(linear) so tintable greyscale maps can be coloured exactly to a swatch.
  arm = R ambient occlusion, G roughness, B metalness (three.js channel convention).
Some materials are composed here rather than used raw: stone cladding and pavers laid
panel by panel from the travertine scan, architectural shingles on real asphalt grain,
a standing-seam panel normal map, greyscale tintable roof tiles and slate.
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
        up = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(np.float32) / 255
        # bicubic resize of a tile isn't perfectly periodic; roll-blend the seam
        total += up * amp
        norm += amp
        amp *= 0.5
    return total / norm


def save_set(tid, color=None, normal=None, arm=None, meters=(1.0, 1.0), sizes=(1024, 512), note="", srgb_color=True):
    os.makedirs(os.path.join(OUT, tid), exist_ok=True)
    rec = {"meters": [round(meters[0], 4), round(meters[1], 4)], "maps": [], "sizes": list(sizes), "note": note}
    for name, arr, q in (("color", color, 86), ("normal", normal, 92), ("arm", arm, 88)):
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


def gray_tint(tid, src, meters, sizes=(1024, 512), contrast=1.0, note=""):
    """Greyscale albedo keeping the material's value structure; colour comes from the swatch."""
    c = load(src, "diff")
    h, w = c.shape[:2]
    lum = to_lin(c) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lum = lum / lum.mean() * 0.35
    lum = 0.35 + (lum - 0.35) * contrast
    g = np.repeat(to_srgb(lum)[..., None], 3, -1)
    n = load(src, "nor", (w, h))
    a = arm_of(src, (h, w))
    return save_set(tid, g, n, a, meters, sizes, note or "greyscale, tint with material.color")


# ---------------------------------------------------------------- composed materials

def stone_panels(tid, src, tile_m, panel_m, joint_m, px_per_m, bond="running", tone=0.05, rough_boost=0.0, note=""):
    """Lay out cut panels from a tileable stone scan, each from a different part of the scan."""
    W = int(round(tile_m[0] * px_per_m))
    H = int(round(tile_m[1] * px_per_m))
    src_c = load(src, "diff")
    src_n = load(src, "nor")
    src_a = arm_of(src, src_c.shape[:2])
    SH, SW = src_c.shape[:2]
    src_m = 1.2  # Travertine009 covers 1.2 m
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
    hmap = -soft * 0.004 * px_per_m  # 4 mm deep
    normal = blend_normals(normal, height_to_normal(hmap, 1.0))
    mortar = np.array([0.42, 0.40, 0.37], np.float32)
    color = color * (1 - groove[..., None]) + mortar * groove[..., None]
    ao = np.clip(1 - box_blur(groove, 2) * 0.55, 0, 1)
    arm[..., 0] = np.minimum(arm[..., 0], ao)
    arm[..., 1] = np.clip(arm[..., 1] + rough_boost + groove * 0.2, 0, 1)
    return save_set(tid, color, normal, arm, tile_m, (2048, 1024, 512), note)


def shingles(tid, meters=3.0, px=2048):
    """Laminated architectural shingles: random-width tabs, shadow lines, real asphalt granules."""
    H = W = px
    ppm = px / meters
    courses = int(round(meters / 0.143))
    ch = H / courses
    grain_c = load("Asphalt026C", "diff", (W, H))
    grain = to_lin(grain_c) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    grain = (grain - grain.mean()) / (grain.std() + 1e-5)
    hmap = np.zeros((H, W), np.float32)
    tone = np.zeros((H, W), np.float32)
    ys = np.arange(H)
    for k in range(courses):
        y0 = int(round(k * ch))
        y1 = int(round((k + 1) * ch))
        # tabs across the course (wrap so the texture tiles)
        edges = [0]
        x = RNG.random() * 0.2 * ppm
        while x < W - 0.12 * ppm:
            edges.append(int(x))
            x += (0.14 + RNG.random() * 0.22) * ppm
        edges.append(W)
        for e0, e1 in zip(edges[:-1], edges[1:]):
            t = (RNG.random() - 0.5) * 0.35
            lam = RNG.random() < 0.55  # second laminated layer, slightly lower edge = shadow line
            drop = int(ch * (0.18 + RNG.random() * 0.22)) if lam else 0
            seg = slice(e0, e1)
            v = (ys[y0:y1] - y0) / max(1, (y1 - y0))  # 0 at top of course, 1 at the butt (downslope)
            thick = 0.004 + 0.003 * v  # gets thicker toward the exposed edge
            hmap[y0:y1, seg] = (thick * ppm)[:, None]
            tone[y0:y1, seg] = t
            if lam:
                yb = y1 - drop
                tone[yb:y1, seg] = t - 0.22
                hmap[yb:y1, seg] -= 0.0015 * ppm
            # tab gap
            hmap[y0:y1, e0 : e0 + 2] -= 0.002 * ppm
            tone[y0:y1, e0 : e0 + 2] -= 0.35
        # course butt shadow
        hmap[max(0, y1 - 3) : y1, :] -= 0.001 * ppm
        tone[max(0, y1 - 2) : y1, :] -= 0.3
    lum = 0.30 * (1 + tone) * (1 + grain * 0.18)
    lum = np.clip(lum, 0.02, 0.9)
    color = np.repeat(to_srgb(lum)[..., None], 3, -1)
    normal = blend_normals(height_to_normal(hmap, 1.0), height_to_normal(grain * 0.35, 1.0))
    arm = np.zeros((H, W, 3), np.float32)
    arm[..., 0] = np.clip(1 + np.minimum(tone, 0) * 0.9, 0.2, 1)
    arm[..., 1] = np.clip(0.86 + grain * 0.04, 0, 1)
    return save_set(tid, color, normal, arm, (meters, meters), (1024, 512), "architectural shingles, greyscale, tint with material.color")


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


# ---------------------------------------------------------------- catalogue

BUILD = {
    # exterior
    "clad_stone": lambda: stone_panels("clad_stone", "Travertine009", (2.4, 1.2), (1.2, 0.6), 0.006, 853, "running", 0.06, 0.08, "limestone cladding, 1200x600 panels"),
    "paver_stone": lambda: stone_panels("paver_stone", "Travertine009", (1.8, 1.2), (0.9, 0.6), 0.004, 853, "stack", 0.05, 0.15, "limestone pavers 900x600, stack bond"),
    "cedar": lambda: plain("cedar", "japanese_cedar_planks", (1.13, 1.13), saturation=0.55, gain=0.92, warmth=-0.02),
    "shingle": lambda: shingles("shingle"),
    "shingle_worn": lambda: plain("shingle_worn", "roof_07", (2.0, 2.0), note="weathered shingles with lichen (before)"),
    "tile_roof": lambda: gray_tint("tile_roof", "RoofingTiles012A", (2.9, 2.9), contrast=1.1),
    "slate": lambda: gray_tint("slate", "roof_slates_02", (3.0, 3.0), contrast=1.15),
    "seam": lambda: seam_panels("seam"),
    "lawn": lambda: plain("lawn", "Grass001", (1.4, 1.4)),
    "meadow": lambda: plain("meadow", "Grass004", (1.4, 1.4)),
    "gravel": lambda: plain("gravel", "Gravel022", (1.5, 1.5)),
    "deck": lambda: plain("deck", "wood_floor_deck", (1.8, 1.8)),
    "driveway": lambda: plain("driveway", "grooved_concrete_driveway", (1.8, 1.8)),
    "concrete": lambda: plain("concrete", "concrete_floor_02", (2.0, 2.0)),
    "pool_tile": lambda: plain("pool_tile", "Tiles107", (1.0, 1.0)),
    # interior
    "oak_floor": lambda: plain("oak_floor", "wood_floor", (1.7, 1.7), (2048, 1024, 512)),
    "herringbone": lambda: plain("herringbone", "herringbone_parquet", (3.4, 3.4), (2048, 1024, 512)),
    "porcelain": lambda: plain("porcelain", "Tiles107", (1.0, 1.0), (2048, 1024, 512)),
    "concrete_polished": lambda: plain("concrete_polished", "Concrete034", (1.1, 0.55), (2048, 1024, 512)),
    "calacatta": lambda: plain("calacatta", "Marble012", (1.6, 1.6), (2048, 1024, 512), saturation=0.55, gain=1.12, warmth=0.035),
    "nero": lambda: plain("nero", "Marble016", (1.6, 1.6), (2048, 1024, 512)),
    "walnut": lambda: plain("walnut", "american_walnut_veneer", (1.0, 1.0), (2048, 1024, 512)),
    "white_oak": lambda: plain("white_oak", "white_oak_veneer", (0.5, 0.5)),
    "oak_veneer": lambda: plain("oak_veneer", "oak_veneer_01", (1.83, 1.83)),
    "old_tiles": lambda: plain("old_tiles", "floor_tiles_06", (3.0, 3.0)),
    "terrazzo": lambda: plain("terrazzo", "Terrazzo013", (1.0, 1.0)),
    "plaster": lambda: plain("plaster", "Plaster001", (2.0, 2.0)),
    "linen": lambda: plain("linen", "rough_linen", (0.27, 0.27), (512, 256), saturation=0.0, gain=1.9),
    "boucle": lambda: plain("boucle", "Fabric061", (0.4, 0.4), (512, 256), saturation=0.25),
    "leather": lambda: plain("leather", "Leather037", (0.6, 0.6), (512, 256)),
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
