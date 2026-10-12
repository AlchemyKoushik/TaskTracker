$ErrorActionPreference = 'Stop'
$uiRoot = Split-Path -Parent $PSScriptRoot
Push-Location $uiRoot
try {
    node node_modules/typescript/bin/tsc -p electron/tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript compilation of the Electron shell failed.' }
    Copy-Item -LiteralPath 'electron/package.json' -Destination 'dist-electron/package.json' -Force
} finally {
    Pop-Location
}
