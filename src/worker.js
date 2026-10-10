// brandrune.com: static site plus one endpoint, POST /api/subscribe.
// The endpoint adds an email to the Resend audience "Brandrune updates".
// Nothing else is stored and nothing is tracked.

const CANONICAL_HOST = "brandrune.com";
const ALLOWED_ORIGINS = new Set(["https://brandrune.com", "https://www.brandrune.com"]);
const MAX_BODY_BYTES = 2048;

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
};
const SITE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
// The sample page is the skill's own results page, which inlines its data, script and styles.
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

    if (url.pathname === "/api/subscribe") {
      return withHeaders(await subscribe(request, env), SITE_CSP);
    }
    if (url.pathname.startsWith("/api/")) {
      return withHeaders(json({ ok: false, error: "Not found." }, 404), SITE_CSP);
    }

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

// Plain HTML answer for a form posted without JavaScript.
function page(title, message, status = 200) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}: Brandrune</title><link rel="stylesheet" href="/style.css"></head><body><main class="wrap narrow" style="padding:80px 24px"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/">Back to brandrune.com</a></p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

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

async function readFields(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(text);
      return body && typeof body === "object" ? body : null;
    } catch {
      return null;
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return null;
}

async function subscribe(request, env) {
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const reply = (ok, status, message) =>
    wantsJson
      ? json(ok ? { ok: true } : { ok: false, error: message }, status)
      : page(ok ? "You are on the list" : "That did not work", ok ? "You will get an email when something new ships, and nothing else." : message, status);

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return reply(false, 403, "Signups only come from brandrune.com.");
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.SUBSCRIBE_LIMITER) {
    const { success } = await env.SUBSCRIBE_LIMITER.limit({ key: ip });
    if (!success) return reply(false, 429, "Too many tries. Wait a minute and try again.");
  }

  const fields = await readFields(request);
  if (!fields) return reply(false, 400, "The form did not come through. Try again.");

  // Honeypot: people never see this field. A bot that fills it gets the same
  // success answer, and nothing is stored.
  if (typeof fields.website === "string" && fields.website.trim() !== "") {
    return reply(true, 200);
  }

  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  if (!validEmail(email)) return reply(false, 400, "That does not look like an email address.");

  if (!env.RESEND_API_KEY || !env.RESEND_AUDIENCE_ID) {
    return reply(false, 503, "Signups are not set up yet. Try again later.");
  }

  const res = await fetch(`https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase(), unsubscribed: false }),
  });
  if (res.ok) return reply(true, 200);

  // An address that is already on the list is a success for the person signing up.
  const detail = await res.text();
  if (res.status === 409 || /already exist/i.test(detail)) return reply(true, 200);
  console.log(`resend contact create failed: ${res.status}`);
  return reply(false, 502, "Something went wrong on our side. Try again in a minute.");
}
