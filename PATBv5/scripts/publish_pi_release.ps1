[CmdletBinding()]
param(
    [string]$ShareRoot = "\\192.1.50.1\pifiles",
    [string]$RepositoryRoot = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}
$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
if (-not (Test-Path -LiteralPath $ShareRoot)) { throw "Samba share unavailable: $ShareRoot" }
$robocopy = Join-Path $env:SystemRoot "System32\robocopy.exe"
if (-not (Test-Path -LiteralPath $robocopy)) { throw "robocopy unavailable: $robocopy" }

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
$commit = if ($gitCommand) { (& git -C $repository rev-parse --short HEAD).Trim() } else { "0000000" }
$releaseId = "{0}-{1}" -f (Get-Date -Format "yyyyMMddTHHmmssZ"), $commit
$releaseRoot = Join-Path $ShareRoot "PATBv5\releases"
$releasePath = Join-Path $releaseRoot $releaseId
if (Test-Path -LiteralPath $releasePath) { throw "Release already exists: $releaseId" }

New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
$copyArgs = @($repository, (Join-Path $releasePath "PATBv5"), "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1", "/XD", ".git", "node_modules", "dist", "polydb", ".agents", ".codex", ".hallmark", ".superpowers", "/XF", ".env", ".env.*", "*.log")
& $robocopy @copyArgs
if ($LASTEXITCODE -gt 7) { throw "robocopy PATBv5 failed with exit code $LASTEXITCODE" }
$overlayArgs = @((Join-Path $repository "..\PATBv5pi"), (Join-Path $releasePath "PATBv5pi"), "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1", "/XF", ".env", ".env.*", "*.log")
& $robocopy @overlayArgs
if ($LASTEXITCODE -gt 7) { throw "robocopy PATBv5pi failed with exit code $LASTEXITCODE" }

$manifest = [ordered]@{ releaseId=$releaseId; publishedAt=(Get-Date).ToUniversalTime().ToString("o"); gitCommit=$commit; source="working-tree" } | ConvertTo-Json
$manifestPath = Join-Path $releasePath "release.json"
Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
$pointer = Join-Path $releaseRoot "current.json"
$temporaryPointer = "$pointer.tmp"
Set-Content -LiteralPath $temporaryPointer -Value $manifest -Encoding UTF8
Move-Item -LiteralPath $temporaryPointer -Destination $pointer -Force
Write-Output "Published Pi release $releaseId"
