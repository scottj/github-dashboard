Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Push-Location "$PSScriptRoot/.."
try {
    # Phase 1: Assemble src/template.html + src/styles.css + src/app.js into a temp file
    $Styles = (Get-Content -Raw src/styles.css) -replace "`r`n", "`n"
    $Script = (Get-Content -Raw src/app.js) -replace "`r`n", "`n"
    $Template = (Get-Content -Raw src/template.html) -replace "`r`n", "`n"

    $Assembled = $Template.Replace('{{STYLES}}', $Styles).Replace('{{SCRIPT}}', $Script).Replace('{{CSP}}', 'PLACEHOLDER_CSP')
    [System.IO.File]::WriteAllText("$PWD/.build-assembled.html", $Assembled, [System.Text.UTF8Encoding]::new($false))

    # Phase 2: Minify the assembled HTML
    bunx html-minifier-terser `
        --collapse-boolean-attributes `
        --collapse-whitespace `
        --decode-entities `
        --minify-css true `
        --minify-js true `
        --remove-comments `
        --remove-empty-attributes `
        --remove-redundant-attributes `
        --remove-script-type-attributes `
        --remove-style-link-type-attributes `
        --sort-attributes `
        --sort-class-name `
        --trim-custom-fragments `
        --use-short-doctype `
        --process-conditional-comments `
        -o .build-minified.html `
        .build-assembled.html

    # Phase 3: Compute hashes and replace CSP placeholder
    $Minified = [System.IO.File]::ReadAllText("$PWD/.build-minified.html")

    if ($Minified -match '(?s)<style>(.*?)</style>') {
        $StyleContent = $Matches[1]
    } else {
        throw "Could not extract style content"
    }

    if ($Minified -match '(?s)<script>(.*?)</script>') {
        $ScriptContent = $Matches[1]
    } else {
        throw "Could not extract script content"
    }

    $Sha256 = [System.Security.Cryptography.SHA256]::Create()

    $StyleBytes = [System.Text.Encoding]::UTF8.GetBytes($StyleContent)
    $StyleHash = [Convert]::ToBase64String($Sha256.ComputeHash($StyleBytes))

    $ScriptBytes = [System.Text.Encoding]::UTF8.GetBytes($ScriptContent)
    $ScriptHash = [Convert]::ToBase64String($Sha256.ComputeHash($ScriptBytes))

    $CSP = "default-src 'self'; script-src 'sha256-$ScriptHash'; style-src 'sha256-$StyleHash' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https://avatars.githubusercontent.com https://*.githubusercontent.com data:; connect-src https://api.github.com"

    $Final = $Minified.Replace('PLACEHOLDER_CSP', $CSP)
    [System.IO.File]::WriteAllText("$PWD/index.html", $Final, [System.Text.UTF8Encoding]::new($false))

    # Cleanup
    Remove-Item -Force .build-assembled.html, .build-minified.html -ErrorAction SilentlyContinue

    Write-Host "Build complete: index.html"
    Write-Host "  Style hash:  sha256-$StyleHash"
    Write-Host "  Script hash: sha256-$ScriptHash"
} finally {
    Pop-Location
}
