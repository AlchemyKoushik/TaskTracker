$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$uiRoot = Join-Path $projectRoot 'ui'
$output = Join-Path $env:LOCALAPPDATA 'TaskTrackerBuild\electron-release'
New-Item -ItemType Directory -Force -Path $output | Out-Null
Push-Location $uiRoot
try {
    node node_modules/electron-builder/cli.js "--config.directories.output=$output"
    if ($LASTEXITCODE -ne 0) { throw 'Electron Builder failed to create the Windows installer.' }

    $installer = Get-ChildItem -LiteralPath $output -Filter 'TaskTracker Setup*.exe' -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) { throw "Electron Builder completed without producing an installer in $output" }

    $release = Join-Path $uiRoot 'release'
    New-Item -ItemType Directory -Force -Path $release | Out-Null
    Copy-Item -LiteralPath $installer.FullName -Destination $release -Force
    $blockMap = Get-Item -LiteralPath ($installer.FullName + '.blockmap') -ErrorAction SilentlyContinue
    if ($blockMap) { Copy-Item -LiteralPath $blockMap.FullName -Destination $release -Force }
    Write-Output "Windows installer ready: $(Join-Path $release $installer.Name)"
} finally {
    Pop-Location
}
