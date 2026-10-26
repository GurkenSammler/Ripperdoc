# Legt Verknüpfungen "RIPPERDOC" auf dem Desktop und im Startmenü an (Doppelklick statt Konsole).
# Sie starten Electron mit diesem Projektordner, also immer den letzten Build (out/). Nach Code-Änderungen:
# npm run build.
#   scripts\install-shortcut.ps1            (anlegen / erneuern)
#   scripts\install-shortcut.ps1 -Remove    (beide wieder löschen)
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'build\icon.ico'

$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'RIPPERDOC.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'RIPPERDOC.lnk')
)

if ($Remove) {
    foreach ($lnk in $targets) {
        if (Test-Path $lnk) { Remove-Item $lnk; "entfernt: $lnk" }
    }
    return
}

if (-not (Test-Path $electron)) { throw "Electron fehlt: npm install (bzw. node node_modules\electron\install.js)" }
if (-not (Test-Path (Join-Path $root 'out\main\index.js'))) { throw "Noch kein Build: npm run build" }

$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $targets) {
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $electron
    $s.Arguments = "`"$root`""
    $s.WorkingDirectory = $root
    $s.IconLocation = "$icon,0"
    $s.Description = 'RIPPERDOC - Mod Manager für Cyberpunk 2077'
    $s.Save()
    "angelegt: $lnk"
}
