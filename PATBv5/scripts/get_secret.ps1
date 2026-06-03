$secretNameFromArg = $args[0]
$ErrorActionPreference = "Stop"

$secretName = $secretNameFromArg
if ([string]::IsNullOrWhiteSpace($secretName) -or $secretName.StartsWith('$')) {
    $secretName = $env:RABBITHAT_SECRET_NAME
}
if ([string]::IsNullOrWhiteSpace($secretName)) {
    $secretName = $env:SECRET_NAME
}

if ([string]::IsNullOrWhiteSpace($secretName)) {
    throw "Secret name was not provided in RABBITHAT_SECRET_NAME or SECRET_NAME."
}

if ($secretName -notmatch '^[A-Za-z0-9_.-]+$') {
    throw "Secret name contains unsupported characters."
}

$vaultName = $env:RABBITHAT_SECRET_VAULT
if ([string]::IsNullOrWhiteSpace($vaultName)) {
    $vaultName = "botv4"
}

function Add-ModulePathIfPresent {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
        return
    }

    $paths = @($env:PSModulePath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($paths -notcontains $Path) {
        $env:PSModulePath = ($paths + $Path) -join ';'
    }
}

$documentsPath = [Environment]::GetFolderPath("MyDocuments")
Add-ModulePathIfPresent (Join-Path $documentsPath "WindowsPowerShell\Modules")
Add-ModulePathIfPresent (Join-Path $documentsPath "PowerShell\Modules")
Add-ModulePathIfPresent (Join-Path $env:USERPROFILE "Documents\WindowsPowerShell\Modules")
Add-ModulePathIfPresent (Join-Path $env:USERPROFILE "Documents\PowerShell\Modules")
Add-ModulePathIfPresent (Join-Path $env:OneDrive "Documents\WindowsPowerShell\Modules")
Add-ModulePathIfPresent (Join-Path $env:OneDrive "Documents\PowerShell\Modules")
Add-ModulePathIfPresent "C:\Program Files\WindowsPowerShell\Modules"
Add-ModulePathIfPresent "C:\Program Files\PowerShell\Modules"

Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop

$secretValue = Get-Secret -Name $secretName -Vault $vaultName -AsPlainText -ErrorAction Stop
if ($null -eq $secretValue) {
    throw "Secret '$secretName' was not found in vault '$vaultName'."
}

[Console]::Out.Write([string]$secretValue)
