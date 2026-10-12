# Pland public site

Static site for [pland.ai](https://pland.ai).

## How production deploys

GitHub Pages, legacy build, from `main` at `/`. The `CNAME` file sets the custom domain `pland.ai`. DNS A records point at GitHub Pages (`185.199.108–111.153`); `www.pland.ai` CNAMEs to `willpeak.github.io` and redirects to the apex. Pages enforces HTTPS. The response `server` header is `GitHub.com` (Fastly is GitHub’s CDN). There is no Vercel, Netlify, or Cloudflare project in front of the site.

Pages publishes `main` only, so a pull request has no host preview URL.

`/plaid/redirect` and the Apple App Site Association files are the iOS app’s return path. Leave them in place.

## Waitlist

The form `POST`s JSON to `/api/waitlist`. GitHub Pages cannot run that route. [`server/waitlist.mjs`](server/waitlist.mjs) is the storage process: one JSON line per signup, a honeypot, and logs that are only a status word. It allows CORS from `https://pland.ai` and `https://www.pland.ai`.

```bash
PORT=4173 node server/waitlist.mjs
```

The store file defaults to the system temp directory (`WAITLIST_STORE` overrides it). Do not commit it. `GET /api/waitlist` does not read it back.

PlandAutomation’s `POST /waitlist` Lambda was not reachable from this site: `api.pland.ai` has no DNS record, and certificate logs for `*.pland.ai` only show `pland.ai` and `www.pland.ai`. When that Lambda is deployed and its CORS allows `https://pland.ai`, point the form at it and this process can go.

## Privacy

[`/privacy/`](privacy/index.html). `{{LEGAL_ENTITY}}` and `{{GOVERNING_LAW}}` are unfilled on purpose.
