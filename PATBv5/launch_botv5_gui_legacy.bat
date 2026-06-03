@echo off
setlocal

echo [LEGACY] launch_botv5_gui_legacy.bat starts the old Python desktop GUI.
echo [LEGACY] The supported PATBv5 runtime is launch_patbv5_cli_and_review.bat
echo.

set "SCRIPT_DIR=%~dp0"
set "LOCAL_PY=%SCRIPT_DIR%.venv-win\Scripts\python.exe"

if exist "%LOCAL_PY%" (
  "%LOCAL_PY%" "%SCRIPT_DIR%botv5_gui.py"
  goto :eof
)

set "VENV_PY=%SCRIPT_DIR%..\.venv-win\Scripts\python.exe"
if exist "%VENV_PY%" (
  "%VENV_PY%" "%SCRIPT_DIR%botv5_gui.py"
  goto :eof
)

py -3 "%SCRIPT_DIR%botv5_gui.py"
