"""Download every source asset listed in sources.json into .cache/assets-src.

    python3 scripts/assets/fetch.py [--only name,name]

Poly Haven (api.polyhaven.com) and ambientCG (ambientcg.com) publish everything used
here under CC0 1.0. Author credits are recorded in .cache/assets-src/credits.json and
folded into ASSET_SOURCES.md.
"""
import concurrent.futures as cf
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, ".cache", "assets-src")
UA = {"User-Agent": "VelaBuilt-asset-fetch/1.0 (+https://velabuilt.com)"}


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print(f"  retry {url}: {e}")
            time.sleep(2 ** (i + 1))


def get_json(url):
    return json.loads(get(url))


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def ph_info(name):
    info = get_json(f"https://api.polyhaven.com/info/{name}")
    return {
        "source": f"https://polyhaven.com/a/{name}",
        "title": info.get("name", name),
        "authors": list(info.get("authors", {}).keys()),
        "license": "CC0 1.0",
    }


def fetch_ph_texture(name):
    out = os.path.join(SRC, "tex", name)
    files = get_json(f"https://api.polyhaven.com/files/{name}")
    wanted = {"Diffuse": "diff", "nor_gl": "nor", "arm": "arm"}
    for key, short in wanted.items():
        if key not in files:
            continue
        f = files[key]["2k"]["jpg"]
        path = os.path.join(out, f"{short}.jpg")
        if not os.path.exists(path):
            save(path, get(f["url"]))
    return ph_info(name)


def fetch_acg_texture(name):
    out = os.path.join(SRC, "tex", name)
    if not os.path.exists(os.path.join(out, "diff.jpg")):
        data = get(f"https://ambientcg.com/get?file={name}_2K-JPG.zip")
        z = zipfile.ZipFile(io.BytesIO(data))
        os.makedirs(out, exist_ok=True)
        rename = {"_Color.jpg": "diff.jpg", "_NormalGL.jpg": "nor.jpg", "_Roughness.jpg": "rough.jpg", "_AmbientOcclusion.jpg": "ao.jpg", "_Metalness.jpg": "metal.jpg", "_Displacement.jpg": "disp.jpg"}
        for zi in z.infolist():
            for suffix, target in rename.items():
                if zi.filename.endswith(suffix):
                    save(os.path.join(out, target), z.read(zi))
    return {"source": f"https://ambientcg.com/a/{name}", "title": name, "authors": ["Lennart Demes (ambientCG)"], "license": "CC0 1.0"}


def fetch_ph_model(name, res="1k"):
    out = os.path.join(SRC, "models", name)
    files = get_json(f"https://api.polyhaven.com/files/{name}")
    g = files["gltf"][res]["gltf"]
    gl_path = os.path.join(out, f"{name}.gltf")
    if not os.path.exists(gl_path):
        save(gl_path, get(g["url"]))
    for rel, inc in g.get("include", {}).items():
        p = os.path.join(out, rel)
        if not os.path.exists(p) or os.path.getsize(p) != inc["size"]:
            save(p, get(inc["url"]))
    # Poly Haven's glTF export ships JPEG colour maps; foliage opacity comes as separate
    # "Alpha" / "<part>_alpha" maps, which the bake and the web build re-attach.
    for key, v in files.items():
        if "alpha" in key.lower() and res in v:
            p = os.path.join(out, "textures", f"{name}_{key.lower()}_{res}.png")
            if not os.path.exists(p):
                save(p, get(v[res]["png"]["url"]))
    return ph_info(name)


def fetch_hdri(name):
    # build_env.py reads the 2k file
    path = os.path.join(SRC, "hdri", f"{name}_2k.hdr")
    if not os.path.exists(path):
        save(path, get(f"https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/{name}_2k.hdr"))
    return ph_info(name)


def main():
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    spec = json.load(open(os.path.join(os.path.dirname(__file__), "sources.json")))
    credits_path = os.path.join(SRC, "credits.json")
    credits = json.load(open(credits_path)) if os.path.exists(credits_path) else {}
    jobs = []
    for name in spec["hdris"]:
        jobs.append(("hdri", name, fetch_hdri, (name,)))
    for name in spec["polyhaven_textures"]:
        jobs.append(("texture", name, fetch_ph_texture, (name,)))
    for name in spec["ambientcg_textures"]:
        jobs.append(("texture", name, fetch_acg_texture, (name,)))
    for name, v in spec["polyhaven_models"].items():
        jobs.append(("model", name, fetch_ph_model, (name, v.get("res", "1k"))))
    for name, v in spec["polyhaven_trees"].items():
        jobs.append(("tree", name, fetch_ph_model, (name, v.get("res", "1k"))))
    if only:
        jobs = [j for j in jobs if j[1] in only]

    def run(job):
        kind, name, fn, args = job
        t = time.time()
        info = fn(*args)
        info["kind"] = kind
        print(f"ok {kind:8s} {name} ({time.time() - t:.0f}s)", flush=True)
        return name, info

    # ambientCG rate-limits bursts; keep concurrency modest
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for name, info in ex.map(run, jobs):
            credits[name] = info
    save(credits_path, json.dumps(credits, indent=2).encode())
    print(f"{len(credits)} assets recorded in {credits_path}")


if __name__ == "__main__":
    main()
