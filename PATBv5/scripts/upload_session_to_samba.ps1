param (
    [Parameter(Mandatory = $true)]
    [string]$SessionFile,
    [Parameter(Mandatory = $true)]
    [string]$SharePath,
    [Parameter(Mandatory = $true)]
    [string]$User,
    [Parameter(Mandatory = $true)]
    [string]$Password
)

$net = New-Object -ComObject WScript.Network
try {
    $net.MapNetworkDrive("T:", $SharePath, $false, $User, $Password)
    Copy-Item -Path $SessionFile -Destination "T:\sessions\" -Force
    Write-Output "OK: Session file copied to $SharePath\sessions\"
} catch {
    Write-Output "ERROR: $_"
} finally {
    try { $net.RemoveNetworkDrive("T:", $true) } catch {}
}
