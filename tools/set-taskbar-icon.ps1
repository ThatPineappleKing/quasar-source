<#
  Puts the Arc+Chrome icon on your pinned Chrome taskbar button.

  Before running: pin Chrome to the taskbar (open Chrome, right-click its
  taskbar button > "Pin to taskbar").

    powershell -ExecutionPolicy Bypass -File tools\set-taskbar-icon.ps1            # apply
    powershell -ExecutionPolicy Bypass -File tools\set-taskbar-icon.ps1 -Restore   # undo

  Only the pinned shortcut's icon is changed; Chrome itself is not modified.
  A backup of the original shortcut is kept next to this script.
  Chrome updates occasionally rewrite this shortcut; just run the script again.
#>
param([switch]$Restore)

$ErrorActionPreference = 'Stop'
$Root   = Split-Path -Parent $PSScriptRoot
$Icon   = Join-Path $Root 'icon\arc-chrome.ico'
$Pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$Backup = Join-Path $PSScriptRoot 'chrome-shortcut-backup.lnk'

$lnk = Get-ChildItem $Pinned -Filter '*.lnk' | Where-Object {
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName)
    $s.TargetPath -like '*\chrome.exe'
} | Select-Object -First 1

if (-not $lnk) {
    Write-Host 'No pinned Chrome shortcut found. Pin Chrome to the taskbar first, then run this again.'
    exit 1
}

if ($Restore) {
    if (-not (Test-Path $Backup)) { Write-Host 'No backup found; nothing to restore.'; exit 1 }
    Copy-Item $Backup $lnk.FullName -Force
    Write-Host "Restored original icon on $($lnk.Name)"
} else {
    if (-not (Test-Path $Icon)) { Write-Host 'Icon missing; run tools\build.ps1 first.'; exit 1 }
    if (-not (Test-Path $Backup)) { Copy-Item $lnk.FullName $Backup }
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk.FullName)
    $s.IconLocation = "$Icon,0"
    $s.Save()
    Write-Host "Set Arc+Chrome icon on $($lnk.Name)"
}

# Ask Explorer to refresh its icon cache so the change shows without a restart.
& "$env:SystemRoot\System32\ie4uinit.exe" -show
Write-Host 'If the old icon still shows, sign out and back in (or restart Explorer).'
