@rem Disable command echoing so the window shows cleaner output.
@echo off
@rem Keep environment-variable changes local to this script.
setlocal

@rem Capture the folder where this batch file lives.
set "SCRIPT_DIR=%~dp0"
@rem Switch to the script directory, even if it is on another drive.
cd /d "%SCRIPT_DIR%"

@rem Print a startup header.
echo Starting PATBv5 CLI bot...
@rem Show which repo/folder the script is running from.
echo Repo: %SCRIPT_DIR%
@rem Print a blank line for readability.
echo.

@rem Announce the build step.
echo Building PATBv5...
@rem Explain that CLI bot events will appear only after build finishes and start runs.
echo Waiting for TypeScript compile to finish. CLI events will appear after "Build succeeded. Starting bot..."
echo.
@rem Compile the TypeScript project into dist before starting the bot.
call npm.cmd run build
@rem If the build failed, stop here instead of starting stale or broken output.
if errorlevel 1 (
    @rem Print a blank line before the error message.
    echo.
    @rem Show the build failure exit code.
    echo Build failed with code %ERRORLEVEL%.
    @rem Keep the window open so the error can be read.
    pause
    @rem Exit this script and return the same failure code.
    exit /b %ERRORLEVEL%
)

@rem Print spacing between build and run steps.
echo.
@rem Confirm build success before launching the bot.
echo Build succeeded. Starting bot...
@rem Print a blank line for readability.
echo.
@rem Show the exact start command that will run next.
echo Running: npm.cmd start
echo.

@rem Start the compiled PATBv5 bot from dist.
call npm.cmd start

@rem Print spacing before the exit summary.
echo.
@rem Show the bot process exit code after it stops.
echo PATBv5 CLI bot exited with code %ERRORLEVEL%.
@rem Keep the window open after exit so the final status can be read.
pause
