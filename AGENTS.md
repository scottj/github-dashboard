# AGENTS.md

## Project Overview

Single-page GitHub dashboard (`index.html`) that shows items needing the user's attention: PRs, issues, and notifications across all repos. Vanilla HTML/CSS/JS with no build step.

## Architecture

- **Single file app**: All HTML, CSS, and JS are inline in `index.html`. No bundler, no framework, no React.
- **Styling**: Pico CSS loaded via CDN. Respects OS light/dark mode preference (no hardcoded `data-theme`). Custom styles are inline in a `<style>` block.
- **External dependencies**: Pico CSS is the only dependency, loaded from `cdn.jsdelivr.net`.
- **Auth**: Two modes:
  - **Personal Access Token (PAT)** — primary, zero infrastructure. Token stored in `sessionStorage`.
  - **OAuth Device Flow** — optional, requires a GitHub App + Cloudflare Worker CORS proxy (`worker.js`). See `DEVICE_FLOW_SETUP.md`.
- **Preferences**: Section visibility toggles stored in `localStorage` key `gh-dash-prefs`.
- **API**: All calls go to `api.github.com` with Bearer token auth.

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Entire app — markup, styles, and logic |
| `worker.js` | Optional Cloudflare Worker for Device Flow CORS proxy |
| `DEVICE_FLOW_SETUP.md` | Setup instructions for the optional Device Flow |

## Conventions

- **No build step**. Do not introduce bundlers, transpilers, or package managers.
- **No frameworks**. Vanilla JS only. No React, Vue, etc.
- **Keep it in one file**. All app code stays in `index.html`. The only exception is `worker.js` which runs on Cloudflare, not in the browser.
- **CDN only** for external dependencies. No `node_modules`.
- **Security**: Never store tokens in `localStorage` — use `sessionStorage`. Never send tokens to third-party services. CSP meta tag must be maintained.
- **Accessibility**: Use semantic HTML. Pico CSS provides accessible defaults — don't override them without reason.
- **Dark mode**: Do not hardcode `data-theme` on the `<html>` element. Pico CSS auto-detects OS preference.

## Testing

No test framework. Verify manually:

1. Open `index.html` in a browser (or serve via `python -m http.server`)
2. Sign in with a PAT
3. Confirm all enabled sections load data
4. Toggle sections off/on, reload, verify preference persistence
5. Check responsive layout at mobile (375px) and desktop (1200px+) widths
6. Verify no CSP violations in the browser console
