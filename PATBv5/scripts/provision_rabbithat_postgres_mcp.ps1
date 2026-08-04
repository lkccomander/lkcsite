[CmdletBinding()]
param(
    [string]$VaultName = "botv4",
    [string]$SecretName = "botv4_POSTGRES_MCP_PASSWORD",
    [string]$RoleName = "rabbithat_mcp_reader",
    [string]$DatabaseName = "rabbitHat",
    [switch]$RotatePassword
)

$ErrorActionPreference = "Stop"

function Assert-SafeIdentifier {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Value -notmatch '^[A-Za-z_][A-Za-z0-9_]{0,62}$') {
        throw "$Label contains unsupported characters."
    }
}

function New-RandomPassword {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-Psql {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password,
        [string]$Operation = "PostgreSQL command"
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:PsqlPath
    $startInfo.Arguments = "-w -X -q -h $script:DatabaseHost -p $script:DatabasePort -U $User -d $script:DatabaseName -v ON_ERROR_STOP=1 -t -A -P pager=off"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables["PGPASSWORD"] = $Password

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "Unable to start psql."
        }
        $process.StandardInput.Write($Sql)
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            $safeError = $stderr
            foreach ($sensitiveValue in @($script:SensitiveValues)) {
                if (-not [string]::IsNullOrEmpty([string]$sensitiveValue)) {
                    $safeError = $safeError.Replace([string]$sensitiveValue, "[REDACTED]")
                }
            }
            $safeError = $safeError -replace "(?i)PASSWORD\s+'[^']*'", "PASSWORD '[REDACTED]'"
            $safeError = (($safeError -split "`r?`n") | Select-Object -First 4) -join " "
            throw "$Operation failed with psql exit code $($process.ExitCode): $safeError"
        }
        return $stdout.Trim()
    }
    finally {
        $process.Dispose()
    }
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

Assert-SafeIdentifier -Value $RoleName -Label "RoleName"
Assert-SafeIdentifier -Value $DatabaseName -Label "DatabaseName"
if ($SecretName -notmatch '^[A-Za-z0-9_.-]+$') {
    throw "SecretName contains unsupported characters."
}

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$postgresEnvPath = Join-Path $workspaceRoot "polydb\postgres\.env"
$runtimeEnvScript = Join-Path $PSScriptRoot "runtime_env.ps1"
. $runtimeEnvScript
Import-DotEnv `
    -Path $postgresEnvPath `
    -OverrideNames @(
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_PSQL_PATH"
    ) `
    -RequiredNames @("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD")

if (-not [string]::Equals($env:POSTGRES_DB, $DatabaseName, [System.StringComparison]::Ordinal)) {
    throw "The configured PostgreSQL database does not match DatabaseName."
}
Assert-SafeIdentifier -Value $env:POSTGRES_USER -Label "POSTGRES_USER"

$script:DatabaseName = $DatabaseName
$script:DatabaseHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "127.0.0.1" }
if ($script:DatabaseHost -notmatch '^[A-Za-z0-9_.:-]+$') {
    throw "POSTGRES_HOST contains unsupported characters."
}
$databasePortValue = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { "5432" }
$parsedPort = 0
if (-not [int]::TryParse($databasePortValue, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    throw "POSTGRES_PORT is invalid."
}
$script:DatabasePort = $parsedPort
$script:PsqlPath = if ($env:POSTGRES_PSQL_PATH) {
    $env:POSTGRES_PSQL_PATH
}
else {
    "C:\Program Files\PostgreSQL\18\bin\psql.exe"
}
if (-not (Test-Path -LiteralPath $script:PsqlPath -PathType Leaf)) {
    throw "psql.exe was not found."
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

$vault = Get-SecretVault -Name $VaultName -ErrorAction Stop
if (-not $vault -or -not (Test-SecretVault -Name $VaultName)) {
    throw "Secret vault '$VaultName' is not ready."
}

$readerPassword = $null
if (-not $RotatePassword) {
    $readerPassword = Get-Secret `
        -Vault $VaultName `
        -Name $SecretName `
        -AsPlainText `
        -ErrorAction SilentlyContinue
}
if ([string]::IsNullOrWhiteSpace([string]$readerPassword)) {
    $readerPassword = New-RandomPassword
    $securePassword = ConvertTo-SecureString -String $readerPassword -AsPlainText -Force
    Set-Secret -Vault $VaultName -Name $SecretName -Secret $securePassword
}
if ([string]$readerPassword -notmatch '^[A-Za-z0-9_-]{43}$') {
    throw "The stored MCP credential has an unsupported format. Rerun with -RotatePassword."
}

$adminUser = $env:POSTGRES_USER
$adminPassword = $env:POSTGRES_PASSWORD
$script:SensitiveValues = @($readerPassword, $adminPassword)
$roleExists = Invoke-Psql `
    -User $adminUser `
    -Password $adminPassword `
    -Operation "Role lookup" `
    -Sql "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RoleName');"

$roleCommand = if ($roleExists -eq "t") {
    "ALTER ROLE `"$RoleName`" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '$readerPassword';"
}
else {
    "CREATE ROLE `"$RoleName`" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '$readerPassword';"
}

$provisionSql = @'
BEGIN;
SET LOCAL client_min_messages TO warning;
__ROLE_COMMAND__

REVOKE ALL PRIVILEGES ON DATABASE "__DATABASE__" FROM "__ROLE__";
GRANT CONNECT ON DATABASE "__DATABASE__" TO "__ROLE__";

REVOKE ALL PRIVILEGES ON SCHEMA public FROM "__ROLE__";
GRANT USAGE ON SCHEMA public TO "__ROLE__";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "__ROLE__";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "__ROLE__";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "__ROLE__";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "__ROLE__";

ALTER DEFAULT PRIVILEGES FOR ROLE "__ADMIN__" IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM "__ROLE__";
ALTER DEFAULT PRIVILEGES FOR ROLE "__ADMIN__" IN SCHEMA public
    GRANT SELECT ON TABLES TO "__ROLE__";
ALTER DEFAULT PRIVILEGES FOR ROLE "__ADMIN__" IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM "__ROLE__";
ALTER DEFAULT PRIVILEGES FOR ROLE "__ADMIN__" IN SCHEMA public
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM "__ROLE__";

ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET default_transaction_read_only TO on;
ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET statement_timeout TO '30s';
ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET lock_timeout TO '2s';
ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET idle_in_transaction_session_timeout TO '15s';
ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET work_mem TO '16MB';
ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET temp_file_limit TO '64MB';
ALTER ROLE "__ROLE__" IN DATABASE "__DATABASE__" SET search_path TO public, pg_catalog;

DO $audit$
DECLARE
    target_role_oid oid;
BEGIN
    SELECT oid INTO target_role_oid FROM pg_roles WHERE rolname = '__ROLE__';

    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE oid = target_role_oid
          AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'MCP role has a privileged role attribute';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = target_role_oid) THEN
        RAISE EXCEPTION 'MCP role has a role membership';
    END IF;

    IF NOT has_database_privilege('__ROLE__', '__DATABASE__', 'CONNECT')
       OR has_database_privilege('__ROLE__', '__DATABASE__', 'CREATE') THEN
        RAISE EXCEPTION 'MCP role has unsafe database privileges';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_namespace n
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND has_schema_privilege('__ROLE__', n.oid, 'CREATE')
    ) THEN
        RAISE EXCEPTION 'MCP role can create objects in a user schema';
    END IF;

    IF NOT has_schema_privilege('__ROLE__', 'public', 'USAGE') THEN
        RAISE EXCEPTION 'MCP role cannot use the public schema';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND NOT has_table_privilege('__ROLE__', c.oid, 'SELECT')
    ) THEN
        RAISE EXCEPTION 'MCP role is missing SELECT on a public relation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (
              has_table_privilege('__ROLE__', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_any_column_privilege('__ROLE__', c.oid, 'INSERT,UPDATE,REFERENCES')
          )
    ) THEN
        RAISE EXCEPTION 'MCP role has a write privilege on a user relation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND CASE
              WHEN c.relkind = 'S'
              THEN has_sequence_privilege('__ROLE__', c.oid, 'USAGE,UPDATE')
              ELSE false
          END
    ) THEN
        RAISE EXCEPTION 'MCP role can advance a user sequence';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND has_schema_privilege('__ROLE__', n.oid, 'USAGE')
          AND has_function_privilege('__ROLE__', p.oid, 'EXECUTE')
    ) THEN
        RAISE EXCEPTION 'MCP role can execute a user SECURITY DEFINER routine';
    END IF;
END
$audit$;
COMMIT;
'@
$provisionSql = $provisionSql.Replace("__ROLE__", $RoleName)
$provisionSql = $provisionSql.Replace("__DATABASE__", $DatabaseName)
$provisionSql = $provisionSql.Replace("__ADMIN__", $adminUser)
$provisionSql = $provisionSql.Replace("__ROLE_COMMAND__", $roleCommand)

$null = Invoke-Psql `
    -User $adminUser `
    -Password $adminPassword `
    -Operation "Role provisioning" `
    -Sql $provisionSql

$validationSql = @'
SELECT concat_ws('|',
    current_user,
    current_database(),
    current_setting('transaction_read_only'),
    current_setting('statement_timeout'),
    has_schema_privilege(current_user, 'public', 'USAGE'),
    has_schema_privilege(current_user, 'public', 'CREATE'),
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
);
'@
$validation = Invoke-Psql `
    -User $RoleName `
    -Password $readerPassword `
    -Operation "Role login validation" `
    -Sql $validationSql
$parts = $validation -split '\|'
if ($parts.Count -ne 7 `
    -or $parts[0] -ne $RoleName `
    -or $parts[1] -ne $DatabaseName `
    -or $parts[2] -ne "on" `
    -or $parts[3] -ne "30s" `
    -or $parts[4] -ne "t" `
    -or $parts[5] -ne "f") {
    throw "The MCP role validation did not return the expected read-only profile."
}

$readerPassword = $null
$adminPassword = $null
$env:POSTGRES_PASSWORD = $null
Write-Output "Provisioned and validated read-only role '$RoleName' for '$DatabaseName' ($($parts[6]) public relations)."
