"""Bake photoscanned CC0 vegetation (Poly Haven) into hemi-octahedral impostors.

    <bvenv>/bin/python scripts/assets/bake_impostors.py [asset ...]

Each plant is rendered with Cycles from N x N directions covering the upper hemisphere
(hemi-octahedral layout). Per view we keep albedo + alpha, world normal, and a soft
"ambient shade" (a render under a uniform white sky divided by albedo), so the runtime
shader can light the plant with the real sun, sky and shadows from any viewing angle.
The same direction/basis maths lives in three/impostor.ts — keep them in sync.

Output: .cache/impostors/<id>/frame_####.exr (raw) then pack_impostors.py builds atlases.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, ".cache", "assets-src", "models")
OUT = os.path.join(ROOT, ".cache", "impostors")

# id: (source asset, node name or None for whole file, grid N, frame px)
PLANTS = {
    "jacaranda": ("jacaranda_tree", None, 8, 256),
    "fir_a": ("fir_tree_01", "fir_tree_01_a_LOD0", 8, 256),
    "fir_b": ("fir_tree_01", "fir_tree_01_b_LOD0", 8, 256),
    "fir_c": ("fir_tree_01", "fir_tree_01_c_LOD0", 8, 256),
    "island": ("island_tree_02", None, 8, 256),
    "searsia_a": ("searsia_lucida", "searsia_lucida_a_LOD0", 6, 160),
    "searsia_b": ("searsia_lucida", "searsia_lucida_b_LOD0", 6, 160),
    "searsia_c": ("searsia_lucida", "searsia_lucida_c_LOD0", 6, 160),
    "searsia_d": ("searsia_lucida", "searsia_lucida_d_LOD0", 6, 160),
    "shrub_a": ("shrub_02", "shrub_02_a", 6, 160),
    "shrub_d": ("shrub_02", "shrub_02_d", 6, 160),
}


def three_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def hemi_oct_decode(qx, qy):
    """Grid coords in [-1,1]^2 -> unit direction (three.js, +Y up), y >= 0."""
    px = (qx + qy) * 0.5
    pz = (qx - qy) * 0.5
    d = np.array([px, 1.0 - abs(px) - abs(pz), pz])
    return d / np.linalg.norm(d)


def frame_basis(d):
    """Camera basis for a view direction d (from plant toward camera). Must match three/impostor.ts."""
    up = np.array([0.0, 1.0, 0.0])
    if d[1] > 0.999:
        y = np.array([0.0, 0.0, -1.0])
    else:
        y = up - d * np.dot(d, up)
        y /= np.linalg.norm(y)
    x = np.cross(y, d)
    return x, y


def setup_scene(size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = 40
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.max_bounces = 6
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 1
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 96
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    sc.render.film_transparent = True
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.use_persistent_data = True
    sc.render.threads_mode = "AUTO"
    sc.view_settings.view_transform = "Standard"
    vl = sc.view_layers[0]
    vl.use_pass_diffuse_color = True
    vl.use_pass_normal = True
    # uniform white sky: the combined pass / albedo becomes the plant's own ambient occlusion
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def compositor(sc, out_dir):
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new("CompositorNodeRLayers")
    fo = nt.nodes.new("CompositorNodeOutputFile")
    fo.base_path = out_dir
    fo.format.file_format = "OPEN_EXR"
    fo.format.color_depth = "16"
    fo.format.color_mode = "RGBA"
    fo.file_slots.clear()
    for name in ("image", "albedo", "normal"):
        fo.file_slots.new(f"{name}_")
    nt.links.new(rl.outputs["Image"], fo.inputs["image_"])
    nt.links.new(rl.outputs["DiffCol"], fo.inputs["albedo_"])
    nt.links.new(rl.outputs["Normal"], fo.inputs["normal_"])


def attach_alpha(asset):
    """Re-attach the foliage opacity maps the glTF export leaves out (see fetch.py)."""
    gltf = json.load(open(os.path.join(SRC, asset, f"{asset}.gltf")))
    alpha_mode = {m["name"]: m.get("alphaMode", "OPAQUE") for m in gltf.get("materials", [])}
    tex_dir = os.path.join(SRC, asset, "textures")
    maps = {}
    for f in os.listdir(tex_dir):
        if "_alpha_" in f:
            key = f[len(asset) + 1 :].split("_1k")[0]  # "alpha", "leaves_alpha", "twig_alpha"
            maps[key[: -len("alpha")].rstrip("_")] = os.path.join(tex_dir, f)
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        base = mat.name.split(".")[0]
        part = next((p for p in maps if p and p in base), None)
        if part is None:
            if alpha_mode.get(base, "OPAQUE") == "OPAQUE" or "" not in maps:
                continue
            part = ""
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(maps[part], check_existing=True)
        tex.image.colorspace_settings.name = "Non-Color"
        for link in list(bsdf.inputs["Alpha"].links):
            nt.links.remove(link)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Alpha"])
        print(f"  alpha: {mat.name} <- {os.path.basename(maps[part])}")


def world_vertices(objs):
    pts = []
    for o in objs:
        me = o.data
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(o.matrix_world)
        co = co @ M[:3, :3].T + M[:3, 3]
        pts.append(co)
    return np.concatenate(pts)


def bake(pid):
    asset, node, N, size = PLANTS[pid]
    out_dir = os.path.join(OUT, pid)
    meta_path = os.path.join(out_dir, "meta.json")
    if os.path.exists(meta_path):
        print(f"skip {pid} (done)")
        return
    os.makedirs(out_dir, exist_ok=True)
    sc, cam = setup_scene(size)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, asset, f"{asset}.gltf"))
    attach_alpha(asset)
    meshes = [o for o in sc.objects if o.type == "MESH"]
    keep = [o for o in meshes if node is None or o.name.startswith(node.replace("_LOD0", ""))]
    for o in meshes:
        o.hide_render = o not in keep
    # blender coords -> three coords for measuring
    vb = world_vertices(keep)
    v3 = np.stack([vb[:, 0], vb[:, 2], -vb[:, 1]], axis=1)
    base = np.array([ (v3[:, 0].min() + v3[:, 0].max()) / 2, v3[:, 1].min(), (v3[:, 2].min() + v3[:, 2].max()) / 2 ])
    height = float(v3[:, 1].max() - v3[:, 1].min())
    center = base + np.array([0, height / 2, 0])
    R = float(np.max(np.linalg.norm(v3 - center, axis=1))) * 1.02
    cam.data.ortho_scale = 2 * R
    cam.data.clip_start = 0.05
    cam.data.clip_end = 6 * R
    compositor(sc, out_dir)
    print(f"{pid}: height {height:.2f} m, radius {R:.2f} m, {N}x{N} views at {size}px", flush=True)
    k = 0
    for j in range(N):
        for i in range(N):
            qx = -1 + 2 * i / (N - 1)
            qy = -1 + 2 * j / (N - 1)
            d = hemi_oct_decode(qx, qy)
            x, y = frame_basis(d)
            pos = center + d * 3 * R
            # camera looks along -d; columns = (x, y, d) in blender space
            bx, by, bz = three_to_blender(x), three_to_blender(y), three_to_blender(d)
            rot = Matrix((bx, by, bz)).transposed()
            cam.matrix_world = Matrix.Translation(three_to_blender(pos)) @ rot.to_4x4()
            sc.frame_set(k)
            bpy.ops.render.render(write_still=False)
            k += 1
        print(f"  row {j + 1}/{N}", flush=True)
    meta = {"id": pid, "asset": asset, "node": node, "N": N, "size": size, "radius": R, "height": height, "center": [float(c) for c in center - base]}
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)


if __name__ == "__main__":
    ids = [a for a in sys.argv[1:] if not a.startswith("-")] or list(PLANTS)
    for pid in ids:
        bake(pid)
