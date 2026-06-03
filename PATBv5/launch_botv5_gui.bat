@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

echo [LEGACY] launch_botv5_gui.bat is retained only for compatibility.
echo [LEGACY] It starts the old Python desktop GUI, not the current PATBv5 embedded UI.
echo [LEGACY] Recommended launcher: launch_patbv5_cli_and_review.bat
echo.
choice /C YC /M "Press Y to continue into the legacy Python GUI, or C to cancel"
if errorlevel 2 exit /b 0

call "%SCRIPT_DIR%launch_botv5_gui_legacy.bat"
