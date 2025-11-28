@echo off
echo Starting RM365 Tools (Self-Hosted Mode)...
echo.

REM Get the directory of this script
set "SCRIPT_DIR=%~dp0"

REM Change to the repository root (parent of start-windows)
cd /d "%SCRIPT_DIR%\.."

REM Run the PowerShell script (use full path)
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1"

pause
