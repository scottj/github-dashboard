Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Push-Location "$PSScriptRoot/.."
try {
    function Build-Page {
        param(
            [string]$Template,
            [string]$Styles,
            [string]$Script,
            [string]$Output
        )

        $Assembled = ".build-assembled-$Output"
        $Minified  = ".build-minified-$Output"

        # Phase 1: Assemble template + styles + script
        $StylesContent   = (Get-Content -Raw $Styles) -replace "`r`n", "`n"
        $ScriptContent   = (Get-Content -Raw $Script) -replace "`r`n", "`n"
        $TemplateContent = (Get-Content -Raw $Template) -replace "`r`n", "`n"

        $AssembledContent = $TemplateContent.Replace('{{STYLES}}', $StylesContent).Replace('{{SCRIPT}}', $ScriptContent).Replace('{{CSP}}', 'PLACEHOLDER_CSP')
        [System.IO.File]::WriteAllText("$PWD/$Assembled", $AssembledContent, [System.Text.UTF8Encoding]::new($false))

        # Phase 2: Minify
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
            -o $Minified `
            $Assembled

        # Phase 3: Compute CSP hashes and write final output
        $MinifiedContent = [System.IO.File]::ReadAllText("$PWD/$Minified")

        if ($MinifiedContent -match '(?s)<style>(.*?)</style>') {
            $StyleBlock = $Matches[1]
        } else {
            throw "Could not extract style content from $Minified"
        }

        if ($MinifiedContent -match '(?s)<script>(.*?)</script>') {
            $ScriptBlock = $Matches[1]
        } else {
            throw "Could not extract script content from $Minified"
        }

        $Sha256 = [System.Security.Cryptography.SHA256]::Create()

        $StyleHash  = [Convert]::ToBase64String($Sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($StyleBlock)))
        $ScriptHash = [Convert]::ToBase64String($Sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ScriptBlock)))

        $CSP = "default-src 'self'; script-src 'sha256-$ScriptHash'; style-src 'sha256-$StyleHash' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https://avatars.githubusercontent.com https://*.githubusercontent.com data:; connect-src https://api.github.com"

        $Final = $MinifiedContent.Replace('PLACEHOLDER_CSP', $CSP)
        [System.IO.File]::WriteAllText("$PWD/$Output", $Final, [System.Text.UTF8Encoding]::new($false))

        Remove-Item -Force $Assembled, $Minified -ErrorAction SilentlyContinue

        Write-Host "Build complete: $Output"
        Write-Host "  Style hash:  sha256-$StyleHash"
        Write-Host "  Script hash: sha256-$ScriptHash"
    }

    Build-Page -Template src/index.template.html   -Styles src/styles.css   -Script src/app.js     -Output index.html
    Build-Page -Template src/repomap.template.html -Styles src/repomap.css  -Script src/repomap.js -Output repomap.html
} finally {
    Pop-Location
}
