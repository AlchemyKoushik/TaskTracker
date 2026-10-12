$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
if (-not (Test-Path '.venv\Scripts\python.exe')) {
    py -3 -m venv .venv
}
& '.venv\Scripts\python.exe' -m pip install -r requirements.txt
& '.venv\Scripts\python.exe' -m uvicorn tasktracker.api:app --app-dir src --host 127.0.0.1 --port 8765
