$ErrorActionPreference = 'Stop'
$uiRoot = Split-Path -Parent $PSScriptRoot
Push-Location $uiRoot
try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    node node_modules/electron/cli.js .
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
