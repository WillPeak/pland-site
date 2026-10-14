# Pland public site

Static site for [pland.ai](https://pland.ai).

## How production deploys

GitHub Pages, legacy build, from `main` at `/`. The `CNAME` file sets the custom domain `pland.ai`. DNS A records point at GitHub Pages (`185.199.108–111.153`); `www.pland.ai` CNAMEs to `willpeak.github.io` and redirects to the apex. Pages enforces HTTPS. The response `server` header is `GitHub.com` (Fastly is GitHub’s CDN). There is no Vercel, Netlify, or Cloudflare project in front of the site.

Pages publishes `main` only, so a pull request has no host preview URL.

`/plaid/redirect` and the Apple App Site Association files are the iOS app’s return path. Leave them in place.

## Waitlist

The form posts JSON to `https://api.pland.ai/waitlist` with `name`, `email`, `household`, and `ios`. A saved signup returns `{"ok":true}`. The button stays disabled while that request is in flight. Empty fields and a badly shaped email are checked in the page before anything is sent. Success and failure stay under the form, in the same dark palette the rest of the site uses (`prefers-color-scheme` does not switch it). Failure copy is a sentence, including a pointer to hello@pland.ai. The address is also linked under the form. Raw error codes from the API are not shown.

## Privacy

[`/privacy/`](privacy/index.html). The publisher is Pland. Contact hello@pland.ai.

## HTTPS

GitHub Pages has Enforce HTTPS on (`https_enforced: true` from `gh api repos/WillPeak/pland-site/pages`). The certificate is approved for `pland.ai` and `www.pland.ai` (Let's Encrypt, expires 20 November 2026). `http://pland.ai`, `http://www.pland.ai`, and `https://www.pland.ai` all 301 to `https://pland.ai/`.

## What the pages load

Nunito Sans is self-hosted from `/fonts/` (SIL Open Font License, see `fonts/OFL.txt`). Styles and scripts are same-origin files. There is no analytics, no iframe, and no third-party script, font, or stylesheet.

The waitlist posts to `https://api.pland.ai/waitlist`. `mailto:hello@pland.ai` stays as the contact address and as the fallback when a signup does not go through. There is no analytics, no iframe, and no third-party script, font, or stylesheet. There is no Mini. `/plaid/redirect` is the iOS return path: a same-origin page with a `pland://` link, not a network API.

## Content security policy

Every HTML page sets this in a meta tag, plus `referrer` of `strict-origin-when-cross-origin`:

`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.pland.ai; form-action 'self' mailto: https://api.pland.ai; base-uri 'self'; object-src 'none'; frame-ancestors 'none'`

`frame-ancestors` is included and then ignored. Browsers do not honor `frame-ancestors`, `report-uri`, or `sandbox` in a meta tag, so this does not stop the site being framed.

## Headers GitHub Pages cannot set

These stay residual risks. Pages does not offer custom response headers, and the live responses do not send them:

- `Content-Security-Policy` as a header. The meta policy covers documents only. It does not cover non-HTML responses, and it cannot enforce `frame-ancestors`.
- `X-Frame-Options`. With `frame-ancestors` ignored, another site can frame these pages.
- `Strict-Transport-Security`, including HSTS preload. HTTPS is enforced by a redirect, not by HSTS, so a first request can still be intercepted.
- `Permissions-Policy`.
- `Referrer-Policy` as a header. The meta tag covers documents; other file types do not get it.
- `X-Content-Type-Options`.
- `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and `Cross-Origin-Embedder-Policy`.

Pages also sends `Access-Control-Allow-Origin: *` on the documents.
