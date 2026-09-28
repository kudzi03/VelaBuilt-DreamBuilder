// Runs axe-core against the main states of the demo: node scripts/qa-a11y.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(base + "/?quality=low&motion=reduced&debug", { waitUntil: "domcontentloaded", timeout: 180000 });
// the loader lifts once the arrival shot's textures are in
await page.waitForFunction(() => window.__store?.getState().phase === "intro", null, { timeout: 400000, polling: 500 });
await page.waitForTimeout(1500);
const audit = async (label) => {
  await page.addScriptTag({ path: axePath });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "best-practice"], resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, target: v.nodes.slice(0, 3).map((x) => x.target.join(" ")) }));
  });
  console.log(`\n== ${label}: ${res.length} violation types`);
  for (const v of res) console.log(` - [${v.impact}] ${v.id} (${v.n}) ${v.help} :: ${v.target.join(" | ")}`);
};
await audit("intro");
await page.click(".tile:has-text('Roofing')");
await page.waitForTimeout(3500);
await audit("explore/roofing");
await page.click(".panel__foot .btn--primary");
await page.waitForTimeout(1500);
await audit("qualify");
await page.click(".chip:has-text('In 1–3 months')");
await page.click(".chip:has-text('WhatsApp')");
await page.click(".panel__foot .btn--primary");
await page.waitForTimeout(6000);
await page.click(".bubble__slot >> nth=0").catch(() => {});
await page.waitForTimeout(5000);
await audit("flow");
await page.click(".flow__done .btn--primary").catch(() => {});
await page.waitForTimeout(4000);
await audit("reveal");
await page.click(".reveal .btn--gold");
await page.waitForTimeout(1500);
await audit("lead form");
await browser.close();
