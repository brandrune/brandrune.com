# brandrune.com

The site for [Brandrune](https://github.com/brandrune/brandrune), the free Claude
Code naming skill. A Cloudflare Worker with static assets, on its own custom
domains (brandrune.com and www.brandrune.com, no wildcard route).

- `public/`: the page, styles, script, OG image and the sample results page.
- `src/worker.js`: serves the assets with security headers, redirects www and
  http to https://brandrune.com, and handles `POST /api/subscribe`.
- `sample-run/`: the invented project, names and registry results behind
  `public/sample/`. Regenerate with the skill's script:
  `python3 brandrune.py check sample-run/names.txt --tlds com,ai --description-file sample-run/about.txt --out sample-run/results.json --html public/sample/index.html`
- `og/`: HTML sources for `public/og.png` and `public/apple-touch-icon.png`,
  rendered with headless Chrome at 1200x630 and 180x180.

## Email signup

`/api/subscribe` adds the address to the Resend audience "Brandrune updates"
(`RESEND_AUDIENCE_ID` in `wrangler.jsonc`). It checks the Origin, rate limits per
IP with the Workers rate limiting binding (5 per minute, approximate by design),
validates the address, and treats a filled honeypot field as success without
storing anything. No other data is kept and the site has no analytics; responses
carry `Cache-Control: no-transform` so the edge does not inject a beacon.

Secret: `RESEND_API_KEY` (a dedicated Resend key named `brandrune-site`), set with
`wrangler secret put RESEND_API_KEY`.

## Develop and deploy

```bash
npm install
npm test          # worker unit tests, offline
npx wrangler deploy
```

Light mode only, colors set explicitly. Brand rules live in the Brandrune
workspace's `brand.md`.
