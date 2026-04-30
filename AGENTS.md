# AGENTS.md

## Project Overview

GitHub dashboard suite — two standalone pages sharing the same auth token:

- **`index.html`** — Shows items needing the user's attention: PRs, issues, and notifications across all repos.
- **`repomap.html`** — Treemap visualization of all repos. Tile area = disk size; tile color = selected metric (activity or size). Cross-page nav links connect both pages.

Vanilla HTML/CSS/JS with a minimal build step that assembles source files into single output files.

## Architecture

- **Source files in `src/`**: Each page has its own template, styles, and script. Shared patterns (auth, API, design tokens) are duplicated by convention — there is no shared runtime bundle.
- **Build step**: `scripts/build.sh` (bash) or `scripts/build.ps1` (PowerShell) calls a `build_page` function for each page. The function assembles source files, minifies via `bunx html-minifier-terser`, and computes CSP SHA-256 hashes. Both scripts produce identical output.
- **Single file output**: Each built page (`index.html`, `repomap.html`) contains all HTML, CSS, and JS inline. No external JS or CSS files are loaded at runtime.
- **Styling**: Custom CSS with design tokens. Respects OS light/dark mode preference via `prefers-color-scheme` media query. Google Fonts (Inter) loaded via CDN.
- **External dependencies**: Google Fonts is the only runtime CDN dependency. `html-minifier-terser` is a build-time dependency (via `bunx`).
- **CSP**: Content Security Policy uses SHA-256 hashes for inline `<style>` and `<script>` blocks — no `'unsafe-inline'`. Hashes are computed automatically by the build script. **Important**: the CSP value is injected as a placeholder (`PLACEHOLDER_CSP`) before minification and replaced afterward. Minifier flags that strip attribute quotes (e.g. `--remove-attribute-quotes`) must not be used — they will strip the quotes from the CSP `content` attribute while the placeholder is in place, leaving the real CSP value unquoted and broken.
- **Auth**: Two modes:
  - **Personal Access Token (PAT)** — primary, zero infrastructure. Classic tokens stored in `sessionStorage`, fine-grained tokens in `localStorage`.
  - **OAuth Device Flow** — optional, requires a GitHub App + Cloudflare Worker CORS proxy (`worker.js`). See `DEVICE_FLOW_SETUP.md`.
- **Shared auth state**: Both pages use the same `localStorage`/`sessionStorage` keys (`gh-token`, `gh-user`), so signing in on one page authenticates the other.
- **Preferences**: `index.html` section visibility stored in `localStorage` key `gh-dash-prefs`. `repomap.html` metric and filter state stored in `gh-repomap-metric` and `gh-repomap-prefs`.
- **API**: All calls go to `api.github.com` with Bearer token auth and ETag caching.
- **Rendering**: DOM construction via `createElement` (no `innerHTML` for dynamic content). This avoids inline `style=` attributes, which would require `'unsafe-inline'` in the CSP.

## Key Files

| File | Purpose |
|---|---|
| `src/index.template.html` | HTML skeleton for `index.html` with `{{CSP}}`, `{{STYLES}}`, `{{SCRIPT}}` placeholders |
| `src/styles.css` | All CSS for `index.html` — base styles, design tokens, component styles |
| `src/app.js` | All JavaScript for `index.html` |
| `src/repomap.template.html` | HTML skeleton for `repomap.html` |
| `src/repomap.css` | All CSS for `repomap.html` — shared base styles + treemap-specific styles |
| `src/repomap.js` | All JavaScript for `repomap.html` — repo fetching, treemap layout, color scale |
| `scripts/build.sh` | Bash build script — builds both pages via a `build_page()` function |
| `scripts/build.ps1` | PowerShell build script — identical functionality to `build.sh` |
| `index.html` | Built output — do not edit directly, regenerate via build script |
| `repomap.html` | Built output — do not edit directly, regenerate via build script |
| `worker.js` | Optional Cloudflare Worker for Device Flow CORS proxy |
| `DEVICE_FLOW_SETUP.md` | Setup instructions for the optional Device Flow |

## Conventions

- **Build produces one file per page**. Edit source files in `src/`, then run the build script.
- **No frameworks**. Vanilla JS only. No React, Vue, etc.
- **No inline `style=` attributes**. Use CSS classes or DOM API (`el.style.x = ...`) for dynamic styles. Inline `style=` attributes in HTML require `'unsafe-inline'` in the CSP.
- **No inline event handlers**. Use `addEventListener` instead of `onclick`/`onchange` attributes.
- **CDN only** for external runtime dependencies. No `node_modules` shipped to the browser.
- **Security**: Never store classic tokens in `localStorage` — use `sessionStorage`. Never send tokens to third-party services. CSP meta tag hashes are maintained by the build script.
- **Accessibility**: Use semantic HTML.
- **Dark mode**: Do not hardcode `data-theme` on the `<html>` element. The app auto-detects OS preference via `prefers-color-scheme`. Both pages must include the full `@media (prefers-color-scheme: dark)` token block in their CSS.

## Building

```sh
# Bash
bash scripts/build.sh

# PowerShell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

Requires `bun` (for `bunx html-minifier-terser`). Output is `index.html` and `repomap.html`.

## Adding a New Page

1. Create `src/<name>.template.html`, `src/<name>.css`, `src/<name>.js`
2. Add a `build_page` call at the bottom of both `scripts/build.sh` and `scripts/build.ps1`
3. Add the new output file to the `cp` command in `.github/workflows/gh-pages.yml`
4. Add cross-page nav links (`.nav-link` class) to the new page and to existing pages

## Testing

No test framework. Verify manually:

1. Run the build script and confirm it completes without errors
2. Open each built page in a browser
3. Sign in with a PAT on one page; confirm the other page is also authenticated
4. **index.html**: confirm all enabled sections load data; toggle sections, reload, verify preference persistence
5. **repomap.html**: confirm repos appear as a treemap; toggle Activity/Size metric; toggle Archived/Forks filters; hover tiles to verify tooltip
6. Check responsive layout at mobile (375px) and desktop (1200px+) widths
7. Verify no CSP violations in the browser console (both pages)
