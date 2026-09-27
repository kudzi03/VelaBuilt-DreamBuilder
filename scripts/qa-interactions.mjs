// Drives real interactions on desktop and saves screenshots: node scripts/qa-interactions.mjs <outdir>
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const out = process.argv[2] || ".";
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("pageerror " + e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, timeout: 120000 });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(base + "/?quality=low&motion=reduced", { waitUntil: "domcontentloaded" });
await wait(12000);

// Roofing: mark a problem by tapping the roof
await page.click(".card:has-text('Roofing')");
await wait(5000);
await page.click(".inspect-btn");
await wait(1200);
await page.mouse.click(430, 430);
await wait(2500);
await shot("q_roof_pending");
const pending = await page.locator(".pending").count();
if (pending) {
  await page.click(".pending .chip:has-text('Leak')");
  await wait(1500);
}
await page.click(".chip:has-text('Architectural shingle')");
await wait(2500);
await page.click(".compare-btn");
await wait(3500);
await shot("q_roof_compare");
await page.click(".compare-btn");

// Remodel compare
await page.click(".switcher__item:has-text('Remodel')");
await wait(6000);
await page.click(".swatch[aria-label*='Walnut']");
await page.click(".swatch[aria-label*='Black granite']");
await wait(1500);
await page.click(".compare-btn");
await wait(4000);
await shot("q_kitchen_compare");
await page.click(".compare-btn");

// Garden evening + compare
await page.click(".switcher__item:has-text('Outdoor')");
await wait(6000);
await page.click(".toggle:has-text('Garden lighting')");
await wait(9000);
await shot("q_garden_evening");
await page.click(".toggle:has-text('Garden lighting')");
await wait(4000);
await page.click(".compare-btn");
await wait(4000);
await shot("q_garden_compare");
await page.click(".compare-btn");

// Steel: explode + inspect
await page.click(".switcher__item:has-text('Steel')");
await wait(14000);
await page.locator(".labelled-slider input").fill("0.8");
await wait(4000);
await shot("q_steel_explode");

// Lead form
await page.click(".topbar__cta");
await wait(1200);
await page.fill(".lead input[autocomplete='name']", "Test Person");
await page.fill(".lead input[autocomplete='organization']", "Acme Roofing");
await page.fill(".lead input[autocomplete='email']", "test@example.com");
await page.click(".wants .chip >> nth=1");
await page.click(".lead button[type='submit']");
await wait(3000);
await shot("q_lead_result");
console.log("flags:", pending, "errors:", logs.filter((l) => !l.includes("ERR_CERT")).join(" | ") || "none");
await browser.close();
