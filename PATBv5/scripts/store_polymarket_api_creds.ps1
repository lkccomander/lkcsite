param(
    [string]$VaultName = "botv4",
    [string]$Prefix = "botv4_"
)

$ErrorActionPreference = "Stop"

Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop

$inputJson = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputJson)) {
    throw "Expected credential JSON on stdin."
}

$creds = $inputJson | ConvertFrom-Json -ErrorAction Stop
$values = @{
    "POLYMARKET_API_KEY" = [string]$creds.apiKey
    "POLYMARKET_API_SECRET" = [string]$creds.secret
    "POLYMARKET_API_PASSPHRASE" = [string]$creds.passphrase
}

foreach ($entry in $values.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($entry.Value)) {
        throw "Refusing to store empty value for $($entry.Key)."
    }

    $secretName = "$Prefix$($entry.Key)"
    $secureValue = ConvertTo-SecureString -String $entry.Value -AsPlainText -Force
    Set-Secret -Vault $VaultName -Name $secretName -Secret $secureValue
    Write-Host "Stored $secretName in SecretStore vault '$VaultName' (length: $($entry.Value.Length))."
}
