// brandrune.com: static site plus the email signup.
//
//   POST /api/subscribe  stores the address in the Resend audience "Brandrune
//                        updates" as unsubscribed (pending) and emails a
//                        confirmation link.
//   GET  /confirm?t=...  a page with one button. Link scanners follow GETs, so
//                        the GET never changes anything.
//   POST /api/confirm    checks the signed token and marks the contact
//                        subscribed, then sends the browser to /confirmed/.
//
// Nothing else is stored and nothing is tracked.

const CANONICAL_HOST = "brandrune.com";
const DEFAULT_ORIGIN = "https://brandrune.com";
const DEFAULT_FROM = "Brandrune <brandrune@kylnor.com>";
const MAX_BODY_BYTES = 2048;
const TOKEN_TTL_SECONDS = 48 * 3600;

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
};
// The home page's name checker asks Verisign's RDAP server straight from the
// browser, so that one host is allowed for fetch. Nothing else leaves 'self'.
const SITE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://rdap.verisign.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
// The sample pages are the skill's own results pages, which inline their data, script and styles.
const SAMPLE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const wrongHost = url.hostname !== CANONICAL_HOST && url.hostname.endsWith(CANONICAL_HOST);
    if (wrongHost || url.protocol === "http:") {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/subscribe") return withHeaders(await subscribe(request, env), SITE_CSP);
    if (url.pathname === "/api/confirm") return withHeaders(await confirm(request, env), SITE_CSP);
    if (url.pathname === "/confirm" || url.pathname === "/confirm/") return withHeaders(await confirmPage(request, env), SITE_CSP);
    if (url.pathname.startsWith("/api/")) return withHeaders(json({ ok: false, error: "Not found." }, 404), SITE_CSP);

    const res = await env.ASSETS.fetch(request);
    const csp = url.pathname.startsWith("/sample") ? SAMPLE_CSP : SITE_CSP;
    return withHeaders(res, csp);
  },
};

function withHeaders(res, csp) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(BASE_HEADERS)) out.headers.set(k, v);
  out.headers.set("Content-Security-Policy", csp);
  // no-transform stops the edge from rewriting pages, which is how a hosted
  // analytics beacon would otherwise get injected. This site tracks nothing.
  const cc = out.headers.get("Cache-Control");
  if (!cc || !/no-transform/.test(cc)) out.headers.set("Cache-Control", cc ? `${cc}, no-transform` : "no-transform");
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A plain page in the site's style. `body` is trusted HTML built here; every
// value from the request goes through esc() before it gets in.
function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="robots" content="noindex"><title>${esc(title)}: Brandrune</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head><body><main class="wrap narrow page-msg"><a class="page-mark" href="/" aria-label="Brandrune home"><img src="/brand/assets/brandrune-lockup-flat.svg" alt="Brandrune" width="141" height="30"></a><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
const para = (text) => `<p>${esc(text)}</p>`;
const backLink = `<p><a href="/">Back to brandrune.com</a></p>`;

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}$/;

export function validEmail(value) {
  if (typeof value !== "string") return false;
  if (value.length < 6 || value.length > 254) return false;
  const at = value.lastIndexOf("@");
  const local = value.slice(0, at);
  if (at < 1 || local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return EMAIL_RE.test(value);
}

function siteOrigin(env) {
  return (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // same-origin form posts from old browsers; the token or limiter still applies
  const site = siteOrigin(env);
  return origin === site || (site === DEFAULT_ORIGIN && origin === "https://www.brandrune.com");
}

// --- body reading ------------------------------------------------------------

const TOO_BIG = Symbol("too big");

// Reads at most MAX_BODY_BYTES. A declared Content-Length over the cap is
// refused before a byte is read; an undeclared (chunked) body is read until it
// passes the cap, then dropped.
async function readBody(request) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return TOO_BIG;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return TOO_BIG;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

async function readFields(request) {
  const text = await readBody(request);
  if (text === TOO_BIG) return TOO_BIG;
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(text);
      return body && typeof body === "object" && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  return null;
}

// --- signed confirmation tokens ----------------------------------------------
//
// token = base64url(email) "." expiry (unix seconds) "." base64url(HMAC-SHA256)
// The HMAC covers a purpose tag, the address and the expiry, so a token cannot
// be stretched, moved to another address, or reused for anything else.

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const signedText = (email, exp) => `brandrune-confirm:v1:${email}:${exp}`;

export async function makeToken(email, secret, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(signedText(email, exp))));
  return `${b64url(enc.encode(email))}.${exp}.${b64url(sig)}`;
}

// Returns { email } for a good token, { expired: true } for a well-signed old
// one, or null for anything else.
export async function readToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d{1,12}$/.test(parts[1])) return null;
  const emailBytes = unb64url(parts[0]);
  const sig = unb64url(parts[2]);
  if (!emailBytes || !sig || sig.length !== 32) return null;
  const email = new TextDecoder().decode(emailBytes);
  if (!validEmail(email)) return null;
  const exp = Number(parts[1]);
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(signedText(email, exp)));
  if (!ok) return null;
  if (exp * 1000 < now) return { expired: true };
  return { email };
}

// --- Resend ------------------------------------------------------------------

function resend(env, path, init = {}) {
  return fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

const contactPath = (env, email) => `/audiences/${env.RESEND_AUDIENCE_ID}/contacts/${encodeURIComponent(email)}`;

// "confirmed", "pending" (on the audience, unsubscribed), "none", or "error".
async function contactState(env, email) {
  const res = await resend(env, contactPath(env, email));
  if (res.status === 404) return "none";
  if (!res.ok) return "error";
  const body = await res.json().catch(() => null);
  if (!body || typeof body.unsubscribed !== "boolean") return "error";
  return body.unsubscribed ? "pending" : "confirmed";
}

function confirmEmail(link) {
  const text = [
    "Someone, hopefully you, asked for Brandrune updates at this address.",
    "",
    "Confirm here:",
    link,
    "",
    "The link works for 48 hours. If this was not you, ignore this email and the address stays off the list.",
    "",
    "Brandrune, the free naming skill for Claude Code and Codex",
    "https://brandrune.com",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#fafaf8;color:#1d1d1b;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><div style="max-width:520px;margin:0 auto;padding:32px 24px"><p style="margin:0 0 20px;font-weight:700;font-size:19px;color:#9c3d1c">Brandrune</p><p style="margin:0 0 16px">Someone, hopefully you, asked for Brandrune updates at this address.</p><p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#9c3d1c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px">Confirm my email</a></p><p style="margin:0 0 16px;color:#5f5f5a;font-size:14px">The link works for 48 hours. If this was not you, ignore this email and the address stays off the list.</p><p style="margin:0;color:#5f5f5a;font-size:14px">Or paste this into your browser:<br><a href="${esc(link)}" style="color:#9c3d1c;word-break:break-all">${esc(link)}</a></p></div></body></html>`;
  return { text, html };
}

// --- POST /api/subscribe -----------------------------------------------------

async function subscribe(request, env) {
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const PENDING = "Check your inbox. Click the link in the email from Brandrune to confirm.";
  const reply = (ok, status, message) =>
    wantsJson
      ? json(ok ? { ok: true, pending: true } : { ok: false, error: message }, status)
      : page(ok ? "Check your inbox" : "That did not work", para(ok ? PENDING : message) + backLink, status);

  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!originAllowed(request, env)) return reply(false, 403, "Signups only come from brandrune.com.");

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.SUBSCRIBE_LIMITER) {
    const { success } = await env.SUBSCRIBE_LIMITER.limit({ key: ip });
    if (!success) return reply(false, 429, "Too many tries. Wait a minute and try again.");
  }

  const fields = await readFields(request);
  if (fields === TOO_BIG) return reply(false, 413, "That form was too large.");
  if (!fields) return reply(false, 400, "The form did not come through. Try again.");

  // Honeypot: people never see this field. A bot that fills it gets the same
  // success answer, and nothing is stored or sent.
  if (typeof fields.website === "string" && fields.website.trim() !== "") return reply(true, 200);

  const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return reply(false, 400, "That does not look like an email address.");

  if (!env.RESEND_API_KEY || !env.RESEND_AUDIENCE_ID || !env.CONFIRM_SECRET) {
    return reply(false, 503, "Signups are not set up yet. Try again later.");
  }

  // One confirmation email per address per window, whoever asks, so the form
  // cannot be used to flood someone else's inbox.
  if (env.CONFIRM_EMAIL_LIMITER) {
    const { success } = await env.CONFIRM_EMAIL_LIMITER.limit({ key: email });
    if (!success) return reply(true, 200);
  }

  const state = await contactState(env, email);
  if (state === "error") return failed("contact lookup");
  // Already confirmed: same answer as a new signup, so the form does not
  // reveal who is on the list, and no email goes out.
  if (state === "confirmed") return reply(true, 200);
  if (state === "none") {
    const res = await resend(env, `/audiences/${env.RESEND_AUDIENCE_ID}/contacts`, {
      method: "POST",
      body: JSON.stringify({ email, unsubscribed: true }),
    });
    if (!res.ok && res.status !== 409) return failed(`contact create ${res.status}`);
  }

  const link = `${siteOrigin(env)}/confirm?t=${await makeToken(email, env.CONFIRM_SECRET)}`;
  const { text, html } = confirmEmail(link);
  const sent = await resend(env, "/emails", {
    method: "POST",
    body: JSON.stringify({ from: env.CONFIRM_FROM || DEFAULT_FROM, to: [email], subject: "Confirm your Brandrune updates", text, html }),
  });
  if (!sent.ok) return failed(`confirmation send ${sent.status}`);
  return reply(true, 200);

  function failed(what) {
    console.log(`subscribe failed: ${what}`);
    return reply(false, 502, "Something went wrong on our side. Try again in a minute.");
  }
}

// --- GET /confirm ------------------------------------------------------------

const EXPIRED = "That confirmation link is more than 48 hours old. Sign up again and a fresh one will arrive.";
const BAD_LINK = "That confirmation link is not one we sent, or it got cut off. Copy the whole link from the email, or sign up again.";

async function confirmPage(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  if (!env.CONFIRM_SECRET) return page("Not set up yet", para("Signups are not set up yet. Try again later.") + backLink, 503);
  const token = new URL(request.url).searchParams.get("t") || "";
  const read = await readToken(token, env.CONFIRM_SECRET);
  if (!read) return page("Link not recognized", para(BAD_LINK) + `<p><a href="/#updates">Sign up again</a></p>`, 400);
  if (read.expired) return page("Link expired", para(EXPIRED) + `<p><a href="/#updates">Sign up again</a></p>`, 410);
  const body =
    para(`Confirm that ${read.email} should get Brandrune updates: an email when something new ships, and nothing else.`) +
    `<form class="confirm-form" action="/api/confirm" method="post"><input type="hidden" name="t" value="${esc(token)}"><button type="submit">Confirm my email</button></form>` +
    `<p class="small">Not you? Close this page and nothing happens.</p>`;
  return page("One more click", body);
}

// --- POST /api/confirm -------------------------------------------------------

async function confirm(request, env) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!originAllowed(request, env)) return page("That did not work", para("Confirmations only come from brandrune.com.") + backLink, 403);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.SUBSCRIBE_LIMITER) {
    const { success } = await env.SUBSCRIBE_LIMITER.limit({ key: ip });
    if (!success) return page("Too many tries", para("Wait a minute and press the button again.") + backLink, 429);
  }
  if (!env.RESEND_API_KEY || !env.RESEND_AUDIENCE_ID || !env.CONFIRM_SECRET) {
    return page("Not set up yet", para("Signups are not set up yet. Try again later.") + backLink, 503);
  }
  const fields = await readFields(request);
  if (fields === TOO_BIG) return page("That did not work", para("That form was too large.") + backLink, 413);
  const read = fields ? await readToken(fields.t, env.CONFIRM_SECRET) : null;
  if (!read) return page("Link not recognized", para(BAD_LINK) + `<p><a href="/#updates">Sign up again</a></p>`, 400);
  if (read.expired) return page("Link expired", para(EXPIRED) + `<p><a href="/#updates">Sign up again</a></p>`, 410);

  let res = await resend(env, contactPath(env, read.email), { method: "PATCH", body: JSON.stringify({ unsubscribed: false }) });
  if (res.status === 404) {
    // The pending contact was removed in between; the signed link is still proof of the request.
    res = await resend(env, `/audiences/${env.RESEND_AUDIENCE_ID}/contacts`, { method: "POST", body: JSON.stringify({ email: read.email, unsubscribed: false }) });
  }
  if (!res.ok) {
    console.log(`confirm failed: ${res.status}`);
    return page("That did not work", para("Something went wrong on our side. Press back and try the button again in a minute.") + backLink, 502);
  }
  return new Response(null, { status: 303, headers: { Location: "/confirmed/", "Cache-Control": "no-store" } });
}
