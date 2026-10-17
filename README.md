# brandrune.com

The site for [Brandrune](https://github.com/brandrune/brandrune), the free Claude
Code naming skill. A Cloudflare Worker with static assets, on its own custom
domains (brandrune.com and www.brandrune.com, no wildcard route).

- `public/`: the home page (`index.html`, `home.css`, `app.js`), the shared
  `style.css`, the OG image, the brand guide at `/brand/`, the sample results pages
  under `/sample/`, the replay data at `/demo/run.json`, and `/confirmed/`.
- `src/worker.js`: serves the assets with security headers, redirects www and
  http to https://brandrune.com, and handles the double opt-in signup
  (`POST /api/subscribe`, `GET /confirm`, `POST /api/confirm`).
- `public/ph.js` and `public/ph-init.js`: PostHog pageview counting, served from
  this origin. `ph.js` is posthog-js 1.438.7 `dist/array.no-external.js` (one em dash
  escaped as `\u2014`, sourcemap line dropped); to upgrade, copy that file from the
  new npm tarball and keep the same edits. `ph-init.js` holds the key and options.
  The worker's own pages (`/confirm` and its errors) load neither: that URL carries
  the subscriber's email and token. Regenerating `public/sample/` with the skill drops
  the two script tags; add them back at the end of the head, after the closing `</style>`.
- `demo-run/`: the recorded run the home page replays (an invented plant-care app,
  150 names on .com and .ai, checked 2026-10-10). `build.py` turns its
  `results.json` into `public/demo/run.json` using the skill's own status labels:
  `python3 demo-run/build.py /path/to/skills/brandrune/scripts/brandrune.py`. The
  skill's HTML page from the same run is `public/sample/plant-care/index.html`.
  `test/static.test.js` fails if the page's printed tallies or picks drift from the data.
- `sample-run/`: the invented project, names and registry results behind
  `public/sample/`. Regenerate with the skill's script:
  `python3 brandrune.py check sample-run/names.txt --tlds com,ai --description-file sample-run/about.txt --out sample-run/results.json --html public/sample/index.html`
- `brand-src/`: the logo system as code. `geometry.py` builds the carved
  berkanan mark and the drawn wordmark from one 30 degree construction;
  `build.py` writes every SVG into `public/brand/assets/` (plus
  `public/favicon.svg`); `render.mjs` renders the PNGs, `public/og.png` and
  `public/apple-touch-icon.png` with headless Chromium.

## Brand assets

```bash
python3 -m venv .venv && .venv/bin/pip install shapely==2.2.0
.venv/bin/python brand-src/build.py                 # SVGs
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node brand-src/render.mjs   # PNGs, og.png, apple-touch-icon.png
.venv/bin/python brand-src/build.py zip             # brandrune-brand-assets.zip
```

The SVGs carry no `<style>` and no live text in the logo itself, so they
render the same everywhere and pass the site CSP when opened directly. The
social card template keeps its headline as live text on purpose, so it can
be edited.

## The .com checker

The "Is yourname.com open?" box on the home page asks Verisign's RDAP server
straight from the browser (Verisign sends `Access-Control-Allow-Origin: *`, and the
request uses only a CORS-safelisted `Accept` header, so there is no preflight). The
site never sees the name. It applies the skill's rules for one extension and no
price check: a 404 only counts when it is served as `application/rdap+json`,
redirects are not answers, and a "no record" is only trusted after nic.com or
google.com comes back registered. A trusted no-record shows as `open*`. The CSP
allows `connect-src https://rdap.verisign.com https://us.i.posthog.com` and nothing else off-site. The
parking list in `app.js` is copied from `brandrune.py` 0.3.0; keep them in step.

## Email signup (double opt-in)

1. `POST /api/subscribe` checks the Origin (`SITE_ORIGIN`), rate limits per IP
   (`SUBSCRIBE_LIMITER`, 5 a minute), refuses a body over 2 KB by `Content-Length`
   before reading it (and cuts off an undeclared one at the cap), validates the
   address, and treats a filled honeypot field as success. Then it emails a
   confirmation link from `CONFIRM_FROM`. **Nothing is written to the Resend
   audience at this step.**
2. Sends are capped three ways, all counted against the address with its `+tag`
   dropped, lowercased, and for gmail.com and googlemail.com its dots dropped
   (`capKey` in `src/worker.js`):
   - one confirmation email per inbox per 24 hours: a KV entry (`CONFIRM_COOLDOWN`)
     keyed on a SHA-256 of that address, with a 24 hour TTL;
   - a burst limit on the same key (`CONFIRM_EMAIL_LIMITER`, 2 a minute), which
     covers the time KV takes to agree across locations;
   - a site-wide limit on all sends (`GLOBAL_SEND_LIMITER`, 10 a minute, keyed on a
     constant). Workers rate limits count per Cloudflare location, so this is a cap
     per location, not a hard global one.
   An address that is already confirmed, or inside its cooldown, gets the same
   answer and no email, so the form does not reveal who is on the list. If any cap
   binding is missing, the endpoint answers 503 and sends nothing.
3. The email links to `GET /confirm?t=<token>`. The token is
   `base64url(email).expiry.HMAC-SHA256` over a purpose tag, the address and the
   expiry, signed with `CONFIRM_SECRET`, good for 48 hours. The GET only shows a
   button; link scanners follow GETs, so nothing changes until a person clicks.
4. `POST /api/confirm` checks the token again and creates the contact in the
   audience "Brandrune updates" (`RESEND_AUDIENCE_ID`) as subscribed. Resend treats
   a create for an existing address as an update (checked 2026-10-10), so an address
   that unsubscribed and confirms again is resubscribed; a 409 falls back to an
   explicit update. Then it 303s to `/confirmed/`.

No other signup data is kept. The site counts pageviews and referrers with PostHog
(self-hosted `/ph.js`, pageviews only, no profiles, no session recording,
no autocapture). It does not track what you type or name in Brandrune.
Responses carry `Cache-Control: no-transform` so the edge does not inject a
third-party beacon.

KV namespaces: `brandrune-confirm-cooldown` (production, bound in `wrangler.jsonc`)
and `brandrune-confirm-cooldown-preview`. The preview worker uses the Resend
audience "Brandrune updates (preview test)", never the production audience.

Secrets, set with `wrangler secret put <NAME>`:

- `RESEND_API_KEY`: a dedicated full-access Resend key (`brandrune-site`; contacts
  need full access).
- `CONFIRM_SECRET`: any long random string, for example
  `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Without it the
  signup answers 503 and stores nothing.

Sender: `CONFIRM_FROM` in `wrangler.jsonc`. It is `brandrune@kylnor.com` because the
Resend plan is at its domain limit and brandrune.com could not be added. Once
brandrune.com is a verified Resend domain, change it to `Brandrune
<updates@brandrune.com>`.

## Develop and deploy

```bash
npm install
npm test          # worker unit tests and static checks on public/, offline
npx wrangler secret put CONFIRM_SECRET   # once, before the first deploy with double opt-in
npx wrangler deploy
```

Light mode only, colors set explicitly. Brand rules live in the Brandrune
workspace's `brand.md`.
