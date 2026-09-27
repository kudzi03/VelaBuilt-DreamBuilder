// Renders public/previews/<industry>.webp — the stills on the intro's industry tiles —
// from the live scene with the UI hidden and the subject centred.
//   node scripts/og/previews.mjs [ids]      (dev server on BASE, default http://localhost:3000)
import { createRequire } from "module";
import { mkdirSync, writeFileSync } from "fs";
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
const out = join(here, "../../public/previews");
mkdirSync(out, { recursive: true });
const base = process.env.BASE || "http://localhost:3000";
const ids = (process.argv[2] || "remodeling,roofing,steel,solar,landscaping,hvac").split(",");
const W = 1280;
const H = 840;

const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${base}/?quality=high&motion=reduced&debug`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().sceneReady, null, { timeout: 300000, polling: 500 });
await page.addStyleTag({ content: ".topbar,.panel,.intro,.hint,.compare,.switcher,.flow,.reveal,.loader,.callout,.tag3d,.pin{display:none!important}" });
const frames = async (n) => {
  const s = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, s + n, { timeout: 900000, polling: 250 });
};

for (const id of ids) {
  await page.evaluate((id) => {
    window.__bare = true;
    const s = window.__store.getState();
    s.selectIndustry(id);
    s.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
  }, id);
  await page.waitForTimeout(3000);
  await frames(Number(process.env.FRAMES || 10));
  const png = await page.screenshot({ type: "png", timeout: 300000 });
  // downsample and encode WebP in the page: no image tooling needed on the machine
  const b64 = await page.evaluate(
    async ({ data, w, h }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, w, h);
      const blob = await c.convertToBlob({ type: "image/webp", quality: 0.8 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    },
    { data: png.toString("base64"), w: W / 2, h: H / 2 },
  );
  writeFileSync(join(out, `${id}.webp`), Buffer.from(b64, "base64"));
  console.log(`${id}: ${Math.round((b64.length * 0.75) / 1024)} KB`);
}
await browser.close();
