// Find the object that blanks a view: hide each top-level scene child in turn and measure.
//   node scripts/qa-bisect.mjs <industry> [w] [h] [quality]
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const [, , ind = "landscaping", w = "480", h = "300", quality = "high"] = process.argv;
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const base = process.env.BASE || "http://localhost:3000";
await page.goto(`${base}/?quality=${quality}&motion=reduced&debug`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().sceneReady, null, { timeout: 600000, polling: 500 });
await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal,.loader,.skip-link,.callout{display:none!important}" });
await page.evaluate((ind) => { window.__settle = true; window.__bare = true; window.__store.getState().selectIndustry(ind); window.__store.getState().setInsets({ top: 0, right: 0, bottom: 0, left: 0 }); }, ind);
const frames = async (n) => {
  const s = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, s + n, { timeout: 900000, polling: 250 });
};
const measure = async () => {
  await frames(2);
  const buf = await page.screenshot({ type: "png", timeout: 600000 });
  return await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data; let s = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; if (l > 240) white++; }
    return { mean: +(s / (d.length / 4)).toFixed(1), white: +(white / (d.length / 4)).toFixed(3) };
  }, buf.toString("base64"));
};
await page.waitForTimeout(2000);
console.log("baseline", JSON.stringify(await measure()));
const names = await page.evaluate(() => window.__vb.scene.children.map((c, i) => `${i}:${c.type}:${c.name}`));
console.log(names.join(" | "));
const deep = process.env.DEEP; // "3" → bisect inside child 3
const list = deep ? await page.evaluate((d) => window.__vb.scene.children[Number(d)].children.map((c, i) => `${i}:${c.type}:${c.name}`), deep) : names;
if (deep) console.log("inside", deep, list.join(" | "));
for (let i = 0; i < list.length; i++) {
  await page.evaluate(({ i, deep }) => { const p = deep ? window.__vb.scene.children[Number(deep)] : window.__vb.scene; window.__hid = p.children[i]; window.__hidVis = window.__hid.visible; window.__hid.visible = false; }, { i, deep });
  const m = await measure();
  console.log(`hide ${list[i]} →`, JSON.stringify(m));
  await page.evaluate(() => { window.__hid.visible = window.__hidVis; });
}
if (process.env.NOPOST) {
  await page.evaluate(() => window.__store.getState().set({ tier: "low" }));
  console.log("low tier", JSON.stringify(await measure()));
}
await browser.close();
