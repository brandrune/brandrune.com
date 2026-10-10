// Static checks on the shipped files. The site CSP has no 'unsafe-inline',
// so an inline style or script would be silently blocked in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
// /sample/ is the skill's own results page; it ships with its own CSP.
const files = walk(pub).filter((p) => !p.startsWith(path.join(pub, "sample")));
const html = files.filter((p) => p.endsWith(".html"));
const svg = files.filter((p) => p.endsWith(".svg"));

test("site pages carry no inline styles or inline scripts", () => {
  assert.ok(html.length >= 3, "expected the home, brand and 404 pages");
  for (const f of html) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /\sstyle\s*=/i, `${f}: style attribute`);
    assert.doesNotMatch(s, /<style[\s>]/i, `${f}: <style> block`);
    for (const m of s.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = m[1];
      assert.ok(/\ssrc=/.test(attrs) || /type="application\/ld\+json"/.test(attrs), `${f}: inline <script${attrs}>`);
    }
  }
});

test("SVG assets need no inline styles or scripts either", () => {
  assert.ok(svg.length > 20, "expected the brand assets");
  for (const f of svg) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /<style[\s>]/i, `${f}: <style> block`);
    assert.doesNotMatch(s, /\sstyle\s*=/i, `${f}: style attribute`);
    assert.doesNotMatch(s, /<script/i, `${f}: script`);
  }
});

test("pages stay light: no dark-scheme switch anywhere", () => {
  for (const f of files.filter((p) => /\.(html|css)$/.test(p))) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /prefers-color-scheme/, f);
  }
});

test("every asset a page links to exists", () => {
  for (const f of html) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) {
      let rel = m[1];
      if (rel.endsWith("/")) rel += "index.html";
      const target = path.join(pub, rel);
      assert.ok(statSync(target, { throwIfNoEntry: false }), `${f} links to missing ${m[1]}`);
    }
  }
});

test("nothing shipped contains an em-dash", () => {
  for (const f of files.filter((p) => /\.(html|css|js|svg|xml|txt|json)$/.test(p))) {
    assert.equal(readFileSync(f, "utf8").includes(String.fromCharCode(0x2014)), false, f);
  }
});

// The home page replays demo-run/; every number and pick it prints as static
// text has to match the recorded data, so the copy cannot drift from the run.
test("the replay's static text matches the recorded run", () => {
  const run = JSON.parse(readFileSync(path.join(pub, "demo", "run.json"), "utf8"));
  const home = readFileSync(path.join(pub, "index.html"), "utf8");
  assert.equal(run.rows.length, 150);
  const order = ["open", "open*", "premium", "expiring", "parked", "reserved", "taken", "unknown"];
  run.tlds.forEach((t, i) => {
    const counts = {};
    for (const r of run.rows) {
      const word = r[3 + i][0] === "openstar" ? "open*" : r[3 + i][0];
      counts[word] = (counts[word] || 0) + 1;
    }
    const text = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(", ");
    assert.ok(home.includes(`id="tally-${t}">${text}</b>`), `.${t} tally should read "${text}"`);
  });
  const byName = Object.fromEntries(run.rows.map((r) => [r[0], r]));
  const pick = home.match(/class="ra-name">([a-z0-9-]+)</)[1];
  assert.equal(byName[pick][3][1], "open $11");
  assert.ok(home.includes(`.com ${byName[pick][3][1]}</span>`) && home.includes(`.ai ${byName[pick][4][1]}</span>`));
  const alts = home.match(/Also open on \.com:<\/span> ([^<]+)</)[1].split(", ");
  for (const a of alts) assert.equal(byName[a][3][0], "open", a);
  assert.ok(home.includes(`Done in ${run.seconds} seconds`));
  const unknownAi = run.rows.filter((r) => r[4][0] === "unknown").length;
  assert.ok(home.includes(`rate limited ${unknownAi} lookups`));
});

test("the home page loads nothing from another host", () => {
  const home = readFileSync(path.join(pub, "index.html"), "utf8");
  for (const m of home.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="(https?:)?\/\/[^"]*"/gi)) {
    assert.ok(/rel="canonical"/.test(m[0]), `external asset: ${m[0]}`);
  }
});

// The carved mark is for 32px and up; every 30px header and message-page logo
// uses the flat lockup (brand guide, minimum sizes).
test("small logos use the flat lockup", () => {
  const sources = [path.join(pub, "index.html"), path.join(pub, "confirmed", "index.html"), path.join(pub, "404.html"), path.join(root, "src", "worker.js")];
  for (const f of sources) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /brandrune-lockup\.svg"[^>]*height="30"/, `${f}: carved lockup at 30px`);
  }
});
