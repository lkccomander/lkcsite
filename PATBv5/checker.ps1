param(
    [Parameter(Mandatory = $true)]
    [string]$SessionID,

    [string]$OutputFile = "results.md"
)

$ErrorActionPreference = "Stop"

$SessionsDir = Join-Path $PSScriptRoot "..\polydb\telemetry\sessions"

Write-Host ""
Write-Host ("BOT CHECKER: " + $SessionID)

$ResolvedTelemetryPath = $null
$DisplayTarget = $SessionID

# Resolve telemetry/session
if ($SessionID.ToLower().EndsWith(".jsonl") -or (Test-Path $SessionID)) {
    $ResolvedTelemetryPath = (Resolve-Path $SessionID).Path
    $DisplayTarget = $ResolvedTelemetryPath
}
else {
    $ResolvedSessionFile = $null

    if (Test-Path $SessionsDir) {
        $ResolvedSessionFile = Get-ChildItem -Path $SessionsDir -Filter "*__$SessionID.jsonl" -File -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            Select-Object -First 1
    }

    if ($ResolvedSessionFile) {
        $ResolvedTelemetryPath = $ResolvedSessionFile.FullName
        $DisplayTarget = $ResolvedSessionFile.FullName
    }
}

function Format-CommandForLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Exe,

        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    $parts = @($Exe)

    foreach ($arg in $Args) {
        if ($arg -match '\s') {
            $parts += ('"' + $arg + '"')
        }
        else {
            $parts += $arg
        }
    }

    return ($parts -join ' ')
}

function Run-And-Append {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OutputFilePath,

        [Parameter(Mandatory = $true)]
        [string]$Exe,

        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    $cmdText = Format-CommandForLog -Exe $Exe -Args $Args
    Write-Host ("Running: " + $cmdText)

    Add-Content -Path $OutputFilePath -Value ("### Command: " + $cmdText)

    try {
        $output = & $Exe @Args 2>&1 | Out-String
    }
    catch {
        $output = $_ | Out-String
    }

    Add-Content -Path $OutputFilePath -Value '```text'
    Add-Content -Path $OutputFilePath -Value ($output.TrimEnd())
    Add-Content -Path $OutputFilePath -Value '```'
    Add-Content -Path $OutputFilePath -Value ''
}

# Markdown header
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $OutputFile -Value ("## Session: " + $SessionID)
Add-Content -Path $OutputFile -Value ("- Time: " + $timestamp)
Add-Content -Path $OutputFile -Value ("- Target: " + $DisplayTarget)
Add-Content -Path $OutputFile -Value ''

# Command 0
Run-And-Append `
    -OutputFilePath $OutputFile `
    -Exe "npx" `
    -Args @("tsx", "tests/entry_ratio.test.ts")

# Shared args for npm commands
$commonArgs = @("--bot-id", "polymarket-bot-v5")

if (-not [string]::IsNullOrWhiteSpace($SessionID)) {
    $commonArgs += @("--session-id", $SessionID)
}

if (-not [string]::IsNullOrWhiteSpace($ResolvedTelemetryPath)) {
    $commonArgs += @("--telemetry-file", $ResolvedTelemetryPath)
}

# Command 1
Run-And-Append `
    -OutputFilePath $OutputFile `
    -Exe "npm" `
    -Args @("run", "validate:signals", "--") + $commonArgs

# Command 2
Run-And-Append `
    -OutputFilePath $OutputFile `
    -Exe "npm" `
    -Args @("run", "analyze:trades", "--") + $commonArgs

# Command 3
Run-And-Append `
    -OutputFilePath $OutputFile `
    -Exe "npm" `
    -Args @("run", "check:live-readiness", "--") + $commonArgs

Add-Content -Path $OutputFile -Value '---'
Add-Content -Path $OutputFile -Value ''

Write-Host ("Completed session " + $SessionID)
``