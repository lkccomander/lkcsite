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
