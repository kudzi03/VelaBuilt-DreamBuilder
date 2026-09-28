// Visual tour: one page load, every scenario, UI hidden or shown.
//   node scripts/tour.mjs <outDir> [width] [height] [views] [quality]
// views: comma list of hero,roofing,solar,remodeling,landscaping,evening,hvac,steel,flow,reveal
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { join } from "path";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const [, , out = "tour", w = "1440", h = "900", viewsArg = "hero,roofing,solar,remodeling,landscaping,evening,hvac,steel,reveal", quality = "high"] = process.argv;
mkdirSync(out, { recursive: true });
const ui = process.env.UI === "1";
const mobile = Number(w) < 700;
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: mobile ? Number(process.env.DPR || 2) : 1,
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const base = process.env.BASE || "http://localhost:3000";
const t0 = Date.now();
await page.goto(`${base}/?quality=${quality}&motion=reduced&debug${process.env.Q || ""}`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().sceneReady, null, { timeout: 600000, polling: 500 });
console.log(`sceneReady ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.evaluate(() => { window.__settle = true; });
if (!ui) await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal,.loader,.skip-link{display:none!important}" });
const frames = async (n) => {
  const s = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, s + n, { timeout: 900000, polling: 250 });
};
const views = viewsArg.split(",");
for (const v of views) {
  const t = Date.now();
  await page.evaluate(({ v, ui }) => {
    const s = window.__store.getState();
    window.__bare = !ui;
    if (v === "hero") { s.set({ industry: null }); s.setPhase("intro"); return; }
    if (v === "reveal") { s.setPhase("reveal"); return; }
    if (v === "flow") { s.setPhase("flow"); return; }
    if (v === "evening") { s.selectIndustry("landscaping"); s.patch("landscaping", { evening: true }); return; }
    if (v.endsWith("-before")) { s.selectIndustry(v.replace("-before", "")); s.setCompare(true); s.setSplit(0.5); return; }
    s.selectIndustry(v);
  }, { v, ui }).catch((e) => logs.push(`[eval ${v}] ${e.message.split("\n")[0]}`));
  if (!ui) await page.evaluate(() => window.__store.getState().setInsets({ top: 0, right: 0, bottom: 0, left: 0 }));
  await page.waitForTimeout(Number(process.env.WAIT || 2500));
  await frames(Number(process.env.FRAMES || 8));
  await page.screenshot({ path: join(out, `${v}.png`), timeout: 600000 });
  console.log(`${v} ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
console.log(logs.slice(0, 30).join("\n") || "no console errors");
await browser.close();
