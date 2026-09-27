// Renders public/poster.jpg: a clean hero frame used when WebGL is unavailable.
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(base + "/?quality=high&motion=reduced&debug=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(16000);
await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal,.loader{display:none!important}" });
await page.evaluate(() => {
  const c = window.__vb.get().controls;
  c.minDistance = 0; c.maxDistance = 1e4; c.minPolarAngle = 0; c.maxPolarAngle = Math.PI; c.minAzimuthAngle = -Infinity; c.maxAzimuthAngle = Infinity;
  c.setFocalOffset(0, 0, 0, false);
  c.setLookAt(20, 9.5, 25.5, 0.6, 3.1, -3.4, false);
});
await page.waitForTimeout(8000);
await page.screenshot({ path: join(here, "poster.png"), timeout: 180000 });
await browser.close();
console.log("poster rendered");
