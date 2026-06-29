param(
  [string]$SessionsFile = "sessions.txt",
  [string]$CheckerScript = ".\checker.ps1",
  [string]$OutputFile = "results.md"
)

$SessionsDir = Join-Path $PSScriptRoot "..\polydb\telemetry\sessions"

function Get-TimeFromName($name) {
  if ($name -match '^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)__') {
    return [datetime]::ParseExact(
      $matches[1],
      "yyyy-MM-ddTHH-mm-ss-fff'Z'",
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::AssumeUniversal
    )
  }
  return $null
}

# Read IDs
$ids = Get-Content $SessionsFile | Where-Object { $_.Trim() -ne "" }

$resolved = foreach ($id in $ids) {

  $file = Get-ChildItem -Path $SessionsDir -Filter "*__$id.jsonl" -File |
    Select-Object -First 1

  if ($file) {
    $time = Get-TimeFromName $file.Name
    if (-not $time) { $time = $file.LastWriteTime }

    [PSCustomObject]@{
      SessionID = $id
      Time = $time
    }
  }
}

# ✅ ORDER by real event time
$ordered = $resolved | Sort-Object Time

Write-Host "`nExecution order:`n"
$ordered | ForEach-Object {
  Write-Host "$($_.Time) -> $($_.SessionID)"
}

foreach ($s in $ordered) {
  & $CheckerScript -SessionID $s.SessionID -OutputFile $OutputFile
}