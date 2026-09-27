// Rapid switching + full loops, reporting console errors: node scripts/qa-stress.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const base = process.env.BASE || "http://localhost:3000";
const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("ERR_CERT")) errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
const phase = () => page.locator("main").getAttribute("data-phase");
const step = async (label, fn) => {
  try { await fn(); } catch (e) { errors.push(`${label}: ${e.message.split("\n")[0]}`); }
};
await page.goto(base + "/?quality=low&company=Kingson%20Engineering", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12000);
console.log("prepared-for line:", await page.locator(".intro__eyebrow").textContent().catch(() => "missing"));
await step("pick", () => page.click(".card:has-text('Roofing')"));
await page.waitForTimeout(800);
for (const n of ["Steel", "Solar", "Remodel", "Outdoor", "HVAC", "Roofing", "Steel", "Remodel", "HVAC", "Solar"]) {
  await step("switch " + n, () => page.click(`.switcher__item:has-text('${n}')`, { timeout: 5000 }));
  await page.waitForTimeout(250);
}
await page.waitForTimeout(3000);
console.log("after rapid switching:", await phase(), "| active:", await page.locator(".switcher__item[aria-current='true']").textContent());
// toggles spam
await step("compare spam", async () => {
  await page.click(".switcher__item:has-text('Outdoor')");
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) { await page.click(".compare-btn"); await page.waitForTimeout(150); }
  await page.click(".toggle:has-text('Garden lighting')");
  await page.click(".toggle:has-text('Pool')");
  await page.click(".toggle:has-text('Pool')");
  await page.click(".chip:has-text('Clean & minimal')");
});
await page.waitForTimeout(2000);
// full flow with personalised company name
await step("flow", async () => {
  await page.click(".switcher__item:has-text('Steel')");
  await page.waitForTimeout(1500);
  await page.setInputFiles("#drawings", { name: "warehouse-GA.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 demo") });
  await page.waitForTimeout(500);
  await page.click(".panel__foot .btn--primary");
  await page.waitForTimeout(800);
  await page.click(".chip:has-text('As soon as possible')");
  await page.click(".chip:has-text('Email')");
  await page.click(".panel__foot .btn--primary");
  await page.waitForTimeout(3000);
  await page.click(".flow__skip");
  await page.waitForTimeout(2500);
});
const msg = await page.locator(".bubble--out p").first().textContent().catch(() => "");
console.log("follow-up mentions company:", msg.includes("Kingson Engineering"), "| drawings in spec:", (await page.locator(".fl-spec").textContent().catch(() => "")).includes("warehouse-GA.pdf"));
await step("replay", () => page.click(".flow__again .link >> nth=0"));
await page.waitForTimeout(2500);
await step("back to demo", () => page.click(".flow__skip"));
await page.waitForTimeout(2000);
await step("reveal", () => page.click(".flow__done .btn--primary"));
await page.waitForTimeout(2500);
console.log("phase:", await phase());
await step("how", async () => { await page.click(".reveal .btn--secondary"); await page.waitForTimeout(800); await page.keyboard.press("Escape"); });
await step("share", async () => { await page.click(".reveal__links button:has-text('Send to a business owner')"); await page.waitForTimeout(800); await page.keyboard.press("Escape"); });
await step("another", () => page.click(".reveal__links button:has-text('Try another business')"));
await page.waitForTimeout(1500);
console.log("after 'try another':", await phase());
await step("second pick", () => page.click(".card:has-text('HVAC')"));
await page.waitForTimeout(2500);
console.log("final phase:", await phase());
console.log("errors:", errors.length ? "\n  " + errors.join("\n  ") : "none");
await browser.close();
