<#
  Builds Quasar's installer and publishes it as a GitHub Release, which every installed
  copy of Quasar picks up by itself (it checks about every 4 hours and on start).

  First time only:
    1. Install the GitHub CLI and sign in:   winget install GitHub.cli   then   gh auth login
    2. Create a PUBLIC repo on github.com (tick "Add a README file" so it isn't empty).

  Each release (from the project folder):
    1. Set the new version in browser\package.json (and the Version line in browser\README.md).
    2. powershell -ExecutionPolicy Bypass -File tools\publish-quasar.ps1 -Notes "What changed"

  The first run needs -Owner <your GitHub name> (and -Repo if it isn't called "quasar");
  they're saved in tools\github.json for next time. Never change them afterwards:
  installed copies only look for updates in the repo they were built with.

  -BuildOnly builds dist\installer\Quasar-Setup-<version>.exe without publishing anything.
#>
param(
    [string]$Owner,
    [string]$Repo,
    [string]$Notes = '',
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$Root     = Split-Path -Parent $PSScriptRoot
$Browser  = Join-Path $Root 'browser'
$OutDir   = Join-Path $Root 'dist\installer'
$Saved    = Join-Path $PSScriptRoot 'github.json'
$version  = (Get-Content (Join-Path $Browser 'package.json') -Raw | ConvertFrom-Json).version

# Runs gh only to read its exit code. (Windows PowerShell turns a native command's error
# output into a terminating error under 'Stop', even when "not found" is the answer we want.)
function Test-Gh {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & gh @args 2>&1 | Out-Null; return $LASTEXITCODE -eq 0 } finally { $ErrorActionPreference = $old }
}

# ---- where releases go (remembered in tools\github.json)
$cfg = if (Test-Path $Saved) { Get-Content $Saved -Raw | ConvertFrom-Json } else { $null }
if ($cfg -and $cfg.owner -eq 'YOUR-GITHUB-NAME') { $cfg = $null }   # the placeholder from the guide, never published
if (-not $Owner -and $cfg) { $Owner = $cfg.owner }
if (-not $Repo) { $Repo = if ($cfg -and $cfg.repo) { $cfg.repo } else { 'quasar' } }
if (-not $Owner) { throw 'Tell me your GitHub name the first time: add  -Owner <your-github-name>' }
if ($cfg -and ($cfg.owner -ne $Owner -or $cfg.repo -ne $Repo)) {
    Write-Warning "Installed copies look for updates in $($cfg.owner)/$($cfg.repo). Publishing to $Owner/$Repo means they will NOT see this release."
    if ((Read-Host 'Type yes to switch anyway') -ne 'yes') { exit 1 }
}
@{ owner = $Owner; repo = $Repo } | ConvertTo-Json | Set-Content -Encoding utf8 $Saved
$slug = "$Owner/$Repo"

if (-not $BuildOnly) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "The GitHub CLI isn't installed. Run: winget install GitHub.cli   (then open a new terminal and run: gh auth login)" }
    if (-not (Test-Gh auth status)) { throw 'Sign in to GitHub first: gh auth login' }
    if (-not (Test-Gh repo view $slug --json name)) { throw "Can't find the repo $slug on GitHub. Create it (Public, with a README) or check -Owner/-Repo." }
    if (Test-Gh release view "v$version" --repo $slug) { throw "Version $version is already published. Raise the version in browser\package.json first." }
}

# ---- build the installer
if (-not (Test-Path (Join-Path $Browser 'node_modules\electron-builder'))) { throw "Run 'npm install' in the browser folder first." }
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
Push-Location $Browser
try {
    npx electron-builder --win nsis --publish never "-c.publish.provider=github" "-c.publish.owner=$Owner" "-c.publish.repo=$Repo"
    if ($LASTEXITCODE -ne 0) { throw 'The installer build failed (see above).' }
} finally { Pop-Location }

$exe   = Join-Path $OutDir "Quasar-Setup-$version.exe"
$files = @($exe, "$exe.blockmap", (Join-Path $OutDir 'latest.yml'))
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "Missing build output: $f" } }
$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "Built $exe ($mb MB)"
if ($BuildOnly) { return }

# ---- publish: installed copies read latest.yml from the newest release
if (-not $Notes) { $Notes = "Quasar $version" }
gh release create "v$version" @files --repo $slug --title "Quasar $version" --notes $Notes --latest
if ($LASTEXITCODE -ne 0) { throw 'Publishing the release failed (see above).' }
Write-Host ""
Write-Host "Published Quasar $version. Installed copies will update within a few hours (or at their next start)."
Write-Host "Download link for new friends: https://github.com/$slug/releases/latest"
