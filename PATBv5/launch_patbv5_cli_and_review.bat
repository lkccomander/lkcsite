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
echo Repo: %SCRIPT_DIR%
echo Bot ID: %BOT_ID%
echo.

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

@rem Build before running so npm start uses fresh dist output.
echo Building PATBv5...
echo Waiting for TypeScript compile to finish. CLI events will appear after "Build succeeded. Starting bot..."
echo.
call npm.cmd run build
if errorlevel 1 (
    echo.
    echo Build failed with code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Build succeeded. Starting bot...
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

@rem Read the latest session id for this bot from the tail of events.jsonl (fast).
for /f "usebackq delims=" %%I in (`powershell -NoProfile -File "scripts\get_latest_session_id.ps1" -EventsPath "%EVENTS_PATH%" -BotId "%BOT_ID%"`) do set "LATEST_SESSION_ID=%%I"

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

@rem Copy the latest session telemetry to the Samba share.
if not defined TELEMETRY_SHARE_PATH (
    echo WARNING: Samba upload skipped because TELEMETRY_SHARE_PATH is not configured.
    goto upload_done
)
if not defined TELEMETRY_SHARE_USER (
    echo WARNING: Samba upload skipped because TELEMETRY_SHARE_USER is not configured.
    goto upload_done
)
if not defined TELEMETRY_SHARE_PASSWORD (
    echo WARNING: Samba upload skipped because TELEMETRY_SHARE_PASSWORD is not configured.
    goto upload_done
)

set "TELEMETRY_SHARE=%TELEMETRY_SHARE_PATH%\sessions"
echo Copying session telemetry to %TELEMETRY_SHARE% ...
echo.

@rem Clean up any stale mapping from a previous interrupted run.
net use T: /DELETE >nul 2>&1

@rem Authenticate to the Samba share.
net use T: "%TELEMETRY_SHARE_PATH%" /USER:"%TELEMETRY_SHARE_USER%" "%TELEMETRY_SHARE_PASSWORD%"
if errorlevel 1 (
    echo ERROR: Could not authenticate to the Samba share.
    echo.
) else (
    for /f "delims=" %%F in ('dir /b "%SCRIPT_DIR%..\polydb\telemetry\sessions\*%LATEST_SESSION_ID%*.jsonl" 2^>nul') do (
        echo Copying %%F ...
        copy /Y "%SCRIPT_DIR%..\polydb\telemetry\sessions\%%F" "T:\sessions\"
        if errorlevel 1 (
            echo ERROR: Failed to copy %%F.
        ) else (
            echo OK: %%F uploaded to %TELEMETRY_SHARE%.
        )
    )

    net use T: /DELETE
    if errorlevel 1 (
        echo WARNING: Could not disconnect T: drive.
    )
)

:upload_done

:end
pause
