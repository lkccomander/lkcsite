param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        "POLYMARKET_PRIVATE_KEY",
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_API_PASSPHRASE",
        "BUILDER_API_KEY",
        "BUILDER_SECRET",
        "BUILDER_PASS_PHRASE",
        "RELAYER_API_KEY"
    )]
    [string]$Key,

    [string]$VaultName = "botv4",
    [string]$Prefix = "botv4_"
)

$ErrorActionPreference = "Stop"

Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop

$secretName = "$Prefix$Key"
$secretValue = Read-Host "Enter value for $secretName" -AsSecureString
$plainValue = [System.Net.NetworkCredential]::new("", $secretValue).Password
if ([string]::IsNullOrWhiteSpace($plainValue)) {
    throw "Refusing to store empty value for $secretName."
}
Set-Secret -Vault $VaultName -Name $secretName -Secret $secretValue

$storedValue = Get-Secret -Vault $VaultName -Name $secretName -AsPlainText -ErrorAction Stop
Write-Host "Stored $secretName in SecretStore vault '$VaultName' (length: $($storedValue.Length))."
