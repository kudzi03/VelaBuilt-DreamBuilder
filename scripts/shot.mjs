// Screenshot harness: node scripts/shot.mjs <url-path> <out.png> [width] [height] [waitMs] [actions-json]
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const [, , path = "/", out = "shot.png", w = "1440", h = "900", wait = "9000", actions = "[]"] = process.argv;
const browser = await pw.chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const mobile = Number(w) < 700;
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
  userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined,
});
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const base = process.env.BASE || "http://localhost:3000";
await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(Number(wait));
for (const a of JSON.parse(actions)) {
  if (a.click) await page.click(a.click, { timeout: 15000 }).catch((e) => logs.push(`[action] ${e.message.split("\n")[0]}`));
  if (a.eval) await page.evaluate(a.eval).catch((e) => logs.push(`[eval] ${e.message.split("\n")[0]}`));
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.shot) await page.screenshot({ path: a.shot, timeout: 120000 });
  if (a.fill) await page.fill(a.fill[0], a.fill[1]).catch((e) => logs.push(`[fill] ${e.message.split("\n")[0]}`));
}
await page.screenshot({ path: out, timeout: 120000 });
console.log(logs.slice(0, 40).join("\n") || "no console errors");
await browser.close();
