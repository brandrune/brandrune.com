import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { validEmail } from "../src/worker.js";

const AUDIENCE = "aud-123";

function makeEnv({ limited = false } = {}) {
  return {
    RESEND_API_KEY: "test-key",
    RESEND_AUDIENCE_ID: AUDIENCE,
    SUBSCRIBE_LIMITER: { limit: async () => ({ success: !limited }) },
    ASSETS: { fetch: async () => new Response("<html>asset</html>", { headers: { "Content-Type": "text/html" } }) },
  };
}

function withFetch(handler, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(url, init); };
  return fn(calls).finally(() => { globalThis.fetch = original; });
}

function post(body, { origin = "https://brandrune.com", type = "application/json", accept = "application/json" } = {}) {
  const headers = { "Content-Type": type, Accept: accept, "CF-Connecting-IP": "203.0.113.9" };
  if (origin) headers.Origin = origin;
  return new Request("https://brandrune.com/api/subscribe", {
    method: "POST", headers, body: type === "application/json" ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
}

test("validEmail accepts real shapes and rejects junk", () => {
  for (const ok of ["a.person@example.com", "x+tag@sub.example.co.uk", "first_last@ex-ample.io"]) assert.equal(validEmail(ok), true, ok);
  for (const bad of ["", "nope", "a@b", "a@b.c", ".a@example.com", "a..b@example.com", "a@-ex.com", "a b@example.com", "a@example.com\n", "x".repeat(65) + "@example.com", 42, null]) assert.equal(validEmail(bad), false, String(bad));
});

test("a valid signup creates one Resend contact", () => withFetch(
  async () => new Response(JSON.stringify({ object: "contact", id: "c1" }), { status: 201 }),
  async (calls) => {
    const res = await worker.fetch(post({ email: "Someone@Example.com", website: "" }), makeEnv());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.resend.com/audiences/${AUDIENCE}/contacts`);
    assert.deepEqual(JSON.parse(calls[0].init.body), { email: "someone@example.com", unsubscribed: false });
  }));

test("the honeypot answers success and stores nothing", () => withFetch(
  async () => { throw new Error("must not call Resend"); },
  async (calls) => {
    const res = await worker.fetch(post({ email: "bot@example.com", website: "http://spam.example" }), makeEnv());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.length, 0);
  }));

test("a bad email is rejected without calling Resend", () => withFetch(
  async () => { throw new Error("must not call Resend"); },
  async (calls) => {
    const res = await worker.fetch(post({ email: "not-an-email" }), makeEnv());
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
    assert.equal(calls.length, 0);
  }));

test("rate limited requests get 429", () => withFetch(
  async () => { throw new Error("must not call Resend"); },
  async (calls) => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv({ limited: true }));
    assert.equal(res.status, 429);
    assert.equal(calls.length, 0);
  }));

test("a foreign Origin is refused", () => withFetch(
  async () => { throw new Error("must not call Resend"); },
  async (calls) => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }, { origin: "https://evil.example" }), makeEnv());
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  }));

test("a no-JavaScript form post gets an HTML answer", () => withFetch(
  async () => new Response("{}", { status: 200 }),
  async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com", website: "" }, { type: "application/x-www-form-urlencoded", accept: "text/html" }), makeEnv());
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Type"), /text\/html/);
    assert.match(await res.text(), /You are on the list/);
  }));

test("a Resend failure is reported, not hidden", () => withFetch(
  async () => new Response("boom", { status: 500 }),
  async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv());
    assert.equal(res.status, 502);
    assert.equal((await res.json()).ok, false);
  }));

test("GET on the endpoint is 405", async () => {
  const res = await worker.fetch(new Request("https://brandrune.com/api/subscribe"), makeEnv());
  assert.equal(res.status, 405);
});

test("www redirects to the apex", async () => {
  const res = await worker.fetch(new Request("https://www.brandrune.com/sample/?x=1"), makeEnv());
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://brandrune.com/sample/?x=1");
});

test("plain http redirects to https", async () => {
  const res = await worker.fetch(new Request("http://brandrune.com/sample/"), makeEnv());
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://brandrune.com/sample/");
});

test("pages carry a CSP; the sample page allows its inline script only", async () => {
  const home = await worker.fetch(new Request("https://brandrune.com/"), makeEnv());
  assert.match(home.headers.get("Content-Security-Policy"), /script-src 'self'/);
  const sample = await worker.fetch(new Request("https://brandrune.com/sample/"), makeEnv());
  assert.match(sample.headers.get("Content-Security-Policy"), /script-src 'unsafe-inline'/);
  assert.equal(sample.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(home.headers.get("Cache-Control"), /no-transform/);
});

test("the brand guide gets the strict site CSP, not the sample page's", async () => {
  const res = await worker.fetch(new Request("https://brandrune.com/brand/"), makeEnv());
  const csp = res.headers.get("Content-Security-Policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
});
