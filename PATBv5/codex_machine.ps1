param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Building PATBv5 controller..."
& npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Building CODEX UI..."
& npm run ui:build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:UI_SERVER_ENABLED = "0"
$env:UI_OPEN_BROWSER = if ($NoBrowser) { "0" } else { "1" }
Write-Host "Starting CODEX control machine..."
& npm run control:start
exit $LASTEXITCODE
