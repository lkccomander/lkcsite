function Import-DotEnv {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$OverrideNames = @(),
        [string[]]$RequiredNames = @()
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        if ($RequiredNames.Count -gt 0) {
            throw "Required environment file not found: $Path"
        }
        return
    }

    $values = @{}
    $counts = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmedLine = $line.TrimStart()
        if ([string]::IsNullOrWhiteSpace($trimmedLine) -or $trimmedLine.StartsWith("#")) { continue }
        if ($line -notmatch '^\s*([^#][^=]*)=(.*)$') { continue }
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"').Trim("'")
        if (-not $counts.ContainsKey($name)) { $counts[$name] = 0 }
        $counts[$name]++
        if (-not $values.ContainsKey($name)) { $values[$name] = $value }
    }

    foreach ($requiredName in $RequiredNames) {
        if (-not $values.ContainsKey($requiredName)) {
            throw "Required environment variable '$requiredName' is missing from $Path"
        }
    }
    foreach ($overrideName in $OverrideNames) {
        if ($counts.ContainsKey($overrideName) -and $counts[$overrideName] -gt 1) {
            throw "Duplicate environment variable '$overrideName' in $Path"
        }
    }

    foreach ($name in $values.Keys) {
        $existingValue = [Environment]::GetEnvironmentVariable($name, "Process")
        if (($OverrideNames -contains $name) -or -not $existingValue) {
            [Environment]::SetEnvironmentVariable($name, $values[$name], "Process")
        }
    }
}

function Resolve-TradingMode {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value,
        [Parameter(Mandatory = $true)][string]$SourcePath
    )

    $normalized = $Value.Trim().ToLowerInvariant()
    if (@("1", "true", "yes", "on") -contains $normalized) { return "PAPER" }
    if (@("0", "false", "no", "off") -contains $normalized) { return "LIVE" }
    throw "Invalid PAPER_TRADING value in $SourcePath. Use true/false, 1/0, yes/no, or on/off."
}

function Resolve-EffectiveTradingMode {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$EnvValue,
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [ValidateSet("PAPER", "LIVE")][string]$RequestedMode
    )

    $envMode = Resolve-TradingMode -Value $EnvValue -SourcePath $SourcePath
    if ([string]::IsNullOrWhiteSpace($RequestedMode)) {
        return [pscustomobject]@{
            Name = $envMode
            Source = "ENV_FILE"
            PaperTradingValue = if ($envMode -eq "PAPER") { "true" } else { "false" }
        }
    }
    $normalizedRequestedMode = $RequestedMode.ToUpperInvariant()
    return [pscustomobject]@{
        Name = $normalizedRequestedMode
        Source = "CONTROL_OVERRIDE"
        PaperTradingValue = if ($normalizedRequestedMode -eq "PAPER") { "true" } else { "false" }
    }
}

function Resolve-ControlledLauncherParameters {
    param(
        [ValidateSet("PAPER", "LIVE")][string]$Mode,
        [string]$RunId,
        [string]$ControlDirectory,
        [string]$StartGatePath
    )

    $hasMode = -not [string]::IsNullOrWhiteSpace($Mode)
    $hasRunId = -not [string]::IsNullOrWhiteSpace($RunId)
    $hasControlDirectory = -not [string]::IsNullOrWhiteSpace($ControlDirectory)
    $hasStartGatePath = -not [string]::IsNullOrWhiteSpace($StartGatePath)
    $hasAnyControlledParameter = $hasMode -or $hasRunId -or $hasControlDirectory -or $hasStartGatePath
    $hasAllControlledParameters = $hasMode -and $hasRunId -and $hasControlDirectory -and $hasStartGatePath

    if ($hasAnyControlledParameter -and -not $hasAllControlledParameters) {
        throw "Controlled run parameters -Mode, -RunId, -ControlDirectory, and -StartGatePath must be provided together."
    }
    if (-not $hasAnyControlledParameter) {
        return [pscustomobject]@{
            IsControlled = $false
            Mode = $null
            RunId = $null
            ControlDirectory = $null
            StartGatePath = $null
        }
    }
    if ($RunId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
        throw "Controlled run requires a valid version-4 -RunId UUID."
    }

    $normalizedRunId = $RunId.ToLowerInvariant()
    $normalizedControlDirectory = [System.IO.Path]::GetFullPath($ControlDirectory)
    $normalizedStartGatePath = Resolve-ControlledStartGatePath `
        -StartGatePath $StartGatePath `
        -ControlDirectory $normalizedControlDirectory `
        -RunId $normalizedRunId

    return [pscustomobject]@{
        IsControlled = $true
        Mode = $Mode.ToUpperInvariant()
        RunId = $normalizedRunId
        ControlDirectory = $normalizedControlDirectory
        StartGatePath = $normalizedStartGatePath
    }
}

function Resolve-ControlledStartGatePath {
    param(
        [Parameter(Mandatory = $true)][string]$StartGatePath,
        [Parameter(Mandatory = $true)][string]$ControlDirectory,
        [Parameter(Mandatory = $true)][string]$RunId
    )

    $normalizedControlDirectory = [System.IO.Path]::GetFullPath($ControlDirectory)
    $normalizedRunId = $RunId.ToLowerInvariant()
    $expectedGatePath = [System.IO.Path]::GetFullPath(
        (Join-Path $normalizedControlDirectory "start-gate-$normalizedRunId.json")
    )
    $normalizedGatePath = [System.IO.Path]::GetFullPath($StartGatePath)
    if (-not [string]::Equals(
        $normalizedGatePath,
        $expectedGatePath,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Controlled start gate must be the run-specific gate inside ControlDirectory."
    }
    return $normalizedGatePath
}

function Wait-ControlledStartGate {
    param(
        [Parameter(Mandatory = $true)][string]$StartGatePath,
        [Parameter(Mandatory = $true)][string]$ControlDirectory,
        [Parameter(Mandatory = $true)][string]$RunId,
        [ValidateRange(1, 60000)][int]$TimeoutMilliseconds = 15000,
        [ValidateRange(1, 1000)][int]$PollMilliseconds = 50
    )

    $normalizedRunId = $RunId.ToLowerInvariant()
    $validatedGatePath = Resolve-ControlledStartGatePath `
        -StartGatePath $StartGatePath `
        -ControlDirectory $ControlDirectory `
        -RunId $normalizedRunId
    $gateTempPath = "$validatedGatePath.tmp"
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
            if (Test-Path -LiteralPath $validatedGatePath -PathType Leaf) {
                $payload = Get-Content -LiteralPath $validatedGatePath -Raw | ConvertFrom-Json
                if ([int]$payload.schemaVersion -ne 1 `
                    -or [string]$payload.runId -cne $normalizedRunId `
                    -or [bool]$payload.released -ne $true) {
                    throw "Controlled start gate payload is invalid."
                }
                return
            }
            Start-Sleep -Milliseconds $PollMilliseconds
        }
        throw "Controlled start gate timed out after $TimeoutMilliseconds ms; bot launch was cancelled."
    }
    finally {
        $stopwatch.Stop()
        Remove-Item -LiteralPath $validatedGatePath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $gateTempPath -Force -ErrorAction SilentlyContinue
    }
}
