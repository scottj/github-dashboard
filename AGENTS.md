# AGENTS.md

## Project Overview

Single-page GitHub dashboard (`index.html`) that shows items needing the user's attention: PRs, issues, and notifications across all repos. Vanilla HTML/CSS/JS with a minimal build step that assembles source files into a single output file.

## Architecture

- **Source files in `src/`**: Styles (`styles.css`), script (`app.js`), and HTML template (`template.html`) are maintained separately for readability.
- **Build step**: `scripts/build.sh` (bash) or `scripts/build.ps1` (PowerShell) assembles source files into a single `index.html`, minifies via `bunx html-minifier-terser`, and computes CSP SHA-256 hashes. Both scripts produce identical output.
- **Single file output**: The built `index.html` contains all HTML, CSS, and JS inline. No external JS or CSS files are loaded at runtime.
- **Styling**: Custom CSS with design tokens. Respects OS light/dark mode preference via `prefers-color-scheme` media query. Google Fonts (Inter) loaded via CDN.
- **External dependencies**: Google Fonts is the only runtime CDN dependency. `html-minifier-terser` is a build-time dependency (via `bunx`).
- **CSP**: Content Security Policy uses SHA-256 hashes for inline `<style>` and `<script>` blocks — no `'unsafe-inline'`. Hashes are computed automatically by the build script.
- **Auth**: Two modes:
  - **Personal Access Token (PAT)** — primary, zero infrastructure. Classic tokens stored in `sessionStorage`, fine-grained tokens in `localStorage`.
  - **OAuth Device Flow** — optional, requires a GitHub App + Cloudflare Worker CORS proxy (`worker.js`). See `DEVICE_FLOW_SETUP.md`.
- **Preferences**: Section visibility toggles stored in `localStorage` key `gh-dash-prefs`.
- **API**: All calls go to `api.github.com` with Bearer token auth and ETag caching.
- **Rendering**: DOM construction via `createElement` (no `innerHTML` for dynamic content). This avoids inline `style=` attributes, which would require `'unsafe-inline'` in the CSP.

## Key Files

| File | Purpose |
|---|---|
| `src/template.html` | HTML skeleton with `{{CSP}}`, `{{STYLES}}`, `{{SCRIPT}}` placeholders |
| `src/styles.css` | All CSS — base styles, design tokens, component styles, utility classes |
| `src/app.js` | All application JavaScript |
| `scripts/build.sh` | Bash build script — assembles, minifies, computes CSP hashes |
| `scripts/build.ps1` | PowerShell build script — identical functionality to `build.sh` |
| `index.html` | Built output — do not edit directly, regenerate via build script |
| `worker.js` | Optional Cloudflare Worker for Device Flow CORS proxy |
| `DEVICE_FLOW_SETUP.md` | Setup instructions for the optional Device Flow |

## Conventions

- **Build produces one file**. All app code ends up in `index.html`. Edit source files in `src/`, then run the build script.
- **No frameworks**. Vanilla JS only. No React, Vue, etc.
- **No inline `style=` attributes**. Use CSS classes or DOM API (`el.style.x = ...`) for dynamic styles. Inline `style=` attributes in HTML require `'unsafe-inline'` in the CSP.
- **No inline event handlers**. Use `addEventListener` instead of `onclick`/`onchange` attributes.
- **CDN only** for external runtime dependencies. No `node_modules` shipped to the browser.
- **Security**: Never store classic tokens in `localStorage` — use `sessionStorage`. Never send tokens to third-party services. CSP meta tag hashes are maintained by the build script.
- **Accessibility**: Use semantic HTML.
- **Dark mode**: Do not hardcode `data-theme` on the `<html>` element. The app auto-detects OS preference via `prefers-color-scheme`.

## Building

```sh
# Bash
bash scripts/build.sh

# PowerShell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

Requires `bun` (for `bunx html-minifier-terser`). Output is `index.html`.

## Testing

No test framework. Verify manually:

1. Run the build script and confirm it completes without errors
2. Open `index.html` in a browser (or serve via `python -m http.server`)
3. Sign in with a PAT
4. Confirm all enabled sections load data
5. Toggle sections off/on, reload, verify preference persistence
6. Check responsive layout at mobile (375px) and desktop (1200px+) widths
7. Verify no CSP violations in the browser console
