// Packs the CC0 props (Poly Haven, downloaded by fetch.py) into small web GLBs:
// welded + lightly simplified geometry, meshopt compression, WebP textures at prop size.
//
//   node scripts/assets/build_models.mjs            (uses npx @gltf-transform/cli@4.5.0)
//
// Output: public/assets/models/<id>.glb + models.json (bytes, bounds, credit). Sources stay in
// .cache/assets-src/models (git-ignored); credits come from .cache/assets-src/credits.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SRC = join(ROOT, ".cache/assets-src/models");
const OUT = join(ROOT, "public/assets/models");
const CLI = ["--yes", "@gltf-transform/cli@4.5.0"];

/** id → source model, max texture size (px), simplify error (fraction of extent). */
const MODELS = {
  vase_a: { src: "ceramic_vase_01", tex: 512, error: 0.0008 },
  vase_b: { src: "ceramic_vase_03", tex: 512, error: 0.0008 },
  bowl: { src: "wooden_bowl_01", tex: 512, error: 0.001 },
  lemon: { src: "lemon", tex: 256, error: 0.002 },
  board: { src: "wooden_cutting_board", tex: 512, error: 0.001 },
  aloe: { src: "potted_plant_04", tex: 512, error: 0.0015 },
  pendant: { src: "modern_ceiling_lamp_01", tex: 512, error: 0.0005 },
  aircon: { src: "exterior_aircon_unit", tex: 1024, error: 0.0008 },
};

const credits = existsSync(join(ROOT, ".cache/assets-src/credits.json")) ? JSON.parse(readFileSync(join(ROOT, ".cache/assets-src/credits.json"), "utf8")) : {};
mkdirSync(OUT, { recursive: true });
const manifest = {};
const only = process.argv.slice(2);

for (const [id, m] of Object.entries(MODELS)) {
  if (only.length && !only.includes(id)) continue;
  const input = join(SRC, m.src, `${m.src}.gltf`);
  if (!existsSync(input)) {
    console.warn(`skip ${id}: ${input} missing (run fetch.py)`);
    continue;
  }
  const output = join(OUT, `${id}.glb`);
  execFileSync(
    "npx",
    [...CLI, "optimize", input, output, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", String(m.tex), "--simplify-error", String(m.error), "--palette", "false", "--instance", "false"],
    { stdio: "inherit" },
  );
  const credit = credits[m.src] ?? {};
  manifest[id] = { src: m.src, title: credit.title ?? m.src, authors: credit.authors ?? [], license: "CC0 1.0", source: credit.source ?? `https://polyhaven.com/a/${m.src}`, bytes: statSync(output).size };
  console.log(`${id}: ${(manifest[id].bytes / 1024).toFixed(0)} KB`);
}

const path = join(OUT, "models.json");
const prev = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
writeFileSync(path, JSON.stringify({ ...prev, ...manifest }, null, 2) + "\n");
