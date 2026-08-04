[CmdletBinding()]
param(
    [ValidateRange(5, 180)][int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$launcherPath = Join-Path $PSScriptRoot "start_rabbithat_postgres_mcp.cmd"
$commandPromptPath = "C:\Windows\System32\cmd.exe"
$expectedTools = @(
    "execute_sql",
    "list_indexes",
    "list_schemas",
    "list_sequences",
    "list_stored_procedure",
    "list_tables",
    "list_triggers",
    "list_views"
)

function Send-McpMessage {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)]$Message
    )

    $json = $Message | ConvertTo-Json -Compress -Depth 12
    $Process.StandardInput.WriteLine($json)
    $Process.StandardInput.Flush()
}

function Read-McpResponse {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][int]$Id,
        [Parameter(Mandatory = $true)][datetime]$Deadline
    )

    while ([datetime]::UtcNow -lt $Deadline) {
        $remainingMilliseconds = [int][Math]::Max(
            1,
            [Math]::Min(2147483647, ($Deadline - [datetime]::UtcNow).TotalMilliseconds)
        )
        $readTask = $Process.StandardOutput.ReadLineAsync()
        if (-not $readTask.Wait($remainingMilliseconds)) {
            throw "Timed out waiting for MCP response $Id."
        }
        $line = $readTask.Result
        if ($null -eq $line) {
            $exitDetail = if ($Process.HasExited) { " exit=$($Process.ExitCode)" } else { "" }
            $stderr = if ($Process.HasExited) { $Process.StandardError.ReadToEnd() } else { "" }
            $stderr = $stderr -replace '(?i)(password[^=:]*[=:]\s*)\S+', '$1[REDACTED]'
            $stderr = $stderr -replace '\b[A-Za-z0-9_-]{43}\b', '[REDACTED]'
            $stderr = (($stderr -split "`r?`n") | Select-Object -First 8) -join " "
            throw "The MCP server closed stdout before response $Id.$exitDetail $stderr"
        }
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        try {
            $message = $line | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "The MCP server emitted non-JSON data on stdout."
        }
        if ($message.PSObject.Properties.Name -contains "id" -and [int]$message.id -eq $Id) {
            if ($message.PSObject.Properties.Name -contains "error") {
                throw "MCP request $Id returned an error."
            }
            return $message
        }
    }
    throw "Timed out waiting for MCP response $Id."
}

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "The RabbitHat PostgreSQL MCP launcher was not found."
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $commandPromptPath
$startInfo.Arguments = '/d /q /c ""' + $launcherPath + '""'
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
$deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)

try {
    if (-not $process.Start()) {
        throw "Unable to start the RabbitHat PostgreSQL MCP server."
    }

    Send-McpMessage -Process $process -Message @{
        jsonrpc = "2.0"
        id = 1
        method = "initialize"
        params = @{
            protocolVersion = "2025-06-18"
            capabilities = @{}
            clientInfo = @{
                name = "rabbithat-postgres-mcp-check"
                version = "1.0.0"
            }
        }
    }
    $initializeResponse = Read-McpResponse -Process $process -Id 1 -Deadline $deadline
    if (-not $initializeResponse.result.serverInfo.name) {
        throw "The MCP initialize response is incomplete."
    }

    Send-McpMessage -Process $process -Message @{
        jsonrpc = "2.0"
        method = "notifications/initialized"
        params = @{}
    }

    Send-McpMessage -Process $process -Message @{
        jsonrpc = "2.0"
        id = 2
        method = "tools/list"
        params = @{}
    }
    $toolsResponse = Read-McpResponse -Process $process -Id 2 -Deadline $deadline
    $actualTools = @($toolsResponse.result.tools | ForEach-Object { [string]$_.name } | Sort-Object)
    $expectedSorted = @($expectedTools | Sort-Object)
    if (($actualTools -join "|") -ne ($expectedSorted -join "|")) {
        throw "The MCP server did not expose the expected eight read-oriented tools."
    }

    Send-McpMessage -Process $process -Message @{
        jsonrpc = "2.0"
        id = 3
        method = "tools/call"
        params = @{
            name = "list_tables"
            arguments = @{}
        }
    }
    $listTablesResponse = Read-McpResponse -Process $process -Id 3 -Deadline $deadline
    if ($listTablesResponse.result.isError) {
        throw "The list_tables MCP check failed."
    }

    Send-McpMessage -Process $process -Message @{
        jsonrpc = "2.0"
        id = 4
        method = "tools/call"
        params = @{
            name = "execute_sql"
            arguments = @{
                sql = "SELECT current_database() AS db, current_user AS db_user, current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS statement_timeout, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create, EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND (has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES'))) AS can_write, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) AS has_privileged_attribute, EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS has_membership, EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE') ELSE false END) AS can_advance_sequence, EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND has_schema_privilege(current_user, n.oid, 'USAGE') AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS can_execute_security_definer"
            }
        }
    }
    $sqlResponse = Read-McpResponse -Process $process -Id 4 -Deadline $deadline
    if ($sqlResponse.result.isError) {
        throw "The execute_sql MCP check failed."
    }
    $sqlText = (@($sqlResponse.result.content | Where-Object { $_.type -eq "text" } | ForEach-Object { $_.text }) -join " ")
    if ($sqlText -notmatch 'rabbitHat' `
        -or $sqlText -notmatch 'rabbithat_mcp_reader' `
        -or $sqlText -notmatch '(?i)read_only[^a-z]+on|transaction_read_only[^a-z]+on' `
        -or $sqlText -notmatch '30s' `
        -or $sqlText -notmatch '(?i)can_create[^a-z]+(false|f)' `
        -or $sqlText -notmatch '(?i)can_write[^a-z]+(false|f)' `
        -or $sqlText -notmatch '(?i)has_privileged_attribute[^a-z]+(false|f)' `
        -or $sqlText -notmatch '(?i)has_membership[^a-z]+(false|f)' `
        -or $sqlText -notmatch '(?i)can_advance_sequence[^a-z]+(false|f)' `
        -or $sqlText -notmatch '(?i)can_execute_security_definer[^a-z]+(false|f)') {
        throw "The MCP SQL check did not confirm the expected database, role, and read-only settings."
    }

    Write-Output "MCP_CHECK_OK tools=8 database=rabbitHat role=rabbithat_mcp_reader read_only=on"
}
finally {
    if ($process -and -not $process.HasExited) {
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(10000)) {
            & "C:\Windows\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
            $process.WaitForExit()
        }
    }
    if ($process) {
        $process.Dispose()
    }
}
