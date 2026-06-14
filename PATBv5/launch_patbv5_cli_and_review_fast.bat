@rem Disable command echoing so the window shows cleaner output.
@echo off
@rem Keep environment-variable changes local to this script.
setlocal

@rem Capture the folder where this batch file lives.
set "SCRIPT_DIR=%~dp0"
@rem Switch to the script directory, even if it is on another drive.
cd /d "%SCRIPT_DIR%"

@rem Hardcode the bot id used by the review commands.
set "BOT_ID=polymarket-bot-v5"
@rem Point at the shared telemetry database file.
set "EVENTS_PATH=%SCRIPT_DIR%..\polydb\telemetry\events.jsonl"

@rem Print a startup header.
echo Starting PATBv5 CLI bot with post-run review...
echo FAST MODE: skipping npm build and using the existing dist output.
echo Repo: %SCRIPT_DIR%
echo Bot ID: %BOT_ID%
echo.

@rem Warn if TypeScript sources are newer than dist output.
set "DIST_ENTRY=%SCRIPT_DIR%dist\index.js"
set "STALE_DIST_FLAG="
if not exist "%DIST_ENTRY%" (
    echo WARNING: dist\index.js was not found.
    echo FAST MODE cannot guarantee current code. Run launch_patbv5_cli_and_review.bat instead.
    echo.
    set "STALE_DIST_FLAG=1"
) else (
    for %%F in (
        "%SCRIPT_DIR%src\index.ts"
        "%SCRIPT_DIR%src\telemetry\db.ts"
        "%SCRIPT_DIR%src\services\liveBalance.ts"
        "%SCRIPT_DIR%src\services\clob.ts"
        "%SCRIPT_DIR%src\trade\decision.ts"
        "%SCRIPT_DIR%src\trade\trade.ts"
    ) do (
        if exist "%%~fF" (
            for %%A in ("%DIST_ENTRY%") do set "DIST_MTIME=%%~tA"
            for %%B in ("%%~fF") do set "SRC_MTIME=%%~tB"
            powershell.exe -NoProfile -Command ^
              "if ((Get-Item '%DIST_ENTRY%').LastWriteTime -lt (Get-Item '%%~fF').LastWriteTime) { exit 10 } else { exit 0 }"
            if errorlevel 10 (
                echo WARNING: dist output looks older than %%~nxF
                set "STALE_DIST_FLAG=1"
            )
        )
    )
)

if defined STALE_DIST_FLAG (
    echo.
    echo FAST MODE warning: source changes may not be reflected in dist\index.js.
    echo Recommended: run launch_patbv5_cli_and_review.bat for a fresh build.
    echo.
)

set "LAUNCH_UI_AFTER_REVIEW=N"
choice /C YN /M "Enable embedded live-data UI for this bot run"
if errorlevel 2 goto ui_choice_done
if errorlevel 1 set "LAUNCH_UI_AFTER_REVIEW=Y"

:ui_choice_done
echo.

if /I "%LAUNCH_UI_AFTER_REVIEW%"=="Y" (
    echo Building newGui assets for the embedded UI...
    echo Running: npm.cmd run ui:build
    echo.
    call npm.cmd run ui:build
    if errorlevel 1 (
        echo.
        echo UI build failed with code %ERRORLEVEL%.
        pause
        exit /b %ERRORLEVEL%
    )
    echo.
    set "UI_SERVER_ENABLED=1"
    set "UI_OPEN_BROWSER=1"
)

echo Skipping PATBv5 build. Starting bot immediately...
echo.
if /I "%LAUNCH_UI_AFTER_REVIEW%"=="Y" (
    echo Embedded UI enabled for this run.
)
echo Running: npm.cmd start
echo.

@rem Run the bot until it exits or you stop it manually.
call npm.cmd start
set "BOT_EXIT_CODE=%ERRORLEVEL%"

echo.
echo PATBv5 CLI bot exited with code %BOT_EXIT_CODE%.
echo Looking up the latest telemetry session for %BOT_ID%...
echo.

@rem Read the latest session id for this bot from the telemetry file without loading the whole file into memory.
for /f "usebackq delims=" %%I in (`node scripts\find_latest_session_id.js "%EVENTS_PATH%" "%BOT_ID%"`) do set "LATEST_SESSION_ID=%%I"

if not defined LATEST_SESSION_ID (
    echo Could not find a telemetry session for %BOT_ID%.
    pause
    exit /b %BOT_EXIT_CODE%
)

echo Latest session: %LATEST_SESSION_ID%
echo.
echo Running: npm.cmd run validate:signals -- --bot-id %BOT_ID% --session-id %LATEST_SESSION_ID%
echo.
call npm.cmd run validate:signals -- --bot-id %BOT_ID% --session-id %LATEST_SESSION_ID%

echo.
echo Running: npx tsx scripts/analyze_trades.ts --bot-id %BOT_ID% --session-id %LATEST_SESSION_ID%
echo.
call npx.cmd tsx scripts/analyze_trades.ts --bot-id %BOT_ID% --session-id %LATEST_SESSION_ID%

echo.
echo Review flow finished for session %LATEST_SESSION_ID%.

:end
pause
