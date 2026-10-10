// Render the PNG versions of every asset in public/brand/assets/manifest.json
// with headless Chromium, plus the site's og.png and apple-touch-icon.png.
//
//   node brand-src/render.mjs
//
// Needs playwright-core and a Playwright Chromium. Point PLAYWRIGHT_CORE at
// an install if it is not resolvable from here, for example
//   PLAYWRIGHT_CORE=~/Dev/kylnor.com/node_modules/playwright-core
// Runs headless; it never needs a display.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "public", "brand", "assets");
const manifest = JSON.parse(readFileSync(path.join(assets, "manifest.json"), "utf8"));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function shoot(svgFile, outFile, width, transparent) {
  const [, , vw, vh] = manifest.find((m) => `${m.name}.svg` === path.basename(svgFile)).vb;
  const height = Math.round((width * vh) / vw);
  await page.setViewportSize({ width, height });
  // An SVG document with a viewBox and no width or height fills the viewport.
  await page.goto(pathToFileURL(svgFile).href);
  await page.screenshot({ path: outFile, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
}

let count = 0;
for (const item of manifest) {
  if (!item.png) continue;
  const svg = path.join(assets, `${item.name}.svg`);
  for (const w of item.png) {
    const suffix = item.png.length > 1 ? `-${w}` : "";
    await shoot(svg, path.join(assets, `${item.name}${suffix}.png`), w, item.transparent);
    count++;
  }
}
await shoot(path.join(assets, "brandrune-og-template.svg"), path.join(root, "public", "og.png"), 1200, false);
await shoot(path.join(assets, "brandrune-github-avatar.svg"), path.join(root, "public", "apple-touch-icon.png"), 180, false);
await browser.close();
console.log(`rendered ${count} PNGs, og.png and apple-touch-icon.png`);
