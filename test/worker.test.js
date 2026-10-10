import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { validEmail, makeToken, readToken } from "../src/worker.js";

const AUDIENCE = "aud-123";
const SECRET = "test-secret-0123456789abcdef";
const CONTACTS = `https://api.resend.com/audiences/${AUDIENCE}/contacts`;

function makeEnv({ limited = false, emailLimited = false, ...over } = {}) {
  return {
    RESEND_API_KEY: "test-key",
    RESEND_AUDIENCE_ID: AUDIENCE,
    CONFIRM_SECRET: SECRET,
    CONFIRM_FROM: "Brandrune <test@example.com>",
    SUBSCRIBE_LIMITER: { limit: async () => ({ success: !limited }) },
    CONFIRM_EMAIL_LIMITER: { limit: async () => ({ success: !emailLimited }) },
    ASSETS: { fetch: async () => new Response("<html>asset</html>", { headers: { "Content-Type": "text/html" } }) },
    ...over,
  };
}

// A fake Resend. `contacts` maps email -> { unsubscribed }. Every call is recorded.
function fakeResend(contacts = {}, { failSend = false, failLookup = false } = {}) {
  const calls = [];
  const handler = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : undefined });
    const u = String(url);
    if (u === "https://api.resend.com/emails") return failSend ? new Response("no", { status: 500 }) : new Response(JSON.stringify({ id: "e1" }), { status: 200 });
    if (u === CONTACTS && method === "POST") {
      const body = JSON.parse(init.body);
      if (contacts[body.email]) return new Response(JSON.stringify({ message: "Contact already exists" }), { status: 409 });
      contacts[body.email] = { unsubscribed: body.unsubscribed };
      return new Response(JSON.stringify({ object: "contact", id: "c1" }), { status: 201 });
    }
    if (u.startsWith(CONTACTS + "/")) {
      const email = decodeURIComponent(u.slice(CONTACTS.length + 1));
      if (failLookup) return new Response("boom", { status: 500 });
      if (!contacts[email]) return new Response(JSON.stringify({ message: "Contact not found" }), { status: 404 });
      if (method === "PATCH") contacts[email] = { ...contacts[email], ...JSON.parse(init.body) };
      return new Response(JSON.stringify({ object: "contact", email, ...contacts[email] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  return { calls, handler, contacts };
}

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

function post(body, { origin = "https://brandrune.com", type = "application/json", accept = "application/json", path = "/api/subscribe", headers = {} } = {}) {
  const h = { "Content-Type": type, Accept: accept, "CF-Connecting-IP": "203.0.113.9", ...headers };
  if (origin) h.Origin = origin;
  const payload = typeof body === "string" ? body : type === "application/json" ? JSON.stringify(body) : new URLSearchParams(body).toString();
  return new Request(`https://brandrune.com${path}`, { method: "POST", headers: h, body: payload });
}

const sentEmails = (calls) => calls.filter((c) => c.url === "https://api.resend.com/emails");
const linkFrom = (email) => email.body.text.match(/https:\/\/\S+\/confirm\?t=\S+/)[0];

test("validEmail accepts real shapes and rejects junk", () => {
  for (const ok of ["a.person@example.com", "x+tag@sub.example.co.uk", "first_last@ex-ample.io"]) assert.equal(validEmail(ok), true, ok);
  for (const bad of ["", "nope", "a@b", "a@b.c", ".a@example.com", "a..b@example.com", "a@-ex.com", "a b@example.com", "a@example.com\n", "x".repeat(65) + "@example.com", 42, null]) assert.equal(validEmail(bad), false, String(bad));
});

test("a new signup is stored as unsubscribed and gets one confirmation email", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "Someone@Example.com", website: "" }), makeEnv());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, pending: true });
  });
  assert.deepEqual(r.contacts["someone@example.com"], { unsubscribed: true });
  const mails = sentEmails(r.calls);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].body.to, ["someone@example.com"]);
  assert.equal(mails[0].body.from, "Brandrune <test@example.com>");
  assert.match(linkFrom(mails[0]), /^https:\/\/brandrune\.com\/confirm\?t=/);
});

test("the confirmation link uses SITE_ORIGIN, so a preview links to itself", async () => {
  const r = fakeResend();
  const env = makeEnv({ SITE_ORIGIN: "https://preview.example.workers.dev" });
  await withFetch(r.handler, () => worker.fetch(post({ email: "a.person@example.com" }, { origin: "https://preview.example.workers.dev" }), env));
  assert.match(linkFrom(sentEmails(r.calls)[0]), /^https:\/\/preview\.example\.workers\.dev\/confirm\?t=/);
});

test("an already confirmed address gets the same answer and no email", async () => {
  const r = fakeResend({ "a.person@example.com": { unsubscribed: false } });
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, pending: true });
  });
  assert.equal(sentEmails(r.calls).length, 0);
  assert.equal(r.calls.some((c) => c.method === "POST" && c.url === CONTACTS), false);
});

test("a pending address signing up again gets a fresh email and stays unsubscribed", async () => {
  const r = fakeResend({ "a.person@example.com": { unsubscribed: true } });
  await withFetch(r.handler, () => worker.fetch(post({ email: "a.person@example.com" }), makeEnv()));
  assert.equal(sentEmails(r.calls).length, 1);
  assert.deepEqual(r.contacts["a.person@example.com"], { unsubscribed: true });
});

test("the per-address limiter stops a second email without saying so", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv({ emailLimited: true }));
    assert.equal(res.status, 200);
  });
  assert.equal(r.calls.length, 0);
});

test("a failed send is reported, not hidden", async () => {
  const r = fakeResend({}, { failSend: true });
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv());
    assert.equal(res.status, 502);
    assert.equal((await res.json()).ok, false);
  });
});

test("a failed contact lookup is reported and sends nothing", async () => {
  const r = fakeResend({}, { failLookup: true });
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv());
    assert.equal(res.status, 502);
  });
  assert.equal(sentEmails(r.calls).length, 0);
});

test("without CONFIRM_SECRET signups fail closed", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv({ CONFIRM_SECRET: undefined }));
    assert.equal(res.status, 503);
  });
  assert.equal(r.calls.length, 0);
});

test("the honeypot answers success and stores nothing", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "bot@example.com", website: "http://spam.example" }), makeEnv());
    assert.equal(res.status, 200);
  });
  assert.equal(r.calls.length, 0);
});

test("a bad email is rejected without calling Resend", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "not-an-email" }), makeEnv());
    assert.equal(res.status, 400);
  });
  assert.equal(r.calls.length, 0);
});

test("an oversize Content-Length is refused before the body is read", async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new TextEncoder().encode("x".repeat(1024))); } });
  const req = new Request("https://brandrune.com/api/subscribe", {
    method: "POST", body, duplex: "half",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://brandrune.com", "Content-Length": "999999" },
  });
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(req, makeEnv());
    assert.equal(res.status, 413);
  });
  assert.equal(r.calls.length, 0);
  assert.ok(pulled <= 1, `body was read (${pulled} pulls)`);
});

test("an undeclared oversize body is cut off at the cap", async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled++; if (pulled > 50) c.close(); else c.enqueue(new TextEncoder().encode("x".repeat(1024))); } });
  const req = new Request("https://brandrune.com/api/subscribe", {
    method: "POST", body, duplex: "half",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://brandrune.com" },
  });
  const res = await worker.fetch(req, makeEnv());
  assert.equal(res.status, 413);
  assert.ok(pulled < 10, `read ${pulled} KB before stopping`);
});

test("rate limited requests get 429", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }), makeEnv({ limited: true }));
    assert.equal(res.status, 429);
  });
  assert.equal(r.calls.length, 0);
});

test("a foreign Origin is refused", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com" }, { origin: "https://evil.example" }), makeEnv());
    assert.equal(res.status, 403);
  });
  assert.equal(r.calls.length, 0);
});

test("a no-JavaScript form post gets an HTML answer", async () => {
  const r = fakeResend();
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ email: "a.person@example.com", website: "" }, { type: "application/x-www-form-urlencoded", accept: "text/html" }), makeEnv());
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Type"), /text\/html/);
    assert.match(await res.text(), /Check your inbox/);
  });
});

test("GET on the endpoint is 405", async () => {
  const res = await worker.fetch(new Request("https://brandrune.com/api/subscribe"), makeEnv());
  assert.equal(res.status, 405);
});

// --- tokens ------------------------------------------------------------------

test("a token reads back its address, and only with the right secret", async () => {
  const t = await makeToken("a.person@example.com", SECRET);
  assert.deepEqual(await readToken(t, SECRET), { email: "a.person@example.com" });
  assert.equal(await readToken(t, "another-secret"), null);
});

test("a token expires after 48 hours", async () => {
  const now = Date.UTC(2026, 9, 10);
  const t = await makeToken("a.person@example.com", SECRET, now);
  assert.deepEqual(await readToken(t, SECRET, now + 47 * 3600e3), { email: "a.person@example.com" });
  assert.deepEqual(await readToken(t, SECRET, now + 49 * 3600e3), { expired: true });
});

test("a token cannot be moved to another address or stretched", async () => {
  const t = await makeToken("a.person@example.com", SECRET);
  const [, exp, sig] = t.split(".");
  const other = Buffer.from("b.person@example.com").toString("base64url");
  assert.equal(await readToken(`${other}.${exp}.${sig}`, SECRET), null);
  const [mail] = t.split(".");
  assert.equal(await readToken(`${mail}.${Number(exp) + 86400}.${sig}`, SECRET), null);
  for (const junk of ["", "a.b", "a.b.c.d", `${mail}.x.${sig}`, `${mail}.${exp}.!!!`, null, 7]) assert.equal(await readToken(junk, SECRET), null, String(junk));
});

// --- the confirm pages -------------------------------------------------------

test("the confirm link shows a button and changes nothing on GET", async () => {
  const r = fakeResend({ "a.person@example.com": { unsubscribed: true } });
  const t = await makeToken("a.person@example.com", SECRET);
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(new Request(`https://brandrune.com/confirm?t=${t}`), makeEnv());
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /action="\/api\/confirm" method="post"/);
    assert.match(html, /a\.person@example\.com/);
    assert.match(res.headers.get("Content-Security-Policy"), /script-src 'self'/);
  });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.contacts["a.person@example.com"], { unsubscribed: true });
});

test("a bad or expired link says so on GET", async () => {
  const bad = await worker.fetch(new Request("https://brandrune.com/confirm?t=nope"), makeEnv());
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /not one we sent/);
  const old = await makeToken("a.person@example.com", SECRET, Date.now() - 72 * 3600e3);
  const exp = await worker.fetch(new Request(`https://brandrune.com/confirm/?t=${old}`), makeEnv());
  assert.equal(exp.status, 410);
});

test("pressing confirm subscribes the contact and lands on /confirmed/", async () => {
  const r = fakeResend({ "a.person@example.com": { unsubscribed: true } });
  const t = await makeToken("a.person@example.com", SECRET);
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ t }, { path: "/api/confirm", type: "application/x-www-form-urlencoded", accept: "text/html" }), makeEnv());
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("Location"), "/confirmed/");
  });
  assert.deepEqual(r.contacts["a.person@example.com"], { unsubscribed: false });
});

test("confirm recreates a contact that vanished in between", async () => {
  const r = fakeResend({});
  const t = await makeToken("a.person@example.com", SECRET);
  await withFetch(r.handler, async () => {
    const res = await worker.fetch(post({ t }, { path: "/api/confirm", type: "application/x-www-form-urlencoded", accept: "text/html" }), makeEnv());
    assert.equal(res.status, 303);
  });
  assert.deepEqual(r.contacts["a.person@example.com"], { unsubscribed: false });
});

test("confirm refuses a forged token, a foreign Origin and a GET", async () => {
  const r = fakeResend({ "a.person@example.com": { unsubscribed: true } });
  const t = await makeToken("a.person@example.com", "wrong-secret");
  await withFetch(r.handler, async () => {
    const forged = await worker.fetch(post({ t }, { path: "/api/confirm", type: "application/x-www-form-urlencoded" }), makeEnv());
    assert.equal(forged.status, 400);
    const good = await makeToken("a.person@example.com", SECRET);
    const foreign = await worker.fetch(post({ t: good }, { path: "/api/confirm", type: "application/x-www-form-urlencoded", origin: "https://evil.example" }), makeEnv());
    assert.equal(foreign.status, 403);
    const get = await worker.fetch(new Request("https://brandrune.com/api/confirm"), makeEnv());
    assert.equal(get.status, 405);
  });
  assert.deepEqual(r.contacts["a.person@example.com"], { unsubscribed: true });
});

// --- routing and headers -----------------------------------------------------

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

test("pages carry a CSP; the sample pages allow their inline script only", async () => {
  const home = await worker.fetch(new Request("https://brandrune.com/"), makeEnv());
  const csp = home.headers.get("Content-Security-Policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/rdap\.verisign\.com;/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  const sample = await worker.fetch(new Request("https://brandrune.com/sample/plant-care/"), makeEnv());
  assert.match(sample.headers.get("Content-Security-Policy"), /script-src 'unsafe-inline'/);
  assert.doesNotMatch(sample.headers.get("Content-Security-Policy"), /connect-src/);
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
