"""Real-time 3D trees from the Poly Haven scans (stage 1 of 2).

    python3 scripts/assets/build_trees.py [ids]      (numpy, scipy, Pillow)
    node scripts/assets/build_trees.mjs [ids]        (stage 2: simplify bark, WebP, meshopt)

The scans are 1-7 million triangles each: every leaf (or fir needle spray) is its own little
mesh. That is right for offline rendering and far too heavy for a browser. This stage keeps the
tree's own structure and imagery but changes how the foliage is represented:

- every leaf becomes one card (two triangles): the leaf's texture coordinates are fitted to its
  3D points (least squares, u,v -> x,y,z), and the card is the leaf's UV rectangle mapped into
  3D, so it shows exactly the leaf picture the scan used, alpha and all;
- the cards are thinned to a budget and the survivors scaled up about their own centre so the
  crown keeps its coverage (a tree seen from 20-60 m reads as masses of leaves, not leaves);
- conifers whose scan models single needles are carded differently: the needles are binned into
  voxels, each voxel's needle cloud gives a plane (PCA) and the branch runs away from the trunk,
  and a sprig picture from the same atlas is laid there (sprig_cards);
- a second, sparser set of the same cards (a quarter, grown further) serves the middle distance;
- cards are stored compactly (cards.bin: quantised centre, two half-axes and a UV rectangle,
  26 bytes a card); the browser expands them and bends their normals toward the crown's outside
  (soft, volumetric shading) and darkens the inside of the crown (three/plantfield.tsx);
- bark (trunk and limbs) is written at full resolution; stage 2 simplifies it with meshopt.

The model is normalised exactly like the impostor bake (footprint centre, ground at y = 0) so
the same placement data drives every LOD. Output: .cache/trees/<id>/ — <id>.gltf (bark, meshes
lod0 and lod1), cards.bin + cards.json, and each leaf picture as RGBA PNG.
"""

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, ".cache", "assets-src", "models")
OUT = os.path.join(ROOT, ".cache", "trees")

# id: source asset, node-name prefix (None = whole file), foliage materials (substring match),
#     cards to keep, largest card scale-up, crown AO strength
SPECIES = {
    "jacaranda": ("jacaranda_tree", None, ["leaves"], 15000, 3.0, 0.55),
    "island": ("island_tree_02", None, ["leaves"], 9000, 2.2, 0.5),
    "fir_a": ("fir_tree_01", "fir_tree_01_a", ["twig"], 7000, 0.0, 0.6),
    "fir_b": ("fir_tree_01", "fir_tree_01_b", ["twig"], 6000, 0.0, 0.6),
    "fir_c": ("fir_tree_01", "fir_tree_01_c", ["twig"], 3500, 0.0, 0.6),
    "searsia_a": ("searsia_lucida", "searsia_lucida_a", ["leaves", "twigs"], 3600, 1.5, 0.45),
    "searsia_b": ("searsia_lucida", "searsia_lucida_b", ["leaves", "twigs"], 3200, 1.5, 0.45),
    "searsia_c": ("searsia_lucida", "searsia_lucida_c", ["leaves", "twigs"], 2800, 1.5, 0.45),
    "searsia_d": ("searsia_lucida", "searsia_lucida_d", ["leaves", "twigs"], 2400, 1.5, 0.45),
}

# leaves grow by this much on top of the thinning compensation: the garden's shrubs are clipped,
# fuller specimens than the open scan
BOOST = {"searsia_a": 1.45, "searsia_b": 1.45, "searsia_c": 1.45, "searsia_d": 1.45}

# LOD1 (mid distance): this share of LOD0's cards, grown to keep the crown's coverage
LOD1_SHARE = 0.25

# The fir scan models every needle (800k tiny strips a tree); thinned and scaled, those read as
# sticks. These species are re-carded from the sprig pictures in the same atlas instead.
SPRIG = {"fir_a", "fir_b", "fir_c"}

CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


class Gltf:
    def __init__(self, asset):
        self.dir = os.path.join(SRC, asset)
        self.j = json.load(open(os.path.join(self.dir, f"{asset}.gltf")))
        self.buf = np.fromfile(os.path.join(self.dir, self.j["buffers"][0]["uri"]), dtype=np.uint8)

    def acc(self, i):
        a = self.j["accessors"][i]
        bv = self.j["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        dt = CT[a["componentType"]]
        n = NC[a["type"]]
        cnt = a["count"]
        isz = np.dtype(dt).itemsize * n
        stride = bv.get("byteStride", 0)
        if stride and stride != isz:
            raw = np.lib.stride_tricks.as_strided(self.buf[off:], shape=(cnt, isz), strides=(stride, 1)).copy()
            return raw.view(dt).reshape(cnt, n)
        return np.frombuffer(self.buf[off : off + cnt * isz].tobytes(), dtype=dt).reshape(cnt, n)

    def image_path(self, mat, slot):
        m = self.j["materials"][mat]
        t = None
        if slot == "base":
            t = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        elif slot == "normal":
            t = m.get("normalTexture")
        elif slot == "orm":
            t = m.get("pbrMetallicRoughness", {}).get("metallicRoughnessTexture") or m.get("occlusionTexture")
        if not t:
            return None
        img = self.j["textures"][t["index"]]["source"]
        return os.path.join(self.dir, self.j["images"][img]["uri"])


def node_matrix(nd):
    if "matrix" in nd:
        return np.array(nd["matrix"], dtype=np.float64).reshape(4, 4).T
    t = np.array(nd.get("translation", [0, 0, 0]), dtype=np.float64)
    x, y, z, w = nd.get("rotation", [0, 0, 0, 1])
    r = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    s = np.array(nd.get("scale", [1, 1, 1]), dtype=np.float64)
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def gather(g, prefix):
    """Primitives of the kept nodes, positions in model space: [(material index, P, N, UV, I)]."""
    out = []
    for nd in g.j["nodes"]:
        if "mesh" not in nd or (prefix and not nd.get("name", "").startswith(prefix)):
            continue
        M = node_matrix(nd)
        for p in g.j["meshes"][nd["mesh"]]["primitives"]:
            P = g.acc(p["attributes"]["POSITION"]).astype(np.float64)
            P = P @ M[:3, :3].T + M[:3, 3]
            N = g.acc(p["attributes"]["NORMAL"]).astype(np.float64) @ M[:3, :3].T if "NORMAL" in p["attributes"] else None
            if N is not None:
                N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
            if "TEXCOORD_0" not in p["attributes"]:
                continue  # untextured helper geometry (fir_c carries one)
            UV = g.acc(p["attributes"]["TEXCOORD_0"]).astype(np.float64)
            I = g.acc(p["indices"]).reshape(-1, 3).astype(np.int64)
            out.append((p["material"], P, N, UV, I))
    return out


def leaf_cards(P, UV, I, keep, max_scale, rng, boost=1.0):
    """One card per connected leaf mesh: its UV rectangle mapped to 3D by a least-squares fit."""
    n = len(P)
    r = np.concatenate([I[:, 0], I[:, 1], I[:, 2]])
    c = np.concatenate([I[:, 1], I[:, 2], I[:, 0]])
    k, lab = connected_components(coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(n, n)), directed=False)
    used = np.zeros(n, bool)
    used[I.ravel()] = True
    lab = np.where(used, lab, -1)
    sel = lab >= 0
    L, U, X = lab[sel], UV[sel], P[sel]
    # normal equations of X ~ [u v 1] @ A, per component
    F = np.column_stack([U, np.ones(len(U))])
    M = np.zeros((k, 3, 3))
    R = np.zeros((k, 3, 3))
    for a in range(3):
        for b in range(3):
            M[:, a, b] = np.bincount(L, weights=F[:, a] * F[:, b], minlength=k)
            R[:, a, b] = np.bincount(L, weights=F[:, a] * X[:, b], minlength=k)
    cnt = M[:, 2, 2]
    # UV rectangle of each leaf
    order = np.argsort(L, kind="stable")
    Ls = L[order]
    starts = np.flatnonzero(np.r_[True, Ls[1:] != Ls[:-1]])
    comps = Ls[starts]
    umin = np.full((k, 2), np.nan)
    umax = np.full((k, 2), np.nan)
    umin[comps] = np.minimum.reduceat(U[order], starts, axis=0)
    umax[comps] = np.maximum.reduceat(U[order], starts, axis=0)
    ok = (cnt >= 3) & np.all(umax - umin > 1e-4, axis=1)
    idx = np.flatnonzero(ok)
    reg = np.eye(3)[None] * 1e-9
    A = np.linalg.solve(M[idx] + reg, R[idx])  # (m,3,3): rows = d/du, d/dv, offset
    du, dv = A[:, 0], A[:, 1]
    nrm = np.cross(du, dv)
    area = np.linalg.norm(nrm, axis=1)
    good = area > 1e-10
    idx, A, nrm = idx[good], A[good], nrm[good]
    total = len(idx)
    # thin to the budget; the survivors grow to keep the crown's coverage
    if keep < total:
        pick = rng.choice(total, keep, replace=False)
        idx, A, nrm = idx[pick], A[pick], nrm[pick]
    scale = min(np.sqrt(total / len(idx)), max_scale) * boost
    u0, u1 = umin[idx], umax[idx]
    corners_uv = np.stack(
        [
            np.column_stack([u0[:, 0], u0[:, 1]]),
            np.column_stack([u1[:, 0], u0[:, 1]]),
            np.column_stack([u1[:, 0], u1[:, 1]]),
            np.column_stack([u0[:, 0], u1[:, 1]]),
        ],
        axis=1,
    )  # (m,4,2)
    Fc = np.concatenate([corners_uv, np.ones(corners_uv.shape[:2] + (1,))], axis=2)
    corners = np.einsum("mcj,mjk->mck", Fc, A)  # (m,4,3)
    mid = corners.mean(axis=1, keepdims=True)
    corners = mid + (corners - mid) * scale
    nrm = nrm / np.linalg.norm(nrm, axis=1, keepdims=True)
    return corners, corners_uv, nrm, total, scale


def sprig_rects(tex_path):
    """UV rectangles of the sprig pictures in an atlas: large green alpha islands, as (u0, v0, u1, v1)."""
    from scipy import ndimage

    im = np.asarray(Image.open(tex_path).convert("RGBA")).astype(np.float32) / 255.0
    h, w = im.shape[:2]
    lab, n = ndimage.label(ndimage.binary_dilation(im[..., 3] > 0.5, iterations=3))
    out = []
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        ys, xs = sl
        bw, bh = (xs.stop - xs.start) / w, (ys.stop - ys.start) / h
        m = (lab[sl] == k) & (im[sl][..., 3] > 0.5)
        if bw < 0.04 or bh < 0.08 or m.sum() < 800:
            continue
        rgb = im[sl][..., :3][m].mean(0)
        if rgb[1] <= rgb[0] * 1.05:  # brown stems and bark strips
            continue
        if bw < 0.33 * bh:  # the thin single-needle strips
            continue
        out.append((xs.start / w, ys.start / h, xs.stop / w, ys.stop / h, float(m.sum())))
    out.sort()
    return out


def sprig_cards(P, UV, I, keep, rng, rects, size_k=2.6):
    """Sprig cards for a needle-modelled conifer: one per occupied voxel of needles.

    Voxel size is searched so the number of voxels lands on the budget. In each voxel the needle
    cloud's smallest principal axis is the spray's normal (tipped toward the sky, as fir sprays
    are); the sprig points away from the trunk with a slight droop; its picture is one of the
    atlas' sprigs, sized to the voxel with some jitter and a small roll."""
    n = len(P)
    r = np.concatenate([I[:, 0], I[:, 1], I[:, 2]])
    c = np.concatenate([I[:, 1], I[:, 2], I[:, 0]])
    k, lab = connected_components(coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(n, n)), directed=False)
    used = np.zeros(n, bool)
    used[I.ravel()] = True
    cnt = np.bincount(lab[used], minlength=k).astype(np.float64)
    ctr = np.stack([np.bincount(lab[used], weights=P[used, a], minlength=k) for a in range(3)], 1) / np.maximum(cnt, 1)[:, None]
    uc = np.bincount(lab[used], weights=UV[used, 0], minlength=k) / np.maximum(cnt, 1)
    # needles only: the stems use the bark strip at the atlas' left edge
    X = ctr[(cnt > 0) & (uc > 0.16)]
    total = len(X)

    def bins(vox):
        key = np.floor(X / vox).astype(np.int64)
        _, inv, num = np.unique(key, axis=0, return_inverse=True, return_counts=True)
        return inv.ravel(), num

    lo_v, hi_v = 0.08, 2.0
    for _ in range(18):
        vox = np.sqrt(lo_v * hi_v)
        inv, num = bins(vox)
        occ = int((num >= 4).sum())
        if occ > keep:
            lo_v = vox
        else:
            hi_v = vox
    vox = hi_v
    inv, num = bins(vox)
    m = len(num)
    S = np.stack([np.bincount(inv, weights=X[:, a], minlength=m) for a in range(3)], 1)
    mu = S / num[:, None]
    C = np.zeros((m, 3, 3))
    for a in range(3):
        for b in range(3):
            C[:, a, b] = np.bincount(inv, weights=X[:, a] * X[:, b], minlength=m) / num - mu[:, a] * mu[:, b]
    ok = num >= 4
    mu, C, num = mu[ok], C[ok], num[ok]
    if len(mu) > keep:
        pick = rng.choice(len(mu), keep, replace=False, p=num / num.sum())
        mu, C, num = mu[pick], C[pick], num[pick]
    _, V = np.linalg.eigh(C)  # ascending: V[:, :, 0] is the spray's normal
    up = np.array([0.0, 1.0, 0.0])
    nrm = V[:, :, 0] * np.where(V[:, 1, 0] < 0, -1.0, 1.0)[:, None]
    nrm = nrm + up * 0.45
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    # away from the trunk (the leader at the top points up), a little droop
    rad = np.column_stack([mu[:, 0], np.zeros(len(mu)), mu[:, 2]])
    rl = np.linalg.norm(rad, axis=1, keepdims=True)
    t = np.where(rl > 0.35, rad / np.maximum(rl, 1e-9) + np.array([0.0, -0.22, 0.0]), up)
    t = t + rng.normal(0, 0.18, t.shape)
    t = t - (t * nrm).sum(1, keepdims=True) * nrm
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    side = np.cross(nrm, t)
    # picture: bigger sprigs more often
    area = np.array([q[4] for q in rects])
    which = rng.choice(len(rects), len(mu), p=area / area.sum())
    R = np.array([q[:4] for q in rects])[which]
    aspect = (R[:, 2] - R[:, 0]) / (R[:, 3] - R[:, 1])
    L = vox * size_k * rng.uniform(0.8, 1.25, len(mu)) * np.clip(np.sqrt(num / np.median(num)), 0.8, 1.3)
    Wd = L * aspect
    # tip at the picture's top (small v): c0 = (u0, v0) tip-left, c3 = (u0, v1) base-left
    mid = mu + t * L[:, None] * 0.18
    hu = side * (Wd / 2)[:, None]
    hv = -t * (L / 2)[:, None]
    corners = np.stack([mid - hu - hv, mid + hu - hv, mid + hu + hv, mid - hu + hv], axis=1)
    cuv = np.stack(
        [
            np.column_stack([R[:, 0], R[:, 1]]),
            np.column_stack([R[:, 2], R[:, 1]]),
            np.column_stack([R[:, 2], R[:, 3]]),
            np.column_stack([R[:, 0], R[:, 3]]),
        ],
        axis=1,
    )
    return corners, cuv, total, vox


def write_png(path, arr_or_img, size=None):
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path)


def build(tid):
    asset, prefix, foliage, keep, max_scale, ao_k = SPECIES[tid]
    rng = np.random.default_rng(sum(ord(ch) * 31**i for i, ch in enumerate(tid)) % (2**32))
    g = Gltf(asset)
    prims = gather(g, prefix)
    mat_name = lambda i: g.j["materials"][i]["name"]
    is_leaf = lambda i: any(f in mat_name(i) for f in foliage)
    allP = np.concatenate([p[1] for p in prims])
    base = np.array([(allP[:, 0].min() + allP[:, 0].max()) / 2, allP[:, 1].min(), (allP[:, 2].min() + allP[:, 2].max()) / 2])
    height = float(allP[:, 1].max() - allP[:, 1].min())
    center = np.array([0.0, height / 2, 0.0])
    half = (allP.max(0) - allP.min(0)) / 2
    out_dir = os.path.join(OUT, tid)
    os.makedirs(out_dir, exist_ok=True)

    blobs = []
    accessors, views, materials, textures, images = [], [], [], [], []
    offset = 0

    def add(arr, comp, typ, target=None, minmax=False):
        nonlocal offset
        b = np.ascontiguousarray(arr).tobytes()
        pad = (-len(b)) % 4
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(b), **({"target": target} if target else {})})
        blobs.append(b + b"\0" * pad)
        offset += len(b) + pad
        a = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = [float(x) for x in arr.min(0)]
            a["max"] = [float(x) for x in arr.max(0)]
        accessors.append(a)
        return len(accessors) - 1

    tex_cache = {}

    def texture(key, make):
        if key not in tex_cache:
            fn = f"{key}.png"
            make(os.path.join(out_dir, fn))
            images.append({"uri": fn})
            textures.append({"source": len(images) - 1})
            tex_cache[key] = len(textures) - 1
        return tex_cache[key]

    mat_cache = {}

    def material(i, leaf):
        if i in mat_cache:
            return mat_cache[i]
        name = mat_name(i)
        m = {"name": name, "doubleSided": True, "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0}}
        base_p = g.image_path(i, "base")
        if base_p:
            if leaf:
                # the scans ship alpha as a separate map: the one named after this material, else the file's only one
                alphas = sorted(f for f in os.listdir(os.path.join(g.dir, "textures")) if "alpha" in f)
                named = [f for f in alphas if name in f]
                pick = named[0] if named else (alphas[0] if alphas else None)
                alpha_p = os.path.join(g.dir, "textures", pick) if pick else None

                def make_rgba(path, base_p=base_p, alpha_p=alpha_p):
                    rgb = Image.open(base_p).convert("RGB")
                    a = Image.open(alpha_p).convert("L").resize(rgb.size) if alpha_p else Image.new("L", rgb.size, 255)
                    rgb.putalpha(a)
                    rgb.save(path)

                m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": texture(f"{name}_color", make_rgba)}
                m["alphaMode"] = "MASK"
                m["alphaCutoff"] = 0.5
            else:
                m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": texture(f"{name}_color", lambda p, s=base_p: Image.open(s).convert("RGB").save(p))}
        # leaves shade from their bent normals and a flat roughness: no normal or ORM maps to ship
        nor_p = None if leaf else g.image_path(i, "normal")
        if nor_p:
            m["normalTexture"] = {"index": texture(f"{name}_normal", lambda p, s=nor_p: Image.open(s).convert("RGB").save(p))}
        orm_p = None if leaf else g.image_path(i, "orm")
        if orm_p:
            ti = texture(f"{name}_orm", lambda p, s=orm_p: Image.open(s).convert("RGB").save(p))
            m["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": ti}
            m["occlusionTexture"] = {"index": ti}
        materials.append(m)
        mat_cache[i] = len(materials) - 1
        return mat_cache[i]

    def leaf_texture(mi):
        """Colour with the scan's separate alpha map folded in: <material>_color.png (RGBA)."""
        name = mat_name(mi)
        base_p = g.image_path(mi, "base")
        alphas = sorted(f for f in os.listdir(os.path.join(g.dir, "textures")) if "alpha" in f)
        named = [f for f in alphas if name in f]
        pick = named[0] if named else (alphas[0] if alphas else None)
        rgb = Image.open(base_p).convert("RGB")
        a = Image.open(os.path.join(g.dir, "textures", pick)).convert("L").resize(rgb.size) if pick else Image.new("L", rgb.size, 255)
        rgb.putalpha(a)
        fn = f"{name}_color.png"
        rgb.save(os.path.join(out_dir, fn))
        return fn

    def bark_prim(P, UV, N, I, mi):
        attrs = {
            "POSITION": add(P.astype(np.float32), 5126, "VEC3", 34962, True),
            "TEXCOORD_0": add(UV.astype(np.float32), 5126, "VEC2", 34962),
        }
        if N is not None:
            attrs["NORMAL"] = add(N.astype(np.float32), 5126, "VEC3", 34962)
        return {"attributes": attrs, "indices": add(I.astype(np.uint32).ravel(), 5125, "SCALAR", 34963), "material": material(mi, False)}

    stats = []
    lod0, lod1 = [], []
    cards = {0: [], 1: []}  # per LOD: [(material slot, corners (m,4,3), uv (m,4,2))]
    leaf_mats = []  # texture file per material slot
    by_mat = {}
    for mi, P, N, UV, I in prims:
        by_mat.setdefault(mi, []).append((P, N, UV, I))
    leaf_total = max(1, sum(len(pp[3]) for m2, pl in by_mat.items() if is_leaf(m2) for pp in pl))
    for mi, parts in by_mat.items():
        leaf = is_leaf(mi)
        P = np.concatenate([p[0] for p in parts]) - base
        UV = np.concatenate([p[2] for p in parts])
        offs = np.cumsum([0] + [len(p[0]) for p in parts[:-1]])
        I = np.concatenate([p[3] + o for p, o in zip(parts, offs)])
        if leaf and tid in SPRIG:
            slot = len(leaf_mats)
            tex = leaf_texture(mi)
            leaf_mats.append({"name": mat_name(mi), "texture": tex})
            rects = sprig_rects(os.path.join(out_dir, tex))
            corners, cuv, total, vox = sprig_cards(P, UV, I, keep, rng, rects)
            c1, cuv1, _, vox1 = sprig_cards(P, UV, I, max(1, int(keep * LOD1_SHARE)), rng, rects, size_k=2.3)
            cards[0].append((slot, corners, cuv))
            cards[1].append((slot, c1, cuv1))
            stats.append(f"{mat_name(mi)}: {total} needles -> {len(corners)} sprig cards at {vox:.2f} m ({len(rects)} sprigs; LOD1 {len(c1)} at {vox1:.2f} m)")
        elif leaf:
            share = keep * len(I) / leaf_total
            corners, cuv, nrm, total, scale = leaf_cards(P, UV, I, max(1, int(share)), max_scale, rng, BOOST.get(tid, 1.0))
            slot = len(leaf_mats)
            leaf_mats.append({"name": mat_name(mi), "texture": leaf_texture(mi)})
            cards[0].append((slot, corners, cuv))
            # LOD1: a share of the same cards, grown further about their own centres
            pick = rng.choice(len(corners), max(1, int(len(corners) * LOD1_SHARE)), replace=False)
            grow = min(np.sqrt(1 / LOD1_SHARE), max_scale * 2 / max(scale, 1e-6))
            c1 = corners[pick]
            mid = c1.mean(axis=1, keepdims=True)
            cards[1].append((slot, mid + (c1 - mid) * grow, cuv[pick]))
            stats.append(f"{mat_name(mi)}: {total} leaves -> {len(corners)} cards x{scale:.2f} (LOD1 {len(pick)} x{scale * grow:.2f})")
        else:
            N = np.concatenate([p[1] for p in parts]) if all(p[1] is not None for p in parts) else None
            lod0.append(bark_prim(P, UV, N, I, mi))
            lod1.append(bark_prim(P, UV, N, I, mi))
            stats.append(f"{mat_name(mi)}: {len(I)} bark triangles")

    # cards, compactly: centre (3 x int16 over the tree's box), two half-axes (6 x int16 over the
    # largest one), UV rectangle (4 x uint16 over the UV range) — 26 bytes a card instead of ~96
    every = [c for lod in (0, 1) for c in cards[lod]]
    if every:
        allc = np.concatenate([c[1] for c in every])
        alluv = np.concatenate([c[2] for c in every])
        mid = allc.mean(axis=1)
        du = (allc[:, 1] - allc[:, 0]) / 2
        dv = (allc[:, 3] - allc[:, 0]) / 2
        lo, hi = mid.min(0), mid.max(0)
        axis = float(max(np.abs(du).max(), np.abs(dv).max()))
        ulo, uhi = alluv.reshape(-1, 2).min(0), alluv.reshape(-1, 2).max(0)
        q16 = lambda x, a, b: np.round((x - a) / np.maximum(b - a, 1e-9) * 65535).astype(np.uint16)
        chunks, layout = [], {0: [], 1: []}
        for lod in (0, 1):
            for slot, cc, uv in cards[lod]:
                m_ = cc.mean(axis=1)
                u_ = (cc[:, 1] - cc[:, 0]) / 2
                v_ = (cc[:, 3] - cc[:, 0]) / 2
                rect = np.column_stack([uv[:, 0, 0], uv[:, 0, 1], uv[:, 2, 0], uv[:, 2, 1]])
                chunks.append(q16(m_, lo, hi).tobytes())
                chunks.append(np.round(np.column_stack([u_, v_]) / axis * 32767).astype(np.int16).tobytes())
                chunks.append(q16(rect, np.r_[ulo, ulo], np.r_[uhi, uhi]).tobytes())
                layout[lod].append([slot, len(cc)])
        open(os.path.join(out_dir, "cards.bin"), "wb").write(b"".join(chunks))
        meta = {
            "materials": leaf_mats,
            "lod0": layout[0],
            "lod1": layout[1],
            "box": [lo.tolist(), hi.tolist()],
            "axis": axis,
            "uv": [ulo.tolist(), uhi.tolist()],
            "crown": {"center": center.tolist(), "half": half.tolist(), "ao": ao_k},
        }
        json.dump(meta, open(os.path.join(out_dir, "cards.json"), "w"))

    blob = b"".join(blobs)
    open(os.path.join(out_dir, f"{tid}.bin"), "wb").write(blob)
    gl = {
        "asset": {"version": "2.0", "generator": "VelaBuilt build_trees.py"},
        "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": [{"name": "lod0", "mesh": 0}, {"name": "lod1", "mesh": 1}],
        "meshes": [{"name": "lod0", "primitives": lod0}, {"name": "lod1", "primitives": lod1}],
        "materials": materials,
        "textures": textures,
        "images": images,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"uri": f"{tid}.bin", "byteLength": len(blob)}],
        "extras": {"height": height, "center": center.tolist(), "source": asset},
    }
    json.dump(gl, open(os.path.join(out_dir, f"{tid}.gltf"), "w"))
    print(f"{tid}: height {height:.2f} m; " + "; ".join(stats), flush=True)


if __name__ == "__main__":
    for tid in sys.argv[1:] or list(SPECIES):
        build(tid)
