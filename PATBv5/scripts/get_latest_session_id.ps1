param (
    [Parameter(Mandatory = $true)]
    [string]$EventsPath,
    [Parameter(Mandatory = $true)]
    [string]$BotId
)

$tailBytes = 50000
$bufSize = $tailBytes
$fs = [System.IO.File]::OpenRead($EventsPath)
$len = $fs.Length
if ($len -le $tailBytes) {
    $bufSize = [int]$len
    $offset = [long]0
} else {
    $offset = $len - $tailBytes
}
$fs.Seek($offset, [System.IO.SeekOrigin]::Begin) | Out-Null
$buf = New-Object byte[] $bufSize
$read = $fs.Read($buf, 0, $bufSize)
$fs.Close()

$chunk = [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
$lines = $chunk -split "`n"

$lastId = $null
foreach ($line in $lines) {
    if (-not $line.Trim()) { continue }
    try {
        $e = $line | ConvertFrom-Json
        if ($e.botId -eq $BotId -and $e.sessionId) {
            $lastId = $e.sessionId
        }
    } catch {
    }
}

if ($lastId) {
    Write-Output $lastId
}
