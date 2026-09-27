// Rasterises public/icon.svg into PNG app icons.
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const svg = readFileSync("public/icon.svg", "utf8").replace('rx="18"', 'rx="0"');
const browser = await pw.chromium.launch();
for (const [size, file] of [[180, "public/apple-icon.png"], [192, "public/icon-192.png"], [512, "public/icon-512.png"]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#050506">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file });
  await page.close();
}
await browser.close();
console.log("icons written");
