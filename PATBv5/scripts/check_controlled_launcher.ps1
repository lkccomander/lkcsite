$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeEnvScript = Join-Path $ScriptDir "runtime_env.ps1"
$LauncherPath = Join-Path $ScriptDir "..\run_bot.ps1"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("patbv5-controlled-launcher-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $TempRoot | Out-Null

. $RuntimeEnvScript

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) {
        throw "$Message | expected=$Expected actual=$Actual"
    }
}

function Assert-Match([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -notmatch $Pattern) {
        throw "$Message | missing pattern=$Pattern"
    }
}

function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Message) {
    $threw = $false
    try {
        & $Action
    }
    catch {
        $threw = $true
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "$Message | unexpected error=$($_.Exception.Message)"
        }
    }
    if (-not $threw) {
        throw "$Message | expected an exception"
    }
}

try {
    $envFile = Join-Path $TempRoot ".env"
    Set-Content -LiteralPath $envFile -Value "PAPER_TRADING=false" -Encoding UTF8

    $manual = Resolve-EffectiveTradingMode -EnvValue "false" -SourcePath $envFile
    Assert-Equal $manual.Name "LIVE" "manual mode must use env"
    Assert-Equal $manual.Source "ENV_FILE" "manual source"
    Assert-Equal $manual.PaperTradingValue "false" "manual paper value"

    $paper = Resolve-EffectiveTradingMode -EnvValue "false" -SourcePath $envFile -RequestedMode "PAPER"
    Assert-Equal $paper.Name "PAPER" "controlled PAPER override"
    Assert-Equal $paper.Source "CONTROL_OVERRIDE" "controlled source"
    Assert-Equal $paper.PaperTradingValue "true" "controlled PAPER value"

    $lowercasePaper = Resolve-EffectiveTradingMode -EnvValue "false" -SourcePath $envFile -RequestedMode "paper"
    Assert-Equal $lowercasePaper.Name "PAPER" "lowercase controlled PAPER name normalization"
    Assert-Equal $lowercasePaper.Source "CONTROL_OVERRIDE" "lowercase controlled PAPER source"
    Assert-Equal $lowercasePaper.PaperTradingValue "true" "lowercase controlled PAPER value"

    $live = Resolve-EffectiveTradingMode -EnvValue "true" -SourcePath $envFile -RequestedMode "LIVE"
    Assert-Equal $live.Name "LIVE" "controlled LIVE override"
    Assert-Equal $live.Source "CONTROL_OVERRIDE" "controlled LIVE source"
    Assert-Equal $live.PaperTradingValue "false" "controlled LIVE value"

    $manualParameters = Resolve-ControlledLauncherParameters
    Assert-Equal $manualParameters.IsControlled $false "manual launch must not be controlled"

    $validRunId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
    $normalizedRunId = $validRunId.ToLowerInvariant()
    $validGatePath = Join-Path $TempRoot "start-gate-$normalizedRunId.json"
    $partialParameterCases = @(
        { Resolve-ControlledLauncherParameters -Mode "PAPER" },
        { Resolve-ControlledLauncherParameters -RunId $validRunId },
        { Resolve-ControlledLauncherParameters -ControlDirectory $TempRoot },
        { Resolve-ControlledLauncherParameters -Mode "PAPER" -RunId $validRunId },
        { Resolve-ControlledLauncherParameters -Mode "PAPER" -ControlDirectory $TempRoot },
        { Resolve-ControlledLauncherParameters -RunId $validRunId -ControlDirectory $TempRoot },
        { Resolve-ControlledLauncherParameters -StartGatePath $validGatePath },
        { Resolve-ControlledLauncherParameters -Mode "PAPER" -RunId $validRunId -ControlDirectory $TempRoot }
    )
    foreach ($partialCase in $partialParameterCases) {
        Assert-Throws $partialCase "must be provided together" "partial controlled parameters must fail"
    }
    Assert-Throws {
        Resolve-ControlledLauncherParameters -Mode "LIVE" -RunId "bad" -ControlDirectory $TempRoot
    } "provided together" "controlled launch without a gate must fail closed"
    Assert-Throws {
        Resolve-ControlledLauncherParameters -Mode "LIVE" -RunId "bad" -ControlDirectory $TempRoot -StartGatePath $validGatePath
    } "version-4" "invalid controlled UUID must fail"
    Assert-Throws {
        Resolve-ControlledLauncherParameters -Mode "LIVE" -RunId $validRunId -ControlDirectory $TempRoot -StartGatePath (Join-Path $TempRoot "wrong.json")
    } "start gate" "unexpected controlled gate path must fail"

    $controlledParameters = Resolve-ControlledLauncherParameters `
        -Mode "LIVE" `
        -RunId $validRunId `
        -ControlDirectory $TempRoot `
        -StartGatePath $validGatePath
    Assert-Equal $controlledParameters.IsControlled $true "complete controlled parameters must be accepted"
    Assert-Equal $controlledParameters.Mode "LIVE" "controlled mode"
    Assert-Equal $controlledParameters.RunId ($validRunId.ToLowerInvariant()) "controlled UUID normalization"
    Assert-Equal $controlledParameters.ControlDirectory ([System.IO.Path]::GetFullPath($TempRoot)) "controlled directory normalization"
    Assert-Equal $controlledParameters.StartGatePath ([System.IO.Path]::GetFullPath($validGatePath)) "controlled gate normalization"

    $lowercaseControlledParameters = Resolve-ControlledLauncherParameters `
        -Mode "live" `
        -RunId $validRunId `
        -ControlDirectory $TempRoot `
        -StartGatePath $validGatePath
    Assert-Equal $lowercaseControlledParameters.Mode "LIVE" "controlled parameter mode normalization"

    $gatePayload = [ordered]@{ schemaVersion = 1; runId = $normalizedRunId; released = $true } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($validGatePath, $gatePayload, (New-Object System.Text.UTF8Encoding($false)))
    Wait-ControlledStartGate -StartGatePath $validGatePath -ControlDirectory $TempRoot -RunId $validRunId -TimeoutMilliseconds 100 -PollMilliseconds 1
    Assert-Equal (Test-Path -LiteralPath $validGatePath) $false "successful gate must be consumed"

    Assert-Throws {
        Wait-ControlledStartGate -StartGatePath $validGatePath -ControlDirectory $TempRoot -RunId $validRunId -TimeoutMilliseconds 1 -PollMilliseconds 1
    } "timed out" "missing gate must fail closed"

    $launcher = Get-Content -LiteralPath $LauncherPath -Raw
    Assert-Match $launcher '(?m)^param\s*\(' "launcher must start with a parameter block"
    Assert-Match $launcher '\[ValidateSet\("PAPER",\s*"LIVE"\)\]\[string\]\$Mode' "launcher must accept controlled Mode"
    Assert-Match $launcher '\[string\]\$RunId' "launcher must accept RunId"
    Assert-Match $launcher '\[string\]\$ControlDirectory' "launcher must accept ControlDirectory"
    Assert-Match $launcher '\[string\]\$StartGatePath' "launcher must accept StartGatePath"
    Assert-Match $launcher '\[switch\]\$NonInteractive' "launcher must accept NonInteractive"
    Assert-Match $launcher '\[switch\]\$SkipBuild' "launcher must accept SkipBuild"
    Assert-Match $launcher '\[switch\]\$DisableEmbeddedUi' "launcher must accept DisableEmbeddedUi"
    Assert-Match $launcher '\$ControlledParameterArguments\s*=\s*@\{' "launcher must build controlled arguments explicitly"
    Assert-Match $launcher 'if\s*\(\s*-not\s+\[string\]::IsNullOrWhiteSpace\(\$Mode\)\s*\)\s*\{\s*\$ControlledParameterArguments\["Mode"\]\s*=\s*\$Mode\s*\}' "launcher must bind Mode only when it has a value"
    Assert-Match $launcher 'Resolve-ControlledLauncherParameters\s+@ControlledParameterArguments' "launcher must reject partial controlled parameters through the tested helper"
    Assert-Match $launcher 'if\s*\(\s*-not\s+\[string\]::IsNullOrWhiteSpace\(\$ControlledParameters\.Mode\)\s*\)\s*\{\s*\$EffectiveModeArguments\["RequestedMode"\]\s*=\s*\$ControlledParameters\.Mode\s*\}' "launcher must bind RequestedMode only for controlled launches"
    Assert-Match $launcher 'Resolve-EffectiveTradingMode\s+@EffectiveModeArguments' "manual mode must omit an empty RequestedMode"
    if ($launcher -match 'Resolve-ControlledLauncherParameters\s+-Mode\s+\$Mode') {
        throw "manual launcher must not pass an empty Mode through ValidateSet"
    }
    if ($launcher -match 'Resolve-EffectiveTradingMode[^\r\n]*-RequestedMode\s+\$ControlledParameters\.Mode') {
        throw "manual launcher must not pass an empty RequestedMode through ValidateSet"
    }
    Assert-Match $launcher 'Wait-ControlledStartGate\s+-StartGatePath\s+\$ControlledParameters\.StartGatePath' "controlled wrapper must wait for the verified start gate"
    Assert-Match $launcher 'Wait-ControlledStartGate\s+-StartGatePath\s+\$ControlledParameters\.StartGatePath\s+-ControlDirectory\s+\$ControlledParameters\.ControlDirectory\s+-RunId\s+\$ControlledParameters\.RunId\s+-TimeoutMilliseconds\s+60000' "controlled wrapper must allow enough time for identity verification before gate timeout"
    Assert-Match $launcher '\$env:CODEX_CONTROL_RUN_ID\s*=' "launcher must export controlled run ID"
    Assert-Match $launcher '\$env:CODEX_CONTROL_DIR\s*=' "launcher must export controlled directory"
    Assert-Match $launcher 'Remove-Item\s+Env:CODEX_CONTROL_RUN_ID' "manual launch must clear inherited controlled run ID"
    Assert-Match $launcher 'Remove-Item\s+Env:CODEX_CONTROL_DIR' "manual launch must clear inherited controlled directory"
    Assert-Match $launcher '\$env:TRADING_MODE_SOURCE\s*=\s*"ENV_FILE"' "manual launch must declare env-file mode authority"
    Assert-Match $launcher '\$env:TRADING_MODE_SOURCE\s*=\s*"CONTROL_OVERRIDE"' "controlled launch must declare override authority"
    Assert-Match $launcher 'source=\$\(\$EffectiveMode\.Source\)' "launcher must display the effective mode source"
    Assert-Match $launcher '\$env:UI_SERVER_ENABLED\s*=\s*"0"' "DisableEmbeddedUi must disable the UI server"
    Assert-Match $launcher '\$env:UI_OPEN_BROWSER\s*=\s*"0"' "DisableEmbeddedUi must disable browser launch"
    Assert-Match $launcher 'if\s*\(\s*-not\s+\$SkipBuild\s*\)' "launcher must guard only the build with SkipBuild"
    Assert-Match $launcher '(?m)^\s*&\s+npm\s+start\s*$' "launcher must always retain bot execution"
    Assert-Match $launcher 'Bot exited with code \$BotExitCode\.' "nonzero bot exits must produce an actionable wrapper error"
    Assert-Match $launcher 'UTF8Encoding\(\$false\)' "wrapper result must be written as UTF-8 without BOM"

    $readHostCount = [regex]::Matches($launcher, '\bRead-Host\b').Count
    $guardedReadHostCount = [regex]::Matches(
        $launcher,
        'if\s*\(\s*-not\s+\$NonInteractive\s*\)\s*\{[^{}]*Read-Host',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    ).Count
    Assert-Equal $guardedReadHostCount $readHostCount "all Read-Host calls must be directly guarded by NonInteractive"

    if ($launcher -match 'Set-Content[^\r\n]*\$RuntimeEnvPath') {
        throw "launcher must never rewrite the runtime .env file"
    }

    Write-Host "controlled launcher tests passed"
}
finally {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
