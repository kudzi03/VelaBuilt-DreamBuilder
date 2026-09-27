// Renders the share image from the real scene: node scripts/og/render.mjs
// 1) screenshot the 3D scene (roof before/after) without UI  2) composite typography  3) write public/og.jpg
import { createRequire } from "module";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

const SPLIT = 0.6; // divider position across the frame (middle of the front roof slope)
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(base + "/?quality=high&motion=reduced&debug=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(16000);
await page.click(".card:has-text('Roofing')");
await page.waitForTimeout(6000);
await page.evaluate((split) => {
  const store = window.__store;
  store.getState().patch("roofing", { material: "metal", color: "matte-black" });
  store.getState().set({ compare: true, split });
  const s = window.__vb.get();
  const c = s.controls;
  c.minDistance = 0; c.maxDistance = 1e4; c.minPolarAngle = 0; c.maxPolarAngle = Math.PI; c.minAzimuthAngle = -Infinity; c.maxAzimuthAngle = Infinity;
  c.smoothTime = 0;
  c.setFocalOffset(-6.2, 0.4, 0, false);
  c.setLookAt(19.5, 12.5, 23, 0.2, 4.0, -3.6, false);
}, SPLIT);
await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal{display:none!important}" });
await page.waitForTimeout(9000);
await page.screenshot({ path: join(here, "scene.png"), timeout: 180000 });
await page.close();

const tpl = readFileSync(join(here, "template.html"), "utf8").replaceAll("SPLIT_Xpx", `${Math.round(1200 * SPLIT)}px`).replace("SPLIT_Lpx", `${Math.round(1200 * SPLIT - 96)}px`).replace("SPLIT_Rpx", `${Math.round(1200 * SPLIT + 12)}px`);
writeFileSync(join(here, "og.html"), tpl);
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.goto("file://" + join(here, "og.html"));
await og.waitForTimeout(2500);
await og.screenshot({ path: join(here, "og.png") });
await browser.close();
console.log("wrote", join(here, "og.png"));
