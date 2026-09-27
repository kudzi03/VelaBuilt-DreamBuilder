// Renders public/poster.jpg: the dusk hero shown behind the intro when WebGL is unavailable.
// The camera keeps the live intro framing (house clear of the copy and the filmstrip); only the
// UI is hidden. Dev server on BASE (default http://localhost:3000).
import { createRequire } from "module";
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`${base}/?quality=high&motion=reduced&debug`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().sceneReady, null, { timeout: 300000, polling: 500 });
const frames = async (n) => {
  const s = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, s + n, { timeout: 900000, polling: 250 });
};
await page.waitForTimeout(3000);
await frames(Number(process.env.FRAMES || 10));
await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal,.loader{visibility:hidden!important}" });
await frames(2);
const out = join(here, "../../public/poster.jpg");
await page.screenshot({ path: out, type: "jpeg", quality: 82, timeout: 300000 });
await browser.close();
console.log("wrote", out);
