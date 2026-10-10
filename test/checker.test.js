// The .com checker's pure parts, loaded from the shipped app.js in a sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadChecker() {
  const window = { matchMedia: () => ({ matches: false }) };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  vm.runInNewContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), { window, document, navigator: {} });
  return window.BrandruneCheck;
}
const { classifyRecord, normalize } = loadChecker();
const rec = (over = {}) => ({ objectClassName: "domain", ldhName: "PLANTZZZ.COM", status: ["active"], nameservers: [{ ldhName: "NS1.EXAMPLE.NET" }], events: [{ eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" }], ...over });

test("a normal record is taken, with its expiry", () => {
  const r = classifyRecord(rec(), "plantzzz.com");
  assert.equal(r.status, "taken");
  assert.equal(r.expires, "2030-01-01");
});

test("parked and expiring follow the script's lists", () => {
  assert.equal(classifyRecord(rec({ nameservers: [{ ldhName: "NS1.SEDOPARKING.COM" }] }), "plantzzz.com").status, "parked");
  assert.equal(classifyRecord(rec({ status: ["pending delete"] }), "plantzzz.com").status, "expiring");
});

test("a reply with the wrong shape is unknown instead of throwing", () => {
  for (const over of [{ status: "active" }, { nameservers: {} }, { events: "x" }, { status: null }]) {
    const r = classifyRecord(rec(over), "plantzzz.com");
    assert.equal(r.status, "unknown", JSON.stringify(over));
  }
  for (const doc of [null, "text", 7, [], rec({ ldhName: "OTHER.COM" }), rec({ objectClassName: "entity" })]) {
    assert.equal(classifyRecord(doc, "plantzzz.com").status, "unknown", JSON.stringify(doc));
  }
});

test("input is normalized to a .com label or refused", () => {
  assert.equal(normalize("https://www.Example.com/path?q=1").name, "example");
  for (const bad of ["", "foo.net", "café", "-foo", "ab--cd", "a".repeat(64), "foo_bar", "foo bar"]) assert.ok(normalize(bad).error, bad);
});
