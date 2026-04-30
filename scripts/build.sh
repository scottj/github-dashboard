#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

build_page() {
  local TMPL="$1" STYLES="$2" SCRIPT="$3" OUT="$4"
  local ASSEMBLED=".build-assembled-${OUT}"
  local MINIFIED=".build-minified-${OUT}"

  # Phase 1: Assemble template + styles + script into a single HTML file
  TMPL_FILE="$TMPL" STYLES_FILE="$STYLES" SCRIPT_FILE="$SCRIPT" ASSEMBLED_FILE="$ASSEMBLED" \
  bun -e '
    const fs = require("fs");
    let template = fs.readFileSync(process.env.TMPL_FILE, "utf8");
    const styles = fs.readFileSync(process.env.STYLES_FILE, "utf8");
    const script = fs.readFileSync(process.env.SCRIPT_FILE, "utf8");
    template = template.replace("{{STYLES}}", styles).replace("{{SCRIPT}}", script).replace("{{CSP}}", "PLACEHOLDER_CSP");
    fs.writeFileSync(process.env.ASSEMBLED_FILE, template);
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
    -o "$MINIFIED" \
    "$ASSEMBLED"

  # Phase 3: Compute CSP hashes and write final output
  MINIFIED_FILE="$MINIFIED" OUT_FILE="$OUT" \
  bun -e '
    const crypto = require("crypto");
    const fs = require("fs");
    const html = fs.readFileSync(process.env.MINIFIED_FILE, "utf8");

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
    fs.writeFileSync(process.env.OUT_FILE, final);

    console.log("Build complete: " + process.env.OUT_FILE);
    console.log("  Style hash:  sha256-" + styleHash);
    console.log("  Script hash: sha256-" + scriptHash);
  '

  rm -f "$ASSEMBLED" "$MINIFIED"
}

build_page src/index.template.html   src/styles.css   src/app.js      index.html
build_page src/repomap.template.html src/repomap.css  src/repomap.js  repomap.html
