// Renders the share image from the real scene: node scripts/og/render.mjs
// 1) the dusk hero with the UI hidden, framed to the right of the copy  2) typography over it
// (scripts/og/template.html)  3) public/og.jpg. Dev server on BASE (default http://localhost:3000).
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require("/opt/node22/lib/node_modules/playwright");
}
const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(`${base}/?quality=high&motion=reduced&debug`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().sceneReady, null, { timeout: 300000, polling: 500 });
await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal,.loader{display:none!important}" });
// the copy block covers the left ~45%: frame the house in what is left
await page.evaluate(() => {
  window.__bare = true;
  window.__store.getState().setInsets({ top: 0, right: 0, bottom: 0, left: 520 });
});
const frames = async (n) => {
  const s = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, s + n, { timeout: 900000, polling: 250 });
};
await page.waitForTimeout(3000);
await frames(Number(process.env.FRAMES || 10));
await page.screenshot({ path: join(here, "scene.png"), timeout: 300000 });
await page.close();

writeFileSync(join(here, "og.html"), readFileSync(join(here, "template.html"), "utf8"));
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.goto("file://" + join(here, "og.html"));
await og.evaluate(() => document.fonts.ready);
await og.waitForTimeout(1500);
const out = join(here, "../../public/og.jpg");
await og.screenshot({ path: out, type: "jpeg", quality: 86 });
await browser.close();
console.log("wrote", out);
