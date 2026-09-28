// Checks every camera move between shots against the real scene: the flight the rig plans
// (window.__flight, debug builds) is raycast against the visible solid meshes and tested
// against the tree crowns. Exits 1 if any move passes through a wall or a crown.
//   node scripts/qa-camera-paths.mjs [w] [h] ["hero>remodeling,remodeling>roofing"]
// Dev server on BASE (default http://localhost:3000). Rendering is paused: no frames needed.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require("/opt/node22/lib/node_modules/playwright");
}
const [, , w = "1440", h = "900", only = ""] = process.argv;
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/?quality=low&debug`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().phase === "intro", null, { timeout: 400000, polling: 500 });
await page.waitForTimeout(4000); // scenario layers mount after the reveal
await page.evaluate(() => window.__vb.get().setFrameloop("never"));

const IND = ["remodeling", "roofing", "steel", "solar", "landscaping", "hvac"];
let pairs = [];
if (only) pairs = only.split(",").map((p) => p.split(">"));
else {
  for (const b of IND) pairs.push(["hero", b]);
  for (const a of IND) for (const b of IND) if (a !== b) pairs.push([a, b]);
  pairs.push(["hvac", "hvacOutdoor"], ["hvacOutdoor", "hvac"], ["hvacOutdoor", "remodeling"]);
  for (const a of IND) pairs.push([a, "reveal"]);
}

// put the app into the state that selects a shot
const go = async (key, instant) => {
  await page.evaluate(
    async ({ key, instant }) => {
      const s = window.__store.getState();
      s.set({ reducedMotion: instant });
      await new Promise((r) => setTimeout(r, 60));
      if (key === "hero") s.set({ phase: "intro", industry: null });
      else if (key === "reveal") s.set({ phase: "reveal" });
      else if (key === "hvacOutdoor") {
        if (s.industry !== "hvac") s.selectIndustry("hvac");
        s.patch("hvac", { issue: "cooling" });
      } else {
        if (s.phase !== "explore") s.set({ phase: "explore" });
        s.selectIndustry(key);
        if (key === "hvac") s.patch("hvac", { issue: "uneven" });
      }
    },
    { key, instant },
  );
  await page.waitForTimeout(instant ? 350 : 150);
};

let failed = 0;
for (const [a, b] of pairs) {
  await go(a, true);
  await page.evaluate(() => {
    window.__flight = null;
  });
  await go(b, false);
  await page.waitForFunction(() => window.__flight, null, { timeout: 8000, polling: 100 }).catch(() => {});
  const r = await page.evaluate(() => {
    const { scene, THREE } = window.__vb;
    if (!window.__flight) return null;
    const pts = window.__flight.points.map((p) => new THREE.Vector3(...p));
    const shown = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    // walls: every visible opaque mesh except ground, sky, water and plants (glass is transparent)
    const solids = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !shown(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.transparent || m.depthWrite === false) return;
      if (/sky|dome|ground|lawn|meadow|terrain|plants|water/i.test(`${o.name} ${o.parent?.name ?? ""} ${m.name}`)) return;
      solids.push(o);
    });
    const ray = new THREE.Raycaster();
    const walls = [];
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].clone().sub(pts[i - 1]);
      const len = d.length();
      if (len < 1e-5) continue;
      ray.set(pts[i - 1], d.normalize());
      ray.far = len + 0.25; // a near plane's worth of margin
      const hit = ray.intersectObjects(solids, false)[0];
      if (hit) walls.push(`${hit.object.name || hit.object.parent?.name || hit.object.type} at ${hit.point.toArray().map((v) => v.toFixed(1))}`);
    }
    // crowns: upright ellipsoids (the same model as three/flight.ts) at 90% size
    const shape = (id) => (id.startsWith("fir") ? [0.24, 0.04] : id === "jacaranda" ? [0.4, 0.3] : id === "island" ? [0.48, 0.2] : [0.5, 0]);
    const crowns = [];
    const m4 = new THREE.Matrix4();
    const tp = new THREE.Vector3();
    const tq = new THREE.Quaternion();
    const ts = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.name.startsWith("plants:") || !shown(o)) return;
      const id = o.name.slice(7);
      const [kh, k0] = shape(id);
      const bs = o.geometry.boundingSphere;
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m4);
        m4.decompose(tp, tq, ts);
        const H = 2 * bs.center.y * ts.x;
        if (H < 1.2) continue;
        const b0 = k0 * H;
        crowns.push({ id, c: new THREE.Vector3(tp.x, tp.y + (b0 + H) / 2, tp.z), rh: kh * H * 0.9, rv: ((H - b0) / 2) * 0.9 });
      }
    });
    const trees = [];
    for (const t of crowns) {
      // the shot's own standpoint may sit beside foliage (out of frame): only the air between counts
      const inside = pts.slice(3, -3).some((p) => ((p.x - t.c.x) ** 2 + (p.z - t.c.z) ** 2) / t.rh ** 2 + (p.y - t.c.y) ** 2 / t.rv ** 2 < 1);
      if (inside) trees.push(`${t.id} at (${t.c.x.toFixed(1)}, ${t.c.z.toFixed(1)})`);
    }
    return { walls: walls.slice(0, 4), nWalls: walls.length, trees, length: window.__flight.length, dur: window.__flight.dur };
  });
  if (!r) {
    console.log(`${a} > ${b}: no flight planned`);
    failed++;
    continue;
  }
  const bad = r.nWalls > 0 || r.trees.length > 0;
  if (bad) failed++;
  console.log(`${bad ? "FAIL" : "ok  "} ${a} > ${b}: ${r.length.toFixed(1)} m in ${r.dur.toFixed(2)} s`);
  for (const x of r.walls) console.log(`       wall ${x}`);
  for (const x of r.trees) console.log(`       crown ${x}`);
}
if (errors.length) console.log(errors.join("\n"));
console.log(failed ? `${failed} of ${pairs.length} moves collide` : `all ${pairs.length} moves clear`);
await browser.close();
process.exit(failed ? 1 : 0);
