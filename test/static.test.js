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
