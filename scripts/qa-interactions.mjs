// Drives real interactions on desktop and saves screenshots: node scripts/qa-interactions.mjs <outdir>
// Roof marking (a real tap on the roof), roof system, before/after on roof, kitchen and garden,
// the kitchen LED package, garden lighting, the steel explode, and the enquiry form.
// Exits 1 on a failed check or a console error.
import { createRequire } from "module";
import { mkdirSync } from "fs";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const out = process.argv[2] || ".";
mkdirSync(out, { recursive: true });
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// clicks wait for two stable animation frames; the software renderer draws one every few seconds
page.setDefaultTimeout(300000);
const logs = [];
const fails = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("pageerror " + e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, timeout: 600000 });
const wait = (ms) => page.waitForTimeout(ms);
const state = (f) => page.evaluate(f);
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const frames = async (n) => {
  const s = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((t) => (window.__frames || 0) >= t, s + n, { timeout: 900000, polling: 250 });
};

await page.goto(base + "/?quality=low&motion=reduced&debug", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => window.__store?.getState().phase === "intro", null, { timeout: 400000, polling: 500 });
// the loader fades out over the intro; wait until it no longer takes clicks
await page.waitForSelector(".loader", { state: "detached", timeout: 120000 }).catch(() => wait(4000));
// end states instead of transitions: the software renderer draws a frame every few seconds
await page.evaluate(() => { window.__settle = true; });

// Roofing: mark a problem by tapping the roof where it is on screen
await page.click(".tile:has-text('Roofing')");
await wait(2500);
await page.click(".inspect-btn");
await frames(2);
const roofAt = await page.evaluate(() => {
  const { camera, size } = window.__vb.get();
  const v = new window.__vb.THREE.Vector3(0, 6.85, 0).project(camera);
  return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
});
await page.mouse.click(roofAt.x, roofAt.y);
await wait(1500);
const pending = await page.locator(".pending").count();
check(pending > 0, `tap on the roof at ${Math.round(roofAt.x)},${Math.round(roofAt.y)} opens "What's wrong here?"`);
if (pending) {
  await page.click(".pending .chip:has-text('Leak')");
  await wait(800);
}
check((await state(() => window.__store.getState().roofing.flags.length)) === (pending ? 1 : 0), "the marked area is recorded");
await page.click(".chip:has-text('Standing-seam metal')");
await wait(800);
check((await state(() => window.__store.getState().roofing.material)) === "metal", "roof system: standing-seam metal");
await page.click(".compare-btn");
await frames(3);
await shot("q_roof_compare");
check(await state(() => window.__store.getState().compare), "roof before/after on");
await page.click(".compare-btn");

// Kitchen: fronts, worktop, the LED package, before/after
await page.click(".switcher__item:has-text('Remodel')");
await wait(2500);
await page.click(".swatch[aria-label*='Walnut']");
await page.click(".swatch[aria-label*='Black granite']");
const est0 = await page.locator(".estimate__value").first().textContent().catch(() => "");
await page.click(".toggle:has-text('Integrated LED lighting')");
await wait(500);
check((await state(() => window.__store.getState().remodeling.lighting)) === false, "LED package switches off");
const est1 = await page.locator(".estimate__value").first().textContent().catch(() => "");
check(est0 !== est1, `estimate follows the LED package (${est0?.trim()} → ${est1?.trim()})`);
await page.click(".toggle:has-text('Integrated LED lighting')");
await frames(3);
await shot("q_kitchen");
await page.click(".compare-btn");
await frames(3);
await shot("q_kitchen_compare");
await page.click(".compare-btn");

// Garden: evening lighting, before/after
await page.click(".switcher__item:has-text('Outdoor')");
await wait(2500);
await page.click(".toggle:has-text('Garden lighting')");
await frames(4);
await shot("q_garden_evening");
check(await state(() => window.__store.getState().landscaping.evening), "garden lighting on");
await page.click(".toggle:has-text('Garden lighting')");
await page.click(".compare-btn");
await frames(3);
await shot("q_garden_compare");
await page.click(".compare-btn");

// Steel: explode
await page.click(".switcher__item:has-text('Steel')");
await wait(2500);
await page.locator(".labelled-slider input").fill("0.8");
await frames(3);
await shot("q_steel_explode");
check((await state(() => window.__store.getState().steel.explode)) > 0.5, "steel explode slider");

// Enquiry form (no delivery channel configured locally: it must hand off, never fake success)
await page.click(".topbar__cta");
await wait(1200);
await page.fill(".lead input[autocomplete='name']", "Test Person");
await page.fill(".lead input[autocomplete='organization']", "Acme Roofing");
await page.fill(".lead input[autocomplete='email']", "test@example.com");
await page.click(".wants .chip >> nth=1");
await page.click(".lead button[type='submit']");
await wait(3000);
await shot("q_lead_result");
const handoff = await page.locator("a[href^='mailto:']").count();
check(handoff > 0, "enquiry without a delivery channel offers the email hand-off");

const errors = logs.filter((l) => !l.includes("ERR_CERT"));
check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
