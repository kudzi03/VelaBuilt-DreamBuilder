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
// capture end states, not transitions (the software renderer draws a frame every few seconds)
await page.evaluate(() => { window.__settle = true; });
// the app's own font faces (next/font, self-hosted): the headless browser can't reach Google Fonts
// (their urls are relative to the stylesheet: made absolute so they resolve from another page)
const faces = await page.evaluate(() =>
  Array.from(document.styleSheets)
    .flatMap((s) => {
      try {
        return Array.from(s.cssRules).map((r) => [r, s.href || location.href]);
      } catch {
        return [];
      }
    })
    .filter(([r]) => r.constructor.name === "CSSFontFaceRule")
    .map(([r, href]) => r.cssText.replace(/url\("([^"]+)"\)/g, (_, u) => `url("${new URL(u, href).href}")`))
    .join("\n"),
);
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

const scene = readFileSync(join(here, "scene.png")).toString("base64");
const html = readFileSync(join(here, "template.html"), "utf8")
  .replace('url("scene.png")', `url("data:image/png;base64,${scene}")`)
  .replace("</head>", `<style>${faces}</style>\n</head>`);
writeFileSync(join(here, "og.html"), html);
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// same origin as the dev server, so the font files resolve
await og.goto(`${base}/robots.txt`);
await og.setContent(html, { waitUntil: "load" });
await og.evaluate(() => document.fonts.ready);
const missing = await og.evaluate(() => ["Instrument Serif", "Archivo", "Geist Mono"].filter((f) => !document.fonts.check(`16px "${f}"`)));
if (missing.length) console.warn("fonts not loaded:", missing.join(", "));
await og.waitForTimeout(1500);
const out = join(here, "../../public/og.jpg");
await og.screenshot({ path: out, type: "jpeg", quality: 86 });
await browser.close();
console.log("wrote", out);
