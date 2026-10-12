$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$uiRoot = Join-Path $projectRoot 'ui'
$buildRoot = Join-Path $env:LOCALAPPDATA 'TaskTrackerBuild'
Push-Location $projectRoot
try {
    New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
    $buildVenv = Join-Path $buildRoot 'venv'
    py -3 -m venv $buildVenv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated backend build environment.' }
    $python = Join-Path $buildVenv 'Scripts/python.exe'
    & $python -m pip install -r (Join-Path $projectRoot 'requirements-desktop.txt') pyinstaller
    if ($LASTEXITCODE -ne 0) { throw 'Could not install backend build dependencies.' }

    $dist = Join-Path $buildRoot 'dist'
    $work = Join-Path $buildRoot 'work'
    $spec = Join-Path $buildRoot 'spec'
    New-Item -ItemType Directory -Force -Path $dist, $work | Out-Null
    & $python -m PyInstaller --noconfirm --clean --onefile --console `
        --name tasktracker-backend `
        --paths (Join-Path $projectRoot 'src') `
        --hidden-import tasktracker.api `
        --collect-all uvicorn `
        --collect-all fastapi `
        --collect-all sqlalchemy `
        --collect-all pydantic_settings `
        --collect-all tzdata `
        --distpath $dist `
        --workpath $work `
        --specpath $spec `
        (Join-Path $projectRoot 'src/tasktracker/__main__.py')
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to bundle the TaskTracker backend.' }
    $packageDist = Join-Path $uiRoot 'backend-dist'
    New-Item -ItemType Directory -Force -Path $packageDist | Out-Null
    Copy-Item -LiteralPath (Join-Path $dist 'tasktracker-backend.exe') -Destination $packageDist -Force
} finally {
    Pop-Location
}
