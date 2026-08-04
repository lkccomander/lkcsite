$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$LauncherPath = Join-Path $RepoRoot "codex_machine.ps1"
$ControllerPath = Join-Path $RepoRoot "src\control\index.ts"
$HttpServerPath = Join-Path $RepoRoot "src\control\httpServer.ts"

function Assert-Match([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -notmatch $Pattern) { throw $Message }
}

if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
    throw "codex_machine.ps1 is missing"
}
if (-not (Test-Path -LiteralPath $ControllerPath -PathType Leaf)) {
    throw "src/control/index.ts is missing"
}
if (-not (Test-Path -LiteralPath $HttpServerPath -PathType Leaf)) {
    throw "src/control/httpServer.ts is missing"
}

$launcher = Get-Content -LiteralPath $LauncherPath -Raw
Assert-Match $launcher 'Set-Location\s+\$ScriptDir' "launcher must set its working directory"
Assert-Match $launcher 'param\s*\(\s*\[switch\]\$NoBrowser\s*\)' "launcher must support -NoBrowser"
Assert-Match $launcher '\$env:UI_SERVER_ENABLED\s*=\s*"0"' "launcher must disable the embedded UI"
Assert-Match $launcher '\$env:UI_OPEN_BROWSER\s*=\s*if\s*\(\$NoBrowser\)' "launcher must map -NoBrowser to UI_OPEN_BROWSER"

$backendBuild = $launcher.IndexOf("npm run build")
$uiBuild = $launcher.IndexOf("npm run ui:build")
$controlStart = $launcher.IndexOf("npm run control:start")
if ($backendBuild -lt 0 -or $uiBuild -lt 0 -or $controlStart -lt 0) {
    throw "launcher must build backend and UI before control:start"
}
if (-not ($backendBuild -lt $uiBuild -and $uiBuild -lt $controlStart)) {
    throw "launcher command order must be build, ui:build, control:start"
}
if ($launcher -match '(?i)(?:\bPAPER\b|\bLIVE\b|PAPER_TRADING|CODEX_CONTROL_RUN_ID|CODEX_CONTROL_DIR|-Mode\s+)') {
    throw "launcher must not contain a PAPER/LIVE bot mode override"
}
if ($launcher -match '(?i)(?:password|secret|passphrase|api[\s_-]*key|private[\s_-]*key)\s*[:=]\s*["'']?\S+') {
    throw "launcher must not contain credentials"
}

$controller = Get-Content -LiteralPath $ControllerPath -Raw
Assert-Match $controller 'createHash[\s\S]*?from\s+"node:crypto"|from\s+"node:crypto"[\s\S]*?createHash' "controller mutex name must use a stable cryptographic hash"
Assert-Match $controller 'createServer[\s\S]*?from\s+"node:net"|from\s+"node:net"[\s\S]*?createServer' "controller must reserve a Windows named pipe with node:net"
Assert-Match $controller 'patbv5-codex-' "controller mutex must use the patbv5-codex named-pipe prefix"
Assert-Match $controller 'EADDRINUSE' "controller must reject a second controller when its named pipe is occupied"
Assert-Match $controller 'controlMutex\s*=\s*await\s+acquireControlMutex\s*\(' "controller must acquire the OS mutex before file-lock recovery"
$mutexAcquire = $controller.IndexOf("controlMutex = await acquireControlMutex")
$lockRead = $controller.IndexOf("store.readControllerLock")
if ($mutexAcquire -lt 0 -or $lockRead -lt 0 -or $mutexAcquire -ge $lockRead) {
    throw "controller must acquire the OS mutex before touching controller.lock"
}
Assert-Match $controller 'closeServer\s*\(\s*controlMutex\s*\)' "controller must release the OS mutex during cleanup"
Assert-Match $controller 'fileLockHeld[\s\S]*?releaseControllerLock\s*\(\s*controllerIdentity\s*\)' "controller startup cleanup must release an acquired file lock"
Assert-Match $controller 'randomBytes\s*\(\s*32\s*\)' "controller must generate a random CSRF token"
Assert-Match $controller 'startControlHttpServer\s*\(' "controller must start the control HTTP server"
Assert-Match $controller 'setInterval\s*\([\s\S]*?controller\.reconcile\s*\([\s\S]*?,\s*500\s*\)' "controller must reconcile every 500 ms"
Assert-Match $controller 'clearInterval\s*\(\s*reconcileTimer\s*\)' "controller shutdown must clear the reconcile timer"
Assert-Match $controller 'closeServer\s*\(\s*listening\?\.server\s*\?\?\s*null\s*\)' "controller shutdown must close only its HTTP server"
Assert-Match $controller 'releaseControllerLock\s*\(\s*controllerIdentity\s*\)' "controller shutdown must release its own lock"
Assert-Match $controller 'process\.once\s*\(\s*"SIGINT"' "controller must handle SIGINT"
Assert-Match $controller 'process\.once\s*\(\s*"SIGTERM"' "controller must handle SIGTERM"
Assert-Match $controller 'listening\.url' "controller must consume the HTTP server URL"
Assert-Match $controller 'initialStatus\s*=\s*await\s+controller\.initialize\s*\(\s*\)' "controller must retain the initialize status"
Assert-Match $controller 'state=\$\{initialStatus\.state\}' "controller final log must reuse the initialize status"
if ($controller -match 'controller\.status\s*\(') {
    throw "controller startup must not perform a second status reconciliation"
}
if ($controller -match 'controller\.(?:stop|forceStop)\s*\(' -or $controller -match 'writeStopRequest\s*\(' -or $controller -match 'forceKillTree\s*\(') {
    throw "controller signals must not stop or force-stop an active bot"
}
if ($controller -match 'console\.(?:log|error)\s*\([^\r\n]*(?:csrfToken|process\.env)') {
    throw "controller logs must not expose CSRF or environment values"
}
if ($controller -match 'http://127\.0\.0\.1|terminal-v5/codex') {
    throw "controller must use listening.url instead of reconstructing the CODEX URL"
}

$httpServer = Get-Content -LiteralPath $HttpServerPath -Raw
Assert-Match $httpServer 'server\.listen\s*\(\s*port\s*,\s*"127\.0\.0\.1"\s*\)' "control HTTP listener must bind literal loopback"

Write-Host "codex machine contract checks passed"
