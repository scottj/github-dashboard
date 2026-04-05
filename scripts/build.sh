#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

# Phase 1: Assemble src/template.html + src/styles.css + src/app.js into a temp file
bun -e '
const fs = require("fs");
let template = fs.readFileSync("src/template.html", "utf8");
const styles = fs.readFileSync("src/styles.css", "utf8");
const script = fs.readFileSync("src/app.js", "utf8");
template = template.replace("{{STYLES}}", styles).replace("{{SCRIPT}}", script).replace("{{CSP}}", "PLACEHOLDER_CSP");
fs.writeFileSync(".build-assembled.html", template);
'

# Phase 2: Minify the assembled HTML
bunx html-minifier-terser \
  --collapse-boolean-attributes \
  --collapse-whitespace \
  --decode-entities \
  --minify-css true \
  --minify-js true \
  --remove-comments \
  --remove-empty-attributes \
  --remove-redundant-attributes \
  --remove-script-type-attributes \
  --remove-style-link-type-attributes \
  --sort-attributes \
  --sort-class-name \
  --trim-custom-fragments \
  --use-short-doctype \
  --process-conditional-comments \
  -o .build-minified.html \
  .build-assembled.html

# Phase 3: Compute hashes and replace CSP placeholder using bun
bun -e '
const crypto = require("crypto");
const fs = require("fs");
const html = fs.readFileSync(".build-minified.html", "utf8");

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!styleMatch || !scriptMatch) { console.error("Failed to extract style/script"); process.exit(1); }

const styleHash = crypto.createHash("sha256").update(styleMatch[1]).digest("base64");
const scriptHash = crypto.createHash("sha256").update(scriptMatch[1]).digest("base64");

const csp = [
  "default-src '\''self'\''",
  "script-src '\''sha256-" + scriptHash + "'\''",
  "style-src '\''sha256-" + styleHash + "'\'' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src https://avatars.githubusercontent.com https://*.githubusercontent.com data:",
  "connect-src https://api.github.com",
].join("; ");

const final = html.replace("PLACEHOLDER_CSP", csp);
fs.writeFileSync("index.html", final);

console.log("Build complete: index.html");
console.log("  Style hash:  sha256-" + styleHash);
console.log("  Script hash: sha256-" + scriptHash);
'

# Cleanup
rm -f .build-assembled.html .build-minified.html
