@echo off
setlocal

set "RABBITHAT_SECRET_VAULT=botv4"
set "POSTGRES_PASSWORD="
for /f "usebackq delims=" %%P in (`powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0get_secret.ps1" "botv4_POSTGRES_MCP_PASSWORD"`) do set "POSTGRES_PASSWORD=%%P"

if not defined POSTGRES_PASSWORD (
    >&2 echo The PostgreSQL MCP credential is unavailable.
    exit /b 1
)

set "POSTGRES_HOST=127.0.0.1"
set "POSTGRES_PORT=5432"
set "POSTGRES_DATABASE=rabbitHat"
set "POSTGRES_USER=rabbithat_mcp_reader"
set "POSTGRES_QUERY_PARAMS="
set "NO_COLOR=1"

set "TOOLBOX_PATH=%LOCALAPPDATA%\RabbitHat\McpToolbox\v1.8.0\toolbox.exe"
if not exist "%TOOLBOX_PATH%" (
    >&2 echo MCP Toolbox v1.8.0 was not found.
    exit /b 1
)

"%TOOLBOX_PATH%" --prebuilt=postgres/data --stdio
set "MCP_EXIT=%ERRORLEVEL%"
set "POSTGRES_PASSWORD="
exit /b %MCP_EXIT%
