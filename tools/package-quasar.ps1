<#
  Builds a shareable copy of the Quasar browser: dist\Quasar-<version>-win-x64.zip.

  Usage (from the project folder):
    powershell -ExecutionPolicy Bypass -File tools\package-quasar.ps1

  The zip holds a ready-to-run Quasar.exe (Electron + Quasar's code). It never includes
  your own Quasar data: that lives in %APPDATA%\Quasar (or %APPDATA%\Arch for installs
  from before the rename), not in this folder. Files that carry this PC's paths
  (Quasar.lnk) are left out.
#>

$ErrorActionPreference = 'Stop'
$Root    = Split-Path -Parent $PSScriptRoot
$Browser = Join-Path $Root 'browser'
$pkg     = Get-Content (Join-Path $Browser 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$Dist    = Join-Path $Root 'dist'
$Stage   = Join-Path $Dist 'Quasar'
$Zip     = Join-Path $Dist "Quasar-$version-win-x64.zip"
$Icon    = Join-Path $Root 'icon\quasar.ico'

$electronDist = Join-Path $Browser 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
    throw "Electron isn't installed. Run 'npm install' in the browser folder first."
}
if (-not (Test-Path $Icon)) { throw "icon\quasar.ico is missing. Run tools\build.ps1 first." }

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
# Remove older builds (any version, including ones from when it was called Arch).
Get-ChildItem -ErrorAction SilentlyContinue (Join-Path $Dist 'Quasar-*-win-x64.zip'), (Join-Path $Dist 'Arch-*-win-x64.zip') | Remove-Item -Force
if (Test-Path (Join-Path $Dist 'Arch')) { Remove-Item -Recurse -Force (Join-Path $Dist 'Arch') }
New-Item -ItemType Directory -Force $Stage | Out-Null

# 1. The Electron runtime, renamed to Quasar.exe.
Copy-Item -Recurse (Join-Path $electronDist '*') $Stage
Rename-Item (Join-Path $Stage 'electron.exe') 'Quasar.exe'
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Stage 'resources\default_app.asar')

# 2. Quasar's code in resources\app (left unpacked so the engine updater can relaunch it).
$App = Join-Path $Stage 'resources\app'
New-Item -ItemType Directory -Force $App | Out-Null
Copy-Item (Join-Path $Browser 'package.json') $App
Copy-Item -Recurse (Join-Path $Browser 'src') $App
Copy-Item -Recurse (Join-Path $Browser 'ui')  $App
Copy-Item (Join-Path $Browser 'README.md') $App

# Runtime dependencies only (npm's production tree): Electron itself is already the exe,
# and electron-builder and its helpers are build-time tooling.
$nm = Join-Path $Browser 'node_modules'
Push-Location $Browser
try { $prod = npm ls --omit=dev --all --parseable 2>$null } finally { Pop-Location }
$prod = $prod | Where-Object { $_ -and $_.StartsWith($nm, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { $_.Substring($nm.Length + 1) } |
    ForEach-Object { $p = $_ -split '\\'; if ($p[0].StartsWith('@')) { "$($p[0])\$($p[1])" } else { $p[0] } } |
    Sort-Object -Unique
if (-not $prod) { throw "Couldn't list Quasar's runtime packages (npm ls failed)." }
New-Item -ItemType Directory -Force (Join-Path $App 'node_modules') | Out-Null
foreach ($rel in $prod) {
    $dest = Join-Path (Join-Path $App 'node_modules') $rel
    New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
    Copy-Item -Recurse (Join-Path $nm $rel) $dest
}

# 3. The icon, where Quasar's code looks for it (two folders above src\).
$IconDir = Join-Path $Stage 'resources\icon'
New-Item -ItemType Directory -Force $IconDir | Out-Null
Copy-Item $Icon $IconDir

# 4. Put Quasar's icon on Quasar.exe itself, if rcedit is available (optional).
$rcedit = Join-Path $PSScriptRoot 'rcedit-x64.exe'
if (Test-Path $rcedit) {
    & $rcedit (Join-Path $Stage 'Quasar.exe') --set-icon $Icon `
        --set-version-string ProductName Quasar --set-version-string FileDescription Quasar `
        --set-version-string CompanyName '' --set-version-string OriginalFilename Quasar.exe
    if ($LASTEXITCODE -ne 0) { throw 'rcedit failed' }
}

# 5. A short how-to for whoever unzips it.
@"
Quasar - an Arc-style browser for Windows
=========================================

1. Unzip this whole folder somewhere you'll keep it (e.g. Documents\Quasar).
   Don't run it from inside the zip.
2. Double-click Quasar.exe.
   Windows may say "Windows protected your PC" because the app isn't signed:
   click "More info" > "Run anyway".
3. Quasar adds itself to the Start menu on first run. To pin it, right-click its
   taskbar icon while it's running > Pin to taskbar.

Your bookmarks, logins and settings are stored in %APPDATA%\Quasar on your own PC
(or %APPDATA%\Arch if you used it before it was renamed from Arch).
To uninstall: delete this folder and that data folder.

Full guide: resources\app\README.md
"@ | Set-Content -Encoding utf8 (Join-Path $Stage 'READ ME FIRST.txt')

# 6. Zip it.
Compress-Archive -Path $Stage -DestinationPath $Zip -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
Write-Host "Built $Zip ($mb MB)"
