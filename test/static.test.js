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
const unescapeHtml = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

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
    const text = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(", ") + ` (${run.rows.length} of ${run.rows.length})`;
    assert.ok(home.includes(`id="tally-${t}">${text}</span>`), `.${t} tally should read "${text}"`);
    assert.ok(home.includes(`data-size="${text}"`), `.${t} sizer should read "${text}"`);
  });
  const byName = Object.fromEntries(run.rows.map((r) => [r[0], r]));
  const pick = home.match(/class="ra-name">([a-z0-9-]+)</)[1];
  assert.equal(byName[pick][3][1], "open $11");
  assert.ok(home.includes(`.com ${byName[pick][3][1]}</span>`) && home.includes(`.ai ${byName[pick][4][1]}</span>`));
  const alts = home.match(/Also open on \.com:<\/span> ([^<]+)</)[1].split(", ");
  for (const a of alts) assert.equal(byName[a][3][0], "open", a);
  assert.ok(home.includes(`The run took ${Math.round(run.seconds)} seconds`));
  const unknownAi = run.rows.filter((r) => r[4][0] === "unknown").length;
  assert.ok(home.includes(`rate limited ${unknownAi} lookups`));
});

test("every terminal line marked as script output is a line the script printed", () => {
  const home = readFileSync(path.join(pub, "index.html"), "utf8");
  const printed = new Set([
    ...readFileSync(path.join(root, "demo-run", "check-stdout.txt"), "utf8").split("\n"),
    ...readFileSync(path.join(root, "demo-run", "check-stderr.txt"), "utf8").split("\n"),
  ]);
  const real = [...home.matchAll(/<p class="t-line t-real[^"]*"[^>]*>([^<]*)<\/p>/g)].map((m) => unescapeHtml(m[1]));
  assert.ok(real.length >= 6, `expected the script's lines, found ${real.length}`);
  assert.ok(!real.some((l) => /^name\s+len\s+style/.test(l)), "no table header without the table");
  for (const line of real) assert.ok(printed.has(line), `not a printed line: ${JSON.stringify(line)}`);
  assert.ok(real.includes(".com across all 150: 16 open, 105 taken, 29 parked"));
});

test("the site does not claim Codex support the shipped skill does not have", () => {
  for (const f of files.filter((p) => /\.(html|js)$/.test(p))) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /codex/i, f);
  }
  assert.doesNotMatch(readFileSync(path.join(root, "src", "worker.js"), "utf8"), /codex/i);
});

test("the FAQ does not say two-part extensions come back unknown", () => {
  const home = readFileSync(path.join(pub, "index.html"), "utf8");
  assert.doesNotMatch(home, /\.co\.uk, come back/);
  assert.match(home, /\.co\.uk are refused/);
});

test("the status tree's open* leaf covers a missing price, not only a missing token", () => {
  const home = readFileSync(path.join(pub, "index.html"), "utf8");
  assert.match(home, /no token, or no price came back<\/span> <span class="chip openstar">open\*<\/span>/);
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

// The signup fails closed without its caps, so production config must bind them.
test("production config binds every send cap", () => {
  const cfg = JSON.parse(readFileSync(path.join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const limits = Object.fromEntries(cfg.ratelimits.map((r) => [r.name, r.simple]));
  for (const name of ["SUBSCRIBE_LIMITER", "CONFIRM_EMAIL_LIMITER", "GLOBAL_SEND_LIMITER"]) assert.ok(limits[name], name);
  assert.ok(cfg.kv_namespaces.some((k) => k.binding === "CONFIRM_COOLDOWN" && /^[0-9a-f]{32}$/.test(k.id)));
  assert.equal(cfg.vars.RESEND_AUDIENCE_ID, "c609e317-d11a-43a2-91e1-3709bd6d6b32");
  assert.equal(new Set(cfg.ratelimits.map((r) => r.namespace_id)).size, cfg.ratelimits.length, "limiter namespaces are distinct");
});
