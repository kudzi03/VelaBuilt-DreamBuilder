// Real-time 3D trees, stage 2 of 2 (stage 1: scripts/assets/build_trees.py).
//   node scripts/assets/build_trees.mjs [ids]
// From .cache/trees/<id>/: simplifies the bark (<id>.gltf, meshes lod0 / lod1) with meshopt to a
// triangle budget and writes public/assets/trees/<id>.glb (WebP textures at 256 px, meshopt
// geometry); re-encodes each leaf picture as WebP at 1024 and 512 px (<id>_<material>_<px>.webp);
// copies the compact leaf cards (cards.bin, expanded to geometry in the browser) and writes the
// layout into trees.json. Uses glTF Transform, sharp and meshoptimizer (fetched by
// `npx @gltf-transform/cli@4.5.0`; resolved from the npx cache if not installed locally).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SRC = join(ROOT, ".cache/trees");
const OUT = join(ROOT, "public/assets/trees");

/** bark triangle budget per tree */
const BARK = { jacaranda: 16000, island: 7000, fir_a: 3500, fir_b: 3000, fir_c: 2500, searsia_a: 2400, searsia_b: 2200, searsia_c: 2000, searsia_d: 2000 };

function req(name) {
  const tries = [createRequire(import.meta.url)];
  const npx = join(homedir(), ".npm/_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) tries.push(createRequire(join(npx, d, "node_modules", "_.js")));
  for (const r of tries) {
    try {
      return r(name);
    } catch {
      /* next */
    }
  }
  throw new Error(`${name} not found: run \`npx --yes @gltf-transform/cli@4.5.0 --version\` once to fetch it`);
}

const { NodeIO } = req("@gltf-transform/core");
const { ALL_EXTENSIONS } = req("@gltf-transform/extensions");
const F = req("@gltf-transform/functions");
const { MeshoptSimplifier, MeshoptEncoder } = req("meshoptimizer");
const sharp = req("sharp");
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

/** Topology-free simplification to a triangle count (small parts may vanish, which is the point). */
function sloppy(prim, goal) {
  const pos = prim.getAttribute("POSITION").getArray();
  const idx = new Uint32Array(prim.getIndices().getArray());
  const [out] = MeshoptSimplifier.simplifySloppy(idx, Float32Array.from(pos), 3, null, goal * 3, 0.05);
  prim.getIndices().setArray(pos.length / 3 < 65536 ? Uint16Array.from(out) : out);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "trees.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(SRC).filter((d) => existsSync(join(SRC, d, `${d}.gltf`)));

const pictures = {};
const written = new Set();
for (const id of ids) {
  const src = join(SRC, id, `${id}.gltf`);
  const doc = await io.read(src);
  const extras = JSON.parse(readFileSync(src, "utf8")).extras ?? {};
  await doc.transform(F.weld());
  const isLeaf = () => false; // leaves travel as compact cards, not in the GLB
  const tris = (p) => (p.getIndices()?.getCount() ?? 0) / 3;
  // two meshes: lod0 (near) and lod1 (mid distance, 30% of the bark budget)
  for (const mesh of doc.getRoot().listMeshes()) {
    const budget = (BARK[id] ?? 4000) * (mesh.getName() === "lod1" ? 0.3 : 1);
    const prims = mesh.listPrimitives();
    const barkTotal = prims.filter((p) => !isLeaf(p)).reduce((a, p) => a + tris(p), 0);
    for (const p of prims) {
      if (isLeaf(p) || !barkTotal) continue;
      const goal = Math.round(budget * (tris(p) / barkTotal));
      const ratio = Math.min(1, goal / tris(p));
      if (ratio < 0.98) F.simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false });
      // thin limbs stop collapsing long before the budget: finish those with the sloppy simplifier
      if (ratio < 0.98 && tris(p) > goal * 1.3) sloppy(p, goal);
    }
  }
  await doc.transform(
    // bark is seen from ten metres and more: 256 px is plenty
    F.textureCompress({ encoder: sharp, targetFormat: "webp", resize: [256, 256], quality: 80 }),
    F.prune(),
    F.dedup(),
    F.meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const out = join(OUT, `${id}.glb`);
  await io.write(out, doc);
  const count = (name) =>
    doc
      .getRoot()
      .listMeshes()
      .filter((m) => m.getName() === name)
      .flatMap((m) => m.listPrimitives())
      .reduce((a, p) => a + tris(p), 0);
  let bytes = statSync(out).size;
  // leaf cards and their pictures
  let cards = null;
  const cardsJson = join(SRC, id, "cards.json");
  if (existsSync(cardsJson)) {
    cards = JSON.parse(readFileSync(cardsJson, "utf8"));
    copyFileSync(join(SRC, id, "cards.bin"), join(OUT, `${id}.cards.bin`));
    bytes += statSync(join(OUT, `${id}.cards.bin`)).size;
    for (const m of cards.materials) {
      // one file per distinct picture: the fir and searsia variants share their foliage
      const png = readFileSync(join(SRC, id, m.texture));
      const hash = createHash("sha1").update(png).digest("hex");
      const stem = (pictures[hash] ??= m.name.replace(/[^a-z0-9]+/gi, "_"));
      for (const px of [1024, 512]) {
        const file = join(OUT, `${stem}_${px}.webp`);
        if (!existsSync(file) || !written.has(file)) await sharp(png).resize(px, px).webp({ quality: 82, alphaQuality: 90 }).toFile(file);
        written.add(file);
        if (px === 1024) bytes += statSync(file).size;
      }
      m.texture = stem;
    }
  }
  const cardCount = (lod) => (cards ? cards[lod].reduce((a, [, n]) => a + n, 0) : 0);
  const triangles = { lod0: { leaves: cardCount("lod0") * 2, bark: count("lod0") }, lod1: { leaves: cardCount("lod1") * 2, bark: count("lod1") } };
  manifest[id] = { height: extras.height, center: extras.center, source: extras.source, triangles, bytes, cards };
  console.log(`${id}: LOD0 ${triangles.lod0.leaves}+${triangles.lod0.bark}, LOD1 ${triangles.lod1.leaves}+${triangles.lod1.bark} triangles, ${Math.round(bytes / 1024)} KB`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
