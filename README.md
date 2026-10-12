# Pland public site

Static site for [pland.ai](https://pland.ai).

## How production deploys

GitHub Pages, legacy build, from `main` at `/`. The `CNAME` file sets the custom domain `pland.ai`. DNS A records point at GitHub Pages (`185.199.108–111.153`); `www.pland.ai` CNAMEs to `willpeak.github.io` and redirects to the apex. Pages enforces HTTPS. The response `server` header is `GitHub.com` (Fastly is GitHub’s CDN). There is no Vercel, Netlify, or Cloudflare project in front of the site.

Pages publishes `main` only, so a pull request has no host preview URL.

`/plaid/redirect` and the Apple App Site Association files are the iOS app’s return path. Leave them in place.

## Waitlist

The form opens a `mailto:hello@pland.ai` message. It does not post to a backend. The same address is linked under the form.

## Privacy

[`/privacy/`](privacy/index.html). The publisher is Pland. Contact hello@pland.ai.
